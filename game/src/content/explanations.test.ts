import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AccessEvent, AppEvent, Recording } from '../recordings/format';
import { ACCESS_TYPES, APP_TYPES, SENDERS, explainLine, lineType, parseCombined, senderOf } from './explanations';

/** Every recording in the library: the moves, the minions, the taps and the customer loops (D-15). */
function recordings(): Recording[] {
  const root = fileURLToPath(new URL('../recordings/', import.meta.url));
  const dirs = ['', 'taps/', 'traffic/'];
  return dirs.flatMap((d) => readdirSync(root + d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(root + d + f, 'utf8')) as Recording));
}

/** nginx's `combined` format as `renderCombined` writes it (engine/replay.ts), with a fixed stamp. */
const combined = (e: AccessEvent) =>
  `${e.ip} - - [22/Nov/2026:03:14:15 +0000] "${e.method} ${e.target} ${e.protocol}" ${e.status} ${e.bytes} "${e.referer || '-'}" "${e.userAgent || '-'}"`;

const all = recordings();
const accessLines = all.flatMap((r) => r.events.filter((e): e is AccessEvent => e.kind === 'access').map(combined));
const appLines = all.flatMap((r) => r.events.filter((e): e is AppEvent => e.kind === 'app').map((e) => e.text));

/**
 * Shapes no recording holds yet but the log can show: the lines the customer engine writes for shoppers turned
 * away (SYS-19: 403, 429, 503) and the admin API read whole (ATK-09's un-paginated form, PRD §3).
 */
const WORLD_LINES = [
  ...[403, 429, 503].map((status) =>
    `198.51.100.7 - - [22/Nov/2026:03:14:15 +0000] "GET /rest/products/search?q=apple HTTP/1.1" ${status} 169 "https://juice-sh.op/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"`),
  '203.0.113.9 - - [22/Nov/2026:03:14:15 +0000] "GET /api/Users HTTP/1.1" 200 48211 "-" "curl/8.23.0"',
];

const INTERNAL_ID = /\b(ATK|MIN|DEF|TAP|SYS|KIRO|CUST|CON|REC|UI|KI|D)-\d+\b|\bCUST\b|\bT1\d{3}\b/;
/** An explanation says what the line is; it never tells the player which action to take (KIRO-03's spirit). */
const TELLS_WHAT_TO_DO = /\b(deploy|patch|revoke|rotate|restore|block|unblock|disable|rate.?limit|turn off|switch off|pull the plug|iptables|waf)\b/i;

const ALL_TEXTS = [...ACCESS_TYPES, ...APP_TYPES].map((t) => t.text).concat(Object.values(SENDERS));

describe('log line explanations (CON-05, KIRO-05)', () => {
  it('reads the whole recording library', () => {
    expect(all.length).toBeGreaterThanOrEqual(26);
    expect(accessLines.length).toBeGreaterThan(10_000);
    expect(appLines.length).toBeGreaterThan(1_000);
  });

  it('parses every rendered access line back to its fields', () => {
    for (const r of all) {
      for (const e of r.events) {
        if (e.kind !== 'access') continue;
        const p = parseCombined(combined(e));
        expect(p, combined(e)).toBeDefined();
        expect(p).toMatchObject({ ip: e.ip, method: e.method, target: e.target, status: e.status, bytes: e.bytes, userAgent: e.userAgent });
      }
    }
    expect(parseCombined('Error: SQLITE_ERROR: near "%": syntax error')).toBeUndefined();
    expect(parseCombined('')).toBeUndefined();
  });

  it('gives every recorded access line a type', () => {
    const untyped = accessLines.filter((l) => lineType(l) === undefined);
    expect(untyped.slice(0, 20), `${untyped.length} untyped`).toEqual([]);
  });

  it('gives every recorded app line a type', () => {
    const untyped = appLines.filter((l) => lineType(l) === undefined);
    expect([...new Set(untyped)].slice(0, 20), `${untyped.length} untyped`).toEqual([]);
  });

  it('has no type that no line reaches (recorded, or one of the known unrecorded shapes)', () => {
    const hit = new Set([...accessLines, ...appLines, ...WORLD_LINES].map((l) => lineType(l)?.id));
    const dead = [...ACCESS_TYPES, ...APP_TYPES].map((t) => t.id).filter((id) => !hit.has(id));
    expect(dead).toEqual([]);
  });

  it('knows every user agent in the library', () => {
    const agents = new Set(all.flatMap((r) => r.events.filter((e): e is AccessEvent => e.kind === 'access').map((e) => e.userAgent)));
    const unknown = [...agents].filter((ua) => senderOf(ua) === 'unknown');
    expect(unknown).toEqual([]);
    expect(senderOf('')).toBe('none');
    expect(senderOf('Mozilla/5.0 (Hydra)')).toBe('hydra');
    expect(senderOf('Fuzz Faster U Fool v2.1.0-dev')).toBe('ffuf');
    expect(senderOf('sqlmap/1.10.11#pip (https://sqlmap.org)')).toBe('sqlmap');
  });

  it('explains a line with its type and its sender; unknown lines still get words', () => {
    const line = accessLines.find((l) => l.includes('sqlmap') && l.includes(' 500 '))!;
    const e = explainLine(line);
    expect(e.type).toBe('search-injection-error');
    expect(e.text).toContain(ACCESS_TYPES.find((t) => t.id === 'search-injection-error')!.text);
    expect(e.text).toContain(SENDERS.sqlmap);
    expect(explainLine(appLines.find((l) => l.startsWith('Error: SQLITE_ERROR'))!)).toMatchObject({ type: 'sqlite-error' });
    const unknown = explainLine('1.2.3.4 - - [x] "BREW /coffee HTCPCP/1.0" 418 0 "-" "-"');
    expect(unknown.type).toBeUndefined();
    expect(unknown.text).toContain(SENDERS.none);
    expect(explainLine('something the shop printed').type).toBeUndefined();
  });

  it('tells recorded shapes apart: a shopper\'s search, an injection that broke, an injection that answered', () => {
    const shopper = accessLines.find((l) => l.includes('/rest/products/search?q=apple ') || l.includes('/rest/products/search?q=juice '));
    expect(shopper && lineType(shopper)?.id).toBe('search');
    const hit = accessLines.find((l) => l.includes('sqlmap') && l.includes('UNION') && l.includes(' 200 '));
    expect(hit && lineType(hit)?.id).toBe('search-injection-hit');
    const walk = accessLines.find((l) => l.includes('"GET /api/Users/14 ') && l.includes(' 404 '));
    expect(walk && lineType(walk)?.id).toBe('user-record');
    const hydra = accessLines.find((l) => l.includes('Hydra') && l.includes('"GET /rest/user/login'));
    expect(hydra && lineType(hydra)?.id).toBe('login-get');
  });

  it('every type has an id, a title, a few sentences of plain words, and no spoilers', () => {
    const ids = [...ACCESS_TYPES, ...APP_TYPES].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of [...ACCESS_TYPES, ...APP_TYPES]) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.text.length, t.id).toBeGreaterThan(60);
      expect(t.text.length, t.id).toBeLessThanOrEqual(420);
      expect(t.text, t.id).toMatch(/[.]$/);
    }
    for (const text of ALL_TEXTS) {
      expect(text).not.toMatch(INTERNAL_ID);
      expect(text).not.toMatch(TELLS_WHAT_TO_DO);
    }
  });
});

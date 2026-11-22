/// <reference types="node" />
// Task 20.1 (R14.1, R14.2): the Shell touches the Engine only through the allowed surface, and the only
// player actions it ever causes are the ones in the design's table.
import { describe, expect, it } from 'vitest';
import { makeFixture } from './test-fixtures/fixture';
import { shellSources } from './test-fixtures/source-scan';

const ALLOWED_ENGINE_MEMBERS = new Set(['act', 'accessLog', 'appLog', 'files', 'evidence', 'db', 'world']);
const FORBIDDEN_ENGINE_MEMBERS = ['advance', 'pause', 'resume', 'subscribe'];
const ALLOWED_ACTION_TYPES = new Set([
  'DEF-01', 'DEF-02', 'DEF-03', 'DEF-04', 'DEF-05', 'DEF-06', 'DEF-08', 'DEF-11', 'DEF-14', 'DEF-15', 'DEF-18',
]);

describe('Shell source: Engine surface (R14.1, R14.2)', () => {
  const sources = shellSources();

  it('finds the Shell source files', () => {
    expect(sources.length).toBeGreaterThan(15);
  });

  it('reads only allowed members off an engine value', () => {
    const bad: string[] = [];
    for (const { rel, code } of sources) {
      for (const m of code.matchAll(/\bengine\s*\??\.\s*(\w+)/g)) {
        if (!ALLOWED_ENGINE_MEMBERS.has(m[1]!)) bad.push(`${rel}: engine.${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never calls advance, pause, resume or subscribe', () => {
    const bad: string[] = [];
    for (const { rel, code } of sources) {
      for (const name of FORBIDDEN_ENGINE_MEMBERS) {
        if (new RegExp(`\\.\\s*${name}\\s*\\(`).test(code)) bad.push(`${rel}: .${name}(`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never assigns to or mutates world members', () => {
    const assign = /\bworld\b[\w.$?[\]'"]*\s*(?:=(?![=>])|\+=|-=|\*=|\/=|\+\+|--)/;
    const mutate = /\bworld\b[\w.$?[\]'"]*\.(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|delete|clear)\s*\(/;
    const bad: string[] = [];
    for (const { rel, code } of sources) {
      code.split('\n').forEach((line, i) => {
        if (assign.test(line) || mutate.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('imports from the engine only types and gameTimeIso', () => {
    const bad: string[] = [];
    for (const { rel, code } of sources) {
      for (const m of code.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+['"]((?:\.\.\/)+engine\/[^'"]*)['"]/g)) {
        if (m[1]) continue;
        const names = m[2]!.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
        const runtime = names.filter((n) => !n.startsWith('type '));
        const isClock = m[3]!.endsWith('/engine/clock');
        if (runtime.length === 0) continue;
        if (!(isClock && runtime.length === 1 && runtime[0] === 'gameTimeIso')) bad.push(`${rel}: ${m[0]}`);
      }
      if (/\b(applyAction|advance)\b/.test(code.replace(/\.advance\b/g, ''))) {
        for (const m of code.matchAll(/import[^;]*\b(applyAction|advance)\b[^;]*;/g)) bad.push(`${rel}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('Shell runtime: only the table of actions', () => {
  it('sends only DEF-01..06, 08, 11, 14, 15, 18 over a mixed session', { timeout: 30_000 }, async () => {
    const f = makeFixture({
      seed: 3,
      advanceMs: 60_000,
      plant: [{ path: 'complaints/rip.php', content: '<?php echo 1;' }],
    });
    const lines = [
      'grep 200 /var/log/nginx/access.log | wc -l',
      'cat /var/log/juice-shop/app.log | head -3',
      'sqlite3 /srv/juice-shop/data/juiceshop.sqlite "SELECT email FROM Users LIMIT 2"',
      'ls -l /srv/juice-shop/uploads/complaints',
      'cat /srv/juice-shop/uploads/complaints/rip.php',
      'whois 203.0.113.9',
      'ping -c 1 203.0.113.9',
      'iptables -A INPUT -s 203.0.113.9 -j DROP',
      'iptables -L',
      'tar czf /evidence/snap.tgz /var/log/nginx',
      'systemctl restart nginx',
      'rm /srv/juice-shop/uploads/complaints/rip.php',
      'nonsense',
    ];
    for (const line of lines) await f.shell.run(line);
    const types = new Set(f.actions().map((e) => e.action.type));
    expect(types.size).toBeGreaterThan(0);
    for (const t of types) expect(ALLOWED_ACTION_TYPES.has(t), `unexpected action ${t}`).toBe(true);
  });
});

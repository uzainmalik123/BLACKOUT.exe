/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Recording } from '../recordings/format';
import { applyAction } from './actions';
import { advance } from './advance';
import { CONFIG } from './config';
import { footholds, gains } from './facts';
import { eventsOfKind } from './log';
import { libraryFrom, type RecordingLibrary } from './library';
import { activeDeathReplay, renderAccessLog, renderAppLog, startReplay } from './replay';
import { soulsStolen } from './souls';
import { initialWorld, type World } from './state';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';

const load = (file: string) => JSON.parse(readFileSync(new URL(`../recordings/${file}`, import.meta.url), 'utf8')) as Recording;
const COMMITTED = libraryFrom([load('ATK-03.a.json'), load('ATK-08.a.json')]);
const medium = CONFIG.medium;

/** Starts a move's first variant as Death and returns the world. */
function playing(lib: RecordingLibrary, move: Parameters<RecordingLibrary['variantsOf']>[0], variant = 0): World {
  const w = initialWorld(1, 'medium');
  startReplay(w, lib.variantsOf(move)[variant]!, 'death');
  return w;
}

describe('the replay engine (SYS-03)', () => {
  it('plays ATK-03.a: one access line at its recorded offset × 30, rendered as an nginx combined line, then lands with an admin session', () => {
    const w = playing(COMMITTED, 'ATK-03');
    expect(eventsOfKind(w, 'move-started')).toMatchObject([{ move: 'ATK-03', variant: 'a', stage: 2, ip: '203.0.113.23' }]);
    expect(w.alerts).toMatchObject([{ about: 'ATK-03', openedAt: 0 }]);
    advance(w, COMMITTED, 507); // 508 recorded ms → 15240 game ms; 507 real ms = 15210 game ms
    expect(w.logs.access).toHaveLength(0);
    advance(w, COMMITTED, 1);
    expect(w.logs.access).toHaveLength(1);
    expect(w.logs.access[0]!.t).toBe(15240);
    expect(renderAccessLog(w)).toBe('203.0.113.23 - - [31/Oct/2026:22:00:15 +0000] "POST /rest/user/login HTTP/1.1" 200 784 "-" "curl/8.23.0"\n');
    advance(w, COMMITTED, 300);
    expect(activeDeathReplay(w)).toBeUndefined();
    expect(gains(w).has('admin-session')).toBe(true);
    expect(w.sessions).toMatchObject([{ email: 'admin@juice-sh.op', kind: 'admin', issuedBy: 'ATK-03', keyVersion: 1 }]);
    expect(eventsOfKind(w, 'move-landed')).toMatchObject([{ move: 'ATK-03', variant: 'a' }]);
    expect(w.death.played).toEqual([{ move: 'ATK-03', variant: 'a', outcome: 'landed' }]);
    expect(w.alerts[0]!.closedAt).toBeDefined();
    expect(w.death.nextMoveAt).toBe(w.clock.gameMs + medium.moveGapGameMs);
  });

  it('plays ATK-08.a to the end: 402 access lines, 242 app lines, 325 souls stolen, souls-stolen events summing to 325', () => {
    const w = playing(COMMITTED, 'ATK-08');
    advance(w, COMMITTED, 6000);
    expect(w.logs.access).toHaveLength(402);
    expect(w.logs.app).toHaveLength(242);
    expect(soulsStolen(w)).toBe(325);
    expect(eventsOfKind(w, 'souls-stolen').reduce((n, e) => n + e.count, 0)).toBe(325);
    expect(renderAppLog(w).split('\n')[0]).toBe('Error: SQLITE_ERROR: near ",": syntax error');
    expect(w.ending).toBe('souls-lost');
  });

  it('blocking the IP mid-ATK-08 stops new lines from that IP within one tick', () => {
    const w = playing(COMMITTED, 'ATK-08');
    advance(w, COMMITTED, 1000);
    const n = w.logs.access.length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(402);
    applyAction(w, { type: 'DEF-06', ip: '203.0.113.81', op: 'add' });
    advance(w, COMMITTED, 100);
    expect(w.logs.access).toHaveLength(n);
    expect(eventsOfKind(w, 'move-cut')).toMatchObject([{ move: 'ATK-08', variant: 'a', by: 'DEF-06' }]);
    expect(w.death.played).toEqual([{ move: 'ATK-08', variant: 'a', outcome: 'cut' }]);
    expect(w.alerts[0]!.closedAt).toBeDefined();
    expect(w.death.nextMoveAt).toBeLessThanOrEqual(w.clock.gameMs + medium.cutRetryGameMs);
    expect(w.death.nextMoveAt).toBeGreaterThan(w.clock.gameMs);
    advance(w, COMMITTED, 2000);
    expect(w.logs.access).toHaveLength(n);
  });

  it('cuts the active move when any of its stoppers starts to hold (feature off, WAF rule, patch applied, plug pulled)', () => {
    const cases: Array<[string, (w: World) => void, string]> = [
      ['feature off', (w) => applyAction(w, { type: 'DEF-10', feature: 'search', enabled: false }), 'DEF-10'],
      ['sqli rule', (w) => applyAction(w, { type: 'DEF-12', rule: { kind: 'sqli' } }), 'DEF-12'],
      ['patch applied', (w) => w.patches.applied.push('search'), 'DEF-13'],
      ['plug pulled', (w) => applyAction(w, { type: 'DEF-11' }), 'DEF-11'],
    ];
    for (const [name, act, by] of cases) {
      const w = playing(FIXTURE_LIBRARY, 'ATK-08');
      advance(w, FIXTURE_LIBRARY, 300);
      const n = w.logs.access.length;
      act(w);
      advance(w, FIXTURE_LIBRARY, 100);
      expect(eventsOfKind(w, 'move-cut'), name).toMatchObject([{ move: 'ATK-08', by }]);
      expect(w.logs.access, name).toHaveLength(n);
    }
  });

  it('a quiet variant keeps playing through a leaky sqli rule on Medium and is cut on Easy', () => {
    const quiet = FIXTURE_LIBRARY.variantsOf('ATK-03')[2]!; // ATK-08 would end the run (all souls) before landing
    expect(quiet.info.quiet).toBe(true);
    const w = initialWorld(1, 'medium');
    w.waf.push({ kind: 'sqli' });
    startReplay(w, quiet, 'death');
    advance(w, FIXTURE_LIBRARY, 2000);
    expect(eventsOfKind(w, 'move-cut')).toEqual([]);
    expect(eventsOfKind(w, 'move-landed')).toHaveLength(1);
    const easy = initialWorld(1, 'easy');
    easy.waf.push({ kind: 'sqli' });
    startReplay(easy, quiet, 'death');
    advance(easy, FIXTURE_LIBRARY, 100);
    expect(eventsOfKind(easy, 'move-cut')).toMatchObject([{ by: 'DEF-12' }]);
  });

  it('db and file events shape the world: ATK-06 adds own-admin, ATK-11 the hidden admin, ATK-16 xss-live, ATK-13 a planted file, ATK-05 a user session, ATK-12 a hijack', () => {
    const run = (move: Parameters<RecordingLibrary['variantsOf']>[0]) => {
      const w = playing(FIXTURE_LIBRARY, move);
      advance(w, FIXTURE_LIBRARY, 7000); // the longest fixture (ATK-01) lasts 6 real s
      expect(eventsOfKind(w, 'move-landed'), move).toHaveLength(1);
      return w;
    };
    expect(gains(run('ATK-06')).has('own-admin')).toBe(true);
    expect(footholds(run('ATK-11')).has('hidden-admin')).toBe(true);
    expect(gains(run('ATK-16')).has('xss-live')).toBe(true);
    expect(gains(run('ATK-15')).has('defaced')).toBe(true);
    expect(footholds(run('ATK-13')).has('planted-file')).toBe(true);
    expect(gains(run('ATK-05')).has('user-session')).toBe(true);
    expect(footholds(run('ATK-12')).has('hijacked-user')).toBe(true);
    expect(footholds(run('ATK-14')).has('forged-token')).toBe(true);
    const w17 = run('ATK-17');
    expect(gains(w17).has('ransom')).toBe(true);
    expect(w17.bannerDefacedBy).toBe('ATK-17');
    expect(gains(run('ATK-01')).has('map')).toBe(true);
    expect(gains(run('ATK-04')).has('admin-password')).toBe(true);
    const w06 = run('ATK-06');
    expect(w06.logs.dbChanges).toHaveLength(1);
    expect(w06.accounts.at(-1)).toMatchObject({ id: 326, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
  });

  it('a minion replay is cut by its closer and never enters death.played', () => {
    const w = initialWorld(1, 'medium');
    startReplay(w, FIXTURE_LIBRARY.variantsOf('MIN-01')[0]!, 'MIN-01');
    advance(w, FIXTURE_LIBRARY, 300);
    expect(w.logs.access.length).toBeGreaterThan(0);
    applyAction(w, { type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'scanner' } });
    const n = w.logs.access.length;
    advance(w, FIXTURE_LIBRARY, 500);
    expect(w.logs.access).toHaveLength(n);
    expect(w.replays).toEqual([]);
    expect(w.death.played).toEqual([]);
    expect(eventsOfKind(w, 'move-cut')).toEqual([]);
  });
  it('blocking the IP after the last event but before the move ends lands it instead of leaving a resume that crashes', () => {
    const w = playing(COMMITTED, 'ATK-03'); // last event at 508 ms, duration 778 ms
    advance(w, COMMITTED, 600);
    expect(w.logs.access).toHaveLength(1);
    applyAction(w, { type: 'DEF-06', ip: '203.0.113.23', op: 'add' });
    advance(w, COMMITTED, 100);
    expect(w.death.resume).toEqual({});
    expect(eventsOfKind(w, 'move-landed')).toMatchObject([{ move: 'ATK-03' }]);
    expect(() => startReplay(w, COMMITTED.variantsOf('ATK-03')[0]!, 'death')).not.toThrow();
    expect(() => advance(w, COMMITTED, 30_000)).not.toThrow();
  });

  it('a move retried after a non-IP cut does not insert the same account twice', () => {
    const w = initialWorld(1, 'medium');
    w.sessions.push({ id: 1, email: 'admin@juice-sh.op', kind: 'admin', issuedBy: 'ATK-03', keyVersion: 1 });
    startReplay(w, FIXTURE_LIBRARY.variantsOf('ATK-11')[0]!, 'death');
    advance(w, FIXTURE_LIBRARY, 150); // the insert is in; the move has not ended
    applyAction(w, { type: 'DEF-11' });
    advance(w, FIXTURE_LIBRARY, 100);
    expect(eventsOfKind(w, 'move-cut')).toMatchObject([{ move: 'ATK-11', by: 'DEF-11' }]);
    applyAction(w, { type: 'DEF-18', what: 'nginx' });
    startReplay(w, FIXTURE_LIBRARY.variantsOf('ATK-11')[0]!, 'death');
    advance(w, FIXTURE_LIBRARY, 1000);
    expect(w.accounts.filter((a) => a.id === 27)).toHaveLength(1);
    expect(applyAction(w, { type: 'DEF-14', email: 'support-ops@juice-sh.op' }).ok).toBe(true);
    expect(footholds(w).has('hidden-admin')).toBe(false);
  });
});

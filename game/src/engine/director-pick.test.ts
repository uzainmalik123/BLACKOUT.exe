import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { advance } from './advance';
import { CONFIG } from './config';
import { directorTick, openAlerts } from './director';
import { eventsOfKind } from './log';
import { libraryFrom } from './library';
import { initialWorld, type World } from './state';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';

const medium = CONFIG.medium;
const REAL_S = 1000;
const lib = FIXTURE_LIBRARY;

function run(seed: number, realMs: number, player?: (w: World, t: number) => void): World {
  const w = initialWorld(seed, 'medium');
  for (let t = 0; t < realMs && !w.ending; t += REAL_S) {
    player?.(w, t);
    advance(w, lib, REAL_S);
  }
  return w;
}
const moves = (w: World) => eventsOfKind(w, 'move-started').map((e) => `${e.move}.${e.variant}`);

describe('the Director (SYS-02)', () => {
  it('a seeded run produces the same move sequence every time', () => {
    const a = run(1, 10 * 60 * REAL_S);
    const b = run(1, 10 * 60 * REAL_S);
    expect(moves(a)).toEqual(moves(b));
    expect(moves(a).length).toBeGreaterThanOrEqual(4);
    expect(a.events).toEqual(b.events);
  });

  it('prefers later stages among allowed candidates and ties deterministically', () => {
    const w = initialWorld(1, 'medium');
    w.death.knowledge.push('map');
    w.death.played.push({ move: 'ATK-01', variant: 'a', outcome: 'landed' });
    directorTick(w, lib);
    const [started] = eventsOfKind(w, 'move-started');
    expect(started!.stage).toBe(2);
    const again = initialWorld(1, 'medium');
    again.death.knowledge.push('map');
    again.death.played.push({ move: 'ATK-01', variant: 'a', outcome: 'landed' });
    directorTick(again, lib);
    expect(eventsOfKind(again, 'move-started')[0]!.move).toBe(started!.move);
  });

  it('switches to another variant and IP after a cut, and comes back from a fresh IP when every recorded one is blocked', () => {
    const w = run(1, 4 * REAL_S); // the first Director tick is at 3 real s
    expect(moves(w)).toEqual(['ATK-01.a']);
    const ip = eventsOfKind(w, 'move-started')[0]!.ip;
    applyAction(w, { type: 'DEF-06', ip, op: 'add' });
    advance(w, lib, REAL_S);
    expect(eventsOfKind(w, 'move-cut')).toMatchObject([{ move: 'ATK-01', variant: 'a', by: 'DEF-06' }]);
    const linesBefore = w.logs.access.length;
    advance(w, lib, medium.ipResumeGameMs / 30 + 3 * REAL_S);
    expect(moves(w)).toEqual(['ATK-01.a', 'ATK-01.a']); // the same scan carries on from a fresh IP (D-24)
    expect(eventsOfKind(w, 'move-started')[1]!.ip).not.toBe(ip);
    expect(w.logs.access.slice(linesBefore).every((l) => l.ip === eventsOfKind(w, 'move-started')[1]!.ip)).toBe(true);
    expect(w.logs.access.slice(linesBefore).length).toBeLessThan(60); // it did not start over
    const blockedAll = run(1, 4 * REAL_S);
    for (const v of lib.variantsOf('ATK-01')) applyAction(blockedAll, { type: 'DEF-06', ip: v.info.ip, op: 'add' });
    advance(blockedAll, lib, 60 * REAL_S);
    expect(moves(blockedAll).length).toBeGreaterThanOrEqual(2); // he comes back from a fresh IP (D-24)
    const fresh = eventsOfKind(blockedAll, 'move-started')[1]!.ip;
    expect(lib.variantsOf('ATK-01').map((v) => v.info.ip)).not.toContain(fresh);
    expect(blockedAll.logs.access.some((l) => l.ip === fresh)).toBe(true);
    expect(blockedAll.ending).toBeUndefined();
    applyAction(blockedAll, { type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } });
    advance(blockedAll, lib, 60 * REAL_S); // loud variants stopped; the quiet one leaks through and lands
  });

  it('pacing: more than 3 open alerts delays the next move once; no open alert for 60 real s brings it forward', () => {
    const w = initialWorld(1, 'medium');
    for (let i = 0; i < 4; i++) w.alerts.push({ id: i, about: 'MIN-01', openedAt: 0 });
    expect(openAlerts(w)).toBe(4);
    directorTick(w, lib);
    expect(eventsOfKind(w, 'move-started')).toEqual([]);
    expect(w.death.nextMoveAt).toBe(medium.breatherGameMs.max);
    directorTick(w, lib);
    expect(w.death.nextMoveAt).toBe(medium.breatherGameMs.max); // once, not every tick
    const q = initialWorld(1, 'medium');
    q.death.nextMoveAt = 10 * medium.breatherGameMs.max;
    q.clock.gameMs = medium.pacing.bringForwardAfterQuietGameMs - 3000;
    directorTick(q, lib);
    expect(eventsOfKind(q, 'move-started')).toEqual([]);
    q.clock.gameMs = medium.pacing.bringForwardAfterQuietGameMs;
    directorTick(q, lib);
    expect(eventsOfKind(q, 'move-started')).toHaveLength(1);
  });

  it('a tip-off lets him skip one stage and play at once', () => {
    const w = initialWorld(1, 'medium');
    w.death.knowledge.push('map');
    w.death.played.push({ move: 'ATK-01', variant: 'a', outcome: 'landed' });
    w.clock.gameMs = 1000;
    w.death.nextMoveAt = 10 * medium.breatherGameMs.max;
    applyAction(w, { type: 'DEF-04', ip: '203.0.113.10', mode: 'active' });
    directorTick(w, lib);
    const [started] = eventsOfKind(w, 'move-started');
    expect(started!.stage).toBe(3);
    expect(started!.move).toBe('ATK-06');
    expect(w.death.stageSkips).toBe(0);
  });
  it('starts nothing while the plug is pulled, and resumes when nginx is back', () => {
    const w = initialWorld(1, 'medium');
    applyAction(w, { type: 'DEF-11' });
    advance(w, lib, 30 * REAL_S); // (the plug flatlines at 50 real s: SYS-06)
    expect(eventsOfKind(w, 'move-started')).toEqual([]);
    expect(eventsOfKind(w, 'move-cut')).toEqual([]);
    expect(w.ending).toBeUndefined();
    applyAction(w, { type: 'DEF-18', what: 'nginx' });
    advance(w, lib, 4 * REAL_S);
    expect(eventsOfKind(w, 'move-started')).toHaveLength(1);
  });

  it('a tip-off during an active move skips the wait after it lands', () => {
    const w = run(1, 4 * REAL_S);
    expect(w.replays).toHaveLength(1);
    applyAction(w, { type: 'DEF-04', ip: eventsOfKind(w, 'move-started')[0]!.ip, mode: 'active' });
    advance(w, lib, 10 * REAL_S); // ATK-01's fixture lasts 6 s
    const landed = eventsOfKind(w, 'move-landed')[0]!;
    expect(landed.move).toBe('ATK-01');
    const next = eventsOfKind(w, 'move-started')[1]!;
    expect(next.t - landed.t).toBeLessThanOrEqual(medium.directorPeriodGameMs); // no 40 s wait after a tip-off
    expect(w.death.skipWait).toBe(false);
  });

  it('a library that only covers some stages skips the missing ones instead of ending the run', () => {
    const partial = libraryFrom(['ATK-01', 'ATK-03', 'ATK-08'].flatMap((m) => lib.variantsOf(m as 'ATK-01').map((v) => v.recording)));
    const w = initialWorld(1, 'medium');
    for (let t = 0; t < 10 * 60 * REAL_S && !w.ending; t += REAL_S) advance(w, partial, REAL_S);
    expect(eventsOfKind(w, 'move-started').map((e) => e.move)).toEqual(['ATK-01', 'ATK-03', 'ATK-08']);
    expect(w.ending).toBe('souls-lost');
  });
});

describe('the harvest variant (D-31)', () => {
  const harvestLib = libraryFrom(['ATK-01', 'ATK-08'].flatMap((m) => lib.variantsOf(m as 'ATK-01').map((v) => v.recording)));

  /** A world where ATK-01 has landed, so ATK-08 is the next candidate (stages 2 and 3 have no recording here). */
  function readyToHarvest(difficulty: 'easy' | 'medium' | 'hard'): World {
    const w = initialWorld(1, difficulty);
    w.death.knowledge.push('map');
    w.death.played.push({ move: 'ATK-01', variant: 'a', outcome: 'landed' });
    return w;
  }
  const harvest = (w: World) => eventsOfKind(w, 'move-started').find((e) => e.move === 'ATK-08');

  it('picks ATK-08.b on Easy and Medium and ATK-08.c on Hard', () => {
    for (const [difficulty, variant] of [['easy', 'b'], ['medium', 'b'], ['hard', 'c']] as const) {
      const w = readyToHarvest(difficulty);
      directorTick(w, harvestLib);
      expect(harvest(w)?.variant, difficulty).toBe(variant);
    }
  });

  it('picks ATK-08.c after a tip-off on Easy and Medium', () => {
    for (const difficulty of ['easy', 'medium'] as const) {
      const w = readyToHarvest(difficulty);
      applyAction(w, { type: 'DEF-04', ip: '203.0.113.10', mode: 'active' });
      directorTick(w, harvestLib);
      expect(harvest(w)?.variant, difficulty).toBe('c');
    }
  });

  it('never picks ATK-08.a in play, even when b and c have been played or cut', () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        const w = initialWorld(seed, difficulty);
        for (let t = 0; t < 15 * 60 * REAL_S && !w.ending; t += REAL_S) {
          if (t === 60 * REAL_S) for (const v of lib.variantsOf('ATK-08')) applyAction(w, { type: 'DEF-06', ip: v.info.ip, op: 'add' });
          advance(w, harvestLib, REAL_S);
        }
        expect(eventsOfKind(w, 'move-started').filter((e) => e.move === 'ATK-08' && e.variant === 'a'), `${difficulty} seed ${seed}`).toEqual([]);
      }
    }
  });

  it('a stopper on the pinned variant closes ATK-08: on Easy a SQLi rule stops .b and he does not fall back to .a or .c', () => {
    const w = readyToHarvest('easy');
    applyAction(w, { type: 'DEF-12', rule: { kind: 'sqli' } });
    directorTick(w, harvestLib);
    expect(harvest(w)).toBeUndefined();
  });
});

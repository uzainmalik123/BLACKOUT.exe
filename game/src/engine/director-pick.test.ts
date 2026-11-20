import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { advance } from './advance';
import { CONFIG } from './config';
import { directorTick, openAlerts } from './director';
import { eventsOfKind } from './log';
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

  it('switches to another variant and IP after a cut, and skips a move whose variants are all blocked', () => {
    const w = run(1, 4 * REAL_S); // the first Director tick is at 3 real s
    expect(moves(w)).toEqual(['ATK-01.a']);
    const ip = eventsOfKind(w, 'move-started')[0]!.ip;
    applyAction(w, { type: 'DEF-06', ip, op: 'add' });
    advance(w, lib, REAL_S);
    expect(eventsOfKind(w, 'move-cut')).toMatchObject([{ move: 'ATK-01', variant: 'a', by: 'DEF-06' }]);
    advance(w, lib, medium.cutRetryGameMs / 30 + 3 * REAL_S);
    expect(moves(w)).toEqual(['ATK-01.a', 'ATK-01.b']);
    expect(eventsOfKind(w, 'move-started')[1]!.ip).not.toBe(ip);
    const blockedAll = run(1, 4 * REAL_S);
    for (const v of lib.variantsOf('ATK-01')) applyAction(blockedAll, { type: 'DEF-06', ip: v.info.ip, op: 'add' });
    advance(blockedAll, lib, 60 * REAL_S);
    expect(moves(blockedAll)).toEqual(['ATK-01.a']);
    expect(blockedAll.ending).toBe('banished'); // nothing left he can start, no foothold
  });

  it('pacing: more than 3 open alerts delays the next move once; no open alert for 60 real s brings it forward', () => {
    const w = initialWorld(1, 'medium');
    for (let i = 0; i < 4; i++) w.alerts.push({ id: i, about: 'MIN-01', openedAt: 0 });
    expect(openAlerts(w)).toBe(4);
    directorTick(w, lib);
    expect(eventsOfKind(w, 'move-started')).toEqual([]);
    expect(w.death.nextMoveAt).toBe(medium.moveGapGameMs);
    directorTick(w, lib);
    expect(w.death.nextMoveAt).toBe(medium.moveGapGameMs); // once, not every tick
    const q = initialWorld(1, 'medium');
    q.death.nextMoveAt = 10 * medium.moveGapGameMs;
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
    w.death.nextMoveAt = 10 * medium.moveGapGameMs;
    applyAction(w, { type: 'DEF-04', ip: '203.0.113.10', mode: 'active' });
    directorTick(w, lib);
    const [started] = eventsOfKind(w, 'move-started');
    expect(started!.stage).toBe(3);
    expect(started!.move).toBe('ATK-06');
    expect(w.death.stageSkips).toBe(0);
  });
});

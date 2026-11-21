// D-42: soul doors. Once a big door (ATK-08, ATK-09) has landed it is his: he keeps coming back to it, each visit
// taking at most half of the souls left, until one of its own stoppers closes it for good. IP blocks and the plug only
// pause it. Runs on the committed recordings unless a test says otherwise; taps are switched off where they would blur
// what a test counts (taps.test.ts covers them).
import { describe, expect, it } from 'vitest';
import { MOVE_BY_ID, SOUL_DOORS } from '../rules/moves';
import type { MoveId, PlayerAction } from '../rules/vocabulary';
import { CONFIG } from './config';
import { candidateMoves, pickHalf, playableVariants, unstolen } from './director';
import { libraryFrom, type RecordingLibrary } from './library';
import { eventsOfKind, type GameEvent } from './log';
import { runSim, type ScriptedPlayer, type SimResult } from './sim';
import { soulsStolen } from './souls';
import { initialWorld, type World } from './state';
import { committedLibrary } from './test-fixtures/committed';

const REAL_MIN = 60_000;
const real = committedLibrary();
const only = (ids: string[]): RecordingLibrary => libraryFrom(ids.flatMap((m) => real.variantsOf(m as MoveId).map((v) => v.recording)));
const searchDoor = only(['ATK-01', 'ATK-08']);
const noTaps = (w: World) => { w.taps.nextAt = Infinity; };
const run = (player: ScriptedPlayer, opts: { library?: RecordingLibrary; minutes?: number; difficulty?: 'easy' | 'medium' | 'hard'; taps?: boolean } = {}): SimResult =>
  runSim({ seed: 1, difficulty: opts.difficulty ?? 'medium', library: opts.library ?? searchDoor, maxRealMs: (opts.minutes ?? 60) * REAL_MIN, player, ...(!opts.taps && { setup: noTaps }) });

/** Each visit to a door: when it started, how many souls were left then, how many it took, how it ended. */
function visits(events: GameEvent[], move: MoveId) {
  const out: Array<{ t: number; variant: string; left: number; took: number; end?: string }> = [];
  let stolen = 0;
  let current: (typeof out)[number] | undefined;
  for (const e of events) {
    if (e.kind === 'move-started' && e.move === move) out.push((current = { t: e.t, variant: e.variant, left: 325 - stolen, took: 0 }));
    if (e.kind === 'souls-stolen') {
      if (current && e.by === move) current.took += e.count;
      stolen = e.stolen;
    }
    if ((e.kind === 'move-landed' || e.kind === 'move-cut') && e.move === move && current) {
      current.end = e.kind === 'move-landed' ? 'landed' : e.by;
      current = undefined;
    }
  }
  return out;
}

describe('the robber: an open door is visited until it is empty (D-42)', () => {
  it('an idle Medium run with the search door open loses souls over several visits spread over minutes, none taking more than half of what was left, and loses them all', () => {
    const r = run(() => []);
    const v = visits(r.events, 'ATK-08').filter((x) => x.end === 'landed');
    expect(v.length).toBeGreaterThanOrEqual(5);
    expect(v.at(-1)!.t - v[0]!.t).toBeGreaterThan(10 * REAL_MIN * 30); // spread over more than ten real minutes
    for (const x of v) {
      expect(x.took, `visit at ${x.t / 30000} s`).toBeLessThanOrEqual(Math.ceil(x.left / 2));
      if (x.left >= 20) expect(x.took / x.left).toBeLessThanOrEqual(0.55);
    }
    expect(v[0]!.took).toBeGreaterThan(150); // the first visit is a real blow (half the shop)
    expect(eventsOfKind(r.world, 'ending')).toMatchObject([{ ending: 'souls-lost' }]);
    expect(soulsStolen(r.world)).toBe(r.world.souls.total);
  });

  it('the first visit plays the first half, the next the other half, then the half with the most unstolen rows', () => {
    const v = visits(run(() => []).events, 'ATK-08');
    expect(v.slice(0, 3).map((x) => x.variant)).toEqual(['d', 'e', 'e']);
  });

  it('a player who closes the search door for good after the first visit never loses another soul to it, and Death never tries it again', () => {
    let done = false;
    const r = run((w) => {
      if (done || !eventsOfKind(w, 'move-landed').some((e) => e.move === 'ATK-08')) return [];
      done = true;
      return [{ type: 'DEF-10', feature: 'search', enabled: false }, { type: 'DEF-13', patch: 'search' }];
    }, { minutes: 20 });
    const landedAt = eventsOfKind(r.world, 'move-landed').find((e) => e.move === 'ATK-08')!.t;
    expect(eventsOfKind(r.world, 'souls-stolen').filter((e) => e.by === 'ATK-08' && e.t > landedAt)).toEqual([]);
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08')).toHaveLength(1);
    expect(eventsOfKind(r.world, 'door-shut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-10' }]);
    expect(eventsOfKind(r.world, 'ending')).toMatchObject([{ ending: 'banished' }]); // no route, no foothold left
  });

  it('a stopper that cuts a visit closes the door for good, even once the stopper lapses (switching search back on does not reopen it: KI-70)', () => {
    let off = false, on = false;
    const r = run((w) => {
      const visit = eventsOfKind(w, 'move-started').filter((e) => e.move === 'ATK-08')[1];
      if (!off && visit && w.clock.gameMs > visit.t + 70 * 30_000) { off = true; return [{ type: 'DEF-10', feature: 'search', enabled: false }]; }
      if (off && !on && eventsOfKind(w, 'move-cut').length > 0) { on = true; return [{ type: 'DEF-18', what: 'search' }]; }
      return [];
    }, { minutes: 20 });
    expect(eventsOfKind(r.world, 'move-cut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-10' }]);
    expect(eventsOfKind(r.world, 'door-shut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-10' }]);
    expect(r.world.features.search).toBe(true);
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08')).toHaveLength(2);
  });

  it('IP-blocking a visit only pauses it: he comes back from a fresh address to the same half, carrying on where he stopped', () => {
    let blocked = false;
    const r = run((w) => {
      const visit = eventsOfKind(w, 'move-started').filter((e) => e.move === 'ATK-08')[1];
      if (blocked || !visit || w.clock.gameMs < visit.t + 60 * 30_000) return [];
      blocked = true;
      return [{ type: 'DEF-06', ip: visit.ip, op: 'add' }];
    }, { minutes: 20 });
    const cut = eventsOfKind(r.world, 'move-cut')[0]!;
    expect(cut).toMatchObject({ move: 'ATK-08', by: 'DEF-06' });
    const after = eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08' && e.t > cut.t);
    expect(after[0]).toMatchObject({ variant: cut.variant });
    expect(after[0]!.ip).not.toBe(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08')[1]!.ip);
    expect(after[0]!.t - cut.t).toBeLessThanOrEqual(CONFIG.medium.ipResumeGameMs + CONFIG.medium.directorPeriodGameMs);
    expect(eventsOfKind(r.world, 'door-shut')).toEqual([]);
    const resumed = visits(r.events, 'ATK-08').filter((x) => x.t >= cut.t - 1);
    const pausedVisit = visits(r.events, 'ATK-08')[1]!;
    expect(pausedVisit.took + resumed[0]!.took).toBeLessThanOrEqual(Math.ceil(pausedVisit.left / 2)); // the cap carries over
  });

  it('pulling the plug on a visit only pauses the door: he comes back once the shop is up again', () => {
    let pulled = false, back = false;
    const r = run((w) => {
      const visit = eventsOfKind(w, 'move-started').filter((e) => e.move === 'ATK-08')[1];
      if (!pulled && visit && w.clock.gameMs > visit.t + 60 * 30_000) { pulled = true; return [{ type: 'DEF-11' }]; }
      if (pulled && !back) { back = true; return [{ type: 'DEF-18', what: 'nginx' }]; }
      return [];
    }, { minutes: 20 });
    const cut = eventsOfKind(r.world, 'move-cut')[0]!;
    expect(cut).toMatchObject({ move: 'ATK-08', by: 'DEF-11' });
    expect(eventsOfKind(r.world, 'door-shut')).toEqual([]);
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08' && e.t > cut.t).length).toBeGreaterThanOrEqual(1);
  });

  it('every second move he starts is a visit while story moves remain, and after the ransom every move is a visit', () => {
    for (const seed of [1, 2, 3]) {
      const r = runSim({ seed, difficulty: 'medium', library: real, maxRealMs: 30 * REAL_MIN, player: () => [] });
      const starts = eventsOfKind(r.world, 'move-started');
      const firstDoor = eventsOfKind(r.world, 'move-landed').find((e) => SOUL_DOORS.includes(e.move))!;
      const ransom = eventsOfKind(r.world, 'move-landed').find((e) => e.move === 'ATK-17');
      const seen = new Set<MoveId>();
      const isVisit = (e: (typeof starts)[number]) => { const v = SOUL_DOORS.includes(e.move) && seen.has(e.move); seen.add(e.move); return v; };
      const kinds = starts.map((e) => ({ e, visit: isVisit(e) })).filter((x) => x.e.t > firstDoor.t);
      expect(kinds[0]!.visit, `seed ${seed}`).toBe(true); // straight back to his new door
      for (let i = 1; i < kinds.length; i++) {
        if (ransom && kinds[i]!.e.t > ransom.t) expect(kinds[i]!.visit, `seed ${seed} after the ransom`).toBe(true);
        else if (!kinds[i]!.visit) expect(kinds[i - 1]!.visit, `seed ${seed}: two story moves in a row at ${kinds[i]!.e.t}`).toBe(true);
      }
    }
  });
});

describe('the doors, unit by unit (D-42)', () => {
  const hisSearchDoor = (difficulty: 'easy' | 'medium' | 'hard' = 'medium'): World => {
    const w = initialWorld(1, difficulty);
    w.death.knowledge.push('map');
    w.death.played.push({ move: 'ATK-01', variant: 'a', outcome: 'landed' }, { move: 'ATK-08', variant: 'd', outcome: 'landed' });
    return w;
  };
  const steal = (w: World, from: number, to: number) => { for (let k = from; k <= to; k++) w.souls.stolen.push({ table: 'Users', key: k }); };
  const halves = (w: World) => playableVariants(w, searchDoor, MOVE_BY_ID['ATK-08']);

  it('a landed door stays playable while a half has unstolen rows; pickHalf takes the first half still more than half unstolen', () => {
    const w = hisSearchDoor();
    expect(halves(w).map((v) => v.variant)).toEqual(['d', 'e']);
    expect(pickHalf(w, halves(w))?.variant).toBe('d');
    steal(w, 1, 163);
    expect(halves(w).map((v) => v.variant)).toEqual(['e']); // .d has nothing left
    expect(pickHalf(w, halves(w))?.variant).toBe('e');
  });

  it('with both halves mostly spent it replays the one with the most unstolen rows; an empty door is no route', () => {
    const w = hisSearchDoor();
    steal(w, 1, 120); // .d: 43 of 163 left
    steal(w, 164, 270); // .e: 55 of 162 left
    expect(halves(w).map((v) => unstolen(w, v))).toEqual([43, 55]);
    expect(pickHalf(w, halves(w))?.variant).toBe('e');
    steal(w, 121, 163);
    steal(w, 271, 325);
    expect(halves(w)).toEqual([]);
    expect(candidateMoves(w, searchDoor).map((m) => m.id)).not.toContain('ATK-08');
  });

  it('on Hard and once tipped off he plays the loud halves; the quiet ones never', () => {
    expect(halves(hisSearchDoor('hard')).map((v) => v.variant)).toEqual(['f', 'g']);
    const w = hisSearchDoor();
    w.death.tippedOff = true;
    expect(halves(w).map((v) => v.variant)).toEqual(['f', 'g']);
  });

  it('a door closed for good is never playable again, whatever lapses (no retrying a patched hole)', () => {
    const w = hisSearchDoor();
    w.death.shutDoors.push('ATK-08');
    expect(halves(w)).toEqual([]);
    expect(candidateMoves(w, searchDoor).map((m) => m.id)).not.toContain('ATK-08');
  });

  it('on Medium the SQLi and sqlmap rules leave the quiet halves open: the door stays his (D-34)', () => {
    const r = run((w) => (w.waf.length === 0 && eventsOfKind(w, 'move-landed').some((e) => e.move === 'ATK-08')
      ? [{ type: 'DEF-12', rule: { kind: 'sqli' } }, { type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'sqlmap' } }] as PlayerAction[]
      : []), { minutes: 15 });
    expect(eventsOfKind(r.world, 'door-shut')).toEqual([]);
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08').length).toBeGreaterThanOrEqual(3);
  });

  it('on Easy a SQLi rule after the first visit closes the door for good', () => {
    const r = run((w) => (w.waf.length === 0 && eventsOfKind(w, 'move-landed').some((e) => e.move === 'ATK-08')
      ? [{ type: 'DEF-12', rule: { kind: 'sqli' } }] as PlayerAction[] : []), { minutes: 15, difficulty: 'easy' });
    expect(eventsOfKind(r.world, 'door-shut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-12' }]);
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08')).toHaveLength(1);
  });

  it('the users API is a door too: the first scrape takes one half, later visits the rest, and the access-control patch closes it for good', () => {
    const users = only(['ATK-01', 'ATK-03', 'ATK-09']);
    const idle = run(() => [], { library: users, minutes: 30 });
    const v = visits(idle.events, 'ATK-09').filter((x) => x.end === 'landed');
    expect(v.length).toBeGreaterThanOrEqual(3);
    for (const x of v) expect(x.took).toBeLessThanOrEqual(Math.ceil(x.left / 2));
    let patched = false;
    const r = run((w) => {
      if (patched || !eventsOfKind(w, 'move-landed').some((e) => e.move === 'ATK-09')) return [];
      patched = true;
      return [{ type: 'DEF-13', patch: 'users-access' }];
    }, { library: users, minutes: 20 });
    expect(eventsOfKind(r.world, 'door-shut')).toMatchObject([{ move: 'ATK-09', by: 'DEF-13' }]);
    const shutAt = eventsOfKind(r.world, 'door-shut')[0]!.t;
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-09' && e.t > shutAt)).toEqual([]);
  });
});

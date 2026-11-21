// D-42, D-44: soul doors. Once a big door (ATK-08, ATK-09) has landed it is his: he keeps coming back to it, each visit
// taking at most half of the souls left (the rest once fewer than 10 % remain), while it is open. A door is shut only
// while one of its own stoppers holds, and reopens when that fix lapses; a cut visit is paused, never over (D-45).
// Runs on the committed recordings unless a test says otherwise; taps are switched off where they would blur what a
// test counts (taps.test.ts covers them).
import { describe, expect, it } from 'vitest';
import { MOVE_BY_ID, SOUL_DOORS } from '../rules/moves';
import type { MoveId, PlayerAction } from '../rules/vocabulary';
import { CONFIG } from './config';
import { candidateMoves, pickHalf, playableVariants } from './director';
import { closingStopper, refreshDoors, unstolen } from './doors';
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
    const threshold = r.world.souls.total * CONFIG.medium.doors.takeAllBelowFraction;
    for (const x of v) {
      if (x.left < threshold) continue; // D-44: the last visit takes the rest
      expect(x.took, `visit at ${x.t / 30000} s`).toBeLessThanOrEqual(Math.ceil(x.left / 2));
      if (x.left >= 20) expect(x.took / x.left).toBeLessThanOrEqual(0.55);
    }
    expect(v[0]!.took).toBeGreaterThan(150); // the first visit is a real blow (half the shop)
    expect(v.at(-1)!.left).toBeLessThan(threshold); // D-44: once fewer than 10 % are left, one visit takes the rest
    expect(v.at(-1)!.took).toBe(v.at(-1)!.left);
    expect(eventsOfKind(r.world, 'ending')).toMatchObject([{ ending: 'souls-lost' }]);
    expect(soulsStolen(r.world)).toBe(r.world.souls.total);
  });

  it('the first visit plays the first half, the next the other half, then the half with the most unstolen rows', () => {
    const v = visits(run(() => []).events, 'ATK-08');
    expect(v.slice(0, 3).map((x) => x.variant)).toEqual(['d', 'e', 'e']);
  });

  it('a player who closes the search door with its patch after the first visit never loses another soul to it, and Death never tries it again', () => {
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

  it('a flag that cuts a visit shuts the door only while it holds: search back on reopens it and he resumes the same half where he stopped (D-44, KI-70)', () => {
    let off = false, on = false;
    const r = run((w) => {
      const visit = eventsOfKind(w, 'move-started').filter((e) => e.move === 'ATK-08')[1];
      if (!off && visit && w.clock.gameMs > visit.t + 70 * 30_000) { off = true; return [{ type: 'DEF-10', feature: 'search', enabled: false }]; }
      if (off && !on && eventsOfKind(w, 'move-cut').length > 0 && w.clock.gameMs > eventsOfKind(w, 'move-cut')[0]!.t + 30 * 30_000) { on = true; return [{ type: 'DEF-18', what: 'search' }]; }
      return [];
    }, { minutes: 25 });
    const cut = eventsOfKind(r.world, 'move-cut')[0]!;
    expect(cut).toMatchObject({ move: 'ATK-08', by: 'DEF-10' });
    expect(eventsOfKind(r.world, 'door-shut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-10' }]);
    expect(eventsOfKind(r.world, 'door-reopened')).toMatchObject([{ move: 'ATK-08' }]);
    expect(eventsOfKind(r.world, 'door-reopened')[0]!.t).toBeGreaterThan(eventsOfKind(r.world, 'door-shut')[0]!.t);
    expect(r.world.features.search).toBe(true);
    const after = eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08' && e.t > cut.t);
    expect(after.length).toBeGreaterThanOrEqual(1); // his again, no new first entry
    expect(after[0]!.variant).toBe(cut.variant); // the paused half carries on
    expect(after[0]!.t).toBeGreaterThanOrEqual(eventsOfKind(r.world, 'door-reopened')[0]!.t);
    const paused = visits(r.events, 'ATK-08')[1]!;
    const resumed = visits(r.events, 'ATK-08').find((x) => x.t === after[0]!.t)!;
    expect(paused.took + resumed.took).toBeLessThanOrEqual(Math.ceil(paused.left / 2)); // the cap carries over
    expect(eventsOfKind(r.world, 'souls-stolen').some((e) => e.by === 'ATK-08' && e.t > cut.t)).toBe(true);
    expect(eventsOfKind(r.world, 'ending')).not.toMatchObject([{ ending: 'banished' }]);
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

  it('pulling the plug on a visit freezes it in place: back up within the grace, the same visit carries on with no cut and its cap (D-45)', () => {
    let pulled = false, back = false;
    const r = run((w) => {
      const visit = eventsOfKind(w, 'move-started').filter((e) => e.move === 'ATK-08')[1];
      if (!pulled && visit && w.clock.gameMs > visit.t + 60 * 30_000) { pulled = true; return [{ type: 'DEF-11' }]; }
      if (pulled && !back) { back = true; return [{ type: 'DEF-18', what: 'nginx' }]; }
      return [];
    }, { minutes: 20 });
    expect(eventsOfKind(r.world, 'move-cut')).toEqual([]);
    expect(eventsOfKind(r.world, 'door-shut')).toEqual([]);
    const second = visits(r.events, 'ATK-08')[1]!;
    expect(second.end).toBe('landed');
    expect(second.took).toBeLessThanOrEqual(Math.ceil(second.left / 2));
  });

  it('a plug held past the grace cuts the visit; once the shop is up he resumes the same half where he stopped, without a breather (D-45)', () => {
    let pulledAt: number | undefined, back = false;
    const r = run((w) => {
      const visit = eventsOfKind(w, 'move-started').filter((e) => e.move === 'ATK-08')[1];
      if (pulledAt === undefined && visit && w.clock.gameMs > visit.t + 60 * 30_000) { pulledAt = w.clock.gameMs; return [{ type: 'DEF-11' }]; }
      if (pulledAt !== undefined && !back && w.clock.gameMs > pulledAt + 20 * 30_000) { back = true; return [{ type: 'DEF-18', what: 'nginx' }]; }
      return [];
    }, { minutes: 20 });
    const cut = eventsOfKind(r.world, 'move-cut')[0]!;
    expect(cut).toMatchObject({ move: 'ATK-08', by: 'DEF-11' });
    expect(cut.t - pulledAt!).toBeGreaterThanOrEqual(CONFIG.medium.doors.pauseGraceGameMs);
    expect(cut.t - pulledAt!).toBeLessThanOrEqual(CONFIG.medium.doors.pauseGraceGameMs + CONFIG.medium.tickGameMs); // the freeze starts on the next tick
    expect(eventsOfKind(r.world, 'door-shut')).toEqual([]);
    const after = eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08' && e.t > cut.t);
    expect(after[0]!.variant).toBe(cut.variant);
    expect(after[0]!.t - (pulledAt! + 20 * 30_000)).toBeLessThanOrEqual(2 * CONFIG.medium.directorPeriodGameMs); // no breather
    const paused = visits(r.events, 'ATK-08')[1]!;
    const resumed = visits(r.events, 'ATK-08').find((x) => x.t === after[0]!.t)!;
    expect(paused.took + resumed.took).toBeLessThanOrEqual(Math.ceil(paused.left / 2)); // the cap carries over
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

  it('a door is shut while one of its own stoppers holds for every half he may play, and his again once it lapses (D-44)', () => {
    const w = hisSearchDoor();
    expect(closingStopper(w, searchDoor, MOVE_BY_ID['ATK-08'])).toBeUndefined();
    w.features.search = false;
    refreshDoors(w, searchDoor);
    expect(closingStopper(w, searchDoor, MOVE_BY_ID['ATK-08'])).toMatchObject({ action: 'DEF-10' });
    expect(w.death.shutDoors).toEqual(['ATK-08']);
    expect(eventsOfKind(w, 'door-shut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-10' }]);
    expect(halves(w)).toEqual([]);
    expect(candidateMoves(w, searchDoor).map((m) => m.id)).not.toContain('ATK-08');
    w.features.search = true;
    refreshDoors(w, searchDoor);
    expect(w.death.shutDoors).toEqual([]);
    expect(eventsOfKind(w, 'door-reopened')).toMatchObject([{ move: 'ATK-08' }]);
    expect(halves(w).map((v) => v.variant)).toEqual(['d', 'e']);
    expect(candidateMoves(w, searchDoor).map((m) => m.id)).toContain('ATK-08');
    w.patches.applied.push('search'); // the real fix holds whatever the flag does
    refreshDoors(w, searchDoor);
    expect(closingStopper(w, searchDoor, MOVE_BY_ID['ATK-08'])).toMatchObject({ action: 'DEF-13' });
    expect(halves(w)).toEqual([]);
  });

  it('on Medium the SQLi and sqlmap rules leave the quiet halves open: the door stays his (D-34)', () => {
    const r = run((w) => (w.waf.length === 0 && eventsOfKind(w, 'move-landed').some((e) => e.move === 'ATK-08')
      ? [{ type: 'DEF-12', rule: { kind: 'sqli' } }, { type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'sqlmap' } }] as PlayerAction[]
      : []), { minutes: 15 });
    expect(eventsOfKind(r.world, 'door-shut')).toEqual([]);
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08').length).toBeGreaterThanOrEqual(3);
  });

  it('on Easy a SQLi rule after the first visit closes the door (the rule stays, so it stays shut)', () => {
    const r = run((w) => (w.waf.length === 0 && eventsOfKind(w, 'move-landed').some((e) => e.move === 'ATK-08')
      ? [{ type: 'DEF-12', rule: { kind: 'sqli' } }] as PlayerAction[] : []), { minutes: 15, difficulty: 'easy' });
    expect(eventsOfKind(r.world, 'door-shut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-12' }]);
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08')).toHaveLength(1);
  });

  it('the users API is a door too: the first scrape takes one half, later visits the rest, and the access-control patch closes it', () => {
    const users = only(['ATK-01', 'ATK-03', 'ATK-09']);
    const idle = run(() => [], { library: users, minutes: 30 });
    const v = visits(idle.events, 'ATK-09').filter((x) => x.end === 'landed');
    expect(v.length).toBeGreaterThanOrEqual(3);
    for (const x of v) if (x.left >= 325 * CONFIG.medium.doors.takeAllBelowFraction) expect(x.took).toBeLessThanOrEqual(Math.ceil(x.left / 2)); // D-44: under 10 % one visit takes the rest
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

  it('revoking sessions shuts the users API door; a MIN-02 success hands him a new session and reopens it (D-44, KI-70)', () => {
    const users = libraryFrom(['ATK-01', 'ATK-03', 'ATK-09', 'MIN-02'].flatMap((m) => real.variantsOf(m as MoveId).map((v) => v.recording)));
    let revoked = false;
    const r = runSim({ seed: 1, difficulty: 'medium', library: users, maxRealMs: 20 * REAL_MIN, setup: noTaps, player: (w) => {
      if (revoked || !eventsOfKind(w, 'move-landed').some((e) => e.move === 'ATK-09')) return [];
      revoked = true;
      return [{ type: 'DEF-09' }];
    } });
    const shut = eventsOfKind(r.world, 'door-shut').find((e) => e.move === 'ATK-09')!;
    expect(shut).toMatchObject({ by: 'DEF-09' });
    const reopened = eventsOfKind(r.world, 'door-reopened').find((e) => e.move === 'ATK-09' && e.t > shut.t)!;
    expect(reopened).toBeDefined();
    const session = r.world.events.find((e) => e.kind === 'souls-stolen' && e.by === 'MIN-02' && e.t > shut.t)!;
    expect(session).toBeDefined();
    expect(reopened.t).toBeGreaterThanOrEqual(session.t);
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-09' && e.t > shut.t && e.t < reopened.t)).toEqual([]);
    expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-09' && e.t >= reopened.t).length).toBeGreaterThanOrEqual(1);
  });

  it('an open leaky tap blocks the win: every route closed, no foothold, he is banished only once the tap is closed (D-44, KI-75)', () => {
    let fixed = false;
    const r = run((w, realMs) => {
      const acts: PlayerAction[] = [];
      if (!fixed && eventsOfKind(w, 'move-landed').some((e) => e.move === 'ATK-08')) { fixed = true; acts.push({ type: 'DEF-10', feature: 'search', enabled: false }, { type: 'DEF-13', patch: 'search' }); }
      if (realMs >= 12 * REAL_MIN) for (const t of w.taps.open) acts.push({ type: 'DEF-12', rule: { kind: 'block-path', method: 'GET', path: t.id === 'TAP-01' ? '/support/logs' : t.id === 'TAP-02' ? '/rest/memories' : '/rest/products/*/reviews' } });
      return acts;
    }, { minutes: 20, taps: true });
    const opened = eventsOfKind(r.world, 'tap-opened')[0]!;
    expect(opened.t).toBeLessThan(12 * REAL_MIN * 30);
    expect(eventsOfKind(r.world, 'patch-applied')).toMatchObject([{ patch: 'search' }]);
    expect(eventsOfKind(r.world, 'patch-applied')[0]!.t).toBeLessThan(12 * REAL_MIN * 30);
    const ending = eventsOfKind(r.world, 'ending')[0]!;
    expect(ending).toMatchObject({ ending: 'banished' });
    expect(ending.t).toBeGreaterThanOrEqual(12 * REAL_MIN * 30);
    expect(eventsOfKind(r.world, 'tap-closed').some((e) => e.by === 'DEF-12')).toBe(true);
    expect(r.world.taps.open).toEqual([]);
  });
});

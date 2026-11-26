// D-41: pacing and fairness. Breathers, no same-move loops, the finale, one wave at a time, minions as pests.
import { describe, expect, it } from 'vitest';
import type { Recording } from '../recordings/format';
import { MOVES } from '../rules/moves';
import type { Difficulty, MinionId, MoveId } from '../rules/vocabulary';
import { applyAction } from './actions';
import { CONFIG } from './config';
import { directorTick } from './director';
import { gains } from './facts';
import { libraryFrom, type RecordingLibrary } from './library';
import { eventsOfKind } from './log';
import { activeWaves, stepWaves } from './minions';
import { activeDeathReplay, cutReplay, deathReplays, startReplay, stepReplays } from './replay';
import { initialWorld, type World } from './state';
import { committedLibrary } from './test-fixtures/committed';
import { lab } from './test-fixtures/lab';
import { FIXTURE_LIBRARY, fakeRecording } from './test-fixtures/recordings';

const REAL_S = 30_000;
const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];
const fixture = (ids: Array<MoveId | MinionId>): RecordingLibrary =>
  libraryFrom(ids.flatMap((id) => FIXTURE_LIBRARY.variantsOf(id).map((v) => v.recording)));
const recordingsOf = (lib: RecordingLibrary, ids: Array<MoveId | MinionId>): Recording[] => ids.flatMap((id) => lib.variantsOf(id).map((v) => v.recording));

/** The minion side alone (no Director), in the engine's 100 real ms sub-steps. */
function runWaves(w: World, lib: RecordingLibrary, realMs: number): void {
  for (let i = 0; i < realMs / 100; i++) {
    w.clock.gameMs += CONFIG[w.difficulty].tickGameMs;
    stepReplays(w, lib);
    stepWaves(w, lib);
  }
}

/** A world where Death has scanned (ATK-01 landed, `map`) and may pick stage-2 moves. */
function scanned(seed: number, difficulty: Difficulty = 'medium'): World {
  const w = initialWorld(seed, difficulty);
  w.death.knowledge.push('map');
  w.death.played.push({ move: 'ATK-01', variant: 'a', outcome: 'landed' });
  w.nextWaveAt = { 'MIN-01': Infinity, 'MIN-02': Infinity, 'MIN-03': Infinity, 'MIN-04': Infinity };
  return lab(w);
}

describe('a breather after every Death move (D-41 rule 4)', () => {
  for (const level of LEVELS) {
    it(`${level}: landed or cut by a stopper, the next move waits a seeded breather in the level's range`, () => {
      const { min, max } = CONFIG[level].breatherGameMs;
      const waits = new Set<number>();
      for (let seed = 1; seed <= 20; seed++) {
        for (const cut of [false, true]) {
          const w = scanned(seed, level);
          const r = startReplay(w, FIXTURE_LIBRARY.variantsOf('ATK-03')[0]!, 'death');
          w.clock.gameMs += 10 * REAL_S;
          if (cut) cutReplay(w, r, 'DEF-12');
          else stepReplays(w, FIXTURE_LIBRARY);
          expect(eventsOfKind(w, cut ? 'move-cut' : 'move-landed')).toHaveLength(1);
          const wait = w.death.nextMoveAt - w.clock.gameMs;
          expect(wait).toBeGreaterThanOrEqual(min);
          expect(wait).toBeLessThanOrEqual(max);
          waits.add(wait);
        }
      }
      expect(waits.size).toBeGreaterThan(5); // drawn, not fixed
    });
  }

  it('the same seed draws the same breathers', () => {
    const draw = () => {
      const w = scanned(7);
      startReplay(w, FIXTURE_LIBRARY.variantsOf('ATK-03')[0]!, 'death');
      w.clock.gameMs += 10 * REAL_S;
      stepReplays(w, FIXTURE_LIBRARY);
      return w.death.nextMoveAt;
    };
    expect(draw()).toBe(draw());
  });

  it('an IP-block cut only interrupts: he resumes after the short IP wait, not a breather (D-24)', () => {
    const w = scanned(1);
    const r = startReplay(w, FIXTURE_LIBRARY.variantsOf('ATK-03')[0]!, 'death');
    cutReplay(w, r, 'DEF-06');
    expect(w.death.nextMoveAt - w.clock.gameMs).toBe(CONFIG.medium.ipResumeGameMs);
  });

  it('a tip-off still skips one wait', () => {
    const w = scanned(1);
    const r = startReplay(w, FIXTURE_LIBRARY.variantsOf('ATK-03')[0]!, 'death');
    applyAction(w, { type: 'DEF-04', ip: r.ip, mode: 'active' }); // D-111: the address he is playing from
    w.clock.gameMs += 10 * REAL_S;
    stepReplays(w, FIXTURE_LIBRARY);
    expect(w.death.nextMoveAt).toBe(w.clock.gameMs);
  });
});

describe('two of his moves at once on Medium and Hard (D-259)', () => {
  /** His login replayed slowly, two real minutes long, beside the fixture's other moves. */
  const slow = libraryFrom([
    fakeRecording('ATK-03', 'a', { ip: '203.0.113.9', durationMs: 120_000 }),
    ...recordingsOf(FIXTURE_LIBRARY, MOVES.map((m) => m.id).filter((id) => id !== 'ATK-03')),
  ]);
  /** Starts the slow move, then plays the Director's 3 s ticks for `realS`; returns when each later move started and how many of his ran at most. */
  function beside(level: Difficulty, realS: number) {
    const w = scanned(1, level);
    startReplay(w, slow.variantsOf('ATK-03')[0]!, 'death');
    const t0 = w.clock.gameMs;
    let most = 1;
    for (let s = 0; s < realS; s += 3) {
      w.clock.gameMs += 3 * REAL_S;
      stepReplays(w, slow);
      directorTick(w, slow);
      most = Math.max(most, deathReplays(w).length);
    }
    const later = eventsOfKind(w, 'move-started').slice(1);
    const slowEnd = eventsOfKind(w, 'move-landed').find((e) => e.move === 'ATK-03')?.t ?? Infinity;
    return { w, t0, later, slowEnd, most };
  }

  for (const level of ['medium', 'hard'] as const) {
    it(`${level}: while a long move plays, a second starts a breather after it began, never the same move, never a third`, () => {
      const { min, max } = CONFIG[level].breatherGameMs;
      const { t0, later, slowEnd, most } = beside(level, 100);
      expect(later.length).toBeGreaterThan(0);
      const second = later[0]!;
      expect(second.t).toBeLessThan(slowEnd); // beside it, not after it
      expect(second.move).not.toBe('ATK-03');
      expect(second.t - t0).toBeGreaterThanOrEqual(min);
      expect(second.t - t0).toBeLessThanOrEqual(max + CONFIG[level].directorPeriodGameMs);
      expect(most).toBe(2);
    });
  }

  it('easy: nothing else of his starts while the long move plays', () => {
    const { later, slowEnd, most } = beside('easy', 100);
    expect(most).toBe(1);
    expect(later.every((e) => e.t >= slowEnd)).toBe(true);
  });
});

describe('no same-move loops (D-41 rule 3)', () => {
  const stage2 = fixture(['ATK-01', 'ATK-03', 'ATK-04', 'ATK-05']);

  it('after a cut by a stopper that no longer holds, he picks a different move next, whatever the seed', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = scanned(seed);
      const r = startReplay(w, stage2.variantsOf('ATK-03')[0]!, 'death');
      cutReplay(w, r, 'DEF-11');
      w.clock.gameMs = w.death.nextMoveAt;
      directorTick(w, stage2);
      const next = eventsOfKind(w, 'move-started').at(-1)!;
      expect(next.move, `seed ${seed}`).not.toBe('ATK-03');
    }
  });

  it('once he has started a different move, the cut one may be picked again', () => {
    const picks = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const w = scanned(seed);
      cutReplay(w, startReplay(w, stage2.variantsOf('ATK-03')[0]!, 'death'), 'DEF-11');
      cutReplay(w, startReplay(w, stage2.variantsOf('ATK-04')[0]!, 'death'), 'DEF-11');
      w.clock.gameMs = w.death.nextMoveAt;
      directorTick(w, stage2);
      picks.add(eventsOfKind(w, 'move-started').at(-1)!.move);
    }
    expect(picks).toContain('ATK-03');
    expect(picks).not.toContain('ATK-04');
  });

  it('an IP-block cut keeps the resume: the same move may come straight back from a fresh address', () => {
    const back = [];
    for (let seed = 1; seed <= 20; seed++) {
      const w = scanned(seed);
      const r = startReplay(w, stage2.variantsOf('ATK-03')[0]!, 'death');
      applyAction(w, { type: 'DEF-06', ip: r.ip, op: 'add' });
      cutReplay(w, r, 'DEF-06');
      w.clock.gameMs = w.death.nextMoveAt;
      directorTick(w, stage2);
      const next = eventsOfKind(w, 'move-started').at(-1)!;
      if (next.move === 'ATK-03') back.push(next.ip);
    }
    expect(back.length).toBeGreaterThan(0);
    expect(back).not.toContain(stage2.variantsOf('ATK-03')[0]!.info.ip);
  });

  it('if the cut move is the only one he could pick, he picks it again after the breather (KI-56)', () => {
    const only = fixture(['ATK-01', 'ATK-03']);
    const w = scanned(1);
    cutReplay(w, startReplay(w, only.variantsOf('ATK-03')[0]!, 'death'), 'DEF-11');
    w.clock.gameMs = w.death.nextMoveAt;
    directorTick(w, only);
    expect(eventsOfKind(w, 'move-started').at(-1)).toMatchObject({ move: 'ATK-03' });
    expect(eventsOfKind(w, 'banished')).toEqual([]);
  });
});

describe('the ransom is the finale (D-41 rule 6)', () => {
  const strike = fixture(['ATK-01', 'ATK-15', 'ATK-17']);
  function afterRansom(): World {
    const w = scanned(1);
    w.death.played.push({ move: 'ATK-17', variant: 'a', outcome: 'landed' });
    w.clock.gameMs = 100 * REAL_S;
    w.death.nextMoveAt = 0;
    return w;
  }

  it('after ATK-17 lands he starts no new move though ATK-15 is open; stuck for two breathers with no soul door open and no foothold, he is banished (D-46, KI-80)', () => {
    const w = afterRansom();
    const stuckFor = CONFIG.medium.stuckBreathers * CONFIG.medium.breatherGameMs.max;
    const start = w.clock.gameMs;
    for (let i = 0; i < 100 && !w.ending; i++) {
      w.clock.gameMs += 3 * REAL_S;
      directorTick(w, strike);
      if (w.clock.gameMs - start < stuckFor) expect(w.ending).toBeUndefined();
    }
    expect(eventsOfKind(w, 'move-started')).toEqual([]);
    expect(w.ending).toBe('banished');
    // the director looks every tick (3 s here): he is first seen stuck a tick in, and banished at the first tick after
    expect(eventsOfKind(w, 'ending')[0]!.t - start).toBeLessThanOrEqual(stuckFor + 2 * 3 * REAL_S);
  });

  it('closing his last route with no foothold left still banishes him (SYS-07); a WAF rule he never gets to attempt after the finale counts once he is stuck (D-231, D-46)', () => {
    const w = afterRansom();
    applyAction(w, { type: 'DEF-12', rule: { kind: 'block-path', method: 'PUT', path: '/api/Products' } });
    directorTick(w, strike);
    expect(w.ending).toBeUndefined(); // the rule is untried: the route still counts until he is stuck
    w.clock.gameMs += CONFIG.medium.stuckBreathers * CONFIG.medium.breatherGameMs.max;
    directorTick(w, strike);
    expect(w.ending).toBe('banished');
  });

  it('a foothold left behind still brings the return', () => {
    const w = afterRansom();
    w.accounts.push({ id: 400, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' });
    applyAction(w, { type: 'DEF-12', rule: { kind: 'block-path', method: 'PUT', path: '/api/Products' } });
    directorTick(w, strike);
    w.clock.gameMs += CONFIG.medium.stuckBreathers * CONFIG.medium.breatherGameMs.max; // D-231: the untried rule counts once he is stuck
    directorTick(w, strike);
    expect(eventsOfKind(w, 'banished')).toHaveLength(1);
    w.clock.gameMs += CONFIG.medium.returnDelayGameMs;
    directorTick(w, strike);
    expect(w.ending).toBe('return');
  });
});

describe('one minion wave at a time (D-41 rule 2)', () => {
  it('a wave that falls due while another runs waits for it to end, then starts', () => {
    const w = initialWorld(1, 'medium');
    w.nextWaveAt = { 'MIN-01': 30 * REAL_S, 'MIN-02': 35 * REAL_S, 'MIN-03': Infinity, 'MIN-04': Infinity };
    runWaves(w, FIXTURE_LIBRARY, 40_000);
    expect(activeWaves(w).map((x) => x.minion)).toEqual(['MIN-01']);
    runWaves(w, FIXTURE_LIBRARY, 12_000);
    expect(activeWaves(w).map((x) => x.minion)).toEqual(['MIN-02']);
    const started = eventsOfKind(w, 'wave-started').find((e) => e.minion === 'MIN-02')!;
    expect(w.nextWaveAt['MIN-02']).toBe(started.t + CONFIG.medium.minions.periodGameMs['MIN-02']);
  });

  for (const level of ['medium', 'hard'] as const) {
    it(`${level}: a wave may start while Death plays a move, and Death may start one during a wave (the combo)`, () => {
      const w = scanned(1, level);
      w.nextWaveAt['MIN-01'] = 0;
      runWaves(w, FIXTURE_LIBRARY, 100);
      expect(activeWaves(w)).toHaveLength(1);
      w.death.nextMoveAt = 0;
      directorTick(w, FIXTURE_LIBRARY);
      expect(activeDeathReplay(w)).toBeDefined();
    });
  }

  it('easy: no wave starts while a Death move plays, and Death starts no move during a wave', () => {
    const long = libraryFrom([fakeRecording('ATK-03', 'a', { ip: '203.0.113.9', durationMs: 60_000 })]);
    const w = scanned(1, 'easy');
    startReplay(w, long.variantsOf('ATK-03')[0]!, 'death');
    w.nextWaveAt['MIN-01'] = 0;
    runWaves(w, long, 30_000);
    expect(eventsOfKind(w, 'wave-started')).toEqual([]);
    runWaves(w, long, 31_000); // the move lands at 60 real s; the wave waiting for it starts
    expect(eventsOfKind(w, 'move-landed')).toHaveLength(1);
    expect(activeWaves(w)).toHaveLength(1);
    w.death.nextMoveAt = 0;
    directorTick(w, FIXTURE_LIBRARY);
    expect(activeDeathReplay(w)).toBeUndefined();
  });
});

describe('minions are pests (D-41 rule 1)', () => {
  const real = committedLibrary();
  const min02 = libraryFrom(recordingsOf(real, ['MIN-02']));
  const onlyMin02 = (w: World) => { w.nextWaveAt = { 'MIN-01': Infinity, 'MIN-02': 0, 'MIN-03': Infinity, 'MIN-04': Infinity }; };
  const minionSouls = (w: World) => eventsOfKind(w, 'souls-stolen').filter((e) => e.by.startsWith('MIN-')).reduce((n, e) => n + e.count, 0);

  for (const [level, successes] of [['easy', 1], ['medium', 1], ['hard', 2]] as const) {
    it(`${level}: a MIN-02 wave lands at most ${successes} success(es) and replays its recording only up to the last one`, () => {
      expect(CONFIG[level].minions.successesPerWave).toBe(successes);
      const w = initialWorld(1, level);
      onlyMin02(w);
      runWaves(w, min02, 25_000);
      expect(eventsOfKind(w, 'wave-ended')).toHaveLength(1);
      expect(minionSouls(w)).toBe(successes);
      expect(w.sessions.filter((s) => s.issuedBy === 'MIN-02')).toHaveLength(successes);
      expect(gains(w).has('user-session')).toBe(true);
      const rec = min02.variantsOf('MIN-02')[0]!.recording;
      const cut = rec.events.findIndex((e, i) => e.kind === 'exfil' && rec.events.slice(0, i + 1).filter((x) => x.kind === 'exfil').length === successes);
      const recorded = rec.events.slice(0, cut + 1).filter((e) => e.kind === 'access');
      const shown = w.logs.access.filter((l) => l.by === 'MIN-02');
      expect(shown.map((l) => [l.method, l.target, l.status, l.userAgent])).toEqual(recorded.map((e) => e.kind === 'access' && [e.method, e.target, e.status, e.userAgent]));
    });
  }

  it('the next wave carries on where the last one stopped: a different victim (KI-57)', () => {
    const w = initialWorld(1, 'medium');
    onlyMin02(w);
    runWaves(w, min02, 3 * 60_000 + 25_000);
    expect(eventsOfKind(w, 'wave-ended')).toHaveLength(2);
    expect(minionSouls(w)).toBe(2);
    const victims = w.sessions.filter((s) => s.issuedBy === 'MIN-02').map((s) => s.email);
    expect(new Set(victims).size).toBe(2);
  });

  it('a recorded success on a locked account takes nothing and gives Death nothing (D-40)', () => {
    const w = initialWorld(1, 'medium');
    onlyMin02(w);
    const first = min02.variantsOf('MIN-02')[0]!.recording.events.find((e) => e.kind === 'exfil')!;
    const victim = w.accounts.find((a) => first.kind === 'exfil' && a.id === first.keys[0])!;
    applyAction(w, { type: 'DEF-08', email: victim.email });
    runWaves(w, min02, 25_000);
    expect(minionSouls(w)).toBe(0);
    expect(w.sessions.filter((s) => s.issuedBy === 'MIN-02')).toEqual([]);
  });

  it('minions never take more than 5% of the souls; past that a success still hands Death a session', () => {
    const w = initialWorld(1, 'hard');
    onlyMin02(w);
    w.souls.byMinions = Math.floor(w.souls.total * CONFIG.hard.minions.soulCapFraction) - 1;
    runWaves(w, min02, 25_000);
    expect(minionSouls(w)).toBe(1);
    expect(w.sessions.filter((s) => s.issuedBy === 'MIN-02')).toHaveLength(2);
  });

  it('a wave with no recording keeps D-24: its successes come halfway through (two on Hard)', () => {
    const w = initialWorld(2, 'hard');
    onlyMin02(w);
    runWaves(w, libraryFrom([]), 25_000);
    expect(minionSouls(w)).toBe(2);
  });
});

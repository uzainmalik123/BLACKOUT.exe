// SYS-13 (D-113): the struggle detector. Idle for 90 real s or souls down by more than 10 % in 2 real min unlocks one
// suggestion per window on Medium and Hard; Easy tracks it and unlocks nothing.
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { advance } from './advance';
import { CONFIG } from './config';
import { emit, eventsOfKind } from './log';
import { runSim } from './sim';
import { initialWorld } from './state';
import { stepStruggle, struggling } from './struggle';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_S = 30_000;
const REAL_MIN = 60 * REAL_S;
const { idleGameMs, soulsWindowGameMs } = CONFIG.medium.struggle;

function steal(w: ReturnType<typeof initialWorld>, count: number): void {
  for (let i = 0; i < count; i++) w.souls.stolen.push({ table: 'Users', key: w.souls.stolen.length + 1 });
  emit(w, { kind: 'souls-stolen', by: 'ATK-08', count, stolen: w.souls.stolen.length, total: w.souls.total });
}

describe('struggling (SYS-13)', () => {
  it('idle: no useful action for 90 real s; an action that took resets the clock, a refused one does not', () => {
    const w = initialWorld(1, 'medium');
    w.clock.gameMs = idleGameMs - 1;
    expect(struggling(w)).toBeUndefined();
    w.clock.gameMs = idleGameMs;
    expect(struggling(w)).toBe('idle');
    applyAction(w, { type: 'DEF-06', ip: '203.0.113.9', op: 'delete' }); // refused: not blocked
    expect(struggling(w)).toBe('idle');
    applyAction(w, { type: 'DEF-01', query: 'grep 203' }); // looking is useful
    expect(struggling(w)).toBeUndefined();
    w.clock.gameMs += idleGameMs - 1;
    expect(struggling(w)).toBeUndefined();
    w.clock.gameMs += 1;
    expect(struggling(w)).toBe('idle');
  });

  it('souls: more than 10 % of the souls gone within the last 2 real minutes, read off the souls-stolen events', () => {
    const w = initialWorld(1, 'medium');
    const tenPct = Math.floor(w.souls.total * 0.1); // 32 of 325
    w.clock.gameMs = 10 * REAL_S;
    applyAction(w, { type: 'DEF-01', query: 'x' });
    steal(w, tenPct);
    expect(struggling(w)).toBeUndefined(); // exactly 10 % is not "more than"
    steal(w, 1);
    expect(struggling(w)).toBe('souls');
    w.clock.gameMs += soulsWindowGameMs; // the window has moved past those thefts
    applyAction(w, { type: 'DEF-01', query: 'x' });
    expect(struggling(w)).toBeUndefined();
    steal(w, tenPct + 1);
    expect(struggling(w)).toBe('souls');
  });

  it('unlocks one suggestion per window: idle at 90 s, again at 180 s, never twice inside a window; souls use their own 2-minute window', () => {
    const w = initialWorld(1, 'medium');
    const tick = () => { w.clock.gameMs += CONFIG.medium.tickGameMs; stepStruggle(w); };
    while (w.clock.gameMs < 2 * idleGameMs + CONFIG.medium.tickGameMs) tick();
    expect(eventsOfKind(w, 'suggestion').map((e) => ({ t: e.t, n: e.n, reason: e.reason }))).toEqual([{ t: idleGameMs, n: 1, reason: 'idle' }, { t: 2 * idleGameMs, n: 2, reason: 'idle' }]);
    expect(w.struggle.suggestions).toBe(2);
    // souls falling fast right after an idle suggestion: the souls window (2 min) must pass since the last suggestion
    applyAction(w, { type: 'DEF-01', query: 'x' });
    steal(w, 40);
    tick();
    expect(eventsOfKind(w, 'suggestion')).toHaveLength(2);
    w.clock.gameMs = 2 * idleGameMs + soulsWindowGameMs - CONFIG.medium.tickGameMs;
    applyAction(w, { type: 'DEF-01', query: 'x' }); // stays busy, so only the souls condition can fire
    steal(w, 40);
    tick();
    expect(eventsOfKind(w, 'suggestion').at(-1)).toMatchObject({ n: 3, reason: 'souls', t: 2 * idleGameMs + soulsWindowGameMs });
  });

  it('on Easy the detector runs but unlocks nothing (Kiro helps anyway, KIRO-03); Hard unlocks like Medium', () => {
    for (const [difficulty, count] of [['easy', 0], ['hard', 2]] as const) {
      const w = initialWorld(1, difficulty);
      while (w.clock.gameMs < 2 * idleGameMs + 1) { w.clock.gameMs += CONFIG[difficulty].tickGameMs; stepStruggle(w); }
      expect(eventsOfKind(w, 'suggestion'), difficulty).toHaveLength(count);
      expect(w.struggle.suggestions, difficulty).toBe(count);
      expect(w.struggle.lastSuggestionAt, difficulty).toBe(2 * idleGameMs); // tracked on every level
    }
  });

  it('nothing is unlocked after the run has ended', () => {
    const w = initialWorld(1, 'medium');
    w.ending = 'flatline';
    w.clock.gameMs = 5 * idleGameMs;
    stepStruggle(w);
    expect(eventsOfKind(w, 'suggestion')).toEqual([]);
  });

  it('runs inside advance(): an idle player on Medium gets a suggestion every 90 real s', () => {
    const w = initialWorld(1, 'medium');
    advance(w, FIXTURE_LIBRARY, 5 * 60_000); // 5 real minutes
    expect(eventsOfKind(w, 'suggestion').map((e) => e.t / idleGameMs)).toEqual([1, 2, 3]);
  });
});

describe('SYS-13 sim: an idle player on Medium gets exactly one suggestion per struggle window', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  it('one per 90 real s of idling, never two inside a window, up to the ending', () => {
    const r = runSim({ seed: 1, player: () => [], library: FIXTURE_LIBRARY, maxRealMs: 20 * REAL_MIN });
    const suggestions = eventsOfKind(r.world, 'suggestion');
    const end = eventsOfKind(r.world, 'ending')[0]!.t;
    expect(suggestions.length).toBe(Math.floor(end / idleGameMs)); // one per window the run lasted
    expect(suggestions.map((e) => e.n)).toEqual(suggestions.map((_, i) => i + 1));
    for (let i = 1; i < suggestions.length; i++) expect(suggestions[i]!.t - suggestions[i - 1]!.t).toBe(idleGameMs); // the idle windows, back to back
    expect(suggestions.length).toBeGreaterThanOrEqual(5);
    // the same run on Easy unlocks nothing
    const easy = runSim({ seed: 1, difficulty: 'easy', player: () => [], library: FIXTURE_LIBRARY, maxRealMs: 20 * REAL_MIN });
    expect(eventsOfKind(easy.world, 'suggestion')).toEqual([]);
  });
});

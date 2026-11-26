// SYS-13 (D-113, D-114): the struggle detector, on the judging engine. Idle (no RELEVANT action) for 90 real s, souls
// down by more than 10 % in 2 real min, or the same biggest gap standing for 3 real min unlocks one suggestion per
// window on Medium and Hard, aimed at the gap; Easy tracks it and unlocks nothing.
import { describe, expect, it } from 'vitest';
import type { PlayerAction } from '../rules/vocabulary';
import { applyAction } from './actions';
import { advance } from './advance';
import { stepAssess } from './assess';
import { CONFIG } from './config';
import { emit, eventsOfKind } from './log';
import { runSim } from './sim';
import { initialWorld } from './state';
import { stepStruggle, struggling } from './struggle';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_MIN = 60 * 30_000;
const { idleGameMs, soulsWindowGameMs, gapGameMs } = CONFIG.medium.struggle;
const HIS_IP = '203.0.113.9';
/** A relevant look (D-115): it showed a line of his; the world has his address from a move he started. */
const USERS: PlayerAction = { type: 'DEF-01', query: `grep ${HIS_IP} access.log`, shown: [`${HIS_IP} - - [31/Oct/2026:22:00:05 +0000] "GET /w1 HTTP/1.1" 404 10 "-" "ffuf"`] };
function knowsHim(w: ReturnType<typeof initialWorld>): void { emit(w, { kind: 'move-started', move: 'ATK-01', variant: 'a', stage: 1, ip: HIS_IP }); }

function steal(w: ReturnType<typeof initialWorld>, count: number): void {
  for (let i = 0; i < count; i++) w.souls.stolen.push({ table: 'Users', key: w.souls.stolen.length + 1 });
  emit(w, { kind: 'souls-stolen', by: 'ATK-08', count, stolen: w.souls.stolen.length, total: w.souls.total });
}
/** An action, judged by the assessor as the engine would on the next tick. */
function act(w: ReturnType<typeof initialWorld>, action: Parameters<typeof applyAction>[1]): void {
  applyAction(w, action);
  stepAssess(w);
}

describe('struggling (SYS-13)', () => {
  it('idle: no RELEVANT action for 90 real s; a look that shows his line resets the clock, ls/pwd, a refused action or an unfocused read do not', () => {
    const w = initialWorld(1, 'medium');
    knowsHim(w);
    w.clock.gameMs = idleGameMs - 1;
    expect(struggling(w)).toBeUndefined();
    w.clock.gameMs = idleGameMs;
    expect(struggling(w)).toBe('idle');
    act(w, { type: 'DEF-06', ip: '203.0.113.9', op: 'delete' }); // refused: not blocked
    act(w, { type: 'DEF-01', query: 'ls -la /var/log/nginx' }); // unfocused
    act(w, { type: 'DEF-03', path: '/srv/juice-shop' }); // pwd-like
    expect(struggling(w)).toBe('idle');
    act(w, USERS);
    expect(struggling(w)).toBeUndefined();
    w.clock.gameMs += idleGameMs - 1;
    expect(struggling(w)).toBeUndefined();
    w.clock.gameMs += 1;
    expect(struggling(w)).toBe('idle');
  });

  it('souls: more than 10 % of the souls gone within the last 2 real minutes, read off the souls-stolen events', () => {
    const w = initialWorld(1, 'medium');
    knowsHim(w);
    const tenPct = Math.floor(w.souls.total * 0.1); // 32 of 325
    w.clock.gameMs = 10 * 30_000;
    act(w, USERS);
    steal(w, tenPct);
    expect(struggling(w)).toBeUndefined(); // exactly 10 % is not "more than"
    steal(w, 1);
    expect(struggling(w)).toBe('souls');
    w.clock.gameMs += soulsWindowGameMs; // the window has moved past those thefts
    act(w, USERS);
    expect(struggling(w)).toBeUndefined();
    steal(w, tenPct + 1);
    expect(struggling(w)).toBe('souls');
  });

  it('gap: the same biggest gap standing for 3 real minutes (D-114), even while the player keeps acting', () => {
    const w = initialWorld(1, 'medium');
    knowsHim(w);
    emit(w, { kind: 'move-started', move: 'ATK-08', variant: 'd', stage: 4, ip: '203.0.113.85' }); // a soul door opened, never investigated
    w.clock.gameMs = gapGameMs - 1;
    act(w, USERS); // busy, and relevant
    expect(w.assess.gap).toMatchObject({ type: 'door-uninvestigated', since: 0 });
    expect(struggling(w)).toBeUndefined();
    w.clock.gameMs = gapGameMs;
    act(w, USERS);
    expect(struggling(w)).toBe('gap');
    w.clock.gameMs += CONFIG.medium.assess.everyGameMs; // the snapshot (and its gaps) refreshes once a real second
    act(w, { type: 'DEF-01', query: 'grep 203.0.113.85 /var/log/nginx/access.log', shown: ['203.0.113.85 - - [31/Oct/2026:22:00:05 +0000] "GET /rest/products/search?q=x HTTP/1.1" 500 197 "-" "Mozilla/5.0"'] }); // the look showed the door: that gap closes
    expect(w.assess.gaps.map((g) => g.type)).not.toContain('door-uninvestigated');
    expect(w.assess.gap).toMatchObject({ type: 'door-unpatched', since: 0 }); // the next biggest has stood as long
    expect(struggling(w)).toBe('gap');
    w.clock.gameMs += CONFIG.medium.assess.everyGameMs;
    act(w, { type: 'DEF-05', name: 'first' }); // evidence first, or the deploy itself opens a gap
    w.clock.gameMs += CONFIG.medium.assess.everyGameMs;
    act(w, { type: 'DEF-13', patch: 'search' }); // deploying: the gap closes
    expect(w.assess.gaps).toEqual([]);
    expect(struggling(w)).toBeUndefined();
  });

  it('unlocks one suggestion per window, aimed at the biggest gap: idle at 90 s, again at 180 s, never twice inside a window; souls and gaps use their own windows', () => {
    const w = initialWorld(1, 'medium');
    knowsHim(w);
    const tick = () => { w.clock.gameMs += CONFIG.medium.tickGameMs; stepAssess(w); stepStruggle(w); };
    while (w.clock.gameMs < 2 * idleGameMs + CONFIG.medium.tickGameMs) tick();
    expect(eventsOfKind(w, 'suggestion').map((e) => ({ t: e.t, n: e.n, reason: e.reason, gap: e.gap }))).toEqual([
      { t: idleGameMs, n: 1, reason: 'idle', gap: 'stage-unseen' }, { t: 2 * idleGameMs, n: 2, reason: 'idle', gap: 'stage-unseen' },
    ]);
    expect(w.struggle.suggestions).toBe(2);
    // souls falling fast right after an idle suggestion: the souls window (2 min) must pass since the last suggestion
    act(w, USERS);
    steal(w, 40);
    tick();
    expect(eventsOfKind(w, 'suggestion')).toHaveLength(2);
    w.clock.gameMs = 2 * idleGameMs + soulsWindowGameMs - CONFIG.medium.tickGameMs;
    act(w, USERS); // stays busy, so only the souls condition can fire
    steal(w, 40);
    tick();
    expect(eventsOfKind(w, 'suggestion').at(-1)).toMatchObject({ n: 3, reason: 'souls', t: 2 * idleGameMs + soulsWindowGameMs });
  });

  it('on Easy the detector runs but unlocks nothing (Kiro helps anyway, KIRO-03); Hard unlocks and shows one like Medium (D-114)', () => {
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

describe('SYS-13 sims', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  it('an idle player on Medium gets exactly one suggestion per struggle window: one per 90 real s of idling, never two inside a window, up to the ending', () => {
    const r = runSim({ seed: 1, player: () => [], library: FIXTURE_LIBRARY, maxRealMs: 20 * REAL_MIN });
    const suggestions = eventsOfKind(r.world, 'suggestion');
    const end = eventsOfKind(r.world, 'ending')[0]!.t;
    expect(suggestions.length).toBe(Math.floor(end / idleGameMs)); // one per window the run lasted
    expect(suggestions.map((e) => e.n)).toEqual(suggestions.map((_, i) => i + 1));
    for (let i = 1; i < suggestions.length; i++) expect(suggestions[i]!.t - suggestions[i - 1]!.t).toBe(idleGameMs); // the idle windows, back to back
    expect(suggestions.length).toBeGreaterThanOrEqual(4); // several windows: the idle run flatlines at 7.2 min (D-259; 5 windows before)
    for (const s of suggestions) expect(s.gap, `suggestion ${s.n}`).toBeDefined(); // each aimed at the gap standing then
    const easy = runSim({ seed: 1, difficulty: 'easy', player: () => [], library: FIXTURE_LIBRARY, maxRealMs: 20 * REAL_MIN });
    expect(eventsOfKind(easy.world, 'suggestion')).toEqual([]);
  });

  it('a player spamming ls and pwd for three minutes gets a suggestion (and a poor detect grade, see assess.test.ts), on Hard too (D-114)', () => {
    for (const difficulty of ['medium', 'hard'] as const) {
      const r = runSim({ seed: 1, difficulty, library: FIXTURE_LIBRARY, maxRealMs: 3 * REAL_MIN, player: (_w, t) => (t % 2000 === 0 ? [{ type: 'DEF-03', path: '/srv/juice-shop' }, { type: 'DEF-01', query: 'ls -la /var/log/nginx' }] : []) });
      const suggestions = eventsOfKind(r.world, 'suggestion');
      expect(suggestions.length, difficulty).toBeGreaterThanOrEqual(1);
      expect(suggestions[0], difficulty).toMatchObject({ n: 1, reason: 'idle', t: idleGameMs });
      expect(r.world.assess.lastRelevantActionAt, difficulty).toBe(0);
      expect(['C', 'D', 'F'], difficulty).toContain(r.world.assess.grades.detect); // three minutes unseen so far
    }
  });
});

import { describe, expect, it } from 'vitest';
import { gameClockLabel, gameTimeIso, pause, realToGameMs, resume } from './clock';
import { nextRandom, pick } from './rng';
import { initialWorld } from './state';

describe('the game clock (SYS-01)', () => {
  it('converts 1 real second to 30 game seconds on every difficulty', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) expect(realToGameMs(initialWorld(1, d), 1000)).toBe(30_000);
  });

  it('pause works on Easy and is a no-op on Medium and Hard', () => {
    const easy = initialWorld(1, 'easy');
    expect(pause(easy)).toBe(true);
    expect(easy.clock.paused).toBe(true);
    resume(easy);
    expect(easy.clock.paused).toBe(false);
    for (const d of ['medium', 'hard'] as const) {
      const w = initialWorld(1, d);
      expect(pause(w)).toBe(false);
      expect(w.clock.paused).toBe(false);
    }
  });

  it('stamps game time from the scenario start: 90 000 game ms is 22:01:30 on 31 Oct 2026', () => {
    const w = initialWorld(1, 'medium');
    expect(gameTimeIso(w, 90_000)).toBe('2026-10-31T22:01:30.000Z');
    w.clock.gameMs = 3_600_000 + 15_000;
    expect(gameTimeIso(w)).toBe('2026-10-31T23:00:15.000Z');
    expect(gameClockLabel(w)).toBe('23:00');
  });
});

describe('the seeded PRNG', () => {
  it('is deterministic for a seed and stays inside [0, 1)', () => {
    const a = initialWorld(42, 'medium');
    const b = initialWorld(42, 'medium');
    const xs = Array.from({ length: 100 }, () => nextRandom(a));
    expect(xs).toEqual(Array.from({ length: 100 }, () => nextRandom(b)));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(90);
    expect(nextRandom(initialWorld(43, 'medium'))).not.toBe(xs[0]);
  });

  it('pick returns an element of the list and advances the state', () => {
    const w = initialWorld(5, 'medium');
    const before = w.rng;
    expect([1, 2, 3]).toContain(pick(w, [1, 2, 3]));
    expect(w.rng).not.toBe(before);
  });
});

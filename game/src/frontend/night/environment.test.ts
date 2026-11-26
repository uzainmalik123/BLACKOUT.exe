// The night answers the fight (D-255): a breach flickers the lights (never more than three flashes a second), a fix
// that stops an attack steadies them, his return brings silence, theft quickens the heartbeat; nothing else moves it.
import { describe, expect, it } from 'vitest';
import { LASTS, envStep, hushAt, lightAt, startEnv, urgencyOf } from './environment';

const ev = (body: object) => ({ t: 0, id: 1, ...body }) as never;
const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) }, (_, i) => from + i * step);

describe('the room answers the engine (D-255)', () => {
  it('a landed move or a large theft is a breach; a fix that stops an attack is relief; his return is silence', () => {
    expect(envStep(startEnv(), 5, [ev({ kind: 'move-landed', move: 'ATK-08', variant: 'a' })]).breachAt).toBe(5);
    expect(envStep(startEnv(), 5, [ev({ kind: 'souls-stolen', by: 'ATK-08', count: 4, stolen: 4, total: 325 })]).breachAt).toBe(5);
    expect(envStep(startEnv(), 5, [ev({ kind: 'souls-stolen', by: 'ATK-08', count: 1, stolen: 1, total: 325 })]).breachAt).toBe(-99);
    expect(envStep(startEnv(), 6, [ev({ kind: 'move-cut', move: 'ATK-01', variant: 'a', by: 'DEF-06' })]).reliefAt).toBe(6);
    expect(envStep(startEnv(), 6, [], 1).reliefAt).toBe(6);
    expect(envStep(startEnv(), 6, [ev({ kind: 'tap-closed', tap: 'TAP-01' })]).reliefAt).toBe(-99); // ran dry on its own: no relief
    expect(envStep(startEnv(), 7, [ev({ kind: 'return' })]).silenceAt).toBe(7);
    const reads = envStep(startEnv(), 8, [ev({ kind: 'action', action: { type: 'DEF-01', query: 'x' }, ok: true }), ev({ kind: 'alert-opened', alert: 1, about: 'ATK-01' })]);
    expect(reads).toEqual(startEnv());
  });

  it('the flicker dips and recovers, never more than three flashes in any second; reduced motion is one slow dip', () => {
    const env = { ...startEnv(), breachAt: 0 };
    const samples = range(0, 1.5, 0.01).map((t) => lightAt(env, t));
    expect(Math.min(...samples)).toBeLessThan(0.6);
    expect(lightAt(env, LASTS.flicker + 0.01)).toBe(1);
    // a flash: the light falling below 0.7 from above it
    let flashes = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i]! < 0.7 && samples[i - 1]! >= 0.7) flashes++;
    expect(flashes).toBeLessThanOrEqual(3);
    const calm = range(0, 1.5, 0.01).map((t) => lightAt(env, t, true));
    let turns = 0;
    for (let i = 2; i < calm.length; i++) if (Math.sign(calm[i]! - calm[i - 1]!) !== Math.sign(calm[i - 1]! - calm[i - 2]!) && calm[i] !== calm[i - 1]) turns++;
    expect(turns).toBeLessThanOrEqual(2);
    expect(Math.min(...calm)).toBeGreaterThanOrEqual(0.69);
  });

  it('relief lifts the room a little and then settles', () => {
    const env = { ...startEnv(), reliefAt: 0 };
    expect(lightAt(env, LASTS.relief / 2)).toBeGreaterThan(1.1);
    expect(lightAt(env, LASTS.relief + 0.1)).toBe(1);
  });

  it('his return brings silence that falls fast, holds, and lifts', () => {
    const env = { ...startEnv(), silenceAt: 10 };
    expect(hushAt(env, 9.9)).toBe(0);
    expect(hushAt(env, 10.5)).toBe(1);
    expect(hushAt(env, 10 + LASTS.silence - 0.1)).toBeGreaterThan(0);
    expect(hushAt(env, 10 + LASTS.silence - 0.1)).toBeLessThan(1);
    expect(hushAt(env, 10 + LASTS.silence + 0.1)).toBe(0);
  });

  it('the heartbeat reads the worse of the business and the records left', () => {
    expect(urgencyOf(100, 0, 325)).toBe(1);
    expect(urgencyOf(40, 0, 325)).toBeCloseTo(0.4);
    expect(urgencyOf(100, 300, 325)).toBeLessThan(0.3);
    expect(urgencyOf(100, 0, 0)).toBe(1);
  });
});

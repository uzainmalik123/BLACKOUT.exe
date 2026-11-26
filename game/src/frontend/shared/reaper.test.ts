// Death the cute reaper (D-253): his eyes turn from cute to wrong as his menace grows, his head snaps to a tilt and
// holds unnaturally still the rest of the time, and under reduced motion he does not move at all.
import { describe, expect, it } from 'vitest';
import { eyesAt, idleAt, tiltAt } from './reaper';

const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) }, (_, i) => from + i * step);

describe("Death's eyes follow his menace (D-253)", () => {
  it('cute glints when he is calm, red points when he is dangerous, never both at full', () => {
    expect(eyesAt(0)).toEqual({ glint: 1, points: 0, red: 0 });
    expect(eyesAt(1)).toMatchObject({ glint: 0, points: 1, red: 1 });
    let last = eyesAt(0);
    for (const m of range(0, 1.01, 0.05)) {
      const e = eyesAt(m);
      expect(e.glint).toBeLessThanOrEqual(last.glint);
      expect(e.points).toBeGreaterThanOrEqual(last.points);
      expect(e.glint + e.points).toBeLessThanOrEqual(1.25);
      last = e;
    }
  });
});

describe('his movement is unsettling, not busy (D-253)', () => {
  it('his head holds still most of the time and snaps to a small tilt now and then', () => {
    const ts = range(0, 120, 0.01);
    const tilts = ts.map(tiltAt);
    const still = tilts.filter((x) => x === 0).length / tilts.length;
    expect(still).toBeGreaterThan(0.4);
    expect(Math.max(...tilts.map(Math.abs))).toBeLessThanOrEqual(0.18 + 1e-9);
    // the snap is quick: somewhere the tilt changes by more than 0.05 rad in a tenth of a second
    const fast = ts.some((t, i) => i + 10 < ts.length && Math.abs(tilts[i + 10]! - tilts[i]!) > 0.05);
    expect(fast).toBe(true);
    // and it happens more than once in two minutes, but not all the time
    const snaps = tilts.filter((x, i) => i > 0 && x !== 0 && tilts[i - 1] === 0).length;
    expect(snaps).toBeGreaterThanOrEqual(10);
    expect(snaps).toBeLessThanOrEqual(40);
  });

  it('under reduced motion he does not breathe, sway or tilt', () => {
    for (const t of range(0, 30, 0.37)) expect(idleAt(t, true)).toEqual({ breathe: 0, hem: 0, tilt: 0 });
    expect(range(0, 30, 0.37).some((t) => idleAt(t).breathe !== 0)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { Haunt, LUNGE_SECONDS } from './haunt';

const run = (h: Haunt, seconds: number, each?: (h: Haunt) => void) => {
  for (let s = 0; s < seconds; s += 1 / 60) {
    h.update(1 / 60);
    each?.(h);
  }
};

describe('screen 2: how she haunts the menu (D-181)', () => {
  it('opens with her eyes first: dark for a moment, then eyes at the trunk, then she comes out', () => {
    const h = new Haunt(1);
    expect(h.visible).toBe(false);
    run(h, 0.5);
    expect(h.eyes).toBe(0);
    run(h, 0.5);
    expect(h.mode).toBe('eyes');
    expect(h.spot).toBe('trunk');
    expect(h.eyes).toBeGreaterThan(0.9);
    run(h, 2);
    expect(h.revealed).toBe(true);
    expect(h.lean).toBeGreaterThan(0.4);
  });

  it('hides only that once: for two minutes after the opening she stays on show, and keeps changing place', () => {
    const h = new Haunt(7);
    run(h, 3);
    let minLean = Infinity;
    let minEyes = Infinity;
    let moves = 0;
    let last = h.spot;
    run(h, 120, (x) => {
      minLean = Math.min(minLean, x.lean);
      minEyes = Math.min(minEyes, x.eyes);
      if (x.spot !== last) moves++;
      last = x.spot;
    });
    expect(minLean).toBeGreaterThan(0.2);
    expect(minEyes).toBeGreaterThan(0.9);
    expect(moves).toBeGreaterThanOrEqual(8);
  });

  it('is restless: she tilts her head both ways, bends out, and sweeps her hair off her neck', () => {
    const h = new Haunt(3, 'hard', false);
    let lo = 0;
    let hi = 0;
    let bend = 0;
    let part = 0;
    run(h, 90, (x) => {
      lo = Math.min(lo, x.tilt);
      hi = Math.max(hi, x.tilt);
      bend = Math.max(bend, x.bend);
      part = Math.max(part, x.part);
    });
    expect(lo).toBeLessThan(-0.5);
    expect(hi).toBeGreaterThan(0.2);
    expect(bend).toBeGreaterThan(0.9);
    expect(part).toBeGreaterThan(0.9);
  });

  it('changes place on her own: she darts in and is out again fast at the new place', () => {
    const h = new Haunt(5, 'medium', false);
    const from = h.spot;
    let t = 0;
    while (h.spot === from && t < 20) {
      h.update(1 / 60);
      t += 1 / 60;
    }
    expect(h.spot).not.toBe(from);
    expect(t).toBeLessThan(12);
    run(h, 0.6);
    expect(h.lean).toBeGreaterThan(0.35);
  });

  it('is bolder on Hard than on Easy: further out on average', () => {
    const mean = (d: 'easy' | 'hard') => {
      const h = new Haunt(11, d, false);
      let sum = 0;
      let n = 0;
      run(h, 180, (x) => {
        sum += x.shown + x.bend * 0.5;
        n++;
      });
      return sum / n;
    };
    expect(mean('hard')).toBeGreaterThan(mean('easy') * 1.15);
  });

  it('Start Game makes her lunge from wherever she is; it finishes in its time and nothing else reaches her', () => {
    const h = new Haunt(9, 'medium', false);
    run(h, 1);
    h.react('start');
    expect(h.mode).toBe('lunge');
    expect(h.spot).toBe('trunk');
    h.react('dark');
    expect(h.mode).toBe('lunge');
    run(h, LUNGE_SECONDS * 0.5);
    expect(h.done).toBe(false);
    expect(h.lean).toBeGreaterThan(1);
    run(h, LUNGE_SECONDS * 0.6);
    expect(h.done).toBe(true);
  });

  it('is the same every run for the same seed', () => {
    const a = new Haunt(42);
    const b = new Haunt(42);
    run(a, 30);
    run(b, 30);
    expect([a.mode, a.spot, a.lean, a.tilt, a.bend]).toEqual([b.mode, b.spot, b.lean, b.tilt, b.bend]);
  });
});

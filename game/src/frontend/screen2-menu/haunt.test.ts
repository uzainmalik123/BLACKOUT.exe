import { describe, expect, it } from 'vitest';
import { Haunt, LUNGE_SECONDS, REACT_COOLDOWN } from './haunt';

const run = (h: Haunt, seconds: number, each?: (h: Haunt) => void) => {
  for (let s = 0; s < seconds; s += 1 / 60) {
    h.update(1 / 60);
    each?.(h);
  }
};

describe('screen 2: how she haunts the menu (D-181)', () => {
  it('opens with her eyes first: dark for a moment, then eyes at the trunk before any lean', () => {
    const h = new Haunt(1);
    expect(h.visible).toBe(false);
    run(h, 0.5);
    expect(h.eyes).toBe(0);
    run(h, 0.5);
    expect(h.mode).toBe('eyes');
    expect(h.spot).toBe('trunk');
    expect(h.eyes).toBeGreaterThan(0.9);
    expect(h.lean).toBeLessThan(0.2);
  });

  it('never stays on show: over two minutes she hides again and again, and turns up in more than one place', () => {
    const h = new Haunt(7);
    let hides = 0;
    let was = false;
    const spots = new Set<string>();
    run(h, 120, (x) => {
      if (x.visible) spots.add(x.spot);
      if (was && !x.visible) hides++;
      was = x.visible;
    });
    expect(hides).toBeGreaterThanOrEqual(5);
    expect(spots.size).toBeGreaterThan(1);
  });

  it('comes out fast and withdraws slowly', () => {
    const h = new Haunt(3, 'hard', false);
    h.react({ difficulty: 'hard' }); // lean out at the trunk
    let out = 0;
    while (h.lean < 0.8 && out < 20) {
      h.update(1 / 60);
      out += 1 / 60;
    }
    expect(h.lean).toBeGreaterThanOrEqual(0.8);
    expect(out).toBeLessThan(0.6);
    run(h, REACT_COOLDOWN + 0.05);
    h.react({ difficulty: 'easy' }); // withdraw
    let back = 0;
    while (h.lean > 0.05 && back < 20) {
      h.update(1 / 60);
      back += 1 / 60;
    }
    expect(back).toBeGreaterThan(out * 4);
    expect(h.eyes).toBeGreaterThan(0.5); // her eyes stayed on you the whole way back
  });

  it('answers each menu move: hidden to eyes, eyes to a peek, a peek to a lean; a burst of keys gets one answer', () => {
    const h = new Haunt(5, 'medium', false);
    run(h, 0.1);
    h.react('move');
    expect(h.mode).toBe('eyes');
    h.react('move'); // inside the cooldown: ignored
    expect(h.mode).toBe('eyes');
    run(h, REACT_COOLDOWN);
    h.react('move');
    expect(h.mode).toBe('peek');
    run(h, REACT_COOLDOWN);
    h.react('move');
    expect(h.mode).toBe('lean');
  });

  it('is bolder on Hard than on Easy: on show far more of the time', () => {
    const shownFor = (d: 'easy' | 'hard') => {
      const h = new Haunt(11, d, false);
      let on = 0;
      run(h, 180, (x) => {
        if (x.shown > 0.3) on++;
      });
      return on;
    };
    expect(shownFor('hard')).toBeGreaterThan(shownFor('easy') * 1.5);
  });

  it('Start Game makes her lunge from wherever she is; it finishes in its time and nothing else reaches her', () => {
    const h = new Haunt(9, 'medium', false);
    run(h, 1);
    h.react('start');
    expect(h.mode).toBe('lunge');
    expect(h.spot).toBe('trunk');
    h.react('move');
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
    expect([a.mode, a.spot, a.lean, a.tilt]).toEqual([b.mode, b.spot, b.lean, b.tilt]);
  });
});

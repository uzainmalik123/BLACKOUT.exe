import { describe, expect, it } from 'vitest';
import {
  type CurtainFrame,
  AUTO_OPEN_SECONDS,
  MAX_SPEED,
  autoOpen,
  handAnchor,
  innerEdge,
  introPose,
  INTRO_GRIPPED,
  maxHalfGap,
  menuShown,
  needsDesktop,
  strandX,
} from './curtain';

const frame = (open: number, grip = 1): CurtainFrame => ({ W: 1920, H: 1080, U: 32, open, gripL: grip, gripR: grip });

describe('the curtains open on their own', () => {
  it('starts closed and ends fully open', () => {
    expect(autoOpen(-1)).toBe(0);
    expect(autoOpen(0)).toBe(0);
    expect(autoOpen(AUTO_OPEN_SECONDS)).toBe(1);
    expect(autoOpen(AUTO_OPEN_SECONDS + 10)).toBe(1);
  });

  it('only ever opens, never snaps back', () => {
    let last = 0;
    for (let s = 0; s <= AUTO_OPEN_SECONDS + 0.5; s += 1 / 60) {
      const o = autoOpen(s);
      expect(o).toBeGreaterThanOrEqual(last - 1e-12);
      last = o;
    }
  });

  it('pulls in one steady motion: never stops halfway, never faster than the effects allow', () => {
    const speed = (s: number) => (autoOpen(s + 0.01) - autoOpen(s)) / 0.01;
    for (let s = 0.2; s < AUTO_OPEN_SECONDS - 0.2; s += 0.05) expect(speed(s)).toBeGreaterThan(0.03);
    for (let s = 0; s < AUTO_OPEN_SECONDS; s += 0.05) expect(speed(s)).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
  });
});

describe('curtain geometry', () => {
  it('with no hands on them the curtains meet in the middle', () => {
    const f = frame(0, 0);
    expect(innerEdge(f, -1, 540)).toBe(960);
    expect(innerEdge(f, 1, 540)).toBe(960);
  });

  it('opening widens the gap, most at the hands and least at the top', () => {
    const f = frame(1);
    const atHand = innerEdge(f, 1, 1080 * 0.5) - innerEdge(f, -1, 1080 * 0.5);
    const atTop = innerEdge(f, 1, 0) - innerEdge(f, -1, 0);
    expect(atHand).toBeGreaterThan(maxHalfGap(1920) * 1.6);
    expect(atTop).toBeLessThan(atHand * 0.35);
  });

  it('strands stay in order across the curtain, pinched near the fist', () => {
    const f = frame(0.7);
    for (const y of [100, 486, 700, 1000]) {
      let last = -Infinity;
      for (let u = 0; u <= 1.0001; u += 0.05) {
        const x = strandX(f, -1, u, y);
        expect(x).toBeGreaterThanOrEqual(last);
        last = x;
      }
    }
    // the inner half is squeezed tighter at the hand than far below it
    const spread = (y: number) => strandX(f, -1, 1, y) - strandX(f, -1, 0.5, y);
    expect(spread(1080 * 0.45)).toBeLessThan(spread(1000) * 0.5);
  });

  it('each fist sits on its own curtain edge', () => {
    const f = frame(0.5);
    expect(handAnchor(f, -1).x).toBeLessThan(innerEdge(f, -1, handAnchor(f, -1).y));
    expect(handAnchor(f, 1).x).toBeGreaterThan(innerEdge(f, 1, handAnchor(f, 1).y));
  });
});

describe('intro and menu', () => {
  it('the left hand grips first, then the right, and both hold by the end', () => {
    expect(introPose(0)).toEqual({ arriveL: 0, arriveR: 0, curlL: 0, curlR: 0, gripL: 0, gripR: 0 });
    const mid = introPose(2.6);
    expect(mid.gripL).toBe(1);
    expect(mid.gripR).toBe(0);
    const end = introPose(INTRO_GRIPPED);
    expect(Object.values(end).every((v) => v === 1)).toBe(true);
  });

  it('the menu shows once the curtains are mostly open, and stays through small wobbles', () => {
    expect(menuShown(false, 0.7)).toBe(false);
    expect(menuShown(false, 0.85)).toBe(true);
    expect(menuShown(true, 0.72)).toBe(true);
    expect(menuShown(true, 0.5)).toBe(false);
  });

  it('asks for a computer below 1024 px or on touch-only devices (UI-01)', () => {
    expect(needsDesktop(1023, false)).toBe(true);
    expect(needsDesktop(1440, true)).toBe(true);
    expect(needsDesktop(1440, false)).toBe(false);
  });
});

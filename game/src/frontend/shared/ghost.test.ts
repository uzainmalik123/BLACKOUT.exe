// Kiro the ghost (UI-13, D-250): her outline is the logo's, her moods differ, she blinks and looks around, reduced
// motion stops her moving but keeps her moods, her glow never flashes, and her mouth follows her voice.
import { describe, expect, it } from 'vitest';
import { EXPRESSIONS, EYES, LOGO_PATH, MOODS, OUTLINE, blendExpression, blinkAt, glowAt, motionAt, shapeAt, talkLevel, wanderAt } from './ghost';

const xs = OUTLINE.map((p) => p[0]);
const ys = OUTLINE.map((p) => p[1]);
const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) }, (_, i) => from + i * step);

describe("Kiro's outline is the logo's (D-250)", () => {
  it('is the reference silhouette: 79 × 97 px, the eyes right of centre and level, the flipper low on the left', () => {
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(79.2 / 97.4, 2);
    expect(EYES.left[0]).toBeGreaterThan(0);
    expect(EYES.right[0]).toBeGreaterThan(EYES.left[0]);
    expect(EYES.left[1]).toBe(EYES.right[1]);
    expect(EYES.left[1]).toBeLessThan(0);
    expect(EYES.ry / EYES.rx).toBeGreaterThan(1.3); // tall ovals, as drawn
    const leftmost = OUTLINE.reduce((a, b) => (b[0] < a[0] ? b : a));
    expect(leftmost[1]).toBeGreaterThan(0.15); // the flipper, in the lower half
  });

  it('ends in two rounded lobes with a notch between them', () => {
    const bottom = OUTLINE.map((p, i) => ({ i, y: p[1] })).filter((p) => p.y > 0.4);
    const peaks = bottom.filter((p) => {
      const prev = OUTLINE[(p.i - 1 + OUTLINE.length) % OUTLINE.length]![1];
      const next = OUTLINE[(p.i + 1) % OUTLINE.length]![1];
      return p.y >= prev && p.y >= next;
    });
    expect(peaks).toHaveLength(2);
  });

  it('gives a closed, finite SVG path for icons', () => {
    expect(LOGO_PATH.startsWith('M')).toBe(true);
    expect(LOGO_PATH.endsWith('Z')).toBe(true);
    expect(LOGO_PATH).not.toMatch(/NaN|Infinity/);
  });

  it('at rest the moving outline is the logo; raising the flipper moves the flipper only; tucking it presses it in', () => {
    expect(shapeAt({ flow: 0 }, 3, 1, 0, 0)).toEqual(OUTLINE.map((p) => [...p]));
    const raised = shapeAt({ flow: 0 }, 3, 1, 0.6, 0);
    const moved = raised.filter((p, i) => Math.hypot(p[0] - OUTLINE[i]![0], p[1] - OUTLINE[i]![1]) > 1e-9);
    expect(moved.length).toBeGreaterThan(3);
    expect(moved.length).toBeLessThan(10);
    const tip = (pts: ReadonlyArray<readonly [number, number]>) => pts.reduce((a, b) => (b[0] < a[0] ? b : a));
    expect(tip(raised)[1]).toBeLessThan(tip(OUTLINE)[1]);
    // tucked, nothing sticks out to the left below the flipper's root
    const lowLeft = (pts: ReadonlyArray<readonly [number, number]>) => Math.min(...pts.filter((p) => p[1] > 0.25).map((p) => p[0]));
    expect(lowLeft(shapeAt({ flow: 0 }, 3, 1, 0, 1))).toBeGreaterThan(lowLeft(OUTLINE) + 0.05);
  });
});

describe('her moods', () => {
  it('each differs from calm', () => {
    for (const m of MOODS) if (m !== 'calm') expect(EXPRESSIONS[m], m).not.toEqual(EXPRESSIONS.calm);
  });

  it('alarm and shock widen her eyes and redden her glow; happy closes them in arcs; a wince squeezes them and shakes her; sad sinks and dims', () => {
    const { calm, alarm, shock, happy, oops, sad } = EXPRESSIONS;
    for (const e of [alarm, shock]) {
      expect(e.eyeW).toBeGreaterThan(calm.eyeW);
      expect(e.hue[0] - e.hue[2]).toBeGreaterThan(calm.hue[0] - calm.hue[2]);
      expect(e.jitter).toBeGreaterThan(0);
    }
    expect(happy.arcs).toBe(1);
    expect(happy.armsUp).toBe(1);
    expect(oops.squint).toBe(1);
    expect(oops.shake).toBeGreaterThan(0);
    expect(sad.droop).toBe(1);
    expect(sad.glow).toBeLessThan(calm.glow);
  });

  it('blend number by number', () => {
    const half = blendExpression(EXPRESSIONS.calm, EXPRESSIONS.alarm, 0.5);
    expect(half.eyeW).toBeCloseTo((EXPRESSIONS.calm.eyeW + EXPRESSIONS.alarm.eyeW) / 2);
    expect(half.hue[0]).toBeCloseTo((EXPRESSIONS.calm.hue[0] + EXPRESSIONS.alarm.hue[0]) / 2);
    expect(blendExpression(EXPRESSIONS.calm, EXPRESSIONS.sad, 1)).toEqual(EXPRESSIONS.sad);
    expect(blendExpression(EXPRESSIONS.calm, EXPRESSIONS.sad, 0)).toEqual(EXPRESSIONS.calm);
  });
});

describe('her movement', () => {
  it('blinks about every 3.4 s, each blink under a quarter of a second', () => {
    let blinks = 0;
    let shut = 0;
    let longest = 0;
    let wasOpen = true;
    for (const t of range(0, 120, 0.01)) {
      const open = blinkAt(t) > 0.5;
      if (wasOpen && !open) blinks++;
      shut = open ? 0 : shut + 0.01;
      longest = Math.max(longest, shut);
      wasOpen = open;
    }
    expect(blinks).toBeGreaterThanOrEqual(30);
    expect(blinks).toBeLessThanOrEqual(50);
    expect(longest).toBeLessThan(0.25);
  });

  it('looks around on her own, and holds a look she is given', () => {
    const glances = range(0, 60, 0.5).map((t) => wanderAt(t).x);
    expect(Math.max(...glances) - Math.min(...glances)).toBeGreaterThan(0.5);
    for (const t of range(0, 20, 0.37)) expect(motionAt(t, EXPRESSIONS.calm, { look: 1 }).lookX).toBe(1);
  });

  it('moves quicker in alarm than when calm', () => {
    const speed = (e: (typeof EXPRESSIONS)['calm']) => range(0, 10, 0.02).reduce((s, t) => s + Math.abs(motionAt(t + 0.02, e).dy - motionAt(t, e).dy), 0);
    expect(speed(EXPRESSIONS.alarm)).toBeGreaterThan(speed(EXPRESSIONS.calm));
  });

  it('under reduced motion she does not float, sway, tremble or flow, and her mood still shows', () => {
    for (const m of MOODS) {
      const at = range(0, 12, 0.13).map((t) => motionAt(t, EXPRESSIONS[m], { reduce: true }));
      for (const x of at) {
        expect(x.dx).toBe(0);
        expect(x.flow).toBe(0);
        expect(x.wiggle).toBe(0);
        expect(x.rot).toBe(0);
        expect(x.dy).toBe(at[0]!.dy);
      }
    }
    expect(EXPRESSIONS.alarm.eyeW).not.toBe(EXPRESSIONS.calm.eyeW);
  });

  it('her glow never flashes: under one cycle a second, small swings, steady under reduced motion', () => {
    for (const m of MOODS) {
      const e = EXPRESSIONS[m];
      const g = range(0, 10, 1 / 120).map((t) => glowAt(t, e));
      const peaks = g.filter((v, i) => i > 0 && i < g.length - 1 && v > g[i - 1]! && v >= g[i + 1]!).length;
      expect(peaks / 10, m).toBeLessThanOrEqual(1);
      expect(Math.max(...g) - Math.min(...g), m).toBeLessThanOrEqual(0.25 * e.glow + 1e-9);
      expect(new Set(range(0, 5, 0.1).map((t) => glowAt(t, e, true))).size, m).toBe(1);
    }
  });
});

describe('her mouth follows her voice', () => {
  const line = { from: 1, until: 3, word: -1 };

  it('is shut before and after the line and when nothing is said; open while she speaks', () => {
    expect(talkLevel(null, 2)).toBe(0);
    expect(talkLevel(line, 0.5)).toBe(0);
    expect(talkLevel(line, 3.5)).toBe(0);
    const during = range(1.2, 2.8, 0.01).map((t) => talkLevel(line, t));
    for (const v of during) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(during.reduce((a, b) => a + b, 0) / during.length).toBeGreaterThan(0.2);
    expect(Math.min(...during)).toBeLessThan(0.15); // it closes between syllables
  });

  it('opens on each word the voice reaches, then settles', () => {
    const s = { ...line, word: 2 };
    expect(talkLevel(s, 2.01)).toBeGreaterThan(0.9);
    expect(talkLevel(s, 2.6)).toBeLessThan(talkLevel(s, 2.01));
  });

  it('is held half open under reduced motion, not flapping', () => {
    const v = range(1.5, 2.5, 0.05).map((t) => talkLevel(line, t, true));
    expect(new Set(v.map((x) => x.toFixed(6))).size).toBe(1);
    expect(v[0]).toBeGreaterThan(0.3);
  });
});

// The title screen's maths, kept free of the DOM so it can be tested:
// curtain physics, the shape of the tear, the intro's timing, and the desktop check (UI-01).

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Deterministic 0..1 hash of two integers (and a seed). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Small seeded PRNG for procedural art that must look the same every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Physics: the player's arrow keys push the curtains; letting go glides to a stop.

export interface CurtainMotion {
  /** 0 = closed (hands touching), 1 = torn fully open. */
  open: number;
  /** Opening speed, in "open" per second. */
  vel: number;
}

/** The fastest the curtains move, in "open" per second; effects scale against it. */
export const MAX_SPEED = 0.46;

/** Seconds from the second grip until the curtains are fully open. */
export const AUTO_OPEN_SECONDS = 3.4;

/** How open the curtains are s seconds after both hands grip: one steady pull, no pauses. */
export function autoOpen(s: number): number {
  return smoothstep(0, AUTO_OPEN_SECONDS, s);
}

// ---------------------------------------------------------------------------
// Geometry: where each curtain's inner edge is, and where each strand of code hangs.

export type Side = -1 | 1; // -1 left curtain, +1 right curtain

export interface CurtainFrame {
  W: number;
  H: number;
  /** Hand unit in px (fist ≈ 7 units tall). */
  U: number;
  open: number;
  /** 0..1 per side: how firmly each hand holds its curtain. */
  gripL: number;
  gripR: number;
}

export const GRIP_V = { left: 0.45, right: 0.5 } as const;
const TOP_FRAC = 0.2;
const BOTTOM_FRAC = 0.6;

export const maxHalfGap = (W: number): number => W * 0.31;
export const minHalfGap = (U: number): number => U * 2.7;

/** Shape of the tear down the screen: narrow at the top, widest at the hand, falling back below it. */
export function tearProfile(v: number, gripV: number): number {
  if (v <= gripV) {
    const f = clamp(v / gripV);
    return TOP_FRAC + (1 - TOP_FRAC) * (1 - (1 - f) * (1 - f));
  }
  const f = clamp((v - gripV) / (1 - gripV));
  return 1 - (1 - BOTTOM_FRAC) * smoothstep(0, 1, f);
}

export function gripOf(f: CurtainFrame, side: Side): number {
  return side < 0 ? f.gripL : f.gripR;
}

export function gripY(f: CurtainFrame, side: Side): number {
  return f.H * (side < 0 ? GRIP_V.left : GRIP_V.right);
}

/** Half the width of the dark gap at height y, measured from the centre line. */
export function halfGap(f: CurtainFrame, side: Side, y: number): number {
  const grip = gripOf(f, side);
  const atHand = minHalfGap(f.U) * grip + f.open * (maxHalfGap(f.W) - minHalfGap(f.U));
  const gv = side < 0 ? GRIP_V.left : GRIP_V.right;
  return Math.max(0, atHand) * tearProfile(y / f.H, gv);
}

/** Screen x of a curtain's inner (torn) edge at height y. */
export function innerEdge(f: CurtainFrame, side: Side, y: number): number {
  return f.W / 2 + side * halfGap(f, side, y);
}

/** Width of the gathered bundle each fist squeezes the inner strands into. */
export const bundleWidth = (U: number): number => U * 2;

/**
 * Screen x of the strand at u (0 = the screen edge, 1 = the torn edge) at height y.
 * Strands are spread evenly, except near the fist, where the inner half is pinched into a
 * tight bundle: that pinch is what makes the code look held.
 */
export function strandX(f: CurtainFrame, side: Side, u: number, y: number): number {
  const reach = f.W / 2 - halfGap(f, side, y); // distance from this curtain's screen edge to its torn edge
  const gy = gripY(f, side);
  const d = (y - gy) / (f.H * 0.12);
  const g = gripOf(f, side) * Math.exp(-d * d);
  const bw = Math.min(bundleWidth(f.U), reach * 0.6);
  const even = u * reach;
  const gathered = u < 0.5 ? (u / 0.5) * (reach - bw) : reach - bw + ((u - 0.5) / 0.5) * bw;
  const fromEdge = lerp(even, gathered, g);
  return side < 0 ? fromEdge : f.W - fromEdge;
}

/** Where a fist sits: the middle of its bundle at grip height. */
export function handAnchor(f: CurtainFrame, side: Side): { x: number; y: number } {
  const y = gripY(f, side);
  return { x: innerEdge(f, side, y) + side * bundleWidth(f.U) * 0.5, y };
}

// ---------------------------------------------------------------------------
// Intro: the code is already falling; the left hand comes out of the dark, then the right.

export interface IntroPose {
  arriveL: number;
  arriveR: number;
  curlL: number;
  curlR: number;
  gripL: number;
  gripR: number;
}

export function introPose(t: number): IntroPose {
  return {
    arriveL: smoothstep(0.6, 2.0, t),
    arriveR: smoothstep(1.2, 2.6, t),
    curlL: smoothstep(1.6, 2.4, t),
    curlR: smoothstep(2.2, 3.0, t),
    gripL: smoothstep(2.0, 2.6, t),
    gripR: smoothstep(2.6, 3.2, t),
  };
}

/** Seconds of intro after which both hands hold their curtains. */
export const INTRO_GRIPPED = 3.2;

// ---------------------------------------------------------------------------
// When the menu shows, with a little hysteresis so it doesn't flicker at the threshold.

export const MENU_SHOW = 0.8;
export const MENU_HIDE = 0.68;
export function menuShown(wasShown: boolean, open: number): boolean {
  return wasShown ? open > MENU_HIDE : open >= MENU_SHOW;
}

// ---------------------------------------------------------------------------
// UI-01: below 1024 px wide, or on a touch-only device, the game asks for a computer.

export function needsDesktop(width: number, coarseOnly: boolean): boolean {
  return width < 1024 || coarseOnly;
}

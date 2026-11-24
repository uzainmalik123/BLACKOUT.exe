// Her (D-181): a void-black head and shoulders under a mass of long hair that hangs, drifts and sways, painted at
// character resolution into coverage layers (body, and hair on its own so it can fall in front of her face).
// When she is out, a dim, bloodless face shows between the hair: hollow black sockets around her eyes and a long
// black mouth that slowly falls open, and two pale hands with long fingers curl round the edge of the trunk, one
// above her head. The scene draws her eyes on top.
// Geometry is in "head widths" around the head's centre.

import { mulberry32 } from '../shared/math';
import type { CoverLayer } from './field';

export interface WraithPose {
  /** Head centre, css px. */
  x: number;
  y: number;
  /** Head width, css px. */
  hw: number;
  /** Radians; negative tips the crown out to the left, away from the trunk. */
  tilt: number;
  /** 0..1+ how far out she leans: her body trails behind her head. */
  lean: number;
  /** 0 standing .. 1 crouched low (the roots): body short, hair pooling on the ground. */
  crouch: number;
  /** The ground's height under her, css px. */
  ground: number;
  /** 0 no face .. 1 her face fully there. */
  face: number;
  /** 0 closed .. 1 her mouth hanging open. */
  mouth: number;
  /** 0 no hands .. 1 her fingers wrapped round the trunk. */
  grip: number;
  /** 0 upright .. 1 bent sideways out of the tree: her shoulders stay back, her head hangs out and down. */
  bend: number;
  /** 0 hair down .. 1 the hair on her near side swept back off a long pale neck. */
  part: number;
  /** The trunk's left edge at a height, css px (where her fingers curl). */
  edgeAt: (y: number) => number;
  t: number;
  wind: number;
}

interface Strand {
  root: number; // angle on the crown, radians (-PI left .. 0 right, through -PI/2 at the top)
  len: number; // head widths
  r: number; // root radius, head widths
  phase: number;
  sway: number;
}

export interface Eye {
  x: number;
  y: number;
  r: number;
}

/** Eyes sit a little above the head's middle, close-set. */
const EYE_X = 0.19;
const EYE_Y = 0.02;
const EYE_R = 0.055;
/** The neck, the pivot of the tilt, in head widths below the head's centre. */
const NECK = 0.62;

export class Wraith {
  private readonly strands: Strand[];

  constructor(seed = 0xa11) {
    const rnd = mulberry32(seed);
    const n = 64;
    this.strands = Array.from({ length: n }, (_, i) => {
      const u = (i + rnd() * 0.8) / n;
      // long down the sides and back; the ones over her face part around her eyes and fall a little shorter
      const front = Math.abs(u - 0.5) < 0.14;
      // the hair parts in the middle: the front strands frame her face instead of hiding it
      const root = front ? -Math.PI / 2 + Math.sign(u - 0.5 || 1) * (0.55 + rnd() * 0.25) : -Math.PI + u * Math.PI * 1.08 - 0.04;
      return {
        root,
        // very long: most of it reaches the ground and spreads there
        len: (front ? 3.2 : 4.2) + rnd() * 2.4,
        r: 0.045 + rnd() * 0.035,
        phase: rnd() * 6.28,
        sway: 0.6 + rnd() * 0.8,
      };
    });
  }

  /** Head-frame point (head widths) to the world, rotated by the tilt about the neck. */
  private toWorld(p: WraithPose, hx: number, hy: number): { x: number; y: number } {
    const c = Math.cos(p.tilt);
    const s = Math.sin(p.tilt);
    const dy = hy - NECK;
    return { x: p.x + (hx * c - dy * s) * p.hw, y: p.y + (NECK + hx * s + dy * c) * p.hw };
  }

  eyes(p: WraithPose): [Eye, Eye] {
    const l = this.toWorld(p, -EYE_X, EYE_Y);
    const r = this.toWorld(p, EYE_X, EYE_Y);
    return [
      { x: l.x, y: l.y, r: EYE_R * p.hw },
      { x: r.x, y: r.y, r: EYE_R * p.hw },
    ];
  }

  /**
   * Her face at a world point: -1 not on her face, 0 a hole (a socket or her mouth), else how much moonlight
   * the skin there catches (0..1). Only meaningful where her head covers the point and no hair does.
   */
  faceAt(p: WraithPose, x: number, y: number): number {
    if (p.face <= 0) return -1;
    const c = Math.cos(p.tilt);
    const s = Math.sin(p.tilt);
    const dx = (x - p.x) / p.hw;
    const dy = (y - p.y) / p.hw - NECK;
    const hx = dx * c + dy * s;
    const hy = -dx * s + dy * c + NECK;
    // a long, narrow face, longer than it should be
    const fx = hx / 0.33;
    const fy = (hy - 0.1) / 0.5;
    const e = fx * fx + fy * fy;
    if (e > 1) return -1;
    for (const sx of [-EYE_X, EYE_X]) {
      const ax = (hx - sx) / 0.12;
      const ay = (hy - EYE_Y) / 0.095;
      if (ax * ax + ay * ay < 1) return 0;
    }
    const open = 0.05 + 0.95 * p.mouth;
    const mx = hx / (0.06 + 0.03 * p.mouth);
    const my = (hy - 0.33 - 0.07 * open) / (0.06 + 0.15 * open);
    if (mx * mx + my * my < 1) return 0;
    // lit from the upper left, darkening into the cheeks and the jaw
    const light = 0.55 + 0.45 * (-hx * 0.8 - (hy - 0.1) * 0.9);
    return Math.max(0.05, Math.min(1, (1 - e) * 1.6 * light));
  }

  /**
   * Her hands, into `skin` (drawn in front of the trunk): long fingers from behind its edge, curling over its face,
   * flexing slowly. The arms that reach them stay behind the trunk, in `body`.
   */
  private hands(body: CoverLayer, skin: CoverLayer, p: WraithPose, shoulder: { x: number; y: number }): void {
    if (p.grip <= 0.02) return;
    const hw = p.hw;
    const grips = [
      { y: p.y - 0.42 * hw, phase: 0 },
      { y: p.y + 1.15 * hw, phase: 2.1 },
    ];
    for (const g of grips) {
      const edge = p.edgeAt(g.y);
      const wrist = { x: edge + 0.12 * hw, y: g.y + 0.04 * hw };
      body.capsule(shoulder.x, shoulder.y, wrist.x, wrist.y, 0.16 * hw, 0.1 * hw, 1);
      for (let f = 0; f < 4; f++) {
        const off = (f - 1.5) * 0.085 * hw;
        let x = edge - 0.02 * hw;
        let y = g.y + off;
        // straight out over the bark, then curling down at each joint, slowly flexing
        let a = -0.12 + f * 0.05;
        const lens = [0.2, 0.17, 0.14];
        for (let j = 0; j < 3; j++) {
          a += 0.32 + 0.14 * Math.sin(p.t * 1.1 + g.phase + f * 0.7);
          const l = lens[j]! * hw * (0.25 + 0.75 * p.grip);
          const nx = x + Math.cos(a) * l;
          const ny = y + Math.sin(a) * l;
          const r0 = (0.04 - j * 0.007) * hw;
          skin.capsule(x, y, nx, ny, r0, r0 * 0.8, 0.8);
          x = nx;
          y = ny;
        }
      }
      // the knuckles, bunched at the edge
      skin.capsule(edge - 0.06 * hw, g.y - 0.15 * hw, edge - 0.02 * hw, g.y + 0.15 * hw, 0.05 * hw, 0.05 * hw, 0.8);
    }
  }

  /** Paints her body and head into `body`, her hair into `hair`, her hands into `skin`. */
  paint(body: CoverLayer, hair: CoverLayer, skin: CoverLayer, p: WraithPose): void {
    const hw = p.hw;
    // body first (it trails behind the head when she leans out), then the head
    const neck = this.toWorld(p, 0, NECK);
    // bent, her shoulders stay back and high while her head hangs out past them
    const trail = Math.min(1, p.lean) * 0.55 * hw + p.bend * 0.6 * hw;
    const shoulderY = neck.y + 0.42 * hw * (1 - 0.4 * p.crouch) - p.bend * 0.45 * hw;
    const sx = neck.x + trail;
    body.ellipse(sx + 0.1 * hw, shoulderY, 0.95 * hw, 0.42 * hw, 0.12, 1);
    const footY = p.crouch > 0.5 ? Math.min(p.ground, shoulderY + 0.9 * hw) : p.ground + hw;
    body.capsule(sx + 0.05 * hw, shoulderY, sx + 0.45 * hw, footY, 0.78 * hw, 0.95 * hw, 1);
    body.capsule(neck.x, neck.y - 0.1 * hw, sx, shoulderY, 0.22 * hw, 0.4 * hw, 1);
    const head = this.toWorld(p, 0, 0);
    body.ellipse(head.x, head.y, 0.5 * hw, 0.64 * hw, p.tilt, 1);
    this.hands(body, skin, p, { x: sx + 0.2 * hw, y: shoulderY });

    // her neck, bared when the hair is swept off it: long, thin, pale, a dark cord down its side
    if (p.part > 0.2 && p.lean > 0.55) {
      const jaw = this.toWorld(p, -0.16, 0.52);
      const base = { x: sx - 0.25 * hw, y: shoulderY - 0.05 * hw };
      const a = Math.min(1, (p.part - 0.2) / 0.5);
      skin.capsule(jaw.x, jaw.y, base.x, base.y, 0.12 * hw * a, 0.17 * hw * a, 0.6);
      body.capsule(jaw.x + 0.05 * hw, jaw.y + 0.05 * hw, base.x + 0.08 * hw, base.y, 0.015 * hw, 0.02 * hw, 1);
    }

    // hair: each strand leaves the crown, curves out, then hangs straight down under its own weight, the ends
    // lifting and drifting; strands that reach the ground spread along it
    // the crown of hair comes down to a fringe just above her eyes
    const crown = this.toWorld(p, 0, -0.36);
    hair.ellipse(crown.x, crown.y, 0.6 * hw, 0.38 * hw, p.tilt, 1);
    const seg = 8;
    for (const s of this.strands) {
      const rx = Math.cos(s.root) * 0.58;
      const ry = -0.07 + Math.sin(s.root) * 0.66;
      const start = this.toWorld(p, rx, ry);
      let x = start.x;
      let y = start.y;
      // the near side's hair, when swept, is thrown back over her shoulder, behind her
      const swept = rx < -0.15 ? p.part : 0;
      const outX = Math.cos(s.root) * 0.9 * (1 - swept) + swept * 1.6 + Math.sin(p.tilt) * 0.5;
      const step = (s.len * hw) / seg;
      for (let k = 0; k < seg; k++) {
        const f = (k + 1) / seg;
        const pull = Math.min(1, f * (2.4 - swept * 1.4));
        const drift = (0.06 * Math.sin(p.t * 0.7 * s.sway + s.phase + k * 0.55) + p.wind * 0.07) * f * f * 1.6;
        let dx = outX * (1 - pull) * 0.55 + drift;
        let dy = pull;
        const n = Math.hypot(dx, dy) || 1;
        dx /= n;
        dy /= n;
        let nx = x + dx * step;
        let ny = y + dy * step;
        if (ny > p.ground) {
          ny = p.ground;
          nx += Math.sign(outX || -1) * step * 0.7;
        }
        const r0 = s.r * hw * (1 - (k / seg) * 0.75);
        const r1 = s.r * hw * (1 - f * 0.75);
        hair.capsule(x, y, nx, ny, r0, r1, 0.5);
        x = nx;
        y = ny;
      }
    }
  }
}

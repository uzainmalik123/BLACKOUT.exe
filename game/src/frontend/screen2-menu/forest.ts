// The haunted forest of screen 2 (D-181): a twisted dead tree on the right, its limbs moving in the wind,
// roots in the ground, and brambles in front. Everything here is darkness carved out of the moonlit mist,
// painted into coverage layers at character resolution (field.ts) for the scene to turn into characters.
// The trunk is painted once per size; the limbs and brambles are painted every frame as they sway.

import { clamp, lerp, mulberry32 } from '../shared/math';
import { CoverLayer } from './field';
import type { Spot } from './haunt';

interface Limb {
  parent: number; // -1: grows from `base`
  base: { x: number; y: number }; // where a root limb starts (on the trunk)
  dir: number; // angle off the parent's direction (root limbs: absolute), radians, y down
  len: number;
  r0: number;
  r1: number;
  depth: number;
  phase: number;
  /** How much the wind moves this piece against its parent. */
  give: number;
}

interface Stem {
  x: number;
  dir: number;
  len: number;
  curl: number;
  phase: number;
  r: number;
}

/** Where she can hide: her head's height, the trunk's left edge at that height, and her size there. */
export interface HidingPlace {
  y: number;
  edge: number;
  scale: number;
}

export class Forest {
  /** Trunk and roots: still. `tone` holds the across-the-trunk position (0 left rim .. 1 right side). */
  readonly trunk = new CoverLayer();
  /** Limbs and twigs: repainted every frame. */
  readonly limbs = new CoverLayer();
  /** Brambles in front of everything. */
  readonly brambles = new CoverLayer();
  W = 0;
  H = 0;
  /** Scale unit: the width, capped so an ultrawide screen doesn't get a fat tree. */
  Z = 0;
  /** First row of ground in each column. */
  groundRow = new Int16Array(0);
  private yFork = 0;
  private yFoot = 0;
  private bx = 0;
  private fx = 0;
  private tree: Limb[] = [];
  private stems: Stem[] = [];
  private ex = new Float32Array(0);
  private ey = new Float32Array(0);
  private ea = new Float32Array(0);

  resize(W: number, H: number, cols: number, rows: number, cw: number, ch: number): void {
    this.W = W;
    this.H = H;
    this.Z = Math.min(W, H * 1.78);
    for (const l of [this.trunk, this.limbs, this.brambles]) l.resize(cols, rows, cw, ch);
    const Z = this.Z;
    this.bx = W - 0.165 * Z;
    this.fx = this.bx - 0.04 * Z;
    this.yFork = H * 0.3;
    this.yFoot = this.groundY(this.bx) + H * 0.02;
    this.groundRow = new Int16Array(cols);
    for (let i = 0; i < cols; i++) this.groundRow[i] = Math.floor(this.groundY((i + 0.5) * cw) / ch);
    this.grow();
    this.paintTrunk();
  }

  /** The ground's height at x: low on the left, rising toward the tree like the slope it stands on. */
  groundY(x: number): number {
    const u = clamp(x / this.W);
    return this.H * (0.93 - 0.06 * u * u + 0.008 * Math.sin(x * 0.011) + 0.005 * Math.sin(x * 0.037 + 1));
  }

  /** The trunk's centre line at height y: an S-curve leaning back toward the fork. */
  centre(y: number): number {
    const s = clamp((this.yFoot - y) / (this.yFoot - this.yFork));
    return lerp(this.bx, this.fx, s) + Math.sin(s * Math.PI * 1.25) * 0.02 * this.Z;
  }

  /** Half the trunk's width at height y, flaring into the roots. */
  half(y: number): number {
    const s = clamp((this.yFoot - y) / (this.yFoot - this.yFork));
    const Z = this.Z;
    return lerp(0.072 * Z, 0.036 * Z, Math.pow(s, 0.8)) + 0.075 * Z * Math.exp(-s * 9) + 0.004 * Z * Math.sin(y * 0.045);
  }

  /** The three hiding places (haunt.ts's spots). */
  spot(s: Spot): HidingPlace {
    const H = this.H;
    const at = (y: number, scale: number): HidingPlace => ({ y, edge: this.centre(y) - this.half(y), scale });
    switch (s) {
      case 'trunk':
        return at(H * 0.45, 1);
      case 'fork':
        return at(this.yFork + H * 0.05, 0.72);
      case 'roots':
        return at(this.groundY(this.centre(H * 0.8) - this.half(H * 0.8)) - H * 0.1, 0.86);
    }
  }

  /** True where the trunk hides a point (her eyes, when she is behind it). */
  hides(x: number, y: number): boolean {
    if (y < this.yFork - this.H * 0.02 || y > this.yFoot) return false;
    return Math.abs(x - this.centre(y)) < this.half(y) * 0.96;
  }

  // ------------------------------------------------------------------ growing (once per size)

  private grow(): void {
    const rnd = mulberry32(0xdead);
    const Z = this.Z;
    const H = this.H;
    const tree: Limb[] = [];
    const deg = Math.PI / 180;
    const fork = { x: this.fx + 0.004 * Z, y: this.yFork + 0.01 * H };

    // One limb is a chain of gnarled pieces; at its end it splits, and thick ones throw side twigs.
    // `turn` is the first piece's angle against its parent (a root limb: absolute); `world` tracks where the
    // chain points (a root limb starts from 0), so each piece can bend back up toward the sky as dead limbs do.
    const limb = (parent: number, base: { x: number; y: number }, turn: number, world: number, len: number, r: number, depth: number): void => {
      const pieces = depth < 2 ? 4 : depth < 4 ? 3 : 2;
      let p = parent;
      let rr = r;
      let wd = world;
      for (let k = 0; k < pieces; k++) {
        const jitter = (rnd() - 0.5) * (depth < 2 ? 22 : 34) * deg;
        const lift = k === 0 ? 0 : -0.09 * Math.cos(wd);
        const rel = (k === 0 ? turn : 0) + jitter + lift;
        wd += rel;
        const rEnd = rr * (1 - 0.35 / pieces);
        tree.push({ parent: p, base, dir: rel, len: len / pieces, r0: rr, r1: rEnd, depth, phase: rnd() * 6.28, give: 0.004 + depth * depth * 0.0045 });
        p = tree.length - 1;
        rr = rEnd;
        if (depth >= 1 && depth < 5 && k === 1 && rnd() < 0.5) {
          const side = (rnd() < 0.5 ? -1 : 1) * (35 + rnd() * 30) * deg;
          limb(p, base, side, wd, len * 0.45, rr * 0.55, depth + 2);
        }
      }
      if (depth >= 6 || rr < 0.7) return;
      const n = depth < 2 && rnd() < 0.5 ? 3 : 2;
      for (let c = 0; c < n; c++) {
        const spread = (n === 2 ? (c === 0 ? -1 : 1) : c - 1) * (16 + rnd() * 20) * deg;
        limb(p, base, spread, wd, len * (0.66 + rnd() * 0.14), rr * (0.6 + rnd() * 0.12), depth + 1);
      }
    };

    const limbsFromFork: Array<[number, number, number]> = [
      [-152, 0.24, 0.022],
      [-124, 0.21, 0.027],
      [-96, 0.19, 0.027],
      [-66, 0.17, 0.022],
      [-34, 0.15, 0.019],
    ];
    for (const [a, l, r] of limbsFromFork) limb(-1, fork, a * deg, 0, l * Z, r * Z, 0);
    // a lower branch reaching left, the one she hides beneath, and a broken stub on the right
    const yb = H * 0.6;
    limb(-1, { x: this.centre(yb) - this.half(yb) * 0.8, y: yb }, -168 * deg, 0, 0.13 * Z, 0.012 * Z, 2);
    const ys = H * 0.52;
    tree.push({ parent: -1, base: { x: this.centre(ys) + this.half(ys) * 0.8, y: ys }, dir: -20 * deg, len: 0.035 * Z, r0: 0.011 * Z, r1: 0.006 * Z, depth: 1, phase: 0, give: 0.002 });
    this.tree = tree;
    this.ex = new Float32Array(tree.length);
    this.ey = new Float32Array(tree.length);
    this.ea = new Float32Array(tree.length);

    // brambles: thorny stems from the bottom-left corner, kept low under the menu
    this.stems = Array.from({ length: 9 }, (_, i) => {
      const u = i / 8;
      const x = this.W * lerp(-0.01, 0.34, u) + (rnd() - 0.5) * 20;
      const tall = u < 0.15 ? lerp(0.3, 0.2, u / 0.15) : lerp(0.15, 0.08, u);
      return { x, dir: (-90 + (rnd() - 0.3) * 50) * deg, len: H * tall * (0.75 + rnd() * 0.5), curl: (rnd() - 0.5) * 0.5, phase: rnd() * 6.28, r: 1.6 + rnd() * 1.6 };
    });
  }

  private paintTrunk(): void {
    const L = this.trunk;
    L.clear();
    const { cw, ch, cols } = L;
    const top = Math.max(0, Math.floor((this.yFork - this.H * 0.03) / ch));
    const bottom = Math.min(L.rows - 1, Math.ceil(this.yFoot / ch) + 1);
    const aa = cw * 0.6;
    for (let j = top; j <= bottom; j++) {
      const y = (j + 0.5) * ch;
      const c = this.centre(y);
      const hw = this.half(y);
      // the crown fades into the fork, where the limbs take over
      const crown = clamp((y - (this.yFork - this.H * 0.03)) / (this.H * 0.05));
      const i0 = Math.max(0, Math.floor((c - hw) / cw) - 1);
      const i1 = Math.min(cols - 1, Math.ceil((c + hw) / cw) + 1);
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * cw;
        const cov = clamp((hw - Math.abs(x - c)) / aa + 0.5) * crown;
        if (cov <= 0) continue;
        const k = j * cols + i;
        L.cover[k] = cov;
        L.tone[k] = clamp((x - (c - hw)) / (2 * hw));
        L.angle[k] = Math.PI / 2;
      }
    }
    // roots: thick tapering strokes snaking along the ground away from the foot
    const rnd = mulberry32(0x2007);
    const Z = this.Z;
    const roots: Array<[number, number, number]> = [
      [-1, 0.16, 0.03],
      [-1, 0.09, 0.022],
      [1, 0.12, 0.026],
      [1, 0.07, 0.02],
      [-1, 0.05, 0.018],
    ];
    for (const [side, len, r] of roots) {
      let x = this.bx + side * this.half(this.yFoot - this.H * 0.02) * 0.7;
      let y = this.groundY(x) - this.H * 0.01;
      let rr = r * Z;
      const n = 6;
      for (let k = 0; k < n; k++) {
        const nx = x + (side * len * Z) / n;
        const ny = this.groundY(nx) + (rnd() - 0.3) * this.H * 0.008;
        const nr = rr * 0.72;
        L.capsule(x, y, nx, ny, rr, nr, 0.5);
        x = nx;
        y = ny;
        rr = nr;
      }
    }
  }

  // ------------------------------------------------------------------ every frame

  /** Repaint the moving parts: limbs swaying in `wind` (about -1..1), brambles shivering. */
  update(t: number, wind: number): void {
    const { tree, ex, ey, ea } = this;
    const L = this.limbs;
    L.clear();
    for (let n = 0; n < tree.length; n++) {
      const b = tree[n]!;
      let sx: number;
      let sy: number;
      let a: number;
      if (b.parent < 0) {
        sx = b.base.x;
        sy = b.base.y;
        a = b.dir;
      } else {
        sx = ex[b.parent]!;
        sy = ey[b.parent]!;
        a = ea[b.parent]! + b.dir;
      }
      // wind pushes everything the same way; each twig also shivers on its own
      a += b.give * (wind * 1.6 + 0.6 * Math.sin(t * 2.1 + b.phase) * (0.4 + Math.abs(wind)));
      const x1 = sx + Math.cos(a) * b.len;
      const y1 = sy + Math.sin(a) * b.len;
      ex[n] = x1;
      ey[n] = y1;
      ea[n] = a;
      if (x1 < -50 && sx < -50) continue;
      L.capsule(sx, sy, x1, y1, b.r0, b.r1, b.depth / 6);
    }

    const B = this.brambles;
    B.clear();
    for (const s of this.stems) {
      let x = s.x;
      let y = this.H + 4;
      let a = s.dir + 0.08 * wind + 0.05 * Math.sin(t * 1.3 + s.phase);
      const n = 7;
      const seg = s.len / n;
      for (let k = 0; k < n; k++) {
        a += s.curl * 0.35 + 0.03 * Math.sin(t * 2.4 + s.phase + k);
        const nx = x + Math.cos(a) * seg;
        const ny = y + Math.sin(a) * seg;
        const r = s.r * (1 - k / (n + 1));
        B.capsule(x, y, nx, ny, r, r * 0.85, 1);
        // a thorn or a twig every piece, alternating sides
        if (k > 0) {
          const side = k % 2 === 0 ? 1 : -1;
          const ta = a + side * (0.9 + 0.2 * Math.sin(s.phase + k));
          const tl = seg * (k < n - 2 ? 0.55 : 0.3);
          B.capsule(nx, ny, nx + Math.cos(ta) * tl, ny + Math.sin(ta) * tl, r * 0.5, 0.4, 1);
        }
        x = nx;
        y = ny;
      }
    }
  }
}

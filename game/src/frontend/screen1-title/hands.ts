// The hands, built from characters.
//
// Each hand is a set of anatomical capsules (forearm, wrist, four metacarpals, knuckles,
// three phalanges per finger, the thumb) in a local frame whose origin is the middle of the
// bundle of code it grips. Every character cell samples the capsules into a height field;
// the field is lit (a green key light from the code, a rim light, specular on the knuckles)
// and the light picks the character and its colour. Silhouettes and the creases between
// fingers get edge characters, so the shape reads as drawn rather than as noise.
//
// Rendered into an offscreen canvas only when the pose changes; the scene moves it each frame.

import { GlyphAtlas, codes, edgeChar } from '../shared/atlas';
import { clamp, hash2, lerp } from './curtain';

export interface HandPose {
  /** 0.35 = a reaching claw, 1 = a closed fist round the code. */
  curl: number;
  /** 0..1, how hard the fist squeezes while pulling. */
  squeeze: number;
}

const ARM = 0;
const PALM = 1;
const KNUCKLE = 2;
const THUMB = 3;
const FINGER = 4;

interface Prim {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  len2: number;
  ra: number;
  rb: number;
  z: number;
  flat: number;
  part: number;
  /** 0 arm and palm, 1 thumb, 2..5 the fingers: where two groups meet, a dark gap is drawn. */
  group: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Vein {
  pts: [number, number][];
  r: number;
  amp: number;
}

// Local frame of a LEFT hand, in hand units (U px each). +x points into the gap, y down.
const BOUNDS = { minX: -12.4, maxX: 4.4, minY: -6.6, maxY: 7.8 };
/** Where the sleeve takes over the forearm, and the direction it runs off-screen. */
export const SLEEVE = { x: -9.3, y: 5.15, dx: -0.837, dy: 0.547 } as const;

const FINGERS = [
  { k: [-1.55, -2.55], r: 0.9, L: [2.45, 1.6, 1.2], a0: -0.08 },
  { k: [-1.35, -0.8], r: 0.97, L: [2.7, 1.8, 1.3], a0: 0.03 },
  { k: [-1.45, 0.95], r: 0.92, L: [2.55, 1.7, 1.25], a0: 0.12 },
  { k: [-1.9, 2.55], r: 0.78, L: [2.0, 1.3, 1.05], a0: 0.24 },
] as const;
const WRIST_PTS = [
  [-5.15, 0.95],
  [-5.35, 1.8],
  [-5.2, 2.6],
  [-4.85, 3.35],
] as const;

const VEINS: Vein[] = [
  { pts: [[-5.0, 1.35], [-3.6, 0.55], [-2.5, -0.35]], r: 0.2, amp: 0.13 },
  { pts: [[-5.1, 2.55], [-3.7, 2.05], [-2.7, 1.55]], r: 0.18, amp: 0.11 },
  { pts: [[-10.2, 5.6], [-8.0, 4.3], [-6.3, 3.0], [-5.2, 1.9]], r: 0.24, amp: 0.12 },
];

function prim(ax: number, ay: number, bx: number, by: number, ra: number, rb: number, z: number, flat: number, part: number, group = 0): Prim {
  const r = Math.max(ra, rb);
  const dx = bx - ax;
  const dy = by - ay;
  return {
    ax,
    ay,
    dx,
    dy,
    len2: dx * dx + dy * dy,
    ra,
    rb,
    z,
    flat,
    part,
    group,
    minX: Math.min(ax, bx) - r,
    maxX: Math.max(ax, bx) + r,
    minY: Math.min(ay, by) - r,
    maxY: Math.max(ay, by) + r,
  };
}

function buildHand(pose: HandPose): Prim[] {
  const c = clamp(pose.curl);
  const s = clamp(pose.squeeze);
  const P: Prim[] = [];
  // forearm and wrist
  P.push(prim(-12.6, 6.7, -6.6, 3.25, 2.3, 1.95, 0.3, 0.75, ARM));
  P.push(prim(-6.6, 3.25, -4.8, 2.1, 1.95, 1.78, 0.35, 0.72, ARM));
  // back of the hand: a plate, then the four metacarpals as ridges on it (the tendons)
  P.push(prim(-2.6, 0.3, -4.4, 2.1, 1.95, 1.95, 0.3, 0.42, PALM));
  FINGERS.forEach((f, i) => {
    const w = WRIST_PTS[i]!;
    P.push(prim(f.k[0], f.k[1], w[0], w[1], f.r * 1.02, 1.08, 0.45, 0.58, PALM));
  });
  // thumb, wrapping over the top of the fist
  const tm = [lerp(-3.75, -3.5, c), lerp(-2.75, -1.95, c)];
  const ti = [lerp(-2.6, -1.95, c), lerp(-4.55, -3.45, c)];
  const tt = [lerp(-1.2, -0.5, c), lerp(-5.45, -3.7, c)];
  P.push(prim(-4.55, 0.35, tm[0]!, tm[1]!, 1.28, 1.08, 0.7, 0.8, THUMB, 1));
  P.push(prim(tm[0]!, tm[1]!, ti[0]!, ti[1]!, 1.08, 0.94, 0.95, 0.9, THUMB, 1));
  P.push(prim(ti[0]!, ti[1]!, tt[0]!, tt[1]!, 0.94, 0.78, 1.0 - 0.2 * c, 0.95, THUMB, 1));
  P.push(prim(ti[0]!, ti[1]!, ti[0]!, ti[1]!, 0.98, 0.98, 1.1, 0.8, KNUCKLE, 1));
  // knuckles: bumps where the metacarpals meet the fingers
  for (const f of FINGERS) P.push(prim(f.k[0], f.k[1], f.k[0], f.k[1], f.r * 1.0, f.r, 0.66 + 0.12 * s, 0.85, KNUCKLE));
  // fingers: three phalanges each, curling round the bundle and away from us
  FINGERS.forEach((f, i) => {
    const g = 2 + i;
    const r = f.r * 0.88;
    const a1 = f.a0 + c * 0.12 + s * 0.03;
    const a2 = a1 + c * (1.22 + 0.18 * s);
    const a3 = a2 + c * (1.15 + 0.12 * s);
    const L1 = f.L[0] * (1 - 0.06 * c);
    const L2 = f.L[1] * (1 - 0.3 * c);
    const L3 = f.L[2] * (1 - 0.5 * c);
    const p1 = [f.k[0] + Math.cos(a1) * L1, f.k[1] + Math.sin(a1) * L1] as const;
    const p2 = [p1[0] + Math.cos(a2) * L2, p1[1] + Math.sin(a2) * L2] as const;
    const p3 = [p2[0] + Math.cos(a3) * L3, p2[1] + Math.sin(a3) * L3] as const;
    P.push(prim(f.k[0], f.k[1], p1[0], p1[1], r, r * 0.92, 1.0, 1, FINGER, g));
    // the middle knuckle stands proud: a fist's row of bumps
    P.push(prim(p1[0], p1[1], p1[0], p1[1], r * 0.98, r * 0.98, 1.08, 1, KNUCKLE, g));
    P.push(prim(p1[0], p1[1], p2[0], p2[1], r * 0.9, r * 0.8, 1.0 - 0.45 * c, 1, FINGER, g));
    P.push(prim(p2[0], p2[1], p3[0], p3[1], r * 0.8, r * 0.68, 1.0 - 0.9 * c, 1, FINGER, g));
  });
  return P;
}

function segDist2(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1));
  const px = ax + dx * t - x;
  const py = ay + dy * t - y;
  return px * px + py * py;
}

// symbols, not letters: letters inside a hand read as text instead of skin
const RAMP = codes('  ..::-=+*o#%&@@');
const RAMP_ALT = codes('  .,:;~=+x*8%$@@');
const LEVELS = 16;
const RIMS = 4;

function handColor(lvl: number, rim: number): string {
  const v = lvl / (LEVELS - 1);
  // ashen skin, lit green by the code; the rim adds the code's own glow
  const r = 10 + v * 150 + rim * 14;
  const g = 14 + v * 196 + rim * 52;
  const b = 12 + v * 160 + rim * 30;
  return `rgb(${Math.min(255, r) | 0},${Math.min(255, g) | 0},${Math.min(255, b) | 0})`;
}

export class HandArt {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private atlas: GlyphAtlas | null = null;
  private palette: number[] = [];
  private U = 30;
  private cw = 5;
  private ch = 8;
  private cols = 0;
  private rows = 0;
  /** Canvas css px of the local origin (the middle of the gripped bundle). */
  ox = 0;
  oy = 0;
  private last: HandPose = { curl: -1, squeeze: -1 };
  private h = new Float32Array(0);
  private part = new Int8Array(0);
  private grp = new Int8Array(0);

  constructor(readonly side: -1 | 1) {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(U: number, dpr: number): void {
    this.U = U;
    this.ch = Math.max(7, U * 0.29);
    this.cw = this.ch * 0.6;
    const wUnits = BOUNDS.maxX - BOUNDS.minX;
    const hUnits = BOUNDS.maxY - BOUNDS.minY;
    this.cols = Math.ceil((wUnits * U) / this.cw);
    this.rows = Math.ceil((hUnits * U) / this.ch);
    const cssW = this.cols * this.cw;
    const cssH = this.rows * this.ch;
    this.canvas.width = Math.ceil(cssW * dpr);
    this.canvas.height = Math.ceil(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ox = (this.side < 0 ? -BOUNDS.minX : BOUNDS.maxX) * U;
    this.oy = -BOUNDS.minY * U;
    this.h = new Float32Array(this.cols * this.rows);
    this.part = new Int8Array(this.cols * this.rows);
    this.grp = new Int8Array(this.cols * this.rows);
    this.atlas = new GlyphAtlas(this.ch * 1.02, dpr, 0, 500);
    const atlas = this.atlas;
    this.palette = [];
    for (let l = 0; l < LEVELS; l++) for (let r = 0; r < RIMS; r++) this.palette.push(atlas.color(handColor(l, r)));
    this.last = { curl: -1, squeeze: -1 };
  }

  get width(): number {
    return this.cols * this.cw;
  }
  get height(): number {
    return this.rows * this.ch;
  }

  /** Screen-local sleeve start (px from the origin) and its direction. */
  sleeve(): { x: number; y: number; dx: number; dy: number } {
    const m = -this.side; // the left hand is drawn as designed, the right one mirrored
    return { x: m * SLEEVE.x * this.U, y: SLEEVE.y * this.U, dx: m * SLEEVE.dx, dy: SLEEVE.dy };
  }

  /** Re-render if the pose moved enough to see. Returns true if it did. */
  update(pose: HandPose): boolean {
    if (Math.abs(pose.curl - this.last.curl) < 0.015 && Math.abs(pose.squeeze - this.last.squeeze) < 0.05) return false;
    this.last = { ...pose };
    this.rasterize(pose);
    return true;
  }

  private rasterize(pose: HandPose): void {
    const atlas = this.atlas;
    if (!atlas) return;
    const { cols, rows, cw, ch, U, side } = this;
    const prims = buildHand(pose);
    const h = this.h;
    const part = this.part;
    const grp = this.grp;
    const mirror = side < 0 ? 1 : -1;

    // 1. sample the height field
    for (let j = 0; j < rows; j++) {
      const ly = ((j + 0.5) * ch - this.oy) / U;
      for (let i = 0; i < cols; i++) {
        const lx = (((i + 0.5) * cw - this.ox) / U) * mirror;
        let best = 0;
        let bp = -1;
        let bg = -1;
        for (let p = 0; p < prims.length; p++) {
          const q = prims[p]!;
          if (lx < q.minX || lx > q.maxX || ly < q.minY || ly > q.maxY) continue;
          const t = q.len2 > 0 ? clamp(((lx - q.ax) * q.dx + (ly - q.ay) * q.dy) / q.len2) : 0;
          const ex = q.ax + q.dx * t - lx;
          const ey = q.ay + q.dy * t - ly;
          const d2 = ex * ex + ey * ey;
          const r = q.ra + (q.rb - q.ra) * t;
          if (d2 >= r * r) continue;
          const hh = q.z + Math.sqrt(r * r - d2) * q.flat;
          if (hh > best) {
            best = hh;
            bp = q.part;
            bg = q.group;
          }
        }
        if (best > 0 && bp !== FINGER) {
          // veins stand up under the skin of the back of the hand and the forearm
          for (const v of VEINS) {
            for (let k = 0; k + 1 < v.pts.length; k++) {
              const a = v.pts[k]!;
              const b = v.pts[k + 1]!;
              const d2 = segDist2(lx, ly, a[0], a[1], b[0], b[1]);
              if (d2 < v.r * v.r * 4) best += v.amp * Math.exp(-d2 / (v.r * v.r));
            }
          }
        }
        const k = j * cols + i;
        h[k] = best;
        part[k] = bp;
        grp[k] = bg;
      }
    }

    // 2. light it and pick characters
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const cwU = cw / U;
    const chU = ch / U;
    const toGap = -side; // the light comes from the code in the gap
    let Lx = 0.62 * toGap;
    let Ly = -0.5;
    let Lz = 0.6;
    const ll = Math.hypot(Lx, Ly, Lz);
    Lx /= ll;
    Ly /= ll;
    Lz /= ll;
    let Hx = Lx;
    let Hy = Ly;
    let Hz = Lz + 1;
    const hl = Math.hypot(Hx, Hy, Hz);
    Hx /= hl;
    Hy /= hl;
    Hz /= hl;
    const rimX = 0.86 * toGap;
    const rimY = -0.5;

    // dark backing first, row by row, so the hand hides the code behind it
    ctx.fillStyle = '#030504';
    for (let j = 0; j < rows; j++) {
      let run = -1;
      for (let i = 0; i <= cols; i++) {
        const inside = i < cols && h[j * cols + i]! > 0;
        if (inside && run < 0) run = i;
        if (!inside && run >= 0) {
          ctx.fillRect(run * cw - 0.5, j * ch - 0.5, (i - run) * cw + 1, ch + 1);
          run = -1;
        }
      }
    }

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const hc = h[k]!;
        if (hc <= 0) continue;
        const hL = i > 0 ? h[k - 1]! : 0;
        const hR = i < cols - 1 ? h[k + 1]! : 0;
        const hU = j > 0 ? h[k - cols]! : 0;
        const hD = j < rows - 1 ? h[k + cols]! : 0;
        const gx = (hR - hL) / (2 * cwU);
        const gy = (hD - hU) / (2 * chU);
        let nx = -gx;
        let ny = -gy;
        let nz = 1;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const silhouette = hL === 0 || hR === 0 || hU === 0 || hD === 0;
        const lap = hL + hR + hU + hD - 4 * hc;
        // a dark gap wherever one finger (or the thumb) lies against another
        const g0 = grp[k]!;
        const other = (n: number) => { const g = grp[n]!; return h[n]! > 0 && g > 0 && g0 > 0 && g !== g0; };
        const between = g0 > 0 && ((i < cols - 1 && other(k + 1)) || (j < rows - 1 && other(k + cols)));
        const crease = !silhouette && (between || lap > 0.55);

        const lx = (((i + 0.5) * cw - this.ox) / U) * mirror;
        const fall = clamp(0.5 + (lx + 7.5) / 11);
        // wrapped diffuse shows the form even on the side turned away from the code
        const wrap = (nx * Lx + ny * Ly + nz * Lz) * 0.5 + 0.5;
        const diff = wrap * wrap;
        const spec = Math.pow(Math.max(0, nx * Hx + ny * Hy + nz * Hz), 22);
        const n2 = Math.hypot(nx, ny) || 1;
        // the code glows all around the hand, strongest from the gap
        const rim = Math.pow(1 - nz, 1.3) * (0.45 + 0.55 * Math.max(0, (nx * rimX + ny * rimY) / n2)) * (0.55 + 0.45 * fall);
        const ao = clamp(0.35 + 0.5 * (hc / 1.9));
        let v = 0.04 + 0.95 * Math.pow(diff, 1.3) * ao * fall + 0.5 * spec * fall;
        if (part[k] === ARM) v *= 0.7;
        if (crease) v *= between ? 0.15 : 0.4;
        const lvl = Math.round(clamp(v) * (LEVELS - 1));
        const rl = rim > 0.48 ? 3 : rim > 0.3 ? 2 : rim > 0.15 ? 1 : 0;
        if (lvl === 0 && rl === 0) continue;

        let code: number;
        if (silhouette || rl >= 2 || crease) code = edgeChar(gx, gy);
        else code = (lvl > 6 && hash2(i, j, 7) < 0.3 ? RAMP_ALT : RAMP)[lvl]!;
        if (code === 32) continue;
        const colorLvl = Math.max(lvl, silhouette || crease ? Math.min(lvl + 2, 5) : lvl);
        atlas.draw(ctx, code, this.palette[colorLvl * RIMS + rl]!, (i + 0.5) * cw, (j + 0.5) * ch);
      }
    }
  }
}

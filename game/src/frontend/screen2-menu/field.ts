// The forest is painted at character resolution: shapes go into coverage layers, one value per cell, and
// the scene turns the layers into characters. Mist comes from tileable value noise, scrolled each frame.

import { mulberry32 } from '../shared/math';

/** Tileable 2D value noise, a few octaves baked into one table; sampled with wrap and bilinear filtering. */
export class NoiseField {
  private readonly data: Float32Array;

  constructor(
    readonly w: number,
    readonly h: number,
    seed: number,
    octaves = 4,
  ) {
    const rnd = mulberry32(seed);
    this.data = new Float32Array(w * h);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      const cell = Math.max(2, Math.floor(w / (8 << o)));
      const gw = Math.ceil(w / cell);
      const gh = Math.ceil(h / cell);
      const g = new Float32Array(gw * gh);
      for (let k = 0; k < g.length; k++) g[k] = rnd();
      for (let y = 0; y < h; y++) {
        const fy = y / cell;
        const y0 = Math.floor(fy);
        const ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < w; x++) {
          const fx = x / cell;
          const x0 = Math.floor(fx);
          const tx = fx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const a = g[(y0 % gh) * gw + (x0 % gw)]!;
          const b = g[(y0 % gh) * gw + ((x0 + 1) % gw)]!;
          const c = g[((y0 + 1) % gh) * gw + (x0 % gw)]!;
          const d = g[((y0 + 1) % gh) * gw + ((x0 + 1) % gw)]!;
          const v = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
          const k = y * w + x;
          this.data[k] = this.data[k]! + v * amp;
        }
      }
      total += amp;
      amp *= 0.5;
    }
    for (let k = 0; k < this.data.length; k++) this.data[k] = this.data[k]! / total;
  }

  /** 0..1 at any real coordinate (wraps). */
  sample(x: number, y: number): number {
    const { w, h } = this;
    const fx = ((x % w) + w) % w;
    const fy = ((y % h) + h) % h;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const x1 = (x0 + 1) % w;
    const y1 = (y0 + 1) % h;
    const d = this.data;
    const a = d[y0 * w + x0]!;
    const b = d[y0 * w + x1]!;
    const c = d[y1 * w + x0]!;
    const e = d[y1 * w + x1]!;
    return (a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty;
  }
}

/**
 * One layer of the picture at character resolution: how much of each cell a shape covers (0..1), and the
 * direction of the stroke that covers it most, so thin limbs and hair can be drawn with `/ | \ -`.
 * Shapes are given in css px; cells are `cw` by `ch` px.
 */
export class CoverLayer {
  cover = new Float32Array(0);
  angle = new Float32Array(0);
  /** 0..1 extra per cell, free for the shape's own use (bark grain, hair sheen). */
  tone = new Float32Array(0);
  cols = 0;
  rows = 0;
  cw = 8;
  ch = 14;

  resize(cols: number, rows: number, cw: number, ch: number): void {
    this.cols = cols;
    this.rows = rows;
    this.cw = cw;
    this.ch = ch;
    this.cover = new Float32Array(cols * rows);
    this.angle = new Float32Array(cols * rows);
    this.tone = new Float32Array(cols * rows);
  }

  clear(): void {
    this.cover.fill(0);
    this.tone.fill(0);
  }

  private put(k: number, c: number, a: number, tone: number): void {
    if (c > this.cover[k]!) {
      this.cover[k] = c;
      this.angle[k] = a;
      this.tone[k] = tone;
    }
  }

  /** A tapered stroke from (x0, y0) radius r0 to (x1, y1) radius r1, in px. */
  capsule(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, tone = 0): void {
    const { cw, ch, cols, rows } = this;
    const rmax = Math.max(r0, r1);
    const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - rmax) / cw - 1));
    const i1 = Math.min(cols - 1, Math.ceil((Math.max(x0, x1) + rmax) / cw + 1));
    const j0 = Math.max(0, Math.floor((Math.min(y0, y1) - rmax) / ch - 1));
    const j1 = Math.min(rows - 1, Math.ceil((Math.max(y0, y1) + rmax) / ch + 1));
    if (i0 > i1 || j0 > j1) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    const a = Math.atan2(dy, dx);
    // anti-aliasing width: about half a cell, so a hair-thin stroke still marks the cells it crosses
    const aa = cw * 0.55;
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) * ch;
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * cw;
        let u = ((px - x0) * dx + (py - y0) * dy) / len2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = x0 + dx * u - px;
        // cells are taller than wide: measure across a cell's height at half weight, so thin strokes stay unbroken
        const qy = (y0 + dy * u - py) * 0.72;
        const d = Math.sqrt(qx * qx + qy * qy);
        const r = r0 + (r1 - r0) * u;
        const c = (r - d) / aa + 0.5;
        if (c > 0) this.put(j * cols + i, c > 1 ? 1 : c, a, tone);
      }
    }
  }

  /** A filled ellipse, rotated by `rot` about its centre. */
  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, tone = 0): void {
    const { cw, ch, cols, rows } = this;
    const rmax = Math.max(rx, ry);
    const i0 = Math.max(0, Math.floor((cx - rmax) / cw - 1));
    const i1 = Math.min(cols - 1, Math.ceil((cx + rmax) / cw + 1));
    const j0 = Math.max(0, Math.floor((cy - rmax) / ch - 1));
    const j1 = Math.min(rows - 1, Math.ceil((cy + rmax) / ch + 1));
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const aa = cw * 0.6;
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) * ch - cy;
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * cw - cx;
        const u = (px * cs + py * sn) / rx;
        const v = (-px * sn + py * cs) / ry;
        const r = Math.sqrt(u * u + v * v);
        // signed distance to the rim, roughly, in px
        const d = (r - 1) * Math.min(rx, ry);
        const c = 0.5 - d / aa;
        if (c <= 0) continue;
        // the rim's tangent, for edge characters: perpendicular to the gradient, turned back into the world
        const tx = -v / ry;
        const ty = u / rx;
        this.put(j * cols + i, c > 1 ? 1 : c, Math.atan2(tx * sn + ty * cs, tx * cs - ty * sn), tone);
      }
    }
  }
}

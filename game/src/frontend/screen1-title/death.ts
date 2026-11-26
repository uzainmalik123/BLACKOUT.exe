// Death, built from characters (D-253): the cute grim reaper of the team's reference, waiting behind the code.
//
// He is painted once by the same painter as every other screen (`shared/reaper.ts`: the big dark-brown hood, the
// ivory skull, the oversized black eyes, the tiny nose and smile, the wooden scythe) at character resolution; each
// cell becomes a character from a 70-step density ramp, so he reads as an ASCII portrait: a bright skull, a sparse dark
// robe, his eyes two holes of nothing. Every frame the cells are re-read with breathing, a slow melt and glitches, and
// the only living thing in him is drawn live: a tiny red point in each eye that follows the player.

import { GlyphAtlas, codes, edgeChar, strokeChar } from '../shared/atlas';
import { clamp, hash2 } from './curtain';
import { drawDeath } from '../shared/reaper';

const DU = 100; // design units across
const DV = 130; // design units down
/** Where the reaper stands in the design box, and how tall he is (design units). */
const BASE = { x: 63, y: 127, s: 112 } as const;
/** His eye holes, from the painter's proportions (-0.135 and 0.066 across, 0.69 up). */
const EYES = [
  { x: BASE.x - 0.135 * BASE.s, y: BASE.y - 0.69 * BASE.s },
  { x: BASE.x + 0.066 * BASE.s, y: BASE.y - 0.69 * BASE.s },
] as const;
/** The red point in each hole (its glow's radius), and how far it wanders with the player's look. */
const IRIS_R = 1.6;
const LOOK_X = 2.4;
const LOOK_Y = 1.6;
/** The points get a finer grid than the rest of him: they are what you look at. */
const EYE_CELL = 0.5;

const NONE = 0;
const SKIN = 1; // warm: face and neck
const HAIR = 2; // cool: hair
const CLOAK = 3;
const WOOD = 4; // the scythe's staff

export interface DeathParams {
  t: number;
  /** 0..1: how much of her has assembled out of the dark. */
  reveal: number;
  /** 0..1: eye brightness. */
  eyes: number;
  /** -1..1 where she looks. */
  lookX: number;
  lookY: number;
  /** 0..1 pupil dilation. */
  pupil: number;
  /** 0..1 extra distortion (the curtains moving fast, a glitch). */
  distort: number;
  /** A band of rows torn sideways, or null. */
  tear: { r0: number; r1: number; shift: number } | null;
}

/** Dark to light by how much ink each character puts down. */
const RAMP = codes(' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$');
const HALF = codes('.:o0@');

const WARM = ['#2c2824', '#48423b', '#6a6359', '#8e867a', '#b3aa9b', '#d5ccbb', '#eee6d7', '#fffaf0'];
const COOL = ['#25252b', '#3b3b43', '#56555e', '#75747e', '#9796a0', '#bab9c2', '#dbdae1', '#f6f5fa'];
const WOODS = ['#2a160b', '#4a2a14', '#6e401f', '#96592c', '#b8743a'];
const NAVY = ['#121b3d', '#1f2f62', '#304890', '#4d6cc0'];

export class DeathArt {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private atlas: GlyphAtlas | null = null;
  private eyeAtlas: GlyphAtlas | null = null;
  cols = 0;
  rows = 0;
  cw = 7;
  ch = 11;
  /** Screen placement, css px. */
  left = 0;
  top = 0;
  width = 0;
  height = 0;
  private baseCode = new Uint16Array(0);
  private baseColor = new Int16Array(0);
  private brightColor = new Int16Array(0);
  private thr = new Float32Array(0);
  private eyeColors: Record<string, number> = {};
  private crimson = 0;
  private blood = 0;
  private bloodDeep = 0;
  private green = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(W: number, H: number, dpr: number): void {
    // full height on a desktop; on a narrow screen (the gate) she shrinks to fit its width
    // sits high enough that her whole face, lips and chin included, clears the title below it
    this.height = Math.min(H * 0.94, (W * 1.15 * DV) / DU);
    this.width = (this.height * DU) / DV;
    this.left = (W - this.width) / 2;
    this.top = this.height < H * 0.9 ? H * 0.03 : -H * 0.07;
    this.ch = clamp(H * 0.0086, 6.5, 11);
    this.cw = this.ch * 0.6;
    this.cols = Math.round(this.width / this.cw);
    this.rows = Math.round(this.height / this.ch);
    this.canvas.width = Math.ceil(this.cols * this.cw * dpr);
    this.canvas.height = Math.ceil(this.rows * this.ch * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.atlas = new GlyphAtlas(this.ch * 1.06, dpr, 0, 600);
    this.eyeAtlas = new GlyphAtlas(this.ch * EYE_CELL * 1.15, dpr, this.ch * 0.45, 700);
    const ea = this.eyeAtlas;
    this.eyeColors = {
      sclera: ea.color('#d6c9cd'),
      scleraDim: ea.color('#8a7880'),
      vein: ea.color('#ff2438'),
      flash: ea.color('#ff2a3c'),
      pupil: ea.color('#10163f'),
      catch: ea.color('#ffe3f6'),
      inner: ea.color('#d4feff'),
      cyan: ea.color('#55e9ff'),
      blue: ea.color('#4a70ff'),
      magenta: ea.color('#ff4fc6'),
      violet: ea.color('#8a3fb8'),
    };
    this.crimson = this.atlas.color('#a3121d');
    this.blood = this.atlas.color('#ff2a36');
    this.bloodDeep = this.atlas.color('#c0101e');
    this.green = this.atlas.color('#2bd673');
    this.build();
  }

  /** Screen position of an eye's centre, for the glow. */
  eye(i: 0 | 1, lookX: number, lookY: number): { x: number; y: number; r: number } {
    const e = EYES[i];
    const s = this.width / DU;
    return { x: this.left + (e.x + lookX * LOOK_X) * s, y: this.top + (e.y + lookY * LOOK_Y) * s, r: IRIS_R * s };
  }

  private build(): void {
    const { cols, rows } = this;
    const atlas = this.atlas;
    if (!atlas) return;
    const src = document.createElement('canvas');
    src.width = cols;
    src.height = rows;
    const dirc = document.createElement('canvas');
    dirc.width = cols;
    dirc.height = rows;
    const a = src.getContext('2d', { willReadFrequently: true });
    const d = dirc.getContext('2d', { willReadFrequently: true });
    if (!a || !d) return;
    paintDeath(a, d, cols, rows);
    const px = a.getImageData(0, 0, cols, rows).data;
    const dx = d.getImageData(0, 0, cols, rows).data;

    const n = cols * rows;
    const lum = new Float32Array(n);
    const kind = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const r = px[k * 4]!;
      const g = px[k * 4 + 1]!;
      const b = px[k * 4 + 2]!;
      // a contrast curve: deep shadows, bright highlights, so the form reads in characters
      const L = Math.pow(clamp(((0.299 * r + 0.587 * g + 0.114 * b) / 255 - 0.04) / 0.9), 1.25);
      lum[k] = L;
      if (L < 0.035) kind[k] = NONE;
      else if (b > r + 25 && b > g + 10) kind[k] = CLOAK;
      else if (r > b + 18 && r > g + 25) kind[k] = WOOD;
      else if (b >= r) kind[k] = HAIR;
      else kind[k] = SKIN;
    }

    const pal = (list: string[]) => list.map((c) => atlas.color(c));
    const warm = pal(WARM);
    const cool = pal(COOL);
    const woods = pal(WOODS);
    const navy = pal(NAVY);
    const pick = (p: number[], L: number) => clamp(Math.floor(L * p.length), 0, p.length - 1);

    this.baseCode = new Uint16Array(n);
    this.baseColor = new Int16Array(n).fill(-1);
    this.brightColor = new Int16Array(n).fill(-1);
    this.thr = new Float32Array(n);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        this.thr[k] = hash2(i, j, 11) * 0.7 + Math.abs(j / rows - 0.42) * 0.5;
        const kd = kind[k]!;
        if (kd === NONE) continue;
        const L = lum[k]!;
        const Ll = i > 0 ? lum[k - 1]! : 0;
        const Lr = i < cols - 1 ? lum[k + 1]! : 0;
        const Lu = j > 0 ? lum[k - cols]! : 0;
        const Ld = j < rows - 1 ? lum[k + cols]! : 0;
        const gx = Lr - Ll;
        const gy = Ld - Lu;
        const mag = Math.hypot(gx, gy);
        const h = hash2(i, j, 3);
        let code: number;
        let p: number[];
        if (kd === CLOAK) {
          // the cloak keeps a halftone weave
          if (L < 0.32 && ((i + j) & 1) === 1) continue;
          code = HALF[clamp(Math.floor(L * 1.5 * HALF.length), 0, HALF.length - 1)]!;
          p = navy;
        } else {
          const idx = clamp(Math.floor(Math.pow(L, 1.05) * (RAMP.length - 1)), 1, RAMP.length - 1);
          code = RAMP[idx]!;
          p = kd === SKIN ? warm : kd === WOOD ? woods : cool;
          const dirR = dx[k * 4]!;
          if (kd === HAIR && dirR > 0 && L > 0.28 && h < 0.5) code = strokeChar(((dirR - 1) / 254) * Math.PI);
          else if (mag > 0.42 && L > 0.2) code = edgeChar(gx, gy);
        }
        const li = pick(p, L);
        this.baseCode[k] = code;
        this.baseColor[k] = p[li]!;
        this.brightColor[k] = p[Math.min(li + 1, p.length - 1)]!;
      }
    }
  }

  render(p: DeathParams): void {
    const atlas = this.atlas;
    const eyeAtlas = this.eyeAtlas;
    if (!atlas || !eyeAtlas) return;
    const ctx = this.ctx;
    const { cols, rows, cw, ch } = this;
    ctx.clearRect(0, 0, cols * cw, rows * ch);
    if (p.reveal <= 0.001 && p.eyes <= 0.001) return;

    const t = p.t;
    const breath = 1 + 0.01 * Math.sin(t * 1.05) + 0.003 * Math.sin(t * 2.7);
    const cy = rows * 0.45;
    const gate = p.reveal * 1.35 - 0.12;
    const flickSeed = Math.floor(t * 7);
    const sheenRow = ((t * 0.09) % 1.6 - 0.3) * rows;

    // he is solid dark: nothing behind him shows through the hood
    const lw = cols * cw;
    const lh = rows * ch;
    ctx.save();
    ctx.globalAlpha = clamp(p.reveal * 1.4);
    ctx.translate(lw * 0.5, lh * 0.47);
    ctx.scale(1, 1.42);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, lw * 0.46);
    g.addColorStop(0, 'rgba(0,0,0,0.97)');
    g.addColorStop(0.75, 'rgba(0,0,0,0.92)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-lw * 0.5, -lh * 0.5, lw, lh);
    ctx.restore();

    const shifts = new Int16Array(rows);
    const srcRow = new Int16Array(rows);
    for (let r = 0; r < rows; r++) {
      let w = Math.sin(r * 0.11 + t * 1.3) * (0.15 + p.distort * 2) + Math.sin(r * 0.031 - t * 0.7) * 0.6 * p.distort;
      if (p.tear && r >= p.tear.r0 && r <= p.tear.r1) w += p.tear.shift;
      shifts[r] = Math.round(w);
      srcRow[r] = Math.round(cy + (r - cy) / breath);
    }

    for (let r = 0; r < rows; r++) {
      const sr = srcRow[r]!;
      if (sr < 0 || sr >= rows) continue;
      const shift = shifts[r]!;
      const inTear = p.tear !== null && r >= p.tear.r0 && r <= p.tear.r1;
      const sheen = Math.abs(r - sheenRow) < 3;
      const y = (r + 0.5) * ch;
      for (let c = 0; c < cols; c++) {
        const sc = c - shift;
        if (sc < 0 || sc >= cols) continue;
        const k = sr * cols + sc;
        const col = this.baseColor[k]!;
        if (col < 0) continue;
        if (this.thr[k]! > gate) continue;
        let code = this.baseCode[k]!;
        let color = sheen ? this.brightColor[k]! : col;
        if (inTear) {
          const f = hash2(sc, sr, flickSeed);
          if (f < 0.35) color = this.crimson;
          else if (f < 0.5) {
            color = this.green;
            code = f < 0.42 ? 48 : 49;
          }
        }
        atlas.draw(ctx, code, color, (c + 0.5) * cw, y);
      }
    }

    // the eyes, drawn live: in each black hole, one tiny red point that follows the player; now and then it flares
    if (p.eyes > 0.001) {
      const ec = this.eyeColors;
      const spasmAt = t % 4.7;
      const spasm = spasmAt < 0.3 ? Math.sin((spasmAt / 0.3) * Math.PI) : 0;
      const reach = 0.7 + 0.35 * clamp(p.pupil) + 1.4 * spasm; // design units
      const pulse = 0.88 + 0.12 * Math.sin(t * 2.3);
      ctx.globalAlpha = clamp(p.eyes * pulse);
      const ecw = cw * EYE_CELL;
      const ech = ch * EYE_CELL;
      const toDu = DU / (cols * cw); // layer px -> design units
      for (const e of EYES) {
        const ix = e.x + p.lookX * LOOK_X;
        const iy = e.y + p.lookY * LOOK_Y;
        for (let r = Math.floor((iy - 3) / toDu / ech); r * ech * toDu <= iy + 3; r++) {
          const y = (r + 0.5) * ech;
          for (let c = Math.floor((ix - 3) / toDu / ecw); c * ecw * toDu <= ix + 3; c++) {
            const x = (c + 0.5) * ecw;
            const d = Math.hypot(x * toDu - ix, y * toDu - iy);
            if (d > reach) continue;
            eyeAtlas.draw(ctx, d < reach * 0.45 ? 42 : 46, spasm > 0.4 ? ec.flash! : ec.vein!, x, y, 1);
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// The portrait, painted at character resolution.

function paintDeath(a: CanvasRenderingContext2D, d: CanvasRenderingContext2D, cols: number, rows: number): void {
  for (const c of [a, d]) {
    c.setTransform(cols / DU, 0, 0, rows / DV, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, DU, DV);
  }
  // still and a little menacing: no glints in his eyes (they are drawn live), nothing moving
  drawDeath(a, BASE.x, BASE.y, BASE.s, { t: 0, form: 1, point: 0, fragment: 0, eyes: 0, menace: 0.7, reduce: true }, 1);
}

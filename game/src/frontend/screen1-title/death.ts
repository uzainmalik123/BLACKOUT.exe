// Death, built from characters: an enchantress waiting behind the code.
//
// Her portrait is painted procedurally (no image files) at character resolution, shaded like a
// real face: a pale, gaunt oval lit from above, sunken cheeks, the bridge and wings of the nose,
// sculpted dark lips, fine brows, almond eyes under heavy lids, and long silver hair parted in
// the middle and falling past her shoulders onto a dark cloak. Each cell becomes a character
// from a 70-step density ramp, so the shading reads as an ASCII portrait; hair cells follow the
// strand they belong to. Every frame the cells are re-read with breathing, a slow melt and
// glitches, and the eyes are drawn live: glowing halftone irises clipped by the lids.

import { GlyphAtlas, codes, edgeChar, strokeChar } from '../shared/atlas';
import { clamp, hash2, lerp, mulberry32 } from './curtain';

const DU = 100; // design units across
const DV = 130; // design units down
const EYES = [
  { x: 38.6, y: 49.6 },
  { x: 61.4, y: 49.6 },
] as const;
/** Wide, terrified eyes: the lids pull back far enough to show the white above and below the iris. */
const IRIS_R = 3.6;
const SOCKET_RX = 6.6;
const SOCKET_RY = 4.3;
const LOOK_X = 1.7;
const LOOK_Y = 0.7;
/** The eyes get a finer grid than the rest of her: they are what you look at. */
const EYE_CELL = 0.5;

const NONE = 0;
const SKIN = 1; // warm: face and neck
const HAIR = 2; // cool: hair
const CLOAK = 3;
const LIPS = 4;

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
const PLUM = ['#2e141a', '#4f222c', '#73343f', '#9a4d59', '#c47884'];
const NAVY = ['#121b3d', '#1f2f62', '#304890', '#4d6cc0'];

type Pt = readonly [number, number];

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
      else if (r > b + 18 && r > g + 25) kind[k] = LIPS;
      else if (b >= r) kind[k] = HAIR;
      else kind[k] = SKIN;
    }

    const pal = (list: string[]) => list.map((c) => atlas.color(c));
    const warm = pal(WARM);
    const cool = pal(COOL);
    const plum = pal(PLUM);
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
          p = kd === SKIN ? warm : kd === LIPS ? plum : cool;
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

    // her head is solid dark: nothing behind her shows through the face
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

    // the eyes, drawn live: a dark eyeball, the glowing iris, clipped by the lids
    if (p.eyes > 0.001) {
      const ec = this.eyeColors;
      const sx = DU / cols;
      // terror: pinpoint pupils that never stop trembling, and every few seconds a spasm where
      // they blow wide and the irises flash red
      const spasmAt = t % 4.7;
      const spasm = spasmAt < 0.3 ? Math.sin((spasmAt / 0.3) * Math.PI) : 0;
      const pr = 0.13 + 0.05 * clamp(p.pupil) + 0.42 * spasm;
      const trembleX = Math.sin(t * 31) * 0.2 + Math.sin(t * 17.3) * 0.14;
      const trembleY = Math.cos(t * 27.1) * 0.13;
      const pulse = 0.88 + 0.12 * Math.sin(t * 2.3);
      ctx.globalAlpha = clamp(p.eyes * pulse);
      const ecw = cw * EYE_CELL;
      const ech = ch * EYE_CELL;
      const toDu = DU / (cols * cw); // layer px -> design units
      const cyD = DV * 0.45;
      for (const e of EYES) {
        const ix = e.x + p.lookX * LOOK_X + trembleX;
        const iy = e.y + p.lookY * LOOK_Y + trembleY;
        const y0 = (e.y - SOCKET_RY - 2) / toDu;
        const y1 = (e.y + SOCKET_RY + 2) / toDu;
        const x0 = (e.x - SOCKET_RX - 3) / toDu;
        const x1 = (e.x + SOCKET_RX + 3) / toDu;
        for (let r = Math.floor(y0 / ech); r * ech <= y1; r++) {
          const y = (r + 0.5) * ech;
          const row = clamp(Math.floor(y / ch), 0, rows - 1);
          // follow her breathing and the melt of the row the eye sits in
          const uy = cyD + (y * (DV / (rows * ch)) - cyD) / breath;
          const shiftD = shifts[row]! * sx;
          for (let c = Math.floor(x0 / ecw); c * ecw <= x1; c++) {
            const x = (c + 0.5) * ecw;
            const ux = x * toDu - shiftD;
            // the almond between the lids: fuller above, flatter below
            const ex = (ux - e.x) / SOCKET_RX;
            if (Math.abs(ex) > 1) continue;
            const open = 1 - ex * ex;
            const dy = uy - e.y;
            if (dy < -SOCKET_RY * open || dy > SOCKET_RY * 0.8 * open) continue;
            const rr = Math.hypot(ux - ix, uy - iy) / IRIS_R;
            const checker = ((c + r) & 1) === 0;
            let code: number;
            let color: number;
            let scale = 1;
            if (rr > 1) {
              // a bloodshot white: red veins crawl in from the corners toward the iris
              const ang = Math.atan2(uy - iy, ux - ix);
              const vein = Math.abs(Math.sin(ang * 5 + rr * 2.2 + Math.sin(ang * 13) * 0.6)) < 0.16 + 0.1 * Math.min(1, rr - 1);
              if (vein) {
                code = rr < 1.4 ? 126 : 45; // '~' '-'
                color = ec.vein!;
              } else {
                code = checker ? 111 : 58; // 'o' ':'
                color = Math.abs(ex) > 0.75 ? ec.scleraDim! : ec.sclera!;
              }
              scale = 0.9;
            } else if (Math.hypot(ux - (ix - 0.34 * IRIS_R), uy - (iy - 0.34 * IRIS_R)) < 0.18 * IRIS_R) {
              code = 42; // '*'
              color = ec.catch!;
            } else if (rr < pr) {
              code = 64; // '@'
              color = ec.pupil!;
            } else if (rr < pr + 0.1) {
              code = 48; // '0'
              color = ec.inner!;
            } else if (rr < 0.52) {
              code = checker ? 79 : 48; // 'O' '0'
              color = spasm > 0.4 ? ec.flash! : ec.cyan!;
            } else if (rr < 0.66) {
              code = 111; // 'o'
              color = ec.blue!;
              scale = 0.9;
            } else if (rr < 0.88) {
              code = checker ? 111 : 42;
              color = ec.magenta!;
              scale = lerp(1, 0.75, (rr - 0.66) / 0.22);
            } else {
              code = 58;
              color = ec.violet!;
              scale = 0.85;
            }
            eyeAtlas.draw(ctx, code, color, x, y, scale);
          }
        }
      }
      ctx.globalAlpha = 1;

      // blood weeping from the inner corner of each eye, crawling down her cheeks
      const pxU = (cols * cw) / DU; // layer px per design unit
      for (const [i, e] of EYES.entries()) {
        const inner = i === 0 ? 1 : -1;
        const x = (e.x + inner * SOCKET_RX * 0.55 + p.lookX * 0.3) * pxU;
        const yStart = (e.y + SOCKET_RY * 0.75) * pxU;
        const cycle = (t * 0.07 + i * 0.37) % 1;
        const len = Math.floor(Math.pow(cycle, 0.8) * 16);
        const fade = cycle > 0.9 ? 1 - (cycle - 0.9) / 0.1 : 1;
        for (let k = 0; k < len; k++) {
          const last = k === len - 1;
          ctx.globalAlpha = clamp(p.eyes) * fade * (last ? 1 : 0.85);
          const wob = Math.sin(k * 0.7 + i) * cw * 0.25;
          const yy = yStart + k * ch * 0.8;
          atlas.draw(ctx, last ? 79 : k % 3 === 2 ? 58 : 124, last ? this.blood : this.bloodDeep, x + wob, yy);
          if (k < len * 0.6) atlas.draw(ctx, 124, this.bloodDeep, x + wob + cw * 0.55 * -inner, yy);
        }
      }
      ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// The portrait, painted at character resolution.

function paintDeath(a: CanvasRenderingContext2D, d: CanvasRenderingContext2D, cols: number, rows: number): void {
  const rnd = mulberry32(0xdea7);
  const R = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  for (const c of [a, d]) {
    c.setTransform(cols / DU, 0, 0, rows / DV, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, DU, DV);
  }
  const soft = (px: number) => {
    a.filter = px > 0 ? `blur(${px}px)` : 'none';
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, rot: number, fill: string) => {
    a.fillStyle = fill;
    a.beginPath();
    a.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    a.fill();
  };
  const line = (pts: Pt[], width: number, stroke: string) => {
    a.strokeStyle = stroke;
    a.lineWidth = width;
    a.lineCap = 'round';
    a.beginPath();
    a.moveTo(pts[0]![0], pts[0]![1]);
    if (pts.length === 3) a.quadraticCurveTo(pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1]);
    else for (const p of pts.slice(1)) a.lineTo(p[0], p[1]);
    a.stroke();
  };
  const hairGrad = () => {
    const g = a.createLinearGradient(0, 0, 0, DV);
    g.addColorStop(0, '#6b6a73');
    g.addColorStop(0.5, '#45444c');
    g.addColorStop(1, '#25252b');
    return g;
  };
  const strand = (p0: Pt, c: Pt, p1: Pt, w0: number, w1: number, color: string) => taper(a, d, p0, c, p1, w0, w1, color);
  const silver = () => {
    const v = Math.floor(R(120, 225));
    return `rgb(${v - 6},${v - 4},${v + 6})`;
  };

  // 1. the hair behind her: a long fall from the crown past the shoulders
  a.fillStyle = hairGrad();
  a.beginPath();
  a.moveTo(50, 4);
  a.bezierCurveTo(26, 4, 13, 22, 12, 46);
  a.bezierCurveTo(11, 80, 6, 110, 3, 131);
  a.lineTo(97, 131);
  a.bezierCurveTo(94, 110, 89, 80, 88, 46);
  a.bezierCurveTo(87, 22, 74, 4, 50, 4);
  a.fill();
  for (let i = 0; i < 120; i++) {
    const s = i % 2 ? 1 : -1;
    strand([50 + s * R(0, 5), R(4, 9)], [50 + s * R(26, 40), R(10, 34)], [50 + s * R(30, 47), R(70, 131)], R(0.6, 1.5), R(0.4, 0.9), silver());
  }

  // 2. the cloak and the neck
  a.beginPath();
  a.moveTo(-2, 131);
  a.lineTo(-2, 113);
  a.quadraticCurveTo(16, 100, 37, 103);
  a.lineTo(50, 114);
  a.lineTo(63, 103);
  a.quadraticCurveTo(84, 100, 102, 113);
  a.lineTo(102, 131);
  a.closePath();
  const cloak = a.createLinearGradient(0, 100, 0, 131);
  cloak.addColorStop(0, '#34488c');
  cloak.addColorStop(1, '#0d1331');
  a.fillStyle = cloak;
  a.fill();
  const neck = a.createLinearGradient(0, 84, 0, 112);
  neck.addColorStop(0, '#3a3530');
  neck.addColorStop(0.35, '#8a8274');
  neck.addColorStop(1, '#5a544a');
  a.fillStyle = neck;
  a.beginPath();
  a.moveTo(41.5, 82);
  a.quadraticCurveTo(42, 100, 38, 108);
  a.lineTo(62, 108);
  a.quadraticCurveTo(58, 100, 58.5, 82);
  a.closePath();
  a.fill();
  soft(1);
  ellipse(50, 92, 9, 4, 0, 'rgba(15,10,10,0.55)'); // shadow under the jaw
  ellipse(44.5, 101, 1.6, 6, -0.25, 'rgba(255,250,240,0.12)'); // the tendon of the neck
  soft(0);

  // 3. the face: a long, pale oval, lit from above
  const face = new Path2D();
  face.moveTo(50, 19);
  face.bezierCurveTo(63, 19, 71.5, 28, 71.5, 43);
  face.bezierCurveTo(71.5, 56, 69.5, 66, 63.5, 76);
  face.bezierCurveTo(59.5, 84, 55, 90, 50, 91);
  face.bezierCurveTo(45, 90, 40.5, 84, 36.5, 76);
  face.bezierCurveTo(30.5, 66, 28.5, 56, 28.5, 43);
  face.bezierCurveTo(28.5, 28, 37, 19, 50, 19);
  const skin = a.createRadialGradient(47, 48, 2, 50, 54, 38);
  skin.addColorStop(0, '#fffaf0');
  skin.addColorStop(0.45, '#e2d9c9');
  skin.addColorStop(0.75, '#8a8274');
  skin.addColorStop(1, '#2a2622');
  a.fillStyle = skin;
  a.fill(face);

  a.save();
  a.clip(face);
  soft(1.6);
  // gaunt: hollow cheeks, high cheekbones, deep sockets
  ellipse(35.5, 67, 6, 9.5, 0.25, 'rgba(30,20,20,0.6)');
  ellipse(64.5, 67, 6, 9.5, -0.25, 'rgba(30,20,20,0.6)');
  ellipse(37, 57.5, 6.5, 2.8, -0.35, 'rgba(255,250,240,0.3)');
  ellipse(63, 57.5, 6.5, 2.8, 0.35, 'rgba(255,250,240,0.3)');
  ellipse(EYES[0].x, 49, 9, 6.2, 0, 'rgba(20,14,20,0.75)');
  ellipse(EYES[1].x, 49, 9, 6.2, 0, 'rgba(20,14,20,0.75)');
  ellipse(38, 42.5, 7, 1.6, -0.08, 'rgba(255,250,240,0.1)');
  ellipse(62, 42.5, 7, 1.6, 0.08, 'rgba(255,250,240,0.1)');
  ellipse(50, 45, 2.6, 3.4, 0, 'rgba(30,22,22,0.28)'); // the brow knits between the eyes
  ellipse(28, 50, 4, 14, 0, 'rgba(20,14,14,0.5)'); // temples fall into shadow
  ellipse(72, 50, 4, 14, 0, 'rgba(20,14,14,0.5)');
  // the nose: a lit bridge, a shadowed side, the tip, the wings and nostrils
  line([[50, 47], [50.3, 64]], 1.5, 'rgba(255,252,245,0.28)');
  line([[47.4, 48], [46.3, 64.5]], 1.9, 'rgba(26,18,16,0.5)');
  line([[52.8, 50], [53.6, 64]], 1.2, 'rgba(32,22,20,0.15)');
  ellipse(50, 66, 3.1, 2.3, 0, 'rgba(255,250,240,0.26)');
  ellipse(50, 69.6, 4.6, 1.3, 0, 'rgba(30,20,20,0.45)');
  ellipse(50, 83, 5, 1.5, 0, 'rgba(30,20,20,0.38)'); // under the lower lip
  ellipse(50, 87, 4.5, 2.4, 0, 'rgba(255,250,240,0.14)'); // the chin
  soft(0.6);
  ellipse(47.5, 68.3, 1.35, 0.75, 0.3, 'rgba(14,8,8,0.88)');
  ellipse(52.5, 68.3, 1.35, 0.75, -0.3, 'rgba(14,8,8,0.88)');
  line([[50, 70.2], [50, 73.8]], 1.1, 'rgba(30,20,20,0.18)'); // philtrum
  soft(0);
  a.restore();

  // brows: fine, high, faintly arched
  for (const s of [-1, 1]) {
    line([[50 + s * 4.8, 43.6], [50 + s * 11.5, 40.4], [50 + s * 18.6, 43.9]], 1.2, '#3a332d');
  }

  // eyes: almond openings, a heavy upper lid, a crease above
  for (const e of EYES) {
    a.fillStyle = '#000';
    a.beginPath();
    a.moveTo(e.x - SOCKET_RX, e.y);
    a.quadraticCurveTo(e.x, e.y - SOCKET_RY * 2, e.x + SOCKET_RX, e.y);
    a.quadraticCurveTo(e.x, e.y + SOCKET_RY * 1.6, e.x - SOCKET_RX, e.y);
    a.fill();
    line([[e.x - SOCKET_RX - 0.4, e.y + 0.2], [e.x, e.y - SOCKET_RY * 2.15], [e.x + SOCKET_RX + 0.4, e.y + 0.2]], 1.1, '#0e090b');
    line([[e.x - SOCKET_RX * 0.9, e.y - 1.6], [e.x, e.y - SOCKET_RY * 3.1], [e.x + SOCKET_RX * 0.9, e.y - 1.6]], 0.6, 'rgba(45,32,32,0.7)');
    // the lower lid raw and red, as if she has not slept or blinked in years
    line([[e.x - SOCKET_RX * 0.85, e.y + 1.2], [e.x, e.y + SOCKET_RY * 1.75], [e.x + SOCKET_RX * 0.85, e.y + 1.2]], 0.8, 'rgba(150,26,36,0.85)');
  }

  // lips: dark, full, closed, the faintest smile at the corners
  a.fillStyle = '#6e3a42';
  a.beginPath();
  a.moveTo(43.2, 77.4);
  a.bezierCurveTo(45.5, 75.5, 48, 75.3, 50, 76.3);
  a.bezierCurveTo(52, 75.3, 54.5, 75.5, 56.8, 77.4);
  a.bezierCurveTo(54, 78.3, 46, 78.3, 43.2, 77.4);
  a.fill();
  a.fillStyle = '#80474f';
  a.beginPath();
  a.moveTo(43.6, 77.6);
  a.bezierCurveTo(46, 78.7, 54, 78.7, 56.4, 77.6);
  a.bezierCurveTo(55, 81, 45, 81, 43.6, 77.6);
  a.fill();
  soft(0.5);
  ellipse(50, 79.3, 2.6, 0.7, 0, 'rgba(255,225,225,0.28)');
  soft(0);
  a.strokeStyle = '#1a0c10';
  a.lineWidth = 0.55;
  a.beginPath();
  a.moveTo(43, 77.2);
  a.bezierCurveTo(46, 78.2, 54, 78.2, 57, 77.2);
  a.stroke();

  // 4. hair in front: a middle parting, a hairline, and two falls framing the face
  a.fillStyle = hairGrad();
  a.beginPath();
  a.moveTo(27, 36);
  a.bezierCurveTo(29, 21, 39, 15.5, 50, 15.8);
  a.bezierCurveTo(61, 15.5, 71, 21, 73, 36);
  a.lineTo(74, 4);
  a.lineTo(26, 4);
  a.closePath();
  a.fill();
  for (const s of [-1, 1]) {
    a.beginPath();
    a.moveTo(50, 6);
    a.bezierCurveTo(50 + s * 15, 8, 50 + s * 22, 20, 50 + s * 21.5, 40);
    a.bezierCurveTo(50 + s * 21, 62, 50 + s * 24, 90, 50 + s * 30, 131);
    a.lineTo(50 + s * 44, 131);
    a.bezierCurveTo(50 + s * 40, 90, 50 + s * 38, 50, 50 + s * 35, 26);
    a.bezierCurveTo(50 + s * 31, 12, 50 + s * 20, 6, 50, 6);
    a.fill();
  }
  for (let i = 0; i < 110; i++) {
    const s = i % 2 ? 1 : -1;
    strand([50 + s * R(0, 3), R(5, 9)], [50 + s * R(17, 26), R(12, 26)], [50 + s * R(21, 38), R(40, 131)], R(0.6, 1.4), R(0.35, 0.8), silver());
  }
  // a few loose strands drifting across her face
  strand([45, 16], [36, 40], [39.5, 74], 0.7, 0.35, 'rgba(205,203,212,0.85)');
  strand([56, 16], [66, 44], [61.5, 82], 0.65, 0.35, 'rgba(190,188,198,0.8)');
  strand([47, 15], [44, 30], [46.5, 44], 0.55, 0.3, 'rgba(215,213,222,0.85)');

  // keep the eyes clear of anything that crossed them
  for (const e of EYES) {
    a.fillStyle = '#000';
    a.beginPath();
    a.moveTo(e.x - SOCKET_RX, e.y);
    a.quadraticCurveTo(e.x, e.y - SOCKET_RY * 2, e.x + SOCKET_RX, e.y);
    a.quadraticCurveTo(e.x, e.y + SOCKET_RY * 1.6, e.x - SOCKET_RX, e.y);
    a.fill();
  }
}

/** A hair strand: a quadratic curve that tapers from w0 to w1, with its direction recorded in d. */
function taper(a: CanvasRenderingContext2D, d: CanvasRenderingContext2D, p0: Pt, c: Pt, p1: Pt, w0: number, w1: number, color: string): void {
  const N = 18;
  const L: Pt[] = [];
  const Rt: Pt[] = [];
  const ang: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0];
    const y = u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1];
    const tx = 2 * u * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0]);
    const ty = 2 * u * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1]);
    const tl = Math.hypot(tx, ty) || 1;
    const w = lerp(w0, w1, t) / 2;
    L.push([x - (ty / tl) * w, y + (tx / tl) * w]);
    Rt.push([x + (ty / tl) * w, y - (tx / tl) * w]);
    ang.push(Math.atan2(ty, tx));
  }
  a.fillStyle = color;
  a.beginPath();
  a.moveTo(L[0]![0], L[0]![1]);
  for (const p of L) a.lineTo(p[0], p[1]);
  for (let i = Rt.length - 1; i >= 0; i--) a.lineTo(Rt[i]![0], Rt[i]![1]);
  a.closePath();
  a.fill();
  for (let i = 0; i < N; i++) {
    let t = ang[i]! % Math.PI;
    if (t < 0) t += Math.PI;
    d.fillStyle = `rgb(${1 + Math.round((t / Math.PI) * 254)},0,0)`;
    d.beginPath();
    d.moveTo(L[i]![0], L[i]![1]);
    d.lineTo(L[i + 1]![0], L[i + 1]![1]);
    d.lineTo(Rt[i + 1]![0], Rt[i + 1]![1]);
    d.lineTo(Rt[i]![0], Rt[i]![1]);
    d.closePath();
    d.fill();
  }
}

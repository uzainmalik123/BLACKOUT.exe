// Screen 2's logo (D-181): BLACKOUT.exe as character type, bone white at the crown of each letter and soaked
// in blood from the feet up, the soak line creeping as if the letters drink it. Live drips run from the feet:
// each grows, swells into a drop at its tip, lets go, and the drop falls while the stream draws back up.
// Same face as the title screen (Cinzel capitals, ".exe" in small capitals behind a diamond). At this small size
// the letters are a crisp, softly lit plate under one even character texture, so the word reads at a glance.

import { CINZEL, GlyphAtlas, codes, edgeChar } from '../shared/atlas';
import { clamp, hash2, mulberry32 } from '../shared/math';

/** One fill character, so the texture is even and the letter shapes stay clean. */
const FILL = codes('#');
const BONE = ['#f6f1e6', '#ebe3d2', '#dccfb6', '#c9b99c'];
const BONE_EDGE = ['#dcd2be', '#cbbea4', '#b6a688', '#9e8d70'];
/** Bright where the blood is fresh (the soak line) to deep and old at the feet. */
const BLOOD = ['#d42232', '#b3151f', '#901019', '#6e0b12'];
const BLOOD_EDGE = ['#a8121e', '#8a0d17', '#6e0a12', '#52070d'];

interface Drip {
  col: number;
  row: number;
  len: number; // longest stream, in cells
  period: number; // seconds per drop
  phase: number;
}

export class LogoArt {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private atlas: GlyphAtlas | null = null;
  /** The letters as solid shapes at full resolution, under the characters. */
  private readonly plate: HTMLCanvasElement;
  cols = 0;
  rows = 0;
  cw = 5;
  ch = 8;
  width = 0;
  height = 0;
  inkLeft = 0;
  inkRight = 0;
  inkTop = 0;
  inkBottom = 0;
  private code = new Uint16Array(0);
  /** -1 empty; else 0..3 the letter's band from crown to foot, +4 on an edge. */
  private band = new Int8Array(0);
  /** How far up the letter each cell sits, 0 at the foot .. 1 at the crown. */
  private rise = new Float32Array(0);
  private drips: Drip[] = [];
  private bone: number[] = [];
  private blood: number[] = [];
  private shadow = 0;
  private dripDeep = 0;
  private dripBright = 0;
  private lastKey = '';

  constructor(private readonly text: string) {
    this.plate = document.createElement('canvas');
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(W: number, H: number, dpr: number): void {
    this.ch = clamp(H * 0.0074, 6.5, 10);
    this.cw = this.ch * 0.6;
    const targetW = Math.min(W * 0.25, 500);
    const EXT = 0.9;
    const dot = this.text.lastIndexOf('.');
    const word = dot > 0 ? this.text.slice(0, dot) : this.text;
    const ext = dot > 0 ? this.text.slice(dot) : '';
    const font = (px: number) => `700 ${px}px ${CINZEL}`;
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return;
    probe.font = font(100);
    const ww = probe.measureText(word).width;
    const letters = ext.startsWith('.') ? ext.slice(1) : ext;
    const DOT = 0.24;
    probe.font = font(100 * EXT);
    const we = probe.measureText(letters).width + (ext.startsWith('.') ? 100 * DOT * 1.9 : 0);
    const fs = (100 * targetW) / (ww + we + 4);
    const textH = fs * 0.74;
    this.cols = Math.ceil(targetW / this.cw) + 4;
    this.rows = Math.ceil((textH + fs * 0.3) / this.ch) + 2;
    this.width = this.cols * this.cw;
    this.height = this.rows * this.ch;

    const src = document.createElement('canvas');
    src.width = this.cols;
    src.height = this.rows;
    const s = src.getContext('2d', { willReadFrequently: true });
    if (!s) return;
    s.setTransform(1 / this.cw, 0, 0, 1 / this.ch, 0, 0);
    s.fillStyle = '#fff';
    const baseline = this.ch * 1.5 + textH;
    const x0 = 2 * this.cw;
    s.font = font(fs);
    s.fillText(word, x0, baseline);
    let ex = x0 + (ww * fs) / 100 + fs * 0.04;
    if (ext.startsWith('.')) {
      const d = fs * DOT;
      const cx = ex + d * 0.75;
      const cy = baseline - d * 0.55;
      s.beginPath();
      s.moveTo(cx, cy - d * 0.6);
      s.lineTo(cx + d * 0.6, cy);
      s.lineTo(cx, cy + d * 0.6);
      s.lineTo(cx - d * 0.6, cy);
      s.closePath();
      s.fill();
      ex += d * 1.9;
    }
    s.font = font(fs * EXT);
    s.fillText(letters, ex, baseline);
    const px = s.getImageData(0, 0, this.cols, this.rows).data;

    const { cols, rows } = this;
    const n = cols * rows;
    const a = new Float32Array(n);
    for (let k = 0; k < n; k++) a[k] = px[k * 4 + 3]! / 255;
    const capTop = (baseline - fs * 0.7) / this.ch;
    const capBottom = baseline / this.ch;
    this.code = new Uint16Array(n);
    this.band = new Int8Array(n).fill(-1);
    this.rise = new Float32Array(n);
    for (let j = 0; j < rows; j++) {
      const up = clamp((capBottom - (j + 0.5)) / (capBottom - capTop));
      const band = clamp(Math.floor((1 - up) * BONE.length), 0, BONE.length - 1);
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const v = a[k]!;
        if (v < 0.32) continue;
        const gx = (i < cols - 1 ? a[k + 1]! : 0) - (i > 0 ? a[k - 1]! : 0);
        const gy = (j < rows - 1 ? a[k + cols]! : 0) - (j > 0 ? a[k - cols]! : 0);
        const edge = Math.hypot(gx, gy) > 0.55;
        this.code[k] = edge ? edgeChar(gx, gy) : FILL[0]!;
        this.band[k] = band + (edge ? 4 : 0);
        this.rise[k] = up;
      }
    }
    let l = cols;
    let r = -1;
    let tp = rows;
    let bt = -1;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        if (this.band[j * cols + i]! >= 0) {
          l = Math.min(l, i);
          r = Math.max(r, i);
          tp = Math.min(tp, j);
          bt = Math.max(bt, j);
        }
    this.inkLeft = l * this.cw;
    this.inkRight = (r + 1) * this.cw;
    this.inkTop = tp * this.ch;
    this.inkBottom = (bt + 1) * this.ch;

    // drips leave from the feet of the letters, spread across the word
    const rnd = mulberry32(0xb100d);
    const feet: Array<{ col: number; row: number }> = [];
    for (let i = 0; i < cols; i++) {
      for (let j = rows - 1; j >= rows * 0.5; j--) {
        if (this.band[j * cols + i]! >= 0) {
          feet.push({ col: i, row: j });
          break;
        }
      }
    }
    this.drips = [];
    const want = 11;
    const used = new Set<number>();
    for (let d = 0; d < want && feet.length; d++) {
      const target = Math.floor(((d + 0.5) / want) * cols + (rnd() - 0.5) * cols * 0.05);
      let best = feet[0]!;
      for (const f of feet) if (Math.abs(f.col - target) < Math.abs(best.col - target)) best = f;
      if (used.has(best.col)) continue;
      used.add(best.col);
      this.drips.push({ col: best.col, row: best.row, len: 2 + Math.floor(rnd() * 6), period: 4.5 + rnd() * 5, phase: rnd() });
    }

    this.canvas.width = Math.ceil(this.width * dpr);
    this.canvas.height = Math.ceil(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // the plate: the same letters, solid and sharp, bone at the crown going to dried blood at the feet
    this.plate.width = this.canvas.width;
    this.plate.height = this.canvas.height;
    const pc = this.plate.getContext('2d');
    if (pc) {
      pc.setTransform(dpr, 0, 0, dpr, 0, 0);
      const grad = pc.createLinearGradient(0, baseline - fs * 0.72, 0, baseline);
      grad.addColorStop(0, 'rgba(236,228,212,0.62)');
      grad.addColorStop(0.62, 'rgba(198,182,160,0.5)');
      grad.addColorStop(0.8, 'rgba(140,22,30,0.62)');
      grad.addColorStop(1, 'rgba(96,8,16,0.7)');
      pc.fillStyle = grad;
      pc.font = font(fs);
      pc.fillText(word, x0, baseline);
      let px0 = x0 + (ww * fs) / 100 + fs * 0.04;
      if (ext.startsWith('.')) {
        const d = fs * DOT;
        const cx = px0 + d * 0.75;
        const cy = baseline - d * 0.55;
        pc.beginPath();
        pc.moveTo(cx, cy - d * 0.6);
        pc.lineTo(cx + d * 0.6, cy);
        pc.lineTo(cx, cy + d * 0.6);
        pc.lineTo(cx - d * 0.6, cy);
        pc.closePath();
        pc.fill();
        px0 += d * 1.9;
      }
      pc.font = font(fs * EXT);
      pc.fillText(letters, px0, baseline);
    }

    this.atlas = new GlyphAtlas(this.ch * 1.08, dpr, 0, 700);
    const at = this.atlas;
    this.bone = [...BONE, ...BONE_EDGE].map((c) => at.color(c));
    this.blood = [...BLOOD, ...BLOOD_EDGE].map((c) => at.color(c));
    this.shadow = at.color('rgba(24,2,5,0.85)');
    this.dripDeep = at.color('#8c0d17');
    this.dripBright = at.color('#e02a3a');
    this.lastKey = '';
  }

  /** How high the blood has soaked in this column, 0..1 of the letter's height; it creeps up and down. */
  private soak(col: number, t: number): number {
    const x = col / Math.max(1, this.cols);
    return 0.2 + 0.12 * Math.sin(x * 17 + t * 0.21) + 0.08 * Math.sin(x * 41 - t * 0.33 + 1.7) + 0.05 * Math.sin(t * 0.13);
  }

  /** Redraw the letters; cheap every frame, it only works a few times a second. */
  render(t: number, reveal: number): void {
    const atlas = this.atlas;
    if (!atlas) return;
    const tick = Math.floor(t * 8);
    const key = `${reveal.toFixed(2)}|${tick}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ctx = this.ctx;
    const { cols, rows, cw, ch } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    if (reveal <= 0) return;
    const ts = tick / 8;
    for (let pass = 0; pass < 2; pass++) {
      const ox = pass === 0 ? cw * 0.45 : 0;
      const oy = pass === 0 ? ch * 0.4 : 0;
      if (pass === 1) {
        ctx.globalAlpha = Math.min(1, reveal * 1.2);
        ctx.drawImage(this.plate, 0, 0, this.width, this.height);
        ctx.globalAlpha = 1;
      }
      for (let i = 0; i < cols; i++) {
        const soak = this.soak(i, ts);
        for (let j = 0; j < rows; j++) {
          const k = j * cols + i;
          const b = this.band[k]!;
          if (b < 0 || hash2(i, j, 3) > reveal * 1.25) continue;
          let color: number;
          if (pass === 0) color = this.shadow;
          else {
            const edge = b >= 4 ? 4 : 0;
            // the soak line is ragged, and just under it the blood is freshest
            const line = soak + (hash2(i, j, 11) - 0.5) * 0.06;
            const r = this.rise[k]!;
            if (r < line) {
              const depth = clamp(Math.floor(((line - r) / Math.max(0.05, line)) * 4), 0, 3);
              color = this.blood[depth + edge]!;
            } else color = this.bone[(b % 4) + edge]!;
          }
          atlas.draw(ctx, this.code[k]!, color, (i + 0.5) * cw + ox, (j + 0.5) * ch + oy);
        }
      }
    }
  }

  /** The drips, straight onto the scene each frame at (x, y), the logo's top-left. */
  drawDrips(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, reveal: number): void {
    const atlas = this.atlas;
    if (!atlas || reveal < 0.5) return;
    const a = clamp((reveal - 0.5) / 0.5);
    const { cw, ch } = this;
    for (const d of this.drips) {
      const u = (t / d.period + d.phase) % 1;
      // grow (slow, then quicker as it fills), swell, let go, draw back
      let len: number;
      let bulb = 0;
      let drop = -1;
      if (u < 0.6) len = d.len * Math.pow(u / 0.6, 1.7);
      else if (u < 0.68) {
        len = d.len;
        bulb = (u - 0.6) / 0.08;
      } else {
        const v = (u - 0.68) / 0.32;
        len = d.len * (1 - v * 0.85);
        drop = v;
      }
      const cx = x + (d.col + 0.5) * cw;
      const top = y + (d.row + 1) * ch;
      const full = Math.floor(len);
      ctx.globalAlpha = a * 0.92;
      for (let k = 0; k < full; k++) atlas.draw(ctx, k % 3 === 2 ? 58 : 124, this.dripDeep, cx, top + (k + 0.5) * ch); // ':' '|'
      // the tip: a bead that swells before it lets go
      const tipY = top + len * ch;
      ctx.globalAlpha = a;
      atlas.draw(ctx, bulb > 0.6 ? 79 : 111, this.dripBright, cx, tipY, 0.8 + bulb * 0.45); // 'O' 'o'
      if (drop >= 0) {
        // the drop falls, faster and faster, stretching, and fades below the letters
        const fall = top + d.len * ch + drop * drop * ch * 12;
        ctx.globalAlpha = a * clamp(1 - drop * 1.15);
        atlas.draw(ctx, drop < 0.25 ? 111 : 39, this.dripBright, cx, fall, 0.9); // 'o' then "'"
      }
    }
    ctx.globalAlpha = 1;
  }
}

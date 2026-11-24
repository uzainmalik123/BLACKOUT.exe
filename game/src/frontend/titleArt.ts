// The title, BLACKOUT.exe, as character typography: engraved Roman capitals sampled into a
// character grid in antique gold, champagne at the crown of each letter and old gold at its
// foot, set on a soft oxblood shadow, with a whisper of wear and a few slow drops of blood.
// ".exe" uses the same face: Cinzel's lowercase letters are small capitals, crisp at any size.
// Cells assemble out of the dark as the curtains part, and fall back into it as they close.

import { CINZEL, GlyphAtlas, codes, edgeChar } from './atlas';
import { clamp, hash2, mulberry32 } from './curtain';

const DENSE = codes('@#&%$8');
/** Champagne at the top of the letters down to old gold at their feet. */
const GOLD = ['#fbf1d2', '#f0dca6', '#ddbf7c', '#c49d58', '#a27c3f'];
/** Edges sit a step darker, like the bevel of engraved metal. */
const GOLD_EDGE = ['#e4cf98', '#d3b574', '#bb9858', '#9c7a40', '#7d5f2e'];

interface Drip {
  col: number;
  row: number;
  len: number;
  speed: number;
  phase: number;
}

export class TitleArt {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private atlas: GlyphAtlas | null = null;
  cols = 0;
  rows = 0;
  cw = 5;
  ch = 8;
  /** css px size of the art */
  width = 0;
  height = 0;
  /** Where the ink really is, in css px from the art's top-left: centre it, not the padding. */
  inkLeft = 0;
  inkRight = 0;
  inkTop = 0;
  inkBottom = 0;
  private code = new Uint16Array(0);
  private tone = new Int16Array(0); // -1 empty, else a palette index
  private thr = new Float32Array(0);
  private drips: Drip[] = [];
  private gold: number[] = [];
  private shadow = 0;
  private blood = 0;
  private bloodDeep = 0;
  private green = 0;
  private lastKey = '';

  constructor(private readonly text: string) {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(W: number, H: number, dpr: number): void {
    this.ch = clamp(H * 0.0078, 7, 10.5);
    this.cw = this.ch * 0.6;
    const targetW = Math.min(W * 0.48, 1040);
    const EXT = 0.9; // the extension's size against the word's: its small capitals stand ~70% as tall
    // "BLACKOUT" in engraved capitals, ".exe" in the same face's small capitals
    const dot = this.text.lastIndexOf('.');
    const word = dot > 0 ? this.text.slice(0, dot) : this.text;
    const ext = dot > 0 ? this.text.slice(dot) : '';
    const wordFont = (px: number) => `700 ${px}px ${CINZEL}`;
    const extFont = (px: number) => `700 ${px}px ${CINZEL}`;
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return;
    probe.font = wordFont(100);
    const ww = probe.measureText(word).width;
    // the full stop is drawn as a solid diamond: a real "." is smaller than one character cell
    const letters = ext.startsWith('.') ? ext.slice(1) : ext;
    const DOT = 0.24; // diamond size against the font size
    probe.font = extFont(100 * EXT);
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
    s.textBaseline = 'alphabetic';
    const baseline = this.ch * 1.5 + textH;
    const x0 = 2 * this.cw;
    s.font = wordFont(fs);
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
    s.font = extFont(fs * EXT);
    s.fillText(letters, ex, baseline);
    const px = s.getImageData(0, 0, this.cols, this.rows).data;

    const { cols, rows } = this;
    const n = cols * rows;
    const a = new Float32Array(n);
    for (let k = 0; k < n; k++) a[k] = px[k * 4 + 3]! / 255;
    // the rows the capitals occupy, for the top-to-bottom gold
    const capTop = (baseline - fs * 0.7) / this.ch;
    const capBottom = baseline / this.ch;
    const extCol = Math.floor((x0 + (ww * fs) / 100) / this.cw);
    this.code = new Uint16Array(n);
    this.tone = new Int16Array(n).fill(-1);
    this.thr = new Float32Array(n);
    for (let j = 0; j < rows; j++) {
      const band = clamp(Math.floor(((j - capTop) / (capBottom - capTop)) * GOLD.length), 0, GOLD.length - 1);
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const v = a[k]!;
        this.thr[k] = hash2(i, j, 5) * 0.75 + Math.abs(i / cols - 0.5) * 0.5;
        if (v < 0.32) continue;
        // only a whisper of wear on the word: age, not damage; the small ".exe" stays whole
        if (i < extCol && hash2(i >> 1, j >> 1, 17) > 0.975 && hash2(i, j, 19) < 0.5) continue;
        const gx = (i < cols - 1 ? a[k + 1]! : 0) - (i > 0 ? a[k - 1]! : 0);
        const gy = (j < rows - 1 ? a[k + cols]! : 0) - (j > 0 ? a[k - cols]! : 0);
        const edge = Math.hypot(gx, gy) > 0.55;
        this.code[k] = edge ? edgeChar(gx, gy) : DENSE[Math.floor(hash2(i, j, 29) * DENSE.length)]!;
        this.tone[k] = edge ? GOLD.length + band : band;
      }
    }
    let l = cols;
    let r = -1;
    let tp = rows;
    let bt = -1;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        if (this.tone[j * cols + i]! >= 0) {
          l = Math.min(l, i);
          r = Math.max(r, i);
          tp = Math.min(tp, j);
          bt = Math.max(bt, j);
        }
    this.inkLeft = l * this.cw;
    this.inkRight = (r + 1) * this.cw;
    this.inkTop = tp * this.ch;
    this.inkBottom = (bt + 1) * this.ch;
    // a few slow drops of blood from the feet of the letters
    const rnd = mulberry32(0xb1ac);
    this.drips = [];
    const cand: Drip[] = [];
    for (let i = 0; i < cols; i++) {
      for (let j = rows - 1; j >= rows * 0.5; j--) {
        if (this.tone[j * cols + i]! >= 0) {
          cand.push({ col: i, row: j, len: 0, speed: 0, phase: 0 });
          break;
        }
      }
    }
    for (let d = 0; d < 4 && cand.length; d++) {
      const pick = cand.splice(Math.floor(rnd() * cand.length), 1)[0]!;
      pick.len = 3 + Math.floor(rnd() * 5);
      pick.speed = 0.04 + rnd() * 0.04;
      pick.phase = rnd();
      this.drips.push(pick);
    }

    this.canvas.width = Math.ceil(this.width * dpr);
    this.canvas.height = Math.ceil(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.atlas = new GlyphAtlas(this.ch * 1.08, dpr, this.ch * 0.3, 700);
    const at = this.atlas;
    this.gold = [...GOLD, ...GOLD_EDGE].map((c) => at.color(c));
    this.shadow = at.color('rgba(70,6,14,0.7)');
    this.blood = at.color('#a3101c');
    this.bloodDeep = at.color('#6a0910');
    this.green = at.color('#33e083');
    this.lastKey = '';
  }

  /** Redraw the art; cheap to call every frame, it skips work when nothing changed. */
  render(t: number, reveal: number, glitch: { r0: number; r1: number; shift: number } | null): void {
    const atlas = this.atlas;
    if (!atlas) return;
    const flick = Math.floor(t * 4);
    const key = `${reveal.toFixed(3)}|${flick}|${glitch ? glitch.r0 + ':' + glitch.shift : ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const ctx = this.ctx;
    const { cols, rows, cw, ch } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    if (reveal <= 0) return;
    const gate = reveal * 1.3 - 0.05;
    // pass 0: a soft oxblood shadow, dropped down and right; pass 1: the gold
    for (let pass = 0; pass < 2; pass++) {
      const ox = pass === 0 ? cw * 0.4 : 0;
      const oy = pass === 0 ? ch * 0.35 : 0;
      for (let j = 0; j < rows; j++) {
        const g = glitch && j >= glitch.r0 && j <= glitch.r1 ? glitch.shift : 0;
        for (let i = 0; i < cols; i++) {
          const k = j * cols + i;
          const tone = this.tone[k]!;
          if (tone < 0 || this.thr[k]! > gate) continue;
          let code = this.code[k]!;
          let color = pass === 0 ? this.shadow : this.gold[tone]!;
          const f = hash2(i, j, flick);
          if (pass === 1 && f < 0.006) code = DENSE[Math.floor(f * 1000) % DENSE.length]!;
          if (pass === 1 && g !== 0 && f < 0.25) {
            color = this.green;
            code = f < 0.12 ? 48 : 49;
          }
          atlas.draw(ctx, code, color, (i + 0.5) * cw + ox + g * cw, (j + 0.5) * ch + oy);
        }
      }
    }
  }

  /** Blood drips under the letters, drawn straight onto the scene each frame. */
  drawDrips(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, reveal: number): void {
    const atlas = this.atlas;
    if (!atlas || reveal < 0.6) return;
    for (const d of this.drips) {
      const p = (t * d.speed + d.phase) % 1;
      const len = Math.floor(Math.pow(p, 1.6) * d.len);
      const fade = p > 0.85 ? 1 - (p - 0.85) / 0.15 : 1;
      for (let k = 1; k <= len; k++) {
        const last = k === len;
        const code = last ? 46 : k < 2 ? 124 : 58; // '.' '|' ':'
        ctx.globalAlpha = clamp((reveal - 0.6) / 0.4) * fade * (last ? 1 : 0.8);
        atlas.draw(ctx, code, last ? this.blood : this.bloodDeep, x + (d.col + 0.5) * this.cw, y + (d.row + 0.5 + k) * this.ch);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// A character grid on a canvas that is cheap to keep alive: a scene fills `lum` (0..1), `code` (a character, or 0
// for "pick from the ramp by brightness") and `tone` (which palette) for every cell, then `draw()` stamps only the
// cells whose character or colour changed since the last draw. Cell edges are snapped to device pixels so a
// cleared cell leaves no seam; a band of rows can be drawn torn sideways for a glitch. With `backdrop`, every cell
// also gets a dimmer tint of its own colour behind its character (like ANSI art), so lit areas read as light and
// not as characters on black. (Screen 3 uses it; screen 2 has the same technique inline in its scene.)

import { GlyphAtlas, MONO } from './atlas';
import { hash2 } from './math';

export interface Palette {
  tones: number;
  steps: number;
  color: (tone: number, step: number) => string;
}

export interface Tear {
  r0: number;
  r1: number;
  /** Cells to shift the band by. */
  shift: number;
}

export class GridPainter {
  lum = new Float32Array(0);
  code = new Uint16Array(0);
  tone = new Uint8Array(0);
  cols = 0;
  rows = 0;
  cw = 8;
  ch = 14;
  private dpr = 1;
  private readonly ctx: CanvasRenderingContext2D;
  private atlas: GlyphAtlas | null = null;
  private pal: number[] = [];
  private css: string[] = [];
  private drawn = new Int32Array(0);
  private torn = new Uint8Array(0);
  private colX = new Int32Array(0);
  private rowY = new Int32Array(0);
  private repaint = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly palette: Palette,
    /** Characters for "by brightness", thinnest first; index 0 is drawn as nothing. */
    private readonly ramp: readonly number[],
    /** 0: characters on black. 0..1: each cell is also filled with its colour at this fraction of its brightness. */
    private readonly backdrop = 0,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(W: number, H: number, cw: number, ch: number, dpr: number): void {
    this.canvas.width = Math.floor(W * dpr);
    this.canvas.height = Math.floor(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    this.cols = Math.ceil(W / cw);
    this.rows = Math.ceil(H / ch);
    const n = this.cols * this.rows;
    this.lum = new Float32Array(n);
    this.code = new Uint16Array(n);
    this.tone = new Uint8Array(n);
    this.drawn = new Int32Array(n);
    this.torn = new Uint8Array(this.rows);
    this.colX = Int32Array.from({ length: this.cols + 1 }, (_, i) => Math.round(i * cw * dpr));
    this.rowY = Int32Array.from({ length: this.rows + 1 }, (_, j) => Math.round(j * ch * dpr));
    this.atlas = new GlyphAtlas(ch * 1.02, dpr, 0, 500, MONO);
    const at = this.atlas;
    this.pal = [];
    this.css = [];
    for (let t = 0; t < this.palette.tones; t++)
      for (let q = 0; q < this.palette.steps; q++) {
        const css = this.palette.color(t, q);
        this.css.push(css);
        this.pal.push(at.color(css));
      }
    this.repaint = true;
  }

  /** Stamp the cells that changed (everything, after a resize). */
  draw(tear: Tear | null): void {
    const atlas = this.atlas;
    if (!atlas) return;
    const g = this.ctx;
    const { cols, rows, cw, ch, lum, code, tone, drawn, colX, rowY, dpr, pal, ramp, css, backdrop } = this;
    const steps = this.palette.steps;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#020203';
    if (this.repaint) {
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      drawn.fill(0);
      this.repaint = false;
    }
    const r0 = tear ? tear.r0 : -1;
    const r1 = tear ? tear.r1 : -2;
    for (let j = 0; j < rows; j++) {
      const now = j >= r0 && j <= r1;
      if (this.torn[j] === 1 || now) {
        g.fillRect(0, rowY[j]!, this.canvas.width, rowY[j + 1]! - rowY[j]!);
        drawn.fill(-1, j * cols, (j + 1) * cols);
      }
      this.torn[j] = now ? 1 : 0;
    }
    const nf = ramp.length;
    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * ch * dpr;
      const ox = j >= r0 && j <= r1 && tear ? tear.shift * cw * dpr : 0;
      const ya = rowY[j]!;
      const yh = rowY[j + 1]! - ya;
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const L = lum[k]!;
        let c = 0;
        let color = 0;
        let bg = -1;
        if (L >= 0.03) {
          c = code[k]!;
          if (c === 0) {
            const idx = Math.floor(L * nf * 1.12 + (hash2(i, j, 2) - 0.5) * 0.9);
            c = idx <= 0 ? 0 : ramp[Math.min(nf - 1, idx)]!;
          }
          const tn = tone[k]! * steps;
          if (c !== 0) color = pal[tn + Math.min(steps - 1, Math.floor(Math.pow(L, 0.82) * steps))]!;
          if (backdrop > 0) {
            const qb = Math.floor(Math.pow(L * backdrop, 0.82) * steps);
            if (qb > 0) bg = tn + Math.min(steps - 1, qb);
          }
        }
        const key = ((c * 256 + (c === 0 ? 0 : color + 1)) * 256 + (bg + 1)) | 0;
        if (key === drawn[k]) continue;
        const x0 = colX[i]! + ox;
        const w = colX[i + 1]! - colX[i]!;
        if (bg >= 0) {
          g.fillStyle = css[bg]!;
          g.fillRect(x0, ya, w, yh);
        } else if (drawn[k] !== 0 || ox !== 0) {
          g.fillStyle = '#020203';
          g.fillRect(x0, ya, w, yh);
        }
        drawn[k] = key;
        if (c !== 0) atlas.draw(g, c, color, (i + 0.5) * cw * dpr + ox, y, dpr);
      }
    }
  }
}

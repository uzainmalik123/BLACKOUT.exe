// A glyph atlas: every character the title screen draws is stamped from a sprite sheet.
// fillText per character is too slow for tens of thousands of glyphs a second; drawImage isn't.
// Sprites are made lazily, one per (character, colour) pair, with an optional baked-in glow.

export const MONO = '"Cascadia Mono", Consolas, "SFMono-Regular", Menlo, "DejaVu Sans Mono", "Courier New", monospace';
/** Engraved Roman capitals, for the title and the tagline's warning. */
export const CINZEL = '"Cinzel", "Trajan Pro", "Palatino Linotype", Georgia, serif';
/** A fine old-style italic, for the softer words. */
export const CORMORANT = '"Cormorant Garamond", "Palatino Linotype", "Book Antiqua", Georgia, serif';
/** Web-font faces the canvas uses; the stylesheet imports them. */
export const FACES = ['700 40px "Cinzel"', '600 40px "Cinzel"', 'italic 500 40px "Cormorant Garamond"', 'italic 600 40px "Cormorant Garamond"'];

const SHEET = 2048; // device px per side

export class GlyphAtlas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly slots = new Map<number, number>();
  private readonly colors: string[] = [];
  private readonly colorIndex = new Map<string, number>();
  /** Sprite size in css px. */
  readonly sw: number;
  readonly sh: number;
  private readonly dsw: number;
  private readonly dsh: number;
  private readonly perRow: number;
  private readonly capacity: number;
  private next = 0;

  constructor(
    readonly fontPx: number,
    private readonly dpr: number,
    private readonly glow = 0,
    private readonly weight = 600,
    private readonly family = MONO,
  ) {
    const pad = 1 + glow * 1.3;
    this.sw = Math.ceil(fontPx * 0.66 + pad * 2);
    this.sh = Math.ceil(fontPx * 1.2 + pad * 2);
    this.dsw = Math.ceil(this.sw * dpr);
    this.dsh = Math.ceil(this.sh * dpr);
    this.perRow = Math.max(1, Math.floor(SHEET / this.dsw));
    this.capacity = this.perRow * Math.max(1, Math.floor(SHEET / this.dsh));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.perRow * this.dsw;
    this.canvas.height = Math.ceil(this.capacity / this.perRow) * this.dsh;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  /** Register a css colour; returns its index for draw(). */
  color(css: string): number {
    let i = this.colorIndex.get(css);
    if (i === undefined) {
      i = this.colors.length;
      this.colors.push(css);
      this.colorIndex.set(css, i);
    }
    return i;
  }

  private slot(code: number, color: number): number {
    const key = code * 1024 + color;
    let s = this.slots.get(key);
    if (s !== undefined) return s;
    if (this.next >= this.capacity) {
      // Full: start over. Rare, and only costs re-stamping what's on screen.
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.slots.clear();
      this.next = 0;
    }
    s = this.next++;
    this.slots.set(key, s);
    const x = (s % this.perRow) * this.dsw;
    const y = Math.floor(s / this.perRow) * this.dsh;
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(x, y, this.dsw, this.dsh);
    c.clip();
    c.font = `${this.weight} ${this.fontPx * this.dpr}px ${this.family}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const css = this.colors[color] ?? '#fff';
    c.fillStyle = css;
    const cx = x + this.dsw / 2;
    const cy = y + this.dsh / 2 + this.fontPx * this.dpr * 0.04;
    const ch = String.fromCharCode(code);
    if (this.glow > 0) {
      c.shadowColor = css;
      c.shadowBlur = this.glow * this.dpr;
      c.fillText(ch, cx, cy);
      c.shadowBlur = this.glow * 0.4 * this.dpr;
    }
    c.fillText(ch, cx, cy);
    c.restore();
    return s;
  }

  /** Stamp a character centred on (x, y), in css px, optionally scaled. */
  draw(ctx: CanvasRenderingContext2D, code: number, color: number, x: number, y: number, scale = 1): void {
    const s = this.slot(code, color);
    const w = this.sw * scale;
    const h = this.sh * scale;
    ctx.drawImage(
      this.canvas,
      (s % this.perRow) * this.dsw,
      Math.floor(s / this.perRow) * this.dsh,
      this.dsw,
      this.dsh,
      x - w / 2,
      y - h / 2,
      w,
      h,
    );
  }
}

/** Code points for a string of characters, for indexing ramps without allocating. */
export const codes = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/** Pick an edge character for a surface whose gradient points along (gx, gy). */
const EDGE = codes('-\\|/');
export function edgeChar(gx: number, gy: number): number {
  // the edge runs perpendicular to the gradient
  let a = Math.atan2(gx, -gy); // tangent angle
  if (a < 0) a += Math.PI;
  const bin = Math.round(a / (Math.PI / 4)) % 4;
  return EDGE[bin]!;
}

/** Character for a strand running along angle a (radians, y down). */
export function strokeChar(a: number): number {
  let t = a % Math.PI;
  if (t < 0) t += Math.PI;
  const bin = Math.round(t / (Math.PI / 4)) % 4;
  return EDGE[bin]!;
}

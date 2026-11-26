// The cinematic's eight shots (D-189, D-221), painted on one canvas. The map is an antique sea chart on a
// candle-lit table and the gate a gothic one in an ivy-covered wall (D-221). Each draws a moment of its shot from the time into it,
// the mouse (a little parallax) and the narration, and lists the things on screen the player can inspect
// (hotspots: a rectangle, a title, the fact from the files). Static layers (the street, the table) are painted once
// per window size and reused. Colour carries meaning: purple is Kiro (the logo's ghost, D-250), cyan is guidance, crimson is Death and danger, amber
// is a warning, emerald is normal and verified. Lights flicker slowly and partially, never strobe.

import { KIRO_PURPLE, drawGhost } from '../../shared/ghost';
import { AMBER, CRIMSON, CYAN, EMERALD, VIOLET, drawDeath } from './characters';
import { DOORS, EVIDENCE, FACTS, QUIZ, SUSPICIOUS } from './facts';
import type { ShotId } from './timeline';

type G = CanvasRenderingContext2D;

export type Tone = 'cyan' | 'crimson' | 'amber' | 'emerald';

export interface Hotspot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  body: string;
  tone: Tone;
}

export interface Frame {
  g: G;
  W: number;
  H: number;
  dpr: number;
  /** Seconds from the top of the film. */
  t: number;
  /** Seconds into this shot, and 0..1 through it. */
  st: number;
  u: number;
  /** The mouse, -1..1 across and down. */
  mx: number;
  my: number;
  /** 0..1 how much Kiro is talking right now. */
  talk: number;
  /** The hotspot under the pointer, if any. */
  hover: string | null;
  reduced: boolean;
  /** Hotspots this frame draws, for the pointer and the keyboard. */
  hot: Hotspot[];
}

const rand = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const ease = (v: number) => {
  const x = clamp(v);
  return x * x * (3 - 2 * x);
};
/** 0 before a, rising to 1 at b. */
const ramp = (x: number, a: number, b: number) => ease((x - a) / (b - a));
const MONO = '"Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace';
const SANS = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const TONE: Record<Tone, string> = { cyan: CYAN, crimson: CRIMSON, amber: AMBER, emerald: EMERALD };

/** A soft round light. */
function glow(g: G, x: number, y: number, r: number, color: string, a: number): void {
  if (a <= 0.003 || r <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.save();
  g.globalAlpha = clamp(a);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/** rgba() from a #rrggbb colour. */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(a).toFixed(3)})`;
}

/** A slow, partial flicker for neon and lamps: dips of light, never a strobe (at most about two a second). */
function flicker(t: number, seed: number, reduced: boolean): number {
  if (reduced) return 1;
  const k = Math.floor(t * 2 + seed);
  const r = rand(k * 3.3 + seed);
  const phase = t * 2 + seed - k;
  return r < 0.22 && phase < 0.18 ? 0.62 : 0.92 + 0.08 * Math.sin(t * 3.1 + seed);
}

let fogSprite: HTMLCanvasElement | null = null;
/** Fog: big soft blobs drifting sideways in a band. */
function fog(g: G, W: number, H: number, t: number, y0: number, y1: number, alpha: number): void {
  if (!fogSprite) {
    fogSprite = document.createElement('canvas');
    fogSprite.width = fogSprite.height = 128;
    const f = fogSprite.getContext('2d');
    if (f) {
      const gr = f.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
      gr.addColorStop(1, 'rgba(255, 255, 255, 0)');
      f.fillStyle = gr;
      f.fillRect(0, 0, 128, 128);
    }
  }
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const w = W * (0.35 + 0.3 * rand(i));
    const x = ((rand(i + 2) * (W + w) + t * W * (0.008 + 0.01 * rand(i + 4))) % (W + w)) - w / 2;
    const y = y0 + (y1 - y0) * rand(i + 7);
    g.globalAlpha = alpha * (0.5 + 0.5 * rand(i + 9));
    g.drawImage(fogSprite, x - w / 2, y - w * 0.18, w, w * 0.36);
  }
  g.restore();
}

/** Text with a dark halo so it reads over anything. */
function label(g: G, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', font = SANS, weight = 600): number {
  g.save();
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  g.lineWidth = Math.max(2, size * 0.28);
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
  const w = g.measureText(text).width;
  g.restore();
  return w;
}

/** A chip: rounded, outlined in its tone, with a line of text. Returns its rectangle. */
function chip(g: G, text: string, x: number, y: number, size: number, tone: string, fill = 'rgba(6, 8, 14, 0.82)', align: 'left' | 'center' = 'left'): { x: number; y: number; w: number; h: number } {
  g.save();
  g.font = `700 ${size}px ${SANS}`;
  const w = g.measureText(text).width + size * 1.4;
  const h = size * 1.9;
  const x0 = align === 'center' ? x - w / 2 : x;
  g.beginPath();
  g.roundRect(x0, y - h / 2, w, h, h / 2);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = tone;
  g.lineWidth = Math.max(1, size * 0.09);
  g.stroke();
  g.fillStyle = tone;
  g.textBaseline = 'middle';
  g.fillText(text, x0 + size * 0.7, y + size * 0.04);
  g.restore();
  return { x: x0, y: y - h / 2, w, h };
}

/**
 * ASCII corruption: characters breaking out from the edges inward as `amount` grows. Drawn in two colour batches and
 * capped, so it stays cheap even when it covers much of the screen.
 */
function corrupt(g: G, W: number, H: number, t: number, amount: number, reduced: boolean): void {
  if (amount <= 0.01) return;
  const cell = Math.max(16, H / 40);
  const cw = cell * 0.6;
  const cols = Math.ceil(W / cw);
  const rows = Math.ceil(H / cell);
  const step = reduced ? 0 : Math.floor(t * 8);
  const chars = '01#@$%&*/|<>{}[]=+-;:';
  const reach = amount * 1.3;
  const cap = 900;
  const violet: Array<[string, number, number]> = [];
  const crimson: Array<[string, number, number]> = [];
  for (let j = 0; j < rows && violet.length + crimson.length < cap; j++) {
    const ey = Math.min(j / rows, 1 - j / rows) * 2;
    for (let i = 0; i < cols; i++) {
      const edge = Math.min(Math.min(i / cols, 1 - i / cols) * 2, ey);
      if (edge >= reach) continue;
      const r = rand(i * 31.7 + j * 7.3 + step * 0.37);
      if (r > reach - edge) continue;
      const ch = chars[Math.floor(rand(i + j * 3 + step) * chars.length)] ?? '#';
      (r < 0.5 ? violet : crimson).push([ch, i * cw, j * cell]);
    }
  }
  g.save();
  g.font = `600 ${cell * 0.9}px ${MONO}`;
  g.textBaseline = 'top';
  g.fillStyle = rgba(VIOLET, 0.55);
  for (const [ch, x, y] of violet) g.fillText(ch, x, y);
  g.fillStyle = rgba(CRIMSON, 0.5);
  for (const [ch, x, y] of crimson) g.fillText(ch, x, y);
  g.restore();
}

// ------------------------------------------------------------------ static layers

/**
 * The painted-once layers for one window size, each painted only when first asked for. Kept per size (a few at
 * most), because the cinematic and the Chart Room draw at different sizes at the same time: one shared cache made
 * them repaint every layer on every frame.
 */
interface Cache {
  readonly street: HTMLCanvasElement;
  readonly table: HTMLCanvasElement;
  readonly chart: HTMLCanvasElement;
  readonly gate: HTMLCanvasElement;
}
const caches = new Map<string, Cache>();

function layer(W: number, H: number, dpr: number, paint: (g: G) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(W * dpr);
  c.height = Math.ceil(H * dpr);
  const g = c.getContext('2d');
  if (g) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(g);
  }
  return c;
}

/** Where the shop stands on the street, in screen pixels. */
function shopBox(W: number, H: number) {
  const ground = H * 0.72;
  const x0 = W * 0.3;
  const x1 = W * 0.78;
  return {
    ground,
    x0,
    x1,
    top: H * 0.17,
    sign: { x0: W * 0.36, x1: W * 0.72, y0: H * 0.215, y1: H * 0.305 },
    win: { x0: W * 0.325, x1: W * 0.585, y0: H * 0.36, y1: ground - H * 0.045 },
    door: { x0: W * 0.615, x1: W * 0.745, y0: H * 0.35, y1: ground },
    cam: { x: W * 0.765, y: H * 0.205 },
    lamp: { x: W * 0.14, y: H * 0.3 },
  };
}

function paintStreet(g: G, W: number, H: number): void {
  const b = shopBox(W, H);
  // the sky at 3 AM: midnight blue to black, a city's glow at the bottom
  const sky = g.createLinearGradient(0, 0, 0, b.ground);
  sky.addColorStop(0, '#03050b');
  sky.addColorStop(0.7, '#0a1222');
  sky.addColorStop(1, '#141b2c');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, b.ground);
  // the buildings either side, dark, a few windows dimly lit
  for (const [x0, x1, top] of [
    [0, W * 0.3, H * 0.08],
    [W * 0.78, W, H * 0.04],
  ] as const) {
    g.fillStyle = '#080b13';
    g.fillRect(x0, top, x1 - x0, b.ground - top);
    for (let j = 0; j < 8; j++)
      for (let i = 0; i < 5; i++) {
        const r = rand(i * 7 + j * 13 + x0);
        const wx = x0 + (x1 - x0) * (0.1 + i * 0.18);
        const wy = top + H * 0.05 + j * H * 0.07;
        if (wy > b.ground - H * 0.08) continue;
        g.fillStyle = r < 0.12 ? 'rgba(255, 190, 110, 0.35)' : 'rgba(30, 40, 60, 0.6)';
        g.fillRect(wx, wy, (x1 - x0) * 0.09, H * 0.035);
      }
  }
  // the shop's facade: brick, darker at the top
  const fac = g.createLinearGradient(0, b.top, 0, b.ground);
  fac.addColorStop(0, '#120d0d');
  fac.addColorStop(1, '#2a1c18');
  g.fillStyle = fac;
  g.fillRect(b.x0, b.top, b.x1 - b.x0, b.ground - b.top);
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = 1;
  const bh = H * 0.018;
  for (let y = b.top; y < b.ground; y += bh) {
    g.beginPath();
    g.moveTo(b.x0, y);
    g.lineTo(b.x1, y);
    g.stroke();
    const off = Math.floor((y - b.top) / bh) % 2 ? bh : 0;
    for (let x = b.x0 + off; x < b.x1; x += bh * 2) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + bh);
      g.stroke();
    }
  }
  // the sign's board
  g.fillStyle = '#07080c';
  g.fillRect(b.sign.x0, b.sign.y0, b.sign.x1 - b.sign.x0, b.sign.y1 - b.sign.y0);
  // the window and the door: dark frames
  g.fillStyle = '#05070b';
  g.fillRect(b.win.x0 - 6, b.win.y0 - 6, b.win.x1 - b.win.x0 + 12, b.win.y1 - b.win.y0 + 12);
  g.fillRect(b.door.x0 - 6, b.door.y0 - 6, b.door.x1 - b.door.x0 + 12, b.door.y1 - b.door.y0 + 6);
  // inside: the coolers and their bottles, lit cold
  for (const box of [b.win, { ...b.door, y1: b.door.y1 - H * 0.02 }]) {
    const inside = g.createLinearGradient(0, box.y0, 0, box.y1);
    inside.addColorStop(0, '#9fc7d8');
    inside.addColorStop(1, '#2d4a58');
    g.fillStyle = inside;
    g.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  }
  const shelves = 4;
  const COLORS = ['#ff4d5e', '#ffa53a', '#ffd84d', '#8fd14f', '#3fbf63', '#b05aa8', '#ff7b2e'];
  for (let s = 0; s < shelves; s++) {
    const sy = b.win.y0 + ((s + 1) / (shelves + 0.6)) * (b.win.y1 - b.win.y0);
    g.fillStyle = '#d8e8ee';
    g.fillRect(b.win.x0, sy, b.win.x1 - b.win.x0, H * 0.006);
    const bw = W * 0.0075;
    let run = 0;
    let col = COLORS[0]!;
    for (let x = b.win.x0 + bw; x < b.win.x1 - bw; x += bw * 1.6) {
      if (run-- <= 0) {
        col = COLORS[Math.floor(rand(x * 0.37 + s) * COLORS.length)]!;
        run = 2 + Math.floor(rand(x + s) * 4);
      }
      const bht = H * 0.045;
      g.fillStyle = col;
      g.fillRect(x, sy - bht, bw, bht);
      g.fillStyle = 'rgba(255, 255, 255, 0.5)';
      g.fillRect(x + bw * 0.15, sy - bht * 0.8, bw * 0.18, bht * 0.6);
      g.fillStyle = '#f3efe4';
      g.fillRect(x, sy - bht * 0.55, bw, bht * 0.22);
    }
  }
  // window frames and the door's handle
  g.strokeStyle = '#1b1f27';
  g.lineWidth = 5;
  g.strokeRect(b.win.x0, b.win.y0, b.win.x1 - b.win.x0, b.win.y1 - b.win.y0);
  g.beginPath();
  g.moveTo((b.win.x0 + b.win.x1) / 2, b.win.y0);
  g.lineTo((b.win.x0 + b.win.x1) / 2, b.win.y1);
  g.stroke();
  g.strokeRect(b.door.x0, b.door.y0, b.door.x1 - b.door.x0, b.door.y1 - b.door.y0);
  g.fillStyle = '#c9ccd2';
  g.fillRect(b.door.x0 + (b.door.x1 - b.door.x0) * 0.12, (b.door.y0 + b.door.y1) / 2, W * 0.004, H * 0.05);
  // the glass: a cold sheen across it
  for (const box of [b.win, b.door]) {
    const sheen = g.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0.06)');
    g.fillStyle = sheen;
    g.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  }
  // the pavement: wet asphalt, a kerb
  const road = g.createLinearGradient(0, b.ground, 0, H);
  road.addColorStop(0, '#0f1219');
  road.addColorStop(1, '#05060a');
  g.fillStyle = road;
  g.fillRect(0, b.ground, W, H - b.ground);
  g.fillStyle = '#1b1f28';
  g.fillRect(0, b.ground, W, H * 0.012);
  g.fillStyle = '#0b0d12';
  g.fillRect(0, H * 0.86, W, H * 0.01);
  // the street lamp
  g.strokeStyle = '#0d1016';
  g.lineWidth = W * 0.006;
  g.beginPath();
  g.moveTo(b.lamp.x, H * 0.86);
  g.lineTo(b.lamp.x, b.lamp.y);
  g.quadraticCurveTo(b.lamp.x, b.lamp.y - H * 0.05, b.lamp.x + W * 0.04, b.lamp.y - H * 0.05);
  g.stroke();
  // bare branches over the top left
  g.strokeStyle = '#020306';
  g.lineCap = 'round';
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    if (depth <= 0 || len < 4) return;
    const x2 = x + Math.cos(a) * len;
    const y2 = y + Math.sin(a) * len;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x2, y2);
    g.stroke();
    branch(x2, y2, a - 0.35 - rand(depth + x) * 0.3, len * 0.72, w * 0.68, depth - 1);
    branch(x2, y2, a + 0.3 + rand(depth + y) * 0.35, len * 0.68, w * 0.66, depth - 1);
  };
  branch(-W * 0.02, H * 0.02, 0.35, W * 0.12, W * 0.012, 7);
  branch(W * 1.02, -H * 0.01, Math.PI - 0.4, W * 0.09, W * 0.01, 6);
}

function paintTable(g: G, W: number, H: number): void {
  // an old wooden table under a lamp: dark planks with grain
  g.fillStyle = '#1a100a';
  g.fillRect(0, 0, W, H);
  const plank = H / 7;
  for (let p = 0; p < 8; p++) {
    const y = p * plank;
    const tone = 18 + Math.floor(rand(p) * 10);
    g.fillStyle = `rgb(${tone + 22}, ${tone + 10}, ${tone})`;
    g.fillRect(0, y, W, plank - 2);
    g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    g.lineWidth = 1;
    for (let k = 0; k < 14; k++) {
      const yy = y + rand(p * 31 + k) * plank;
      g.beginPath();
      g.moveTo(0, yy);
      for (let x = 0; x <= W; x += W / 24) g.lineTo(x, yy + Math.sin(x * 0.01 + k + p) * plank * 0.05);
      g.stroke();
    }
    g.fillStyle = 'rgba(0, 0, 0, 0.6)';
    g.fillRect(0, y + plank - 2, W, 2);
  }
}

function ensureCache(W: number, H: number, dpr: number): Cache {
  const key = `${Math.round(W)}x${Math.round(H)}@${dpr}`;
  const hit = caches.get(key);
  if (hit) return hit;
  const made: Partial<Record<keyof Cache, HTMLCanvasElement>> = {};
  const lazy = (name: keyof Cache, paint: (g: G) => void) => () => (made[name] ??= layer(W, H, dpr, paint));
  const street = lazy('street', (g) => paintStreet(g, W, H));
  const table = lazy('table', (g) => paintTable(g, W, H));
  const chart = lazy('chart', (g) => paintChart(g, W, H));
  const gateLayer = lazy('gate', (g) => paintGate(g, W, H));
  const c: Cache = {
    get street() {
      return street();
    },
    get table() {
      return table();
    },
    get chart() {
      return chart();
    },
    get gate() {
      return gateLayer();
    },
  };
  // a handful of sizes at most: drop the oldest
  if (caches.size >= 4) caches.delete(caches.keys().next().value as string);
  caches.set(key, c);
  return c;
}

/** Draw a cached layer under a camera: zoomed by `z` about (cx, cy), shifted by the mouse. */
function under(f: Frame, img: HTMLCanvasElement, z: number, cx: number, cy: number, depth = 1): void {
  const { g, W, H } = f;
  const px = f.mx * W * 0.012 * depth;
  const py = f.my * H * 0.01 * depth;
  g.save();
  g.translate(cx + px, cy + py);
  g.scale(z, z);
  g.translate(-cx, -cy);
  g.drawImage(img, 0, 0, W, H);
  g.restore();
}

function withCamera(f: Frame, z: number, cx: number, cy: number, depth: number, draw: () => void): void {
  const { g, W, H } = f;
  g.save();
  g.translate(cx + f.mx * W * 0.012 * depth, cy + f.my * H * 0.01 * depth);
  g.scale(z, z);
  g.translate(-cx, -cy);
  draw();
  g.restore();
}

// ------------------------------------------------------------------ 1. the street, 3 AM

function streetLife(f: Frame, z: number, shadow: number, reflection: number): void {
  const { g, W, H, t } = f;
  const b = shopBox(W, H);
  const c = ensureCache(W, H, f.dpr);
  const cx = W * 0.56;
  const cy = H * 0.52;
  under(f, c.street, z, cx, cy);
  withCamera(f, z, cx, cy, 1, () => {
    // the neon sign, flickering, and its glow on the wet road
    const fl = flicker(t, 1.3, f.reduced);
    const sx = (b.sign.x0 + b.sign.x1) / 2;
    const sy = (b.sign.y0 + b.sign.y1) / 2;
    glow(g, sx, sy, W * 0.22, rgba('#ff7a3d', 0.55), fl);
    g.save();
    g.font = `900 ${H * 0.062}px ${SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff6a2a';
    g.shadowBlur = 24 * f.dpr * fl;
    g.fillStyle = fl > 0.8 ? '#ffe2c4' : '#c9886a';
    g.fillText('JUICE SHOP', sx, sy);
    g.restore();
    // the street lamp's cone
    glow(g, b.lamp.x + W * 0.04, b.lamp.y - H * 0.04, W * 0.18, rgba(AMBER, 0.42), flicker(t, 7.7, f.reduced));
    // reflections in the wet pavement
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [x, w, col, a] of [
      [sx, W * 0.3, '#ff7a3d', 0.32 * fl],
      [(b.win.x0 + b.win.x1) / 2, W * 0.24, '#9fd4ff', 0.18],
      [b.lamp.x + W * 0.04, W * 0.1, AMBER, 0.25],
    ] as const) {
      const rg = g.createLinearGradient(0, b.ground, 0, H);
      rg.addColorStop(0, rgba(col, a));
      rg.addColorStop(1, rgba(col, 0));
      g.fillStyle = rg;
      for (let k = 0; k < 14; k++) {
        const yy = b.ground + H * 0.015 + k * (H * 0.018);
        const ww = w * (0.6 + 0.4 * Math.sin(t * 1.3 + k * 1.7)) * (1 - k / 18);
        g.fillRect(x - ww / 2, yy, ww, H * 0.006);
      }
    }
    g.restore();
    // the security camera, turning slowly, its red light
    const ang = f.reduced ? 0.2 : 0.5 * Math.sin(t * 0.45);
    g.save();
    g.translate(b.cam.x, b.cam.y);
    g.rotate(ang);
    g.fillStyle = '#1f232b';
    g.fillRect(-W * 0.028, -H * 0.012, W * 0.03, H * 0.024);
    g.fillStyle = '#0c0e12';
    g.fillRect(-W * 0.033, -H * 0.008, W * 0.006, H * 0.016);
    g.restore();
    glow(g, b.cam.x - W * 0.004, b.cam.y - H * 0.008, H * 0.012, rgba(CRIMSON, 0.9), 0.6 + 0.4 * Math.sin(t * 2));
    g.strokeStyle = '#1f232b';
    g.lineWidth = W * 0.003;
    g.beginPath();
    g.moveTo(b.cam.x, b.cam.y);
    g.lineTo(b.x1, b.cam.y - H * 0.02);
    g.stroke();
    // something moving inside, and a shadow crossing the window
    g.save();
    g.beginPath();
    g.rect(b.win.x0, b.win.y0, b.win.x1 - b.win.x0, b.win.y1 - b.win.y0);
    g.clip();
    if (shadow > 0 && shadow < 1) {
      const x = b.win.x0 - W * 0.08 + (b.win.x1 - b.win.x0 + W * 0.16) * shadow;
      const sg = g.createRadialGradient(x, b.win.y0 + (b.win.y1 - b.win.y0) * 0.45, 0, x, b.win.y0 + (b.win.y1 - b.win.y0) * 0.45, H * 0.2);
      sg.addColorStop(0, 'rgba(0, 0, 0, 0.88)');
      sg.addColorStop(0.5, 'rgba(0, 0, 0, 0.6)');
      sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = sg;
      g.beginPath();
      g.ellipse(x, b.win.y0 + (b.win.y1 - b.win.y0) * 0.5, W * 0.035, (b.win.y1 - b.win.y0) * 0.55, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Kiro's reflection in the glass, before she is there
    if (reflection > 0.01)
      drawGhost(g, b.win.x1 - W * 0.07, b.win.y0 + (b.win.y1 - b.win.y0) * 0.55, (b.win.y1 - b.win.y0) * 0.5, { t, mood: 'calm', alpha: reflection * 0.55, look: 0.3, wander: 0, glitch: f.reduced ? 0 : 0.35, reduce: f.reduced }, f.dpr);
    g.restore();
  });
  fog(g, W, H, t, H * 0.55, H * 0.95, 0.22);
}

function street(f: Frame): void {
  const { g, W, H, st } = f;
  // the camera walks slowly toward the door
  const z = 1 + 0.16 * ease(st / 7);
  streetLife(f, z, ramp(st, 3.4, 5.6) * (st < 5.6 ? 1 : 0), ramp(st, 5.5, 6.8));
  // dark at the very start, coming up out of black
  if (st < 1.2) {
    g.fillStyle = `rgba(0, 0, 0, ${(1 - st / 1.2).toFixed(3)})`;
    g.fillRect(0, 0, W, H);
  }
}

// ------------------------------------------------------------------ 2. Kiro

function kiro(f: Frame): void {
  const { g, W, H, st, t } = f;
  streetLife(f, 1.16 + 0.04 * ease(st / 8), 0, 0);
  // the street falls back into the dark behind him
  g.fillStyle = 'rgba(2, 4, 10, 0.55)';
  g.fillRect(0, 0, W, H);
  const form = f.reduced ? ramp(st, 0, 0.6) : ramp(st, 0.1, 1.6);
  const look = st < 3 ? -0.3 : st < 5 ? 0.4 * Math.sin((st - 3) * 1.5) : -0.2;
  const wave = st > 1.8 && st < 4.2 ? 1 : 0;
  // her purple light on the pavement under her
  glow(g, W * 0.36, H * 0.92, W * 0.26, rgba(KIRO_PURPLE, 0.4), form);
  drawGhost(g, W * 0.36 + f.mx * W * 0.02, H * 0.52, H * 0.5, { t, form, talk: f.talk, look, wander: 0.5, mood: st > 5.2 ? 'happy' : 'calm', wave, glitch: f.reduced ? 0 : st < 1.6 ? 0.4 : rand(Math.floor(t * 3)) < 0.04 ? 0.3 : 0, reduce: f.reduced }, f.dpr);
  // the street's amber on his right side
  glow(g, W * 0.6, H * 0.35, W * 0.3, rgba(AMBER, 0.18), flicker(t, 1.3, f.reduced));
}

// ------------------------------------------------------------------ 3. the sea chart

interface MapLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  nodes: Array<{ id: string; x: number; y: number }>;
  doors: Array<{ x: number; y: number }>;
  /** The firewall's sea wall, the WAF's lighthouse, the two logs' ledgers, the backups' hourglass fort. */
  wall: { x: number; y: number };
  light: { x: number; y: number };
  ledgers: Array<{ x: number; y: number }>;
  fort: { x: number; y: number };
}

/** Where everything sits on the chart, in screen pixels. */
function mapLayout(W: number, H: number): MapLayout {
  const w = W * 0.78;
  const h = H * 0.74;
  const x = (W - w) / 2;
  const y = H * 0.12;
  const at = (u: number, v: number) => ({ x: x + w * u, y: y + h * v });
  return {
    x,
    y,
    w,
    h,
    nodes: [
      { id: 'customers', ...at(0.09, 0.56) },
      { id: 'web', ...at(0.33, 0.56) },
      { id: 'app', ...at(0.55, 0.52) },
      { id: 'db', ...at(0.87, 0.56) },
    ],
    doors: DOORS.map((_, i) => at(0.38 + (i * 0.34) / Math.max(1, DOORS.length - 1), 0.24 + (i % 2) * 0.03)),
    wall: at(0.22, 0.56),
    light: at(0.26, 0.33),
    ledgers: [at(0.33, 0.73), at(0.55, 0.7)],
    fort: at(0.66, 0.8),
  };
}

/** The island's coast: a wobbly closed outline round a centre. */
function coast(g: G, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  g.beginPath();
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + 0.12 * Math.sin(a * 3 + seed) + 0.07 * Math.sin(a * 7 + seed * 2) + 0.04 * Math.sin(a * 13 + seed * 3);
    const px = cx + Math.cos(a) * rx * r;
    const py = cy + Math.sin(a) * ry * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

/** A compass rose of sixteen points, inked. */
function rose(g: G, x: number, y: number, r: number, ink: string): void {
  g.save();
  g.translate(x, y);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const len = k % 4 === 0 ? r : k % 2 === 0 ? r * 0.65 : r * 0.42;
    g.fillStyle = k % 2 ? 'rgba(90, 60, 30, 0.55)' : ink;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a - 0.12) * len * 0.25, Math.sin(a - 0.12) * len * 0.25);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.lineTo(Math.cos(a + 0.12) * len * 0.25, Math.sin(a + 0.12) * len * 0.25);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = ink;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** A tiny sailing ship, inked, for the customers coming in. */
function ship(g: G, x: number, y: number, s: number, ink: string): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = ink;
  g.beginPath();
  g.moveTo(-s, 0);
  g.lineTo(s, 0);
  g.lineTo(s * 0.7, s * 0.35);
  g.lineTo(-s * 0.7, s * 0.35);
  g.closePath();
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = Math.max(1, s * 0.08);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, -s * 1.4);
  g.stroke();
  g.fillStyle = 'rgba(245, 232, 200, 0.9)';
  g.beginPath();
  g.moveTo(s * 0.06, -s * 1.3);
  g.quadraticCurveTo(s * 0.8, -s * 0.8, s * 0.06, -s * 0.2);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

/** An anchor: a pier's mark on the chart. */
function anchor(g: G, x: number, y: number, s: number, ink: string): void {
  g.save();
  g.translate(x, y);
  g.strokeStyle = ink;
  g.lineWidth = Math.max(1.5, s * 0.12);
  g.lineCap = 'round';
  g.beginPath();
  g.arc(0, -s * 0.7, s * 0.18, 0, Math.PI * 2);
  g.moveTo(0, -s * 0.52);
  g.lineTo(0, s * 0.55);
  g.moveTo(-s * 0.35, -s * 0.2);
  g.lineTo(s * 0.35, -s * 0.2);
  g.moveTo(-s * 0.55, s * 0.15);
  g.quadraticCurveTo(-s * 0.45, s * 0.65, 0, s * 0.6);
  g.quadraticCurveTo(s * 0.45, s * 0.65, s * 0.55, s * 0.15);
  g.stroke();
  g.restore();
}

/** The parchment, its coasts, roses, rhumb lines and names, and the brass on the table: painted once. */
function paintChart(g: G, W: number, H: number): void {
  paintTable(g, W, H);
  const L = mapLayout(W, H);
  const INKC = 'rgba(70, 42, 18, 0.9)';
  // a rope coiled at the top left, a spyglass bottom right, the candle's brass dish
  g.strokeStyle = '#7a5a34';
  g.lineWidth = H * 0.014;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.arc(W * 0.06, H * 0.08, H * (0.03 + k * 0.016), 0.2, Math.PI * 1.6);
    g.stroke();
  }
  // the parchment: torn edges, aged and stained, darker at the rim
  g.save();
  g.beginPath();
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const j = (k: number) => (Math.sin(k * 91.7) * 0.5 + 0.5) * 0.012;
    let px: number;
    let py: number;
    if (u < 0.25) {
      px = L.x + L.w * (u / 0.25);
      py = L.y + H * j(i);
    } else if (u < 0.5) {
      px = L.x + L.w - W * j(i);
      py = L.y + L.h * ((u - 0.25) / 0.25);
    } else if (u < 0.75) {
      px = L.x + L.w * (1 - (u - 0.5) / 0.25);
      py = L.y + L.h - H * j(i);
    } else {
      px = L.x + W * j(i);
      py = L.y + L.h * (1 - (u - 0.75) / 0.25);
    }
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.shadowColor = 'rgba(0, 0, 0, 0.75)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 10;
  const paper = g.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, W * 0.5);
  paper.addColorStop(0, '#e3cd9a');
  paper.addColorStop(0.7, '#c9a66c');
  paper.addColorStop(1, '#8e6a3c');
  g.fillStyle = paper;
  g.fill();
  g.shadowColor = 'transparent';
  g.clip();
  for (let k = 0; k < 26; k++) {
    const sx = L.x + L.w * rand(k + 300);
    const sy = L.y + L.h * rand(k + 400);
    const r = H * (0.02 + 0.07 * rand(k + 500));
    const st = g.createRadialGradient(sx, sy, 0, sx, sy, r);
    st.addColorStop(0, `rgba(120, 80, 40, ${(0.08 + 0.12 * rand(k)).toFixed(3)})`);
    st.addColorStop(1, 'rgba(120, 80, 40, 0)');
    g.fillStyle = st;
    g.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  // the lines of latitude and the rhumb lines out of two roses
  g.strokeStyle = 'rgba(90, 60, 30, 0.22)';
  g.lineWidth = 1;
  for (let k = 1; k < 8; k++) {
    g.beginPath();
    g.moveTo(L.x, L.y + (L.h * k) / 8);
    g.lineTo(L.x + L.w, L.y + (L.h * k) / 8);
    g.stroke();
  }
  for (const [rx, ry] of [
    [L.x + L.w * 0.46, L.y + L.h * 0.86],
    [L.x + L.w * 0.12, L.y + L.h * 0.2],
  ] as const) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      g.beginPath();
      g.moveTo(rx, ry);
      g.lineTo(rx + Math.cos(a) * W, ry + Math.sin(a) * W);
      g.stroke();
    }
  }
  // the island of the shop, the vault's rock, small islets; shaded, inked, hatched at the shore
  const isle = { x: L.x + L.w * 0.53, y: L.y + L.h * 0.47, rx: L.w * 0.22, ry: L.h * 0.33 };
  for (const [cx, cy, rx, ry, seed] of [
    [isle.x, isle.y, isle.rx, isle.ry, 1.3],
    [L.x + L.w * 0.87, L.y + L.h * 0.56, L.w * 0.07, L.h * 0.13, 4.1],
    [L.x + L.w * 0.26, L.y + L.h * 0.33, L.w * 0.025, L.h * 0.04, 7.7],
    [L.x + L.w * 0.7, L.y + L.h * 0.86, L.w * 0.04, L.h * 0.05, 2.2],
  ] as const) {
    // the shallows round each shore
    g.strokeStyle = 'rgba(90, 60, 30, 0.25)';
    for (let k = 1; k <= 3; k++) {
      coast(g, cx, cy, rx + k * 7, ry + k * 7, seed);
      g.lineWidth = 1;
      g.stroke();
    }
    coast(g, cx, cy, rx, ry, seed);
    const land = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    land.addColorStop(0, 'rgba(160, 120, 70, 0.55)');
    land.addColorStop(1, 'rgba(120, 85, 45, 0.7)');
    g.fillStyle = land;
    g.fill();
    g.strokeStyle = INKC;
    g.lineWidth = 2;
    g.stroke();
  }
  // little inked mountains on the island
  g.strokeStyle = 'rgba(70, 42, 18, 0.7)';
  g.lineWidth = 1.5;
  for (let k = 0; k < 9; k++) {
    const mx = isle.x + (rand(k + 800) - 0.2) * isle.rx * 1.1;
    const my = isle.y + (rand(k + 900) - 0.1) * isle.ry * 0.9;
    const ms = H * (0.012 + 0.012 * rand(k));
    g.beginPath();
    g.moveTo(mx - ms, my);
    g.lineTo(mx, my - ms * 1.2);
    g.lineTo(mx + ms, my);
    g.stroke();
  }
  rose(g, L.x + L.w * 0.46, L.y + L.h * 0.86, H * 0.07, INKC);
  rose(g, L.x + L.w * 0.12, L.y + L.h * 0.2, H * 0.045, INKC);
  // the names, in an old chart's italic
  const name = (text: string, x: number, y: number, size: number, rot = 0) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.font = `italic 600 ${size}px "Cormorant Garamond", Georgia, serif`;
    g.fillStyle = 'rgba(70, 40, 16, 0.85)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
  };
  name('The Open Internet', L.x + L.w * 0.11, L.y + L.h * 0.42, H * 0.03, -0.12);
  name('Juice Shop Isle', isle.x + isle.rx * 0.1, isle.y + isle.ry * 0.52, H * 0.03, 0.04);
  name('Mare Incognitum', L.x + L.w * 0.86, L.y + L.h * 0.2, H * 0.022, 0.1);
  // the vignette of age round the edges
  const age = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.55);
  age.addColorStop(0, 'rgba(60, 30, 10, 0)');
  age.addColorStop(1, 'rgba(60, 30, 10, 0.45)');
  g.fillStyle = age;
  g.fillRect(0, 0, W, H);
  g.restore();
  // a spyglass lying across the bottom right corner
  g.save();
  g.translate(W * 0.86, H * 0.93);
  g.rotate(-0.35);
  const brass = g.createLinearGradient(0, -H * 0.03, 0, H * 0.03);
  brass.addColorStop(0, '#f0d79b');
  brass.addColorStop(0.5, '#a07a3c');
  brass.addColorStop(1, '#4e3818');
  g.fillStyle = brass;
  g.fillRect(-W * 0.12, -H * 0.022, W * 0.24, H * 0.044);
  g.fillStyle = '#2d1f12';
  g.fillRect(-W * 0.04, -H * 0.025, W * 0.1, H * 0.05);
  g.restore();
  // the candle's brass dish, top right
  g.fillStyle = '#9c7a3e';
  g.beginPath();
  g.ellipse(W * 0.9, H * 0.2, W * 0.045, H * 0.02, 0, 0, Math.PI * 2);
  g.fill();
  const wax = g.createLinearGradient(W * 0.885, 0, W * 0.915, 0);
  wax.addColorStop(0, '#d9cdb0');
  wax.addColorStop(0.5, '#fbf3df');
  wax.addColorStop(1, '#bfb193');
  g.fillStyle = wax;
  g.fillRect(W * 0.887, H * 0.08, W * 0.026, H * 0.12);
  // the compass's brass case, bottom left
  g.fillStyle = '#7d5c2a';
  g.beginPath();
  g.arc(W * 0.08, H * 0.86, H * 0.085, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#efe3c3';
  g.beginPath();
  g.arc(W * 0.08, H * 0.86, H * 0.068, 0, Math.PI * 2);
  g.fill();
  rose(g, W * 0.08, H * 0.86, H * 0.06, 'rgba(60, 40, 20, 0.9)');
}

function tacticalMap(f: Frame): void {
  const { g, W, H, st, t, hot } = f;
  const c = ensureCache(W, H, f.dpr);
  const L = mapLayout(W, H);
  // the chart unrolls on the table, the camera settling over it
  const unfold = f.reduced ? 1 : ramp(st, 0, 1.3);
  g.drawImage(c.table, 0, 0, W, H);
  withCamera(f, 1.04 - 0.03 * ease(st / 10), W / 2, H / 2, 0.8, () => {
    g.save();
    g.translate(0, L.y + L.h / 2);
    g.scale(1, Math.max(0.02, unfold));
    g.translate(0, -(L.y + L.h / 2));
    g.drawImage(c.chart, 0, 0, W, H);
    g.restore();
  });
  // the candle: a living flame and its warm light over everything
  const fl = flicker(t, 2.2, f.reduced);
  const fx = W * 0.9 + (f.reduced ? 0 : Math.sin(t * 7) * 1.5);
  const fy = H * 0.065;
  glow(g, fx, fy + H * 0.02, W * 0.5, 'rgba(255, 190, 110, 0.32)', fl);
  g.save();
  const flame = g.createRadialGradient(fx, fy + H * 0.01, 0, fx, fy, H * 0.03);
  flame.addColorStop(0, '#fffbe8');
  flame.addColorStop(0.5, '#ffcf6a');
  flame.addColorStop(1, 'rgba(255, 140, 40, 0)');
  g.fillStyle = flame;
  g.beginPath();
  g.ellipse(fx, fy, H * 0.011, H * 0.026 * (0.9 + 0.1 * fl), 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // the compass needle, settling north
  const needle = f.reduced ? 0 : 0.25 * Math.sin(t * 1.3) * Math.exp(-st * 0.2);
  g.save();
  g.translate(W * 0.08, H * 0.86);
  g.rotate(needle);
  g.fillStyle = '#a0261c';
  g.beginPath();
  g.moveTo(0, -H * 0.055);
  g.lineTo(H * 0.008, 0);
  g.lineTo(-H * 0.008, 0);
  g.closePath();
  g.fill();
  g.restore();
  if (unfold < 0.95) return;
  const k = ramp(st, 1.2, 2.2);
  const s = H * 0.045;
  const fs = Math.max(12, H * 0.018);
  const INKC = 'rgba(70, 42, 18, 0.95)';
  const doorsLit = st > 1.4 && st < 4.4 ? 1 : 0.35;
  const closeLit = ramp(st, 2.8, 3.4) * (st < 4.6 ? 1 : 0.4);
  const loginLit = st > 4.3 ? 1 : 0;
  const dbLit = ramp(st, 6, 6.8);
  const ink = (text: string, x: number, y: number, size: number, color = INKC, weight = 700) => {
    g.font = `italic ${weight} ${size}px "Cormorant Garamond", Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, x, y);
  };
  withCamera(f, 1.04 - 0.03 * ease(st / 10), W / 2, H / 2, 0.8, () => {
    g.globalAlpha = k;
    // the route every request sails: from the open sea, through the harbour gate, to the shop, down to the vault
    g.strokeStyle = 'rgba(70, 42, 18, 0.7)';
    g.lineWidth = 2.5;
    g.setLineDash([3, 7]);
    g.beginPath();
    L.nodes.forEach((n, i) => (i ? g.lineTo(n.x, n.y) : g.moveTo(n.x, n.y)));
    g.stroke();
    g.setLineDash([]);
    // a light running along it
    const run = (((t * 0.18) % 1) + 1) % 1;
    const seg = Math.min(L.nodes.length - 2, Math.floor(run * (L.nodes.length - 1)));
    const a = L.nodes[seg]!;
    const b = L.nodes[seg + 1]!;
    const u = run * (L.nodes.length - 1) - seg;
    glow(g, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, H * 0.02, rgba(CYAN, 0.9), 0.9);
    // the way in, in red ink: through the pier that never closes, round to the vault
    const loginIdx = Math.max(0, DOORS.findIndex((d) => !d.closable));
    const lg = L.doors[loginIdx]!;
    g.strokeStyle = rgba(CRIMSON, 0.35 + 0.6 * loginLit);
    g.lineWidth = 2 + 1.5 * loginLit;
    g.setLineDash([10, 7]);
    g.lineDashOffset = f.reduced ? 0 : -t * 50;
    g.beginPath();
    g.moveTo(L.x + L.w * 0.05, L.y + L.h * 0.08);
    g.quadraticCurveTo(lg.x - L.w * 0.12, lg.y - L.h * 0.12, lg.x, lg.y);
    g.quadraticCurveTo(L.nodes[2]!.x, L.nodes[2]!.y - L.h * 0.05, L.nodes[2]!.x + s, L.nodes[2]!.y);
    g.quadraticCurveTo(L.nodes[3]!.x - L.w * 0.1, L.nodes[3]!.y - L.h * 0.18, L.nodes[3]!.x, L.nodes[3]!.y - s * 0.8);
    g.stroke();
    g.setLineDash([]);
    // customers: ships coming in from the open sea
    for (let i = 0; i < 4; i++) {
      const life = ((f.reduced ? 0.3 : t * 0.05) + i * 0.25) % 1;
      const sx = L.x + L.w * (0.02 + life * 0.25);
      const sy = L.nodes[0]!.y + (i - 1.5) * H * 0.05 + Math.sin(t + i) * 2;
      g.globalAlpha = k * Math.sin(life * Math.PI);
      ship(g, sx, sy, s * 0.35, INKC);
    }
    g.globalAlpha = k;
    // the firewall: a sea wall across the approach, unmanned (broken, no guard)
    const wl = L.wall;
    g.strokeStyle = INKC;
    g.lineWidth = 3;
    for (let q = 0; q < 7; q++) {
      const yy = wl.y - H * 0.16 + q * H * 0.05;
      g.strokeRect(wl.x - s * 0.18, yy, s * 0.36, H * 0.025);
    }
    ink('Firewall', wl.x, wl.y - H * 0.2, fs * 1.05);
    ink(FACTS.firewall.state, wl.x, wl.y + H * 0.22, fs * 0.8, 'rgba(140, 20, 30, 0.95)', 600);
    hot.push({ id: 'firewall', x: wl.x - s, y: wl.y - H * 0.2, w: s * 2, h: H * 0.42, title: 'Firewall', body: `${FACTS.firewall.where} · ${FACTS.firewall.state}`, tone: 'crimson' });
    // the WAF: a lighthouse on its rock, its lamp dark
    const lh = L.light;
    g.fillStyle = 'rgba(70, 42, 18, 0.85)';
    g.beginPath();
    g.moveTo(lh.x - s * 0.22, lh.y + s * 0.4);
    g.lineTo(lh.x - s * 0.12, lh.y - s * 0.7);
    g.lineTo(lh.x + s * 0.12, lh.y - s * 0.7);
    g.lineTo(lh.x + s * 0.22, lh.y + s * 0.4);
    g.closePath();
    g.fill();
    g.fillStyle = '#2a1a0c';
    g.fillRect(lh.x - s * 0.16, lh.y - s * 0.95, s * 0.32, s * 0.25);
    ink('WAF · lamp out', lh.x, lh.y - s * 1.3, fs * 0.95);
    hot.push({ id: 'waf', x: lh.x - s, y: lh.y - s * 1.5, w: s * 2, h: s * 2.2, title: 'Web application firewall', body: `${FACTS.waf.where} · ${FACTS.waf.state}`, tone: 'crimson' });
    // the seven piers round the island: anchors, a flag lever on each that can close, Login burning red
    DOORS.forEach((d, i) => {
      const p = L.doors[i]!;
      const lit = d.closable ? Math.max(doorsLit, closeLit) : Math.max(doorsLit, loginLit);
      if (d.closable) {
        if (lit > 0.5) glow(g, p.x, p.y, s * 1.3, rgba(CYAN, 0.5), lit * 0.8);
        anchor(g, p.x, p.y, s * 0.55, lit > 0.5 ? '#0f5c68' : INKC);
        // its flag: up, it can close
        g.strokeStyle = INKC;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(p.x + s * 0.45, p.y + s * 0.3);
        g.lineTo(p.x + s * 0.45, p.y - s * 0.45);
        g.stroke();
        g.fillStyle = closeLit > 0.3 ? rgba(CYAN, 0.9) : 'rgba(70, 42, 18, 0.7)';
        g.beginPath();
        g.moveTo(p.x + s * 0.45, p.y - s * 0.45);
        g.lineTo(p.x + s * 0.8, p.y - s * 0.33);
        g.lineTo(p.x + s * 0.45, p.y - s * 0.2);
        g.closePath();
        g.fill();
      } else {
        glow(g, p.x, p.y, s * 2, rgba(CRIMSON, 0.7), 0.55 + 0.45 * (f.reduced ? 1 : Math.sin(t * 3) * 0.5 + 0.5));
        anchor(g, p.x, p.y, s * 0.6, '#a0141f');
        ink('always open', p.x, p.y + s * 0.95, fs * 0.82, '#a0141f');
      }
      ink(d.feature, p.x, p.y - s * 0.95, fs * 0.82, INKC, 700);
      hot.push({ id: `door-${i}`, x: p.x - s, y: p.y - s * 1.2, w: s * 2, h: s * 2.4, title: d.feature, body: `${d.address} · ${d.closable ? `can be switched off in ${d.off}` : `${d.off}: it can never be switched off`}`, tone: d.closable ? 'cyan' : 'crimson' });
    });
    // the harbour gate (nginx), the shop in its town, the vault in its rock
    const web = L.nodes[1]!;
    g.fillStyle = 'rgba(60, 36, 14, 0.9)';
    g.fillRect(web.x - s * 0.55, web.y - s * 0.55, s * 0.3, s);
    g.fillRect(web.x + s * 0.25, web.y - s * 0.55, s * 0.3, s);
    g.strokeStyle = 'rgba(60, 36, 14, 0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(web.x, web.y - s * 0.1, s * 0.25, Math.PI, 0);
    g.stroke();
    const app = L.nodes[2]!;
    g.fillStyle = 'rgba(60, 36, 14, 0.9)';
    for (let q = 0; q < 5; q++) g.fillRect(app.x - s * 0.9 + q * s * 0.38, app.y - s * (0.2 + 0.15 * (q % 2)), s * 0.3, s * (0.5 + 0.15 * (q % 2)));
    glow(g, app.x, app.y, s * 1.2, 'rgba(255, 200, 110, 0.5)', 0.6 + 0.2 * fl);
    const db = L.nodes[3]!;
    if (dbLit > 0) glow(g, db.x, db.y, s * 2.4, rgba(CYAN, 0.5), dbLit);
    g.fillStyle = '#2a1a0c';
    g.beginPath();
    g.arc(db.x, db.y, s * 0.42, Math.PI, 0);
    g.lineTo(db.x + s * 0.42, db.y + s * 0.3);
    g.lineTo(db.x - s * 0.42, db.y + s * 0.3);
    g.closePath();
    g.fill();
    g.strokeStyle = '#b89452';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(db.x, db.y + s * 0.02, s * 0.16, 0, Math.PI * 2);
    g.stroke();
    const names = ['', 'the Harbour Gate', 'the shop', 'the Vault'];
    FACTS.parts.forEach((part, i) => {
      const n = L.nodes[i]!;
      ink(`${part.name}${names[i] ? ` · ${names[i]}` : ''}`, n.x, n.y + s * 1.05, fs * 1.05, INKC, 700);
      if (part.sub) ink(part.sub, n.x, n.y + s * 1.05 + fs * 1.25, fs * 0.78, 'rgba(70, 42, 18, 0.75)', 600);
      hot.push({ id: `part-${part.id}`, x: n.x - s * 1.3, y: n.y - s, w: s * 2.6, h: s * 2.9, title: part.name, body: part.id === 'customers' ? 'Everyone on the internet: the shop is open to all of them.' : `${part.sub}${'note' in part && part.note ? ` · ${part.note}` : ''}`, tone: part.id === 'customers' ? 'emerald' : 'cyan' });
    });
    if (dbLit > 0) chip(g, `${FACTS.customers} CUSTOMERS · ${FACTS.products} PRODUCTS`, db.x, db.y - s * 1.3, fs * 0.9, '#7a1a10', 'rgba(240, 225, 190, 0.92)', 'center');
    // the two logs, as ledgers by the gate and the shop
    L.ledgers.forEach((p, i) => {
      g.fillStyle = 'rgba(80, 30, 20, 0.85)';
      g.fillRect(p.x - s * 0.3, p.y - s * 0.2, s * 0.6, s * 0.4);
      g.strokeStyle = 'rgba(240, 220, 170, 0.8)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(p.x, p.y - s * 0.2);
      g.lineTo(p.x, p.y + s * 0.2);
      g.stroke();
      const log = FACTS.logs[i];
      if (!log) return;
      ink(log.name, p.x, p.y + s * 0.5, fs * 0.8, INKC, 700);
      hot.push({ id: `log-${i}`, x: p.x - s * 0.8, y: p.y - s * 0.4, w: s * 1.6, h: s * 1.2, title: log.name, body: `${log.path} · ${log.what}`, tone: 'amber' });
    });
    // the backups: an hourglass on its fort, every hour
    const ft = L.fort;
    g.strokeStyle = '#1d6b4a';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(ft.x - s * 0.25, ft.y - s * 0.4);
    g.lineTo(ft.x + s * 0.25, ft.y - s * 0.4);
    g.lineTo(ft.x - s * 0.25, ft.y + s * 0.4);
    g.lineTo(ft.x + s * 0.25, ft.y + s * 0.4);
    g.closePath();
    g.stroke();
    ink('Backups · every hour', ft.x, ft.y + s * 0.75, fs * 0.85, '#1d6b4a', 700);
    hot.push({ id: 'backup', x: ft.x - s, y: ft.y - s * 0.6, w: s * 2, h: s * 1.6, title: 'Backups', body: FACTS.backups, tone: 'emerald' });
    g.globalAlpha = 1;
  });
  // Kiro's light, moving to whatever she is talking about
  const target = st < 4.3 ? L.doors[1]! : st < 6 ? L.doors[Math.max(0, DOORS.findIndex((d) => !d.closable))]! : L.nodes[3]!;
  const px = target.x + Math.sin(t * 2) * 6 + f.mx * W * 0.012;
  const py = target.y - H * 0.08 + Math.cos(t * 1.7) * 4 + f.my * H * 0.01;
  glow(g, px, py, H * 0.05, rgba(CYAN, 0.9), k);
  glow(g, px, py, H * 0.012, 'rgba(220, 252, 255, 1)', k);
}

// ------------------------------------------------------------------ 4. the gate

/** The wall, the gothic arch, the ivy, the moonlit mist beyond: painted once. */
function paintGate(g: G, W: number, H: number): void {
  // the night, teal with moonlight behind the gate
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#03080a');
  sky.addColorStop(0.55, '#0b1d1f');
  sky.addColorStop(1, '#050807');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const moon = g.createRadialGradient(W * 0.5, H * 0.36, 0, W * 0.5, H * 0.36, W * 0.4);
  moon.addColorStop(0, 'rgba(170, 230, 220, 0.55)');
  moon.addColorStop(0.3, 'rgba(90, 170, 165, 0.25)');
  moon.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = moon;
  g.fillRect(0, 0, W, H);
  // through the arch: a mausoleum, the vault, misty in the distance
  const vx = W * 0.5;
  const vy = H * 0.56;
  g.fillStyle = 'rgba(20, 38, 38, 0.85)';
  g.fillRect(vx - W * 0.06, vy - H * 0.12, W * 0.12, H * 0.14);
  g.beginPath();
  g.moveTo(vx - W * 0.07, vy - H * 0.12);
  g.lineTo(vx, vy - H * 0.19);
  g.lineTo(vx + W * 0.07, vy - H * 0.12);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(5, 12, 12, 0.9)';
  g.fillRect(vx - W * 0.018, vy - H * 0.07, W * 0.036, H * 0.09);
  // the stone wall across the screen, crenellated, with the arch cut through it
  const top = H * 0.2;
  const ground = H * 0.74;
  const archW = W * 0.18;
  const archTop = H * 0.27;
  const wall = new Path2D();
  wall.rect(0, top, W, ground - top);
  // the arch's opening (pointed): cut out by drawing it with even-odd
  wall.moveTo(vx - archW / 2, ground);
  wall.lineTo(vx - archW / 2, archTop + H * 0.12);
  wall.quadraticCurveTo(vx - archW / 2, archTop, vx, archTop - H * 0.02);
  wall.quadraticCurveTo(vx + archW / 2, archTop, vx + archW / 2, archTop + H * 0.12);
  wall.lineTo(vx + archW / 2, ground);
  wall.closePath();
  const stone = g.createLinearGradient(0, top, 0, ground);
  stone.addColorStop(0, '#2d3533');
  stone.addColorStop(1, '#151a19');
  g.fillStyle = stone;
  g.fill(wall, 'evenodd');
  // crenellations along the top
  for (let x = 0; x < W; x += W * 0.05) g.fillRect(x, top - H * 0.04, W * 0.03, H * 0.045);
  g.fillStyle = '#2d3533';
  // the stone courses, faint
  g.save();
  g.clip(wall, 'evenodd');
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = 1;
  for (let y = top; y < ground; y += H * 0.03) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  // bare vine stems creeping up the stone, dark, no leaves (D-224: the only leaves in the shot are the five on the ground)
  g.strokeStyle = 'rgba(14, 20, 16, 0.85)';
  g.lineCap = 'round';
  for (let k = 0; k < 14; k++) {
    let x = (k < 7 ? rand(k) * W * 0.3 : W * 0.55 + rand(k) * W * 0.18) + (rand(k + 40) - 0.5) * W * 0.02;
    let y = ground;
    g.lineWidth = Math.max(1, H * (0.002 + 0.002 * rand(k + 3)));
    g.beginPath();
    g.moveTo(x, y);
    const reach = (0.25 + 0.45 * rand(k + 9)) * (ground - top);
    for (let j = 0; j < 9; j++) {
      x += (rand(k * 13 + j) - 0.5) * W * 0.025;
      y -= reach / 9;
      g.lineTo(x, y);
      // a short tendril now and then
      if (rand(k * 7 + j) > 0.7) {
        g.moveTo(x, y);
        g.quadraticCurveTo(x + W * 0.01, y - H * 0.01, x + W * 0.018 * (rand(j) > 0.5 ? 1 : -1), y - H * 0.025);
        g.moveTo(x, y);
      }
    }
    g.stroke();
  }
  g.restore();
  // the arch's stone mouldings
  g.strokeStyle = '#3b4441';
  g.lineWidth = W * 0.008;
  g.beginPath();
  g.moveTo(vx - archW / 2, ground);
  g.lineTo(vx - archW / 2, archTop + H * 0.12);
  g.quadraticCurveTo(vx - archW / 2, archTop, vx, archTop - H * 0.02);
  g.quadraticCurveTo(vx + archW / 2, archTop, vx + archW / 2, archTop + H * 0.12);
  g.lineTo(vx + archW / 2, ground);
  g.stroke();
  // the watchtower on the right (the WAF), its lantern dark
  g.fillStyle = '#1e2524';
  g.fillRect(W * 0.76, H * 0.06, W * 0.1, ground - H * 0.06);
  for (let x = W * 0.76; x < W * 0.86; x += W * 0.025) g.fillRect(x, H * 0.03, W * 0.015, H * 0.035);
  g.fillStyle = '#0a0d0d';
  g.fillRect(W * 0.795, H * 0.12, W * 0.03, H * 0.06);
  // the small side gate on the left (the firewall): its grille raised, the way left open
  g.fillStyle = '#060909';
  g.fillRect(W * 0.18, H * 0.48, W * 0.08, ground - H * 0.48);
  g.strokeStyle = '#2a302f';
  g.lineWidth = 3;
  for (let x = W * 0.185; x < W * 0.26; x += W * 0.012) {
    g.beginPath();
    g.moveTo(x, H * 0.48);
    g.lineTo(x, H * 0.52);
    g.stroke();
  }
  // grass, and a handful of fallen leaves on the ground, kept clear of the gate (D-224: four or five, no more)
  const grass = g.createLinearGradient(0, ground, 0, H);
  grass.addColorStop(0, '#0e1a12');
  grass.addColorStop(1, '#050806');
  g.fillStyle = grass;
  g.fillRect(0, ground, W, H - ground);
  const fallen: Array<[number, number, number, number, string]> = [
    // x, y (fractions of the frame), size (fraction of H), turn, colour
    [0.12, 0.93, 0.03, 0.6, '#6e2216'],
    [0.24, 0.975, 0.036, -0.9, '#7a4a1c'],
    [0.31, 0.9, 0.022, 2.2, '#5a2a18'],
    [0.74, 0.95, 0.032, -2.4, '#6a3018'],
    [0.88, 0.91, 0.026, 1.1, '#5e3a1a'],
  ];
  for (const [fx, fy, fs, turn, colour] of fallen) leaf(g, W * fx, Math.max(ground + H * 0.02, H * fy), H * fs, turn, colour);
  // branches hanging over the top
  g.strokeStyle = '#020404';
  g.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    g.lineWidth = W * (0.002 + 0.004 * rand(k));
    g.beginPath();
    g.moveTo(rand(k) * W * 0.5, -H * 0.02);
    g.quadraticCurveTo(rand(k + 1) * W * 0.6, H * 0.08, rand(k + 2) * W * 0.7, H * (0.12 + 0.08 * rand(k + 3)));
    g.stroke();
  }
}

/** A fallen maple leaf lying flat on the ground: five lobes, a stem, faint veins, a little shadow. */
function leaf(g: G, x: number, y: number, s: number, turn: number, colour: string): void {
  g.save();
  g.translate(x, y);
  g.scale(1, 0.55); // lying on the ground, seen at an angle
  g.rotate(turn);
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  g.beginPath();
  g.ellipse(s * 0.08, s * 0.12, s * 0.95, s * 0.8, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  // five rounded lobes with shallow notches between them: a maple leaf, not a star
  const lobes = 5;
  const span = Math.PI * 1.55;
  for (let i = 0; i <= lobes; i++) {
    const a = -Math.PI / 2 - span / 2 + (i / lobes) * span;
    const r = s * (i === 0 || i === lobes ? 0.55 : i === Math.floor(lobes / 2) + 0 ? 1 : 0.85);
    const notch = a - span / lobes / 2;
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else {
      g.quadraticCurveTo(Math.cos(notch) * s * 0.62, Math.sin(notch) * s * 0.62, Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
      g.arc(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8, r * 0.16, a - 1.2, a + 1.2);
    }
  }
  g.quadraticCurveTo(s * 0.2, s * 0.1, 0, s * 0.15);
  g.closePath();
  const body = g.createRadialGradient(0, -s * 0.2, s * 0.05, 0, 0, s);
  body.addColorStop(0, colour);
  body.addColorStop(1, '#1e0e08');
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = 'rgba(20, 8, 4, 0.7)';
  g.lineWidth = Math.max(0.6, s * 0.03);
  g.beginPath();
  g.moveTo(0, s * 0.45);
  g.lineTo(0, -s * 0.95);
  for (const a of [-2.3, -0.85, 2.3 - Math.PI, -Math.PI + 0.85]) {
    g.moveTo(0, -s * 0.05);
    g.lineTo(Math.cos(a) * s * 0.7, Math.sin(a) * s * 0.7);
  }
  g.stroke();
  g.restore();
}

/** One leaf of the wrought-iron gate: bars and scrolls, swung open by `open` (0 shut, 1 flat against the wall). */
function ironLeaf(g: G, hingeX: number, top: number, bottom: number, width: number, dir: number, open: number): void {
  const w = width * (1 - 0.75 * open);
  g.save();
  g.strokeStyle = '#0b0f0f';
  g.lineWidth = Math.max(2, width * 0.03);
  g.lineCap = 'round';
  const bars = 7;
  for (let i = 0; i <= bars; i++) {
    const x = hingeX + dir * (w * i) / bars;
    g.beginPath();
    g.moveTo(x, bottom);
    g.lineTo(x, top + (bottom - top) * 0.08);
    g.stroke();
    // spear tips
    g.beginPath();
    g.moveTo(x - 4, top + (bottom - top) * 0.1);
    g.lineTo(x, top + (bottom - top) * 0.06);
    g.lineTo(x + 4, top + (bottom - top) * 0.1);
    g.stroke();
  }
  for (const v of [0.2, 0.55, 0.9]) {
    g.beginPath();
    g.moveTo(hingeX, top + (bottom - top) * v);
    g.lineTo(hingeX + dir * w, top + (bottom - top) * v);
    g.stroke();
  }
  // scrollwork between the rails
  g.lineWidth = Math.max(1.5, width * 0.018);
  for (let i = 0; i < bars; i++) {
    for (const v of [0.32, 0.72]) {
      const cx = hingeX + dir * (w * (i + 0.5)) / bars;
      const cy = top + (bottom - top) * v;
      const r = (w / bars) * 0.42;
      g.beginPath();
      for (let a = 0; a < Math.PI * 3.2; a += 0.25) {
        const rr = r * (1 - a / (Math.PI * 3.4));
        const px = cx + Math.cos(a) * rr * dir;
        const py = cy + Math.sin(a) * rr;
        if (a === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  g.restore();
}

function gate(f: Frame): void {
  const { g, W, H, st, t, hot } = f;
  const c = ensureCache(W, H, f.dpr);
  const z = 1 + 0.07 * ease(st / 10);
  const fs = Math.max(12, H * 0.018);
  const vx = W * 0.5;
  const ground = H * 0.74;
  const archW = W * 0.18;
  under(f, c.gate, z, vx, H * 0.55, 1);
  withCamera(f, z, vx, H * 0.55, 1, () => {
    // the gate stands open: one leaf swung back, the other ajar
    ironLeaf(g, vx - archW / 2, H * 0.29, ground, archW / 2, 1, 0.85);
    ironLeaf(g, vx + archW / 2, H * 0.29, ground, archW / 2, -1, 0.55 + 0.03 * Math.sin(t * 0.6));
    // the backup's hourglass glowing emerald by the vault, every hour
    const bx = vx + W * 0.03;
    const by = H * 0.47;
    const backupLit = ramp(st, 3.6, 4.4);
    glow(g, bx, by, H * 0.06, rgba(EMERALD, 0.6), 0.35 + 0.65 * backupLit);
    g.strokeStyle = EMERALD;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(bx - H * 0.012, by - H * 0.02);
    g.lineTo(bx + H * 0.012, by - H * 0.02);
    g.lineTo(bx - H * 0.012, by + H * 0.02);
    g.lineTo(bx + H * 0.012, by + H * 0.02);
    g.closePath();
    g.stroke();
    // the WAF's lantern: dark; then a crimson warning light comes on below it as the scene turns
    const red = ramp(st, 2.2, 3.4);
    glow(g, W * 0.81, H * 0.15, H * 0.05, rgba(CRIMSON, 0.7), red * flicker(t, 4.4, f.reduced));
    glow(g, W * 0.22, H * 0.46, H * 0.05, rgba(CRIMSON, 0.7), red * flicker(t, 9.1, f.reduced));
    // engraved plaques: what each thing is, and how it stands tonight
    const plaque = (title: string, state: string, x: number, y: number, tone: string) => {
      g.save();
      g.font = `700 ${fs}px ${SANS}`;
      const w = Math.max(g.measureText(title).width, g.measureText(state).width * 0.85) + fs * 2;
      g.fillStyle = 'rgba(8, 12, 12, 0.85)';
      g.strokeStyle = tone;
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(x - w / 2, y - fs * 1.5, w, fs * 3, 4);
      g.fill();
      g.stroke();
      g.restore();
      label(g, title, x, y - fs * 0.55, fs * 1.05, tone, 'center', SANS, 900);
      label(g, state, x, y + fs * 0.65, fs * 0.82, '#e9eef0', 'center');
    };
    const tone = red > 0.5 ? CRIMSON : AMBER;
    plaque('FIREWALL', FACTS.firewall.state, W * 0.22, H * 0.4, tone);
    plaque('WAF', FACTS.waf.state, W * 0.81, H * 0.24, tone);
    plaque('WEB SERVER · THE GATE · OPEN', FACTS.parts[1]?.sub ?? '', vx, ground - H * 0.06, CYAN); // above the subtitles
    label(g, 'DATABASE · THE VAULT', vx, H * 0.33, fs, '#dff6ff', 'center', SANS, 800);
    label(g, 'BACKUP · EVERY HOUR', bx + H * 0.06, by, fs * 0.85, EMERALD, 'left', SANS, 800);
    hot.push({ id: 'firewall', x: W * 0.16, y: H * 0.36, w: W * 0.12, h: ground - H * 0.36, title: 'Firewall', body: `${FACTS.firewall.where} · ${FACTS.firewall.state}`, tone: 'crimson' });
    hot.push({ id: 'waf', x: W * 0.75, y: H * 0.05, w: W * 0.12, h: H * 0.3, title: 'Web application firewall', body: `${FACTS.waf.where} · ${FACTS.waf.state}`, tone: 'crimson' });
    hot.push({ id: 'gate', x: vx - archW / 2, y: H * 0.4, w: archW, h: ground - H * 0.4, title: FACTS.parts[1]!.name, body: `${FACTS.parts[1]!.sub} · ${FACTS.parts[1]!.note ?? ''}`, tone: 'cyan' });
    hot.push({ id: 'vault', x: vx - W * 0.07, y: H * 0.37, w: W * 0.06, h: H * 0.2, title: FACTS.parts[3]!.name, body: `${FACTS.parts[3]!.sub} · ${FACTS.dbWhat}`, tone: 'cyan' });
    hot.push({ id: 'backup', x: bx - H * 0.04, y: by - H * 0.04, w: H * 0.2, h: H * 0.08, title: 'Backups', body: FACTS.backups, tone: 'emerald' });
    // a dark figure walking in through the open gate
    const walk = ramp(st, 4.2, 8.6);
    if (walk > 0 && walk < 1) {
      const fx = W * 0.15 + (vx - W * 0.15) * Math.min(1, walk * 1.25);
      const fy = H * 0.97 - (H * 0.97 - ground) * Math.min(1, walk * 1.25);
      const sc = 1 - 0.55 * Math.min(1, walk * 1.25);
      const a = walk > 0.85 ? (1 - walk) / 0.15 : 1;
      g.save();
      g.globalAlpha = a;
      g.fillStyle = '#000';
      g.beginPath();
      g.ellipse(fx, fy - H * 0.16 * sc, H * 0.04 * sc, H * 0.16 * sc, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(fx, fy - H * 0.34 * sc, H * 0.032 * sc, 0, Math.PI * 2);
      g.fill();
      g.restore();
      glow(g, fx, fy - H * 0.33 * sc, H * 0.03 * sc, rgba(CRIMSON, 0.9), a * 0.8);
    }
  });
  fog(g, W, H, t, H * 0.45, H * 0.85, 0.2);
  // the trade-off of a restore, in the files' words
  if (st > 4.4) chip(g, FACTS.backups.split('. ').slice(1).join('. ') || FACTS.backups, W * 0.5, H * 0.94, Math.max(12, H * 0.016), EMERALD, 'rgba(4, 14, 10, 0.85)', 'center');
}

// ------------------------------------------------------------------ 5. the logs

function logs(f: Frame): void {
  const { g, W, H, st, t, hot } = f;
  g.fillStyle = '#02040a';
  g.fillRect(0, 0, W, H);
  const cx = W / 2 + f.mx * W * 0.02;
  const cy = H * 0.46 + f.my * H * 0.02;
  // the tunnel: frames rushing toward us out of the dark
  const speed = f.reduced ? 0 : 0.35;
  for (let k = 0; k < 14; k++) {
    const d = ((k / 14 + t * speed * 0.1) % 1) ** 2;
    const w = W * (0.05 + d * 1.3);
    const h = H * (0.04 + d * 1.1);
    g.strokeStyle = rgba(CYAN, 0.05 + 0.25 * d);
    g.lineWidth = 1 + 2 * d;
    g.strokeRect(cx - w / 2, cy - h / 2, w, h);
  }
  // floating fragments of ordinary requests: times, paths, status codes
  const bits = [...FACTS.normalPieces.map((p) => p.text), ...FACTS.logs.map((l) => l.path)];
  g.save();
  g.font = `500 ${Math.max(11, H * 0.014)}px ${MONO}`;
  g.textAlign = 'center';
  for (let i = 0; i < 26; i++) {
    const d = ((rand(i) + t * 0.05 * (f.reduced ? 0 : 1)) % 1) ** 1.6;
    const ang = rand(i + 3) * Math.PI * 2;
    const r = (0.15 + d * 0.9) * Math.min(W, H) * 0.6;
    const x = cx + Math.cos(ang) * r * 1.4;
    const y = cy + Math.sin(ang) * r * 0.8;
    g.globalAlpha = 0.12 + 0.35 * d;
    g.fillStyle = EMERALD;
    g.fillText((bits[i % bits.length] ?? '').slice(0, 48), x, y);
  }
  g.restore();
  const fs = Math.max(13, H * 0.019);
  // the normal line, emerald, along the bottom
  const nIn = ramp(st, 0.4, 1.2);
  if (nIn > 0) {
    g.save();
    g.globalAlpha = nIn;
    const y = H * 0.84;
    g.font = `500 ${fs * 0.85}px ${MONO}`;
    const line = FACTS.normalLine.length > 140 ? `${FACTS.normalLine.slice(0, 137)}…` : FACTS.normalLine;
    const w = Math.min(W * 0.92, g.measureText(line).width + fs * 2);
    g.fillStyle = 'rgba(2, 20, 12, 0.85)';
    g.strokeStyle = EMERALD;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(W / 2 - w / 2, y - fs * 1.2, w, fs * 2.4, 8);
    g.fill();
    g.stroke();
    g.fillStyle = '#d8ffe9';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(line, W / 2, y, W * 0.9);
    g.restore();
    label(g, 'NORMAL · ONE QUIET CUSTOMER', W / 2, H * 0.84 - fs * 1.9, fs * 0.85, EMERALD, 'center', SANS, 800);
    hot.push({ id: 'normal', x: W / 2 - w / 2, y: y - fs * 1.2, w, h: fs * 2.4, title: 'A normal access log line', body: FACTS.normalPieces.map((p) => `${p.label}: ${p.text}`).join(' · '), tone: 'emerald' });
  }
  // the suspicious ones, crimson, arriving as Kiro names them, and his scanner closing round each
  const spots = [
    { x: 0.27, y: 0.24 },
    { x: 0.73, y: 0.24 },
    { x: 0.25, y: 0.58 },
    { x: 0.75, y: 0.58 },
  ];
  SUSPICIOUS.forEach((s, i) => {
    const at = 2.2 + i * 0.95;
    const k = ramp(st, at, at + 0.6);
    if (k <= 0) return;
    const p = spots[i]!;
    const x = cx + (W * p.x - cx) * k;
    const y = cy + (H * p.y - cy) * k;
    g.save();
    g.globalAlpha = k;
    g.font = `700 ${fs}px ${MONO}`;
    const w = g.measureText(s.text).width + fs * 2;
    const h = fs * 2.6;
    g.fillStyle = 'rgba(30, 2, 8, 0.88)';
    g.strokeStyle = CRIMSON;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(x - w / 2, y - h / 2, w, h, 8);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffd6dc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s.text, x, y);
    g.restore();
    label(g, s.signal.toUpperCase(), x, y - h * 0.85, fs * 0.8, CRIMSON, 'center', SANS, 800);
    // Kiro's scanner: cyan brackets tightening round it
    const scan = ramp(st, at + 0.4, at + 1.0);
    if (scan > 0) {
      const m = (1 - scan) * fs * 2 + fs * 0.4;
      g.strokeStyle = rgba(CYAN, 0.9);
      g.lineWidth = 2.5;
      const L = fs * 1.2;
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        const ex = x + sx * (w / 2 + m);
        const ey = y + sy * (h / 2 + m);
        g.beginPath();
        g.moveTo(ex - sx * L, ey);
        g.lineTo(ex, ey);
        g.lineTo(ex, ey - sy * L);
        g.stroke();
      }
    }
    const ev = EVIDENCE.find((e) => e.signal === s.signal);
    hot.push({ id: `ev-${i}`, x: x - w / 2, y: y - h / 2, w, h, title: `Worth a look: ${s.signal}`, body: ev ? `Normal: ${ev.normal} · Worth a look: ${ev.watch}` : s.text, tone: 'crimson' });
  });
  label(g, FACTS.logs.map((l) => l.path).join('   ·   '), W / 2, H * 0.06, Math.max(11, H * 0.015), 'rgba(200, 230, 255, 0.7)', 'center', MONO, 500);
}

// ------------------------------------------------------------------ 6. the unknown admin

function admin(f: Frame): void {
  const { g, W, H, st, t, hot } = f;
  const room = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.7);
  room.addColorStop(0, '#0d1220');
  room.addColorStop(1, '#020308');
  g.fillStyle = room;
  g.fillRect(0, 0, W, H);
  const fs = Math.max(11, H * 0.0145);
  // the eight records on the list, lit emerald, either side of the empty middle
  const cw = W * 0.17;
  const ch = H * 0.12;
  FACTS.admins.forEach((a, i) => {
    const col = i < 4 ? 0 : 1;
    const row = i % 4;
    const x = (col === 0 ? W * 0.05 : W * 0.78) + f.mx * W * 0.01;
    const y = H * 0.14 + row * (ch + H * 0.03) + f.my * H * 0.01;
    const k = ramp(st, 0.1 + i * 0.12, 0.6 + i * 0.12);
    if (k <= 0) return;
    g.save();
    g.globalAlpha = k * (st > 2.2 ? 0.55 : 1);
    g.fillStyle = 'rgba(6, 20, 16, 0.9)';
    g.strokeStyle = rgba(EMERALD, 0.7);
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(x, y, cw, ch, 8);
    g.fill();
    g.stroke();
    g.fillStyle = rgba(EMERALD, 0.25);
    g.beginPath();
    g.arc(x + ch * 0.4, y + ch * 0.45, ch * 0.24, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e6fff2';
    g.font = `700 ${fs}px ${MONO}`;
    g.fillText(a.email.length > 26 ? `${a.email.slice(0, 25)}…` : a.email, x + ch * 0.78, y + ch * 0.34, cw - ch * 0.85);
    g.font = `500 ${fs * 0.92}px ${SANS}`;
    g.fillStyle = 'rgba(220, 255, 236, 0.75)';
    g.fillText(a.who, x + ch * 0.78, y + ch * 0.6, cw - ch * 0.85);
    g.fillStyle = EMERALD;
    g.font = `800 ${fs * 0.85}px ${SANS}`;
    g.fillText('✓ ON THE LIST', x + ch * 0.78, y + ch * 0.84);
    g.restore();
    hot.push({ id: `admin-${i}`, x, y, w: cw, h: ch, title: a.email, body: `${a.who} · on the list of admins`, tone: 'emerald' });
  });
  // the one that isn't: out of the dark in the middle, flickering, its picture torn
  const k = ramp(st, 2.0, 2.9);
  if (k > 0) {
    const w = W * 0.3;
    const h = H * 0.34;
    const x = W / 2 - w / 2;
    const y = H * 0.24;
    const jitter = f.reduced ? 0 : (rand(Math.floor(t * 9)) < 0.3 ? (rand(t) - 0.5) * 10 : 0);
    g.save();
    g.globalAlpha = k;
    g.translate(jitter, 0);
    g.fillStyle = 'rgba(28, 4, 10, 0.94)';
    g.strokeStyle = CRIMSON;
    g.lineWidth = 2.5;
    g.beginPath();
    g.roundRect(x, y, w, h, 10);
    g.fill();
    g.stroke();
    // the photograph: a face that won't hold still
    const px = x + w * 0.08;
    const py = y + h * 0.14;
    const pw = w * 0.32;
    const ph = h * 0.6;
    g.fillStyle = '#12060a';
    g.fillRect(px, py, pw, ph);
    for (let b = 0; b < 10; b++) {
      const off = f.reduced ? 0 : (rand(b + Math.floor(t * 6)) - 0.5) * pw * 0.3;
      g.fillStyle = `rgba(${120 + b * 8}, ${20 + b * 3}, ${40 + b * 5}, 0.55)`;
      g.fillRect(px + off, py + (b / 10) * ph, pw, ph / 10 - 1);
    }
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(px + pw / 2, py + ph * 0.42, pw * 0.26, ph * 0.3, 0, 0, Math.PI * 2);
    g.fill();
    glow(g, px + pw * 0.42, py + ph * 0.4, pw * 0.08, rgba(CRIMSON, 1), 0.9);
    glow(g, px + pw * 0.58, py + ph * 0.4, pw * 0.08, rgba(VIOLET, 1), 0.9);
    // the fields: no name, admin, not on the list
    const tx = x + w * 0.46;
    g.font = `700 ${fs * 1.2}px ${MONO}`;
    g.fillStyle = '#ffd6dc';
    g.fillText('████████@????', tx, y + h * 0.24);
    g.font = `600 ${fs * 1.1}px ${SANS}`;
    g.fillText('ROLE: ADMIN', tx, y + h * 0.4);
    g.fillStyle = CRIMSON;
    g.font = `800 ${fs * 1.1}px ${SANS}`;
    g.fillText('✗ NOT ON THE LIST', tx, y + h * 0.56);
    g.restore();
    hot.push({ id: 'unknown', x, y, w, h, title: 'An admin nobody created', body: FACTS.rule, tone: 'crimson' });
    // UNAUTHORIZED, stamped across it
    const stamp = ramp(st, 3.0, 3.3);
    if (stamp > 0) {
      g.save();
      g.translate(W / 2, y + h * 0.78);
      g.rotate(-0.16);
      const sc = f.reduced ? 1 : 1 + (1 - stamp) * 0.6;
      g.scale(sc, sc);
      g.globalAlpha = stamp;
      g.strokeStyle = CRIMSON;
      g.lineWidth = 4;
      g.font = `900 ${H * 0.05}px ${SANS}`;
      const sw = g.measureText('UNAUTHORIZED').width + H * 0.04;
      g.strokeRect(-sw / 2, -H * 0.04, sw, H * 0.08);
      g.fillStyle = CRIMSON;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('UNAUTHORIZED', 0, 0);
      g.restore();
    }
  }
  // a shadowed hand reaching for the vault
  const reach = ramp(st, 3.4, 6.2);
  if (reach > 0) {
    const vx = W * 0.6;
    const vy = H * 0.8;
    g.strokeStyle = rgba(CYAN, 0.6);
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(vx, vy, W * 0.05, H * 0.025, 0, 0, Math.PI * 2);
    g.stroke();
    label(g, 'DATABASE', vx, vy + H * 0.05, fs, rgba(CYAN, 0.9), 'center', SANS, 800);
    const hx = W * 0.95 - (W * 0.95 - vx - W * 0.04) * reach;
    const hy = H * 1.02 - (H * 1.02 - vy + H * 0.02) * reach;
    g.strokeStyle = '#000';
    g.lineCap = 'round';
    g.lineWidth = H * 0.05;
    g.beginPath();
    g.moveTo(W * 1.05, H * 1.1);
    g.lineTo(hx, hy);
    g.stroke();
    g.lineWidth = H * 0.012;
    for (let fi = 0; fi < 4; fi++) {
      g.beginPath();
      g.moveTo(hx, hy);
      g.lineTo(hx - H * (0.06 + fi * 0.008), hy - H * (0.03 - fi * 0.02));
      g.stroke();
    }
  }
  // Kiro at the edge, alarmed as the hand reaches for the vault
  drawGhost(g, W * 0.12, H * 0.76, H * 0.3, { t, talk: f.talk, look: 0.6, wander: 0, mood: st > 3 ? 'alarm' : 'concern', reduce: f.reduced }, f.dpr);
  // evidence first, in the playbook's words
  if (st > 3.8) chip(g, (QUIZ[1]?.reveal ?? '').split('. ')[0]?.toUpperCase() ?? '', W / 2, H * 0.68, Math.max(12, H * 0.018), AMBER, 'rgba(24, 14, 2, 0.88)', 'center');
}

// ------------------------------------------------------------------ 7. Death

/** Which playbook step each word Kiro says lights, by the seconds into the shot. */
const STEP_CUES: ReadonlyArray<[number, number]> = [
  [0.35, 1],
  [1.0, 2],
  [1.7, 3],
  [2.5, 4],
];

function death(f: Frame): void {
  const { g, W, H, st, t } = f;
  g.fillStyle = '#030208';
  g.fillRect(0, 0, W, H);
  // a dark pane of glass behind Kiro, the shop's last neon smeared in it
  const pane = g.createLinearGradient(0, 0, W, H);
  pane.addColorStop(0, '#0b0a16');
  pane.addColorStop(0.5, '#120a1a');
  pane.addColorStop(1, '#05040a');
  g.fillStyle = pane;
  g.fillRect(W * 0.06, H * 0.05, W * 0.88, H * 0.78);
  glow(g, W * 0.75, H * 0.15, W * 0.25, 'rgba(255, 110, 60, 0.15)', flicker(t, 3.3, f.reduced));
  // Death, in the reflection behind him: she comes out of the glass
  const form = ramp(st, 0.3, 1.8);
  const point = ramp(st, 2.2, 4.0);
  g.save();
  g.beginPath();
  g.rect(W * 0.06, H * 0.05, W * 0.88, H * 0.78);
  g.clip();
  drawDeath(g, W * 0.4 + f.mx * W * 0.015, H * 0.98, H * 0.95, { t, form: form * 0.92, point, fragment: 0.25 + 0.5 * ramp(st, 3, 5.6), eyes: 0.5 + 0.5 * point }, f.dpr);
  g.restore();
  // the glass's own sheen over her
  const sheen = g.createLinearGradient(W * 0.06, 0, W * 0.94, 0);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
  sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
  g.fillStyle = sheen;
  g.fillRect(W * 0.06, H * 0.05, W * 0.88, H * 0.78);
  // Kiro in front, sensing Death behind her, turning, frightened
  const turn = ramp(st, 1.6, 2.6);
  drawGhost(g, W * 0.76 + f.mx * W * 0.03, H * 0.52, H * 0.46, { t, talk: f.talk, look: -turn, wander: 0, mood: turn > 0.5 ? 'alarm' : 'concern', glitch: !f.reduced && st > 4 ? 0.15 : 0, reduce: f.reduced }, f.dpr);
  // the scene begins to corrupt
  corrupt(g, W, H, t, ramp(st, 2.8, 6) * 0.75, f.reduced);
  // the six steps along the bottom, each lit as he names it; legal's deadline beside them
  const fs = Math.max(11, H * 0.015);
  let lit = -1;
  for (const [at, step] of STEP_CUES) if (st >= at) lit = step;
  const y = H * 0.9;
  const n = FACTS.steps.length;
  FACTS.steps.forEach((s, i) => {
    const x = W * (0.1 + (0.8 * (i + 0.5)) / n);
    const on = i === lit || (lit >= 0 && i < lit && i > 0);
    const tone = i === lit ? CYAN : on ? rgba(CYAN, 0.55) : 'rgba(220, 230, 255, 0.35)';
    chip(g, `${i + 1} ${s.toUpperCase()}`, x, y, fs, tone, 'rgba(4, 6, 14, 0.85)', 'center');
  });
  if (st > 3.0) chip(g, `DATA TAKEN? TELL LEGAL AS SOON AS YOU'RE SURE · ${FACTS.hours ?? 72}-HOUR DEADLINE`, W / 2, H * 0.96, fs * 0.95, AMBER, 'rgba(24, 14, 2, 0.88)', 'center');
}

// ------------------------------------------------------------------ 8. the blackout

function blackout(f: Frame): void {
  const { g, W, H, st } = f;
  // the camera pulls away from the shop, and its lights fail
  const z = 1.3 - 0.45 * ease(st / 1.4);
  streetLife(f, Math.max(0.85, z), 0, 0);
  const dark = ramp(st, 0.8, 2.0);
  g.fillStyle = `rgba(0, 0, 0, ${dark.toFixed(3)})`;
  g.fillRect(0, 0, W, H);
  // Death's eyes stay a moment in the dark window; then Kiro's, beside us
  const b = shopBox(W, H);
  const de = ramp(st, 1.8, 2.2) * (1 - ramp(st, 3.0, 3.5));
  if (de > 0) {
    const ex = (b.win.x0 + b.win.x1) / 2;
    const ey = b.win.y0 + (b.win.y1 - b.win.y0) * 0.35;
    glow(g, ex - W * 0.01, ey, H * 0.02, rgba(VIOLET, 1), de);
    glow(g, ex + W * 0.01, ey, H * 0.02, rgba(CRIMSON, 1), de);
  }
  const ke = ramp(st, 2.6, 3.0) * (1 - ramp(st, 3.6, 4));
  if (ke > 0) drawGhost(g, W * 0.14, H * 0.52, H * 0.2, { t: f.t, mood: 'calm', look: 0.4, wander: 0, alpha: ke * 0.85, reduce: f.reduced }, f.dpr);
}

const PAINT: Record<ShotId, (f: Frame) => void> = { street, kiro, map: tacticalMap, gate, logs, admin, death, blackout };

/** Paint a shot's moment. */
export function paintShot(id: ShotId, f: Frame): void {
  PAINT[id](f);
}

export { TONE };

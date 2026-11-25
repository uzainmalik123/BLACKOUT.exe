// Screen 3's scene (UI-03, D-184): the cabin in the woods (cabin.ts), drawn in characters from a still camera and
// lit like a flash photograph: the cabin and the ground in front of it are lit, the forest behind falls off into
// black. The picture is composed once per window size, back to front (night, forest floor, thin trunks, the
// cabin's wall, door, graffiti and roof, the pale trunk, the chairs, the bottles); every refresh copies it and adds
// what moves: the eyes in the doorway (they blink, shift, and sometimes go and come back) and dust drifting through
// the flash. Their glow is on an overlay. Nothing walks, bobs or glitches. A 70-step ramp turns light into
// characters, and each cell is also tinted with its own colour (GridPainter's backdrop), so lit wood reads as wood.
// Start the night shift lets the light die until only the eyes are left, then hands over.

import { codes, strokeChar } from '../shared/atlas';
import { GridPainter } from '../shared/gridPainter';
import { clamp, hash2, mulberry32, smoothstep } from '../shared/math';
import { NoiseField } from '../screen2-menu/field';
import { buildCabin, roofLine, type Cabin } from './cabin';
import { drawBottle, drawChair, drawHead, drawWisps } from './props';

export interface CabinSceneOptions {
  reducedMotion: boolean;
  /** The closing (Start the night shift) has finished. */
  onClosed: () => void;
}

const T_DARK = 0;
const T_WOOD = 1;
const T_PAINT = 2;
const T_GROUND = 3;
const T_NEEDLE = 4;
const T_BARK = 5;
const T_MOSS = 6;
const T_LABEL = 9;
const T_EYE = 13;
const T_ROOF = 14;
const TONES = 15;
const STEPS = 16;
const TINT: readonly (readonly [number, number, number])[] = [
  [0.66, 0.7, 0.86], // night
  [1.0, 0.88, 0.72], // weathered wood
  [0.56, 0.55, 0.6], // spray paint
  [0.98, 0.8, 0.6], // earth
  [1.12, 0.68, 0.4], // needles
  [0.94, 0.96, 0.9], // pale bark, lichen
  [0.62, 0.92, 0.48], // moss
  [0.42, 1.06, 0.56], // green glass
  [1.16, 0.72, 0.36], // brown glass
  [1.06, 1.0, 0.88], // labels, dust
  [0.66, 0.8, 0.56], // green chair
  [1.06, 0.86, 0.68], // tan chair
  [0.86, 0.9, 0.98], // metal
  [1.25, 1.14, 0.84], // the eyes
  [0.8, 0.78, 0.74], // roof
];
function color(tone: number, q: number): string {
  const v = 10 + q * 15.6;
  const [r, g, b] = TINT[tone] ?? TINT[0]!;
  return `rgb(${Math.round(Math.min(255, v * r))},${Math.round(Math.min(255, v * g))},${Math.round(Math.min(255, v * b))})`;
}

const RAMP = codes(" .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$");
const NEEDLES = codes(",'`.-~,'");
const LICHEN = codes('%&@o8');
const C_BAR = 124; // |
const C_UNDER = 95; // _
const C_EQ = 61; // =
const C_DOT = 46; // .
const C_TICK = 39; // '
const C_O = 111; // o
const GRID_HZ = 20;

type Phase = 'live' | 'closing' | 'closed';

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
}

export class CabinScene {
  private readonly painter: GridPainter;
  private readonly fxc: CanvasRenderingContext2D;
  private readonly grain = new NoiseField(256, 256, 0x7c1, 4);
  private readonly rnd = mulberry32(0xcab1);
  private cabin: Cabin = buildCabin(16 / 9);
  private baseL = new Float32Array(0);
  private baseC = new Uint16Array(0);
  private baseT = new Uint8Array(0);
  private W = 0;
  private H = 0;
  /** One column and one row, in units of the screen's height. */
  private cu = 0.01;
  private ru = 0.01;
  private t = 0;
  private last = 0;
  private raf = 0;
  private alive = true;
  private acc = 1;
  private phase: Phase = 'live';
  private phaseT = 0;
  private closeAt = 0;
  /** When the first frame ran, real milliseconds: the opening flash is timed from it, so slow first frames don't stretch it. */
  private born = -1;
  private real = 0;
  private bright = 0;
  private flash = 0;
  private dpr = 1;
  /** The graffiti, painted once per window size at screen resolution, laid over the scene on the overlay. */
  private spray: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null = null;
  /** The chairs, the bottles and the head (D-187), painted once per window size, laid over the scene. */
  private props: HTMLCanvasElement | null = null;
  private motes: Mote[] = [];
  /** The eyes: where they are now and where they drift to, when they next blink, and when they are gone. */
  private eyes = { x: 0, y: 0, tx: 0, ty: 0, nextMove: 9, nextBlink: 3, blinkAt: -1, nextGone: 22, goneUntil: -1, seen: 1 };

  constructor(
    canvas: HTMLCanvasElement,
    private readonly fx: HTMLCanvasElement,
    private readonly opts: CabinSceneOptions,
  ) {
    const fxc = fx.getContext('2d');
    if (!fxc) throw new Error('2D canvas unavailable');
    this.fxc = fxc;
    this.painter = new GridPainter(canvas, { tones: TONES, steps: STEPS, color }, RAMP, 0.86);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Start the night shift: the light dies until only the eyes are left, then `onClosed`. */
  close(): void {
    if (this.phase !== 'live') return;
    this.phase = 'closing';
    this.phaseT = 0;
    this.closeAt = performance.now();
  }

  destroy(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    const W = Math.max(320, window.innerWidth);
    const H = Math.max(320, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.W = W;
    this.H = H;
    const ch = clamp(H / 118, 7, 11);
    this.painter.resize(W, H, ch * 0.56, ch, dpr);
    this.fx.width = Math.floor(W * dpr);
    this.fx.height = Math.floor(H * dpr);
    this.fx.style.width = `${W}px`;
    this.fx.style.height = `${H}px`;
    this.fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cu = this.painter.cw / H;
    this.ru = this.painter.ch / H;
    this.cabin = buildCabin(W / H);
    const e = this.cabin.eyes;
    this.eyes.x = this.eyes.tx = e.x;
    this.eyes.y = this.eyes.ty = e.y;
    this.motes = [];
    for (let k = 0; k < 34; k++)
      this.motes.push({
        x: this.cabin.centre + (this.rnd() - 0.5) * 1.1,
        y: 0.15 + this.rnd() * 0.8,
        vx: (this.rnd() - 0.5) * 0.008,
        vy: 0.004 + this.rnd() * 0.01,
        ph: this.rnd() * 6.28,
      });
    this.compose();
    this.acc = 1;
  }

  // ------------------------------------------------------------------ loop

  private readonly frame = (now: number): void => {
    if (!this.alive) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.born < 0) this.born = now;
    this.real = (now - this.born) / 1000;
    if (this.phase !== 'live') this.phaseT = (now - this.closeAt) / 1000;
    this.update(dt);
    this.acc += dt;
    if (this.acc >= 1 / GRID_HZ) {
      this.acc = 0;
      this.paintFrame();
      this.painter.draw(null);
    }
    this.drawFx();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    this.t += dt;
    const t = this.t;
    const rm = this.opts.reducedMotion;
    const r = () => this.rnd();
    const c = this.cabin;

    // the opening: a camera flash goes off, and the picture is there
    const rt = this.real;
    this.flash = rm || rt <= 0.2 ? 0 : Math.max(0, 1 - (rt - 0.2) / 0.55);
    let b = rm ? smoothstep(0, 0.8, rt) : rt > 0.2 ? 1 : 0;
    if (this.phase === 'closing') {
      b *= 1 - smoothstep(0.1, 1.4, this.phaseT);
      if (this.phaseT >= 2.4) {
        this.phase = 'closed';
        this.opts.onClosed();
      }
    } else if (this.phase === 'closed') b = 0;
    this.bright = b;

    // the eyes: a blink now and then, a slow drift to somewhere else in the doorway, and sometimes they are gone
    const e = this.eyes;
    if (!rm && this.phase === 'live') {
      if (t >= e.nextBlink) {
        e.blinkAt = t;
        e.nextBlink = t + 2.5 + r() * 4;
      }
      if (t >= e.nextMove) {
        e.tx = c.eyes.x + (r() - 0.5) * (c.door.x1 - c.door.x0 - 0.06);
        e.ty = c.eyes.y + (r() - 0.3) * 0.06;
        e.nextMove = t + 7 + r() * 8;
      }
      if (t >= e.nextGone) {
        e.goneUntil = t + 2.5 + r() * 2.5;
        e.nextGone = t + 20 + r() * 18;
        // they come back somewhere else
        e.x = e.tx = c.eyes.x + (r() - 0.5) * (c.door.x1 - c.door.x0 - 0.06);
        e.y = e.ty = c.eyes.y + (r() - 0.3) * 0.06;
      }
    }
    const ease = 1 - Math.exp(-dt * 0.9);
    e.x += (e.tx - e.x) * ease;
    e.y += (e.ty - e.y) * ease;
    const blinking = e.blinkAt >= 0 && t - e.blinkAt < 0.16;
    const gone = t < e.goneUntil;
    // closing: they stay after the light has gone, then blink out
    e.seen = this.phase === 'live' ? (blinking || gone ? 0 : 1) : this.phaseT < 2.0 ? 1 : 0;

    // dust drifting through the flash
    if (!rm)
      for (const m of this.motes) {
        m.x += (m.vx + 0.003 * Math.sin(t * 0.7 + m.ph)) * dt;
        m.y += m.vy * dt;
        if (m.y > 1) {
          m.y = 0.12;
          m.x = c.centre + (r() - 0.5) * 1.1;
        }
      }
  }

  private paintFrame(): void {
    const { cols, rows, lum, code, tone } = this.painter;
    lum.set(this.baseL);
    code.set(this.baseC);
    tone.set(this.baseT);
    const b = this.bright;
    if (b < 0.999) for (let k = 0; k < lum.length; k++) lum[k] = lum[k]! * b;

    if (b > 0.05)
      for (const m of this.motes) {
        const i = Math.floor(m.x / this.cu);
        const j = Math.floor(m.y / this.ru);
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        const k = j * cols + i;
        const tw = 0.5 + 0.5 * Math.sin(this.t * 2.3 + m.ph);
        // a mote only shows where it is darker than itself
        const L = (0.28 + 0.3 * tw) * b;
        if (lum[k]! < L * 0.8) {
          lum[k] = L;
          tone[k] = T_LABEL;
          code[k] = tw > 0.6 ? C_TICK : C_DOT;
        }
      }

    const e = this.eyes;
    if (e.seen > 0)
      for (const s of [-1, 1]) {
        // each eye two cells wide, so it reads as a glint and not a speck
        const i = Math.floor((e.x + (s * this.cabin.eyes.gap) / 2) / this.cu);
        const j = Math.floor(e.y / this.ru);
        for (const di of [0, 1]) {
          if (i + di < 0 || j < 0 || i + di >= cols || j >= rows) continue;
          const k = j * cols + i + di;
          lum[k] = 1;
          tone[k] = T_EYE;
          code[k] = C_O;
        }
      }
  }

  private drawFx(): void {
    const g = this.fxc;
    g.clearRect(0, 0, this.W, this.H);
    if (this.bright > 0.01) {
      g.globalAlpha = Math.min(1, this.bright);
      if (this.props) g.drawImage(this.props, 0, 0, this.W, this.H);
      const hd = this.cabin.head;
      if (!this.opts.reducedMotion) drawWisps(g, hd.x * this.H, hd.y * this.H, hd.r * this.H, this.t, 1);
      if (this.spray) g.drawImage(this.spray.canvas, this.spray.x, this.spray.y, this.spray.w, this.spray.h);
      g.globalAlpha = 1;
    }
    const e = this.eyes;
    if (e.seen > 0) {
      g.globalCompositeOperation = 'lighter';
      const r = this.H * 0.016;
      for (const s of [-1, 1]) {
        const cx = (Math.floor((e.x + (s * this.cabin.eyes.gap) / 2) / this.cu) + 1) * this.cu * this.H;
        const cy = (Math.floor(e.y / this.ru) + 0.5) * this.ru * this.H;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, 'rgba(255,246,214,0.75)');
        gr.addColorStop(0.35, 'rgba(255,226,170,0.25)');
        gr.addColorStop(1, 'rgba(255,210,150,0)');
        g.fillStyle = gr;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      g.globalCompositeOperation = 'source-over';
    }
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,252,244,${(this.flash * 0.85).toFixed(3)})`;
      g.fillRect(0, 0, this.W, this.H);
    }
  }

  // ------------------------------------------------------------------ the still picture

  /** Compose the whole still picture into the base buffers, back to front. */
  private compose(): void {
    const { cols, rows } = this.painter;
    const n = cols * rows;
    this.baseL = new Float32Array(n);
    this.baseC = new Uint16Array(n);
    this.baseT = new Uint8Array(n);
    this.night();
    this.floor();
    for (const tr of this.cabin.trunks) this.trunk(tr.x, tr.w, tr.depth);
    this.house();
    this.graffiti();
    this.roof();
    this.paleTree();
    this.paintProps();
  }

  /** The flash: strongest in the middle of the picture, falling off toward the edges and the top. */
  private lit(X: number, Y: number): number {
    const dx = X - this.cabin.centre;
    const dy = Y - 0.64;
    return 0.42 + 0.58 * Math.exp(-(dx * dx * 1.1 + dy * dy * 2.2));
  }

  private set(i: number, j: number, L: number, tn: number, c = 0): void {
    const { cols, rows } = this.painter;
    if (i < 0 || j < 0 || i >= cols || j >= rows) return;
    const k = j * cols + i;
    this.baseL[k] = clamp(L);
    this.baseT[k] = tn;
    this.baseC[k] = c;
  }

  /** Every cell whose centre lies in the box, with its centre in screen-height units. */
  private each(x0: number, x1: number, y0: number, y1: number, fn: (i: number, j: number, X: number, Y: number) => void): void {
    const { cols, rows } = this.painter;
    const i0 = Math.max(0, Math.floor(x0 / this.cu));
    const i1 = Math.min(cols - 1, Math.ceil(x1 / this.cu));
    const j0 = Math.max(0, Math.floor(y0 / this.ru));
    const j1 = Math.min(rows - 1, Math.ceil(y1 / this.ru));
    for (let j = j0; j <= j1; j++) {
      const Y = (j + 0.5) * this.ru;
      if (Y < y0 || Y > y1) continue;
      for (let i = i0; i <= i1; i++) {
        const X = (i + 0.5) * this.cu;
        if (X < x0 || X > x1) continue;
        fn(i, j, X, Y);
      }
    }
  }

  private night(): void {
    const { cols, rows } = this.painter;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const X = (i + 0.5) * this.cu;
        const Y = (j + 0.5) * this.ru;
        const n = this.grain.sample(X * 30, Y * 30);
        this.set(i, j, 0.012 + 0.02 * n * this.lit(X, Y), T_DARK);
      }
  }

  /** The forest floor: earth and fallen needles, lit more the nearer it is. */
  private floor(): void {
    const c = this.cabin;
    this.each(0, c.aspect, c.horizon, 1, (i, j, X, Y) => {
      const near = smoothstep(c.horizon, 1.02, Y);
      const n = this.grain.sample(X * 70, Y * 90);
      const h = hash2(i, j, 31);
      let L = (0.05 + 0.5 * Math.pow(near, 1.1)) * this.lit(X, Y) * (0.62 + 0.55 * n);
      let tn = h < 0.32 ? T_NEEDLE : T_GROUND;
      let ch = NEEDLES[Math.floor(hash2(i, j, 32) * NEEDLES.length)]!;
      if (h > 0.93) {
        // a twig
        ch = strokeChar(hash2(i, j, 33) * Math.PI);
        L *= 1.25;
        tn = T_GROUND;
      }
      // the shadow along the foot of the cabin, and under the chairs
      if (Y > c.wall.y1 && Y < c.wall.y1 + 0.02 && X > c.wall.x0 - 0.02 && X < c.wall.x1 + 0.08) L *= 0.45;
      for (const chair of c.chairs) {
        const dx = (X - chair.x) / (chair.h * 0.55);
        const dy = (Y - chair.ground - 0.004) / 0.018;
        if (dx * dx + dy * dy < 1) L *= 0.45;
      }
      this.set(i, j, L, tn, L < 0.09 ? 0 : ch);
    });
  }

  /** A thin, straight trunk in the dark, from above the picture down to where it stands. */
  private trunk(x: number, w: number, depth: number): void {
    const c = this.cabin;
    const foot = c.horizon + (1 - depth) * 0.1;
    const base = 0.05 + 0.26 * Math.pow(1 - depth, 1.4);
    this.each(x - w / 2, x + w / 2, 0, foot, (i, j, X, Y) => {
      const s = (X - x) / (w / 2);
      const round = Math.sqrt(Math.max(0, 1 - s * s));
      const n = this.grain.sample(X * 160 + depth * 50, Y * 14);
      const L = base * this.lit(X, Y) * (0.45 + 0.55 * round) * (0.7 + 0.5 * n) * (0.65 + 0.35 * (Y / foot));
      const ch = Math.abs(s) > 0.7 ? C_BAR : hash2(i, j, 41) < 0.5 ? 108 : 58; // | l :
      this.set(i, j, L, depth < 0.5 ? T_BARK : T_DARK, L < 0.06 ? 0 : ch);
    });
  }

  /** The front wall: horizontal planks with dark gaps, corner posts, the door, and a darker annex on the right. */
  private house(): void {
    const c = this.cabin;
    const { wall, door } = c;
    // the annex beyond the right corner, in shadow
    this.each(wall.x1, wall.x1 + 0.075, wall.y0 + 0.05, wall.y1, (i, j, X, Y) => {
      const f = ((Y - wall.y0) / 0.032) % 1;
      const L = 0.2 * this.lit(X, Y) * (f > 0.82 ? 0.4 : 0.8 + 0.4 * this.grain.sample(X * 50, Y * 60));
      this.set(i, j, L, T_WOOD, f > 0.82 ? C_UNDER : 0);
    });
    this.each(wall.x1, wall.x1 + 0.09, wall.y0 + 0.03, wall.y0 + 0.055, (i, j, X, Y) => this.set(i, j, 0.22 * this.lit(X, Y), T_ROOF, C_EQ));

    const plank = 0.031;
    this.each(wall.x0, wall.x1, wall.y0, wall.y1, (i, j, X, Y) => {
      const p = (Y - wall.y0) / plank;
      const row = Math.floor(p);
      const f = p - row;
      const grainV = this.grain.sample(X * 26 + row * 17.3, row * 5.1);
      const fine = this.grain.sample(X * 140, Y * 40 + row * 3);
      // rain has run down the boards in streaks
      const streak = 0.78 + 0.3 * this.grain.sample(X * 90, 3.7);
      let L = 0.56 * this.lit(X, Y) * (0.72 + 0.4 * grainV) * (0.85 + 0.25 * fine) * streak;
      let ch = 0;
      if (f > 0.84) {
        L *= 0.32;
        ch = C_UNDER;
      } else if (f < 0.12) L *= 1.12;
      // the corner posts
      if (X - wall.x0 < 0.022 || wall.x1 - X < 0.022) {
        L = 0.5 * this.lit(X, Y) * (0.85 + 0.3 * fine);
        ch = C_BAR;
      }
      this.set(i, j, L, T_WOOD, ch);
    });

    // the doorway: a frame of boards around a black opening
    const frame = 0.014;
    this.each(door.x0 - frame, door.x1 + frame, door.y0 - frame, door.y1, (i, j, X, Y) => {
      const inside = X > door.x0 && X < door.x1 && Y > door.y0;
      if (inside) {
        // the dark inside, barely anything: a hint of a floor at the threshold
        const L = Y > door.y1 - 0.012 ? 0.36 * this.lit(X, Y) : 0.004;
        this.set(i, j, L, Y > door.y1 - 0.012 ? T_WOOD : T_DARK, Y > door.y1 - 0.012 ? C_EQ : 0);
        return;
      }
      const L = 0.6 * this.lit(X, Y) * (0.85 + 0.25 * this.grain.sample(X * 120, Y * 30));
      this.set(i, j, L, T_WOOD, Y < door.y0 ? C_EQ : C_BAR);
    });
  }

  /**
   * "DO YOU WANT A HUG? COME IN", sprayed in black left of the door. Sampled into character cells the letters were
   * too coarse to read ("HUG?" looked like "HUG7"), so the paint is drawn at full screen resolution instead: a heavy
   * typeface with a soft overspray edge, worn in specks, and paint running down from a few strokes (long under the
   * last line, short above, never into the line below). It is prepared once per window size and laid over the scene
   * on the overlay each frame. Under the words, the dark seams between the boards are lightened so they don't cut
   * through the letters.
   */
  private graffiti(): void {
    const c = this.cabin;
    const { cols, rows, cw, ch } = this.painter;
    const H = this.H;
    const x0 = c.graffiti.x * H;
    const y0 = c.graffiti.y * H;
    const x1 = (c.door.x0 - 0.025) * H;
    const y1 = (c.wall.y1 - 0.045) * H;
    this.spray = null;
    // lighten the board seams behind the words
    const i0 = Math.max(0, Math.floor(x0 / cw));
    const i1 = Math.min(cols - 1, Math.ceil(x1 / cw));
    const j0 = Math.max(0, Math.floor(y0 / ch));
    const j1 = Math.min(rows - 1, Math.ceil(y1 / ch));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        if (this.baseC[k] === C_UNDER) this.baseL[k] = this.baseL[k]! * 2.1;
      }
    const w = Math.ceil(x1 - x0);
    const h = Math.ceil(y1 - y0);
    if (w < 20 || h < 20 || typeof document === 'undefined') return;
    const dpr = this.dpr;
    const pad = 8;
    const lines = c.graffiti.lines;
    const lineH = h / lines.length;
    const off = document.createElement('canvas');
    off.width = Math.ceil((w + pad * 2) * dpr);
    off.height = Math.ceil((h + pad * 2 + lineH * 0.6) * dpr);
    const g = off.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr);
    g.textBaseline = 'middle';
    g.fillStyle = '#0c0a0d';
    // a soft overspray round every stroke
    g.shadowColor = 'rgba(10, 8, 12, 0.55)';
    g.shadowBlur = 5 * dpr;
    const size = lineH * 0.98;
    lines.forEach((line, l) => {
      g.font = `900 ${size}px "Arial Black", "Segoe UI Black", Impact, "Helvetica Neue", sans-serif`;
      const tw = g.measureText(line).width;
      const indent = [0.03, 0, 0.05, 0][l] ?? 0;
      const sx = Math.min(1, (w * (1 - indent)) / tw);
      g.save();
      g.translate(w * indent, lineH * (l + 0.5));
      g.rotate([-0.012, 0.008, 0, 0.01][l] ?? 0);
      g.scale(sx, 1);
      g.fillText(line, 0, 0);
      g.restore();
    });
    g.shadowBlur = 0;
    // paint running from the feet of a few strokes: find the strokes along each line's foot, let some of them run
    const img = g.getImageData(0, 0, off.width, off.height);
    const alpha = (x: number, y: number) => {
      const px = Math.round((x + pad) * dpr);
      const py = Math.round((y + pad) * dpr);
      if (px < 0 || py < 0 || px >= off.width || py >= off.height) return 0;
      return img.data[(py * off.width + px) * 4 + 3]!;
    };
    const rnd = mulberry32(0xd21b);
    lines.forEach((_, l) => {
      const last = l === lines.length - 1;
      const probe = lineH * (l + 0.5) + size * 0.28;
      let x = 0;
      while (x < w) {
        if (alpha(x, probe) < 200) {
          x += 1;
          continue;
        }
        let run = x;
        while (run < w && alpha(run, probe) >= 200) run += 1;
        const width = run - x;
        if (width >= 4 && rnd() < 0.42) {
          const cx = x + width * (0.3 + rnd() * 0.4);
          let foot = probe;
          while (alpha(cx, foot + 1) >= 160 && foot < h + pad) foot += 1;
          const len = lineH * (last ? 0.18 + rnd() * 0.42 : 0.06 + rnd() * 0.14);
          const dw = Math.max(2, Math.min(width * 0.45, size * 0.07)) * (0.6 + rnd() * 0.5);
          g.fillStyle = '#0c0a0d';
          g.beginPath();
          g.moveTo(cx - dw / 2, foot - 2);
          g.lineTo(cx + dw / 2, foot - 2);
          g.lineTo(cx + dw * 0.3, foot + len);
          g.lineTo(cx - dw * 0.3, foot + len);
          g.closePath();
          g.fill();
          g.beginPath();
          g.arc(cx, foot + len, dw * 0.55, 0, Math.PI * 2);
          g.fill();
        }
        x = run + 1;
      }
    });
    // worn in specks, as sprayed paint is
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    const specks = Math.floor((w * h) / 120);
    for (let k = 0; k < specks; k++) {
      g.beginPath();
      g.arc(rnd() * w, rnd() * (h + lineH * 0.5), (0.4 + rnd() * 0.9) * 1, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    this.spray = { canvas: off, x: x0 - pad, y: y0 - pad, w: off.width / dpr, h: off.height / dpr };
  }

  /** Paint the chairs, the bottles and the severed head at full resolution (props.ts), back to front. */
  private paintProps(): void {
    this.props = null;
    if (typeof document === 'undefined') return;
    const c = this.cabin;
    const off = document.createElement('canvas');
    off.width = Math.ceil(this.W * this.dpr);
    off.height = Math.ceil(this.H * this.dpr);
    const g = off.getContext('2d');
    if (!g) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const H = this.H;
    for (const ch of c.chairs) drawChair(g, ch, H);
    // lying bottles first, then the standing ones in front of them
    for (const b of [...c.bottles].sort((p, q) => p.y - q.y)) drawBottle(g, b, H);
    drawHead(g, c.head.x * H, c.head.y * H, c.head.r * H);
    this.props = off;
  }

  private mark(i: number, j: number, L: number, c: number): void {
    this.set(i, j, L, T_PAINT, c);
  }

  /** The gable: vertical boards under the two slopes of the roof, the barge boards along them, moss on top. */
  private roof(): void {
    const c = this.cabin;
    const { wall, apex, overhang } = c;
    this.each(wall.x0 - overhang, wall.x1 + overhang, apex.y - 0.05, wall.y0 + 0.04, (i, j, X, Y) => {
      const edge = roofLine(c, X);
      const left = X < apex.x;
      if (Y >= edge - 0.034 && Y < edge) {
        // the barge board, catching the flash; moss along its top
        const top = Y < edge - 0.026;
        const L = (top ? 0.3 : 0.5) * this.lit(X, Y) * (0.85 + 0.3 * this.grain.sample(X * 80, Y * 80));
        this.set(i, j, L, top ? T_MOSS : T_WOOD, top ? 0 : left ? 47 : 92);
      } else if (Y >= edge - 0.046 && Y < edge - 0.034) {
        this.set(i, j, 0.12 * this.lit(X, Y), T_ROOF, 0);
      } else if (Y >= edge && Y < wall.y0 && X > wall.x0 && X < wall.x1) {
        // the gable's boards stand upright, darker just under the roof
        const board = (X - wall.x0) / 0.03;
        const f = board - Math.floor(board);
        const shade = smoothstep(0, 0.03, Y - edge) * 0.55 + 0.45;
        let L = 0.5 * this.lit(X, Y) * shade * (0.75 + 0.4 * this.grain.sample(Math.floor(board) * 9.1, Y * 60));
        let ch = 0;
        if (f > 0.86) {
          L *= 0.38;
          ch = C_BAR;
        }
        this.set(i, j, L, T_WOOD, ch);
      }
    });
    // the beam along the eaves
    this.each(wall.x0 - 0.02, wall.x1 + 0.02, wall.y0 - 0.012, wall.y0 + 0.006, (i, j, X, Y) => this.set(i, j, 0.46 * this.lit(X, Y), T_WOOD, C_EQ));
  }

  /** The big pale trunk in front on the right: lichen in blotches, dark cracks, moss at its foot. */
  private paleTree(): void {
    const c = this.cabin;
    const { x, w } = c.tree;
    this.each(x - w / 2, x + w / 2, 0, 1.02, (i, j, X, Y) => {
      const s = (X - x) / (w / 2);
      const round = Math.sqrt(Math.max(0, 1 - s * s));
      const lichen = this.grain.sample(X * 34, Y * 10);
      const crack = this.grain.sample(X * 110, Y * 2.5);
      const glow = 0.55 + 0.45 * smoothstep(0.05, 0.75, Y);
      let L = 0.62 * glow * (0.35 + 0.65 * round) * (0.78 - 0.18 * s) * (0.8 + 0.35 * lichen);
      let tn = T_BARK;
      let ch = 0;
      if (lichen > 0.62) {
        L *= 1.18;
        ch = LICHEN[Math.floor(hash2(i, j, 61) * LICHEN.length)]!;
      }
      if (crack < 0.3) {
        L *= 0.38;
        ch = C_BAR;
      }
      if (Y > 0.86 && s < 0.2 && this.grain.sample(X * 60, Y * 40) > 0.4) {
        tn = T_MOSS;
        L = 0.4 * (0.6 + 0.4 * round);
        ch = 0;
      }
      if (Math.abs(s) > 0.92) L *= 0.5;
      this.set(i, j, L, tn, ch);
    });
  }
}

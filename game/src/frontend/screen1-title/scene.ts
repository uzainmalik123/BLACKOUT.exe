// The title screen's real-time scene: two curtains of falling binary, torn apart by two hands
// the player drives with ← and →, and behind them the title and Death, all drawn as characters.
//
// Layers, back to front: crimson rain in the dark, Death, drifting shadow, the title and
// tagline, dust and torn threads, the curtains (dark backing, then glowing strands), the
// sleeves and hands, then glitches, grain, scanlines and the vignette.

import { CINZEL, CORMORANT, FACES, GlyphAtlas, codes } from '../shared/atlas';
import {
  type CurtainFrame,
  type CurtainMotion,
  type Side,
  GRIP_V,
  INTRO_GRIPPED,
  MAX_SPEED,
  autoOpen,
  bundleWidth,
  clamp,
  gripY,
  halfGap,
  handAnchor,
  hash2,
  introPose,
  lerp,
  maxHalfGap,
  menuShown,
  minHalfGap,
  mulberry32,
  smoothstep,
  strandX,
  tearProfile,
} from './curtain';
import { DeathArt } from './death';
import { HandArt } from './hands';
import { TitleArt } from './titleArt';

export type Selection = 'enter' | 'exit';
export type Phase = 'intro' | 'play' | 'entering' | 'exiting' | 'closed' | 'gate';

export interface SceneUi {
  phase: Phase;
  menu: boolean;
}

export interface SceneOptions {
  title: string;
  tagline: readonly [string, string];
  gate: boolean;
  reducedMotion: boolean;
  onUi: (ui: SceneUi) => void;
  onEntered: () => void;
  onExited: () => void;
}

interface Strand {
  u: number;
  /** 0..1 bit-reversed order: any prefix of ranks is spread evenly across the curtain. */
  rank: number;
  speed: number;
  phase: number;
  bright: number;
  seed: number;
  back: boolean;
  corruptUntil: number;
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  code: number;
  color: number;
  scale: number;
}

interface Thread {
  v: number;
  snap: number;
  broken: boolean;
  alpha: number;
}

const GREENS = ['#05301a', '#094325', '#0d5a30', '#11743e', '#158f4b', '#1aab5a', '#26c86b', '#4de08a', '#93f6b9', '#e0ffec'];
const REDS = ['#1f0204', '#330508', '#4d080d', '#6b0d14'];
const BIN = codes('01');
const DUST = codes('.`*+01:');
const SLEEVE_CH = codes('/\\|=-:.');
const ease = (t: number) => t * t * (3 - 2 * t);

export class CurtainScene {
  private readonly ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private U = 30;
  private t = 0;
  private last = 0;
  private raf = 0;
  private alive = true;

  private phase: Phase;
  private phaseT = 0;
  private phaseOpen = 0;
  private introT = 0;
  private introSpeed = 1;
  private motion: CurtainMotion = { open: 0, vel: 0 };
  private pose = introPose(0);
  private menu = false;
  private selection: Selection = 'enter';
  private mouse = { x: 0, y: 0 };
  private look = { x: 0, y: 0, tx: 0, ty: 0, nextSaccade: 2 };
  private pupil = 0.4;
  private uiSent = '';

  private bin!: GlyphAtlas;
  private red!: GlyphAtlas;
  private sleeveAtlas!: GlyphAtlas;
  private binColors: number[] = [];
  private binCrimson = 0;
  private redColors: number[] = [];
  private dustColors: number[] = [];
  private sleeveColors: number[] = [];
  private spacing = 24;
  private font = 20;
  private lineH = 22;
  private strands: { L: Strand[]; R: Strand[] } = { L: [], R: [] };
  private edgeStep = 8;
  private edgeL = new Float32Array(0);
  private edgeR = new Float32Array(0);

  private readonly death = new DeathArt();
  private deathAt = -1;
  private readonly title: TitleArt;
  private readonly hands = { L: new HandArt(-1), R: new HandArt(1) };
  /** The tagline's two lines, each in its own face and colour, laid out letter by letter. */
  private tagline: { font: string; size: number; color: string; glow: string; xs: number[]; text: string }[] = [];

  private dust: Bit[] = [];
  private shreds: Bit[] = [];
  private threads: Thread[] = [
    { v: 0.2, snap: 0.42, broken: false, alpha: 1 },
    { v: 0.9, snap: 0.56, broken: false, alpha: 1 },
  ];
  private glitch = { next: 6, until: -1, y: 0, h: 0, shift: 0 };

  private vignette: HTMLCanvasElement | null = null;
  private shadow: HTMLCanvasElement | null = null;
  private scan: CanvasPattern | null = null;
  private grain: CanvasPattern | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: SceneOptions,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.title = new TitleArt(opts.title);
    this.phase = opts.gate ? 'gate' : 'intro';
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    // the title and tagline faces come from the stylesheet's web fonts: lay out again once they land
    if (typeof document !== 'undefined' && document.fonts) {
      Promise.all(FACES.map((f) => document.fonts.load(f)))
        .then(() => {
          if (this.alive) this.resize();
        })
        .catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ controls

  /** A key or click: hurries the opening along, or brings it back after EXIT. */
  nudge(): void {
    if (this.phase === 'closed') this.restart();
    else if (this.phase === 'intro' || (this.phase === 'play' && this.motion.open < 1)) this.introSpeed = 2.6;
  }

  setSelection(sel: Selection): void {
    this.selection = sel;
  }

  setMouse(nx: number, ny: number): void {
    this.mouse.x = nx;
    this.mouse.y = ny;
  }

  enter(): void {
    if (this.phase !== 'play') return;
    this.phase = 'entering';
    this.phaseT = 0;
    this.phaseOpen = this.motion.open;
    this.motion.vel = 0;
  }

  exit(): void {
    if (this.phase !== 'play') return;
    this.phase = 'exiting';
    this.phaseT = 0;
    this.phaseOpen = this.motion.open;
    this.motion.vel = 0;
  }

  destroy(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
  }

  private restart(): void {
    this.phase = 'intro';
    this.introT = 0;
    this.introSpeed = 1.3;
    this.motion = { open: 0, vel: 0 };
    for (const th of this.threads) {
      th.broken = false;
      th.alpha = 0;
    }
  }

  // ------------------------------------------------------------------ sizing

  resize(): void {
    const W = Math.max(320, window.innerWidth);
    const H = Math.max(320, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.U = Math.min(H * 0.037, W * 0.023);
    this.canvas.width = Math.floor(W * dpr);
    this.canvas.height = Math.floor(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;

    this.spacing = clamp(W / 68, 15, 28);
    this.font = this.spacing * 0.84;
    this.lineH = this.font * 1.1;
    this.bin = new GlyphAtlas(this.font, dpr, this.font * 0.5, 700);
    this.binColors = GREENS.map((c) => this.bin.color(c));
    this.binCrimson = this.bin.color('#c0121f');
    this.dustColors = ['#1d5a3a', '#2f7f52', '#5e1a22', '#8d1622', '#77736a'].map((c) => this.bin.color(c));
    this.red = new GlyphAtlas(clamp(H * 0.012, 10, 15), dpr, 0, 600);
    this.redColors = REDS.map((c) => this.red.color(c));
    this.sleeveAtlas = new GlyphAtlas(Math.max(7, this.U * 0.3), dpr, 0, 500);
    this.sleeveColors = [];
    for (let i = 0; i < 8; i++) {
      const v = i / 7;
      this.sleeveColors.push(this.sleeveAtlas.color(`rgb(${(8 + v * 60) | 0},${(14 + v * 150) | 0},${(11 + v * 90) | 0})`));
    }

    const rnd = mulberry32(0x5eed);
    const n = Math.ceil(W / 2 / this.spacing) + 1;
    const bits = Math.ceil(Math.log2(n + 1));
    const reversed = (i: number) => {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      return r / (1 << bits);
    };
    const make = (back: boolean): Strand[] =>
      Array.from({ length: n }, (_, i) => ({
        u: back ? Math.min(1, (i + 0.5) / (n - 1)) : i / (n - 1),
        // the torn edge always survives the fold
        rank: i === n - 1 ? 0 : reversed(back ? i + 1 : i),
        speed: back ? lerp(16, 28, rnd()) : lerp(26, 50, rnd()),
        phase: rnd() * 5000,
        bright: back ? lerp(0.16, 0.32, rnd()) : rnd() < 0.18 ? lerp(0.3, 0.45, rnd()) : lerp(0.55, 1, rnd()),
        seed: rnd() * 100,
        back,
        corruptUntil: -1,
      }));
    this.strands = { L: [...make(true), ...make(false)], R: [...make(true), ...make(false)] };
    this.edgeL = new Float32Array(Math.ceil(H / this.edgeStep) + 3);
    this.edgeR = new Float32Array(this.edgeL.length);

    this.death.resize(W, H, dpr);
    this.deathAt = -1;
    this.title.resize(W, H, dpr);
    this.hands.L.resize(this.U, dpr);
    this.hands.R.resize(this.U, dpr);
    this.hands.L.update({ curl: 0.35, squeeze: 0 });
    this.hands.R.update({ curl: 0.35, squeeze: 0 });

    // line one: a soft italic in pale silver; line two: engraved capitals in blood red
    const s1 = clamp(H * 0.045, 26, 52);
    const s2 = clamp(H * 0.027, 16, 31);
    const [first, second] = this.opts.tagline;
    const lines = [
      { font: `italic 600 ${s1}px ${CORMORANT}`, size: s1, color: '#f7f2e7', glow: 'rgba(0,0,0,0.95)', text: first, track: 0.015 },
      { font: `700 ${s2}px ${CINZEL}`, size: s2, color: '#ea3c4a', glow: 'rgba(234,60,74,0.4)', text: second.toUpperCase(), track: 0.2 },
    ];
    this.tagline = lines.map((l) => {
      this.ctx.font = l.font;
      const widths = Array.from(l.text, (c) => this.ctx.measureText(c).width + l.size * l.track);
      const total = widths.reduce((a, b) => a + b, 0) - l.size * l.track;
      let x = W / 2 - total / 2;
      const xs = widths.map((w) => {
        const at = x;
        x += w;
        return at;
      });
      return { font: l.font, size: l.size, color: l.color, glow: l.glow, xs, text: l.text };
    });

    this.dust = Array.from({ length: 80 }, () => this.newDust(rnd, true));
    this.buildOverlays();
  }

  private buildOverlays(): void {
    const { W, H } = this;
    const v = document.createElement('canvas');
    v.width = Math.ceil(W / 2);
    v.height = Math.ceil(H / 2);
    const vc = v.getContext('2d');
    if (vc) {
      const g = vc.createRadialGradient(v.width / 2, v.height * 0.48, Math.min(v.width, v.height) * 0.22, v.width / 2, v.height * 0.48, Math.max(v.width, v.height) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.65, 'rgba(0,0,0,0.38)');
      g.addColorStop(1, 'rgba(0,0,0,0.88)');
      vc.fillStyle = g;
      vc.fillRect(0, 0, v.width, v.height);
    }
    this.vignette = v;

    const s = document.createElement('canvas');
    s.width = s.height = 128;
    const sc = s.getContext('2d');
    if (sc) {
      const g = sc.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,0.7)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      sc.fillStyle = g;
      sc.fillRect(0, 0, 128, 128);
    }
    this.shadow = s;

    const line = document.createElement('canvas');
    line.width = 1;
    line.height = 4;
    const lc = line.getContext('2d');
    if (lc) {
      lc.fillStyle = 'rgba(0,0,0,0.22)';
      lc.fillRect(0, 0, 1, 1);
    }
    this.scan = this.ctx.createPattern(line, 'repeat');

    const gr = document.createElement('canvas');
    gr.width = gr.height = 160;
    const gc = gr.getContext('2d');
    if (gc) {
      const img = gc.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = Math.random() * 255;
        img.data[i] = n;
        img.data[i + 1] = n;
        img.data[i + 2] = n;
        img.data[i + 3] = 255;
      }
      gc.putImageData(img, 0, 0);
    }
    this.grain = this.ctx.createPattern(gr, 'repeat');
  }

  private newDust(rnd: () => number, anywhere: boolean): Bit {
    const crimson = rnd() < 0.18;
    return {
      x: this.W * (0.15 + rnd() * 0.7),
      y: anywhere ? rnd() * this.H : this.H + 10,
      vx: (rnd() - 0.5) * 8,
      vy: -(5 + rnd() * 12),
      life: 0,
      max: 8 + rnd() * 10,
      code: DUST[Math.floor(rnd() * DUST.length)]!,
      color: this.dustColors[crimson ? 2 + Math.floor(rnd() * 2) : Math.floor(rnd() * 2)]!,
      scale: 0.32 + rnd() * 0.25,
    };
  }

  // ------------------------------------------------------------------ loop

  private readonly frame = (now: number): void => {
    if (!this.alive) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private curtainFrame(): CurtainFrame {
    if (this.phase === 'gate') {
      // no hands on a phone: the code parts just enough to show her eyes
      const d = this.death;
      const need = d.width * 0.29;
      const eyeV = (d.top + d.height * (51 / 130)) / this.H;
      const per = (maxHalfGap(this.W) - minHalfGap(this.U)) * tearProfile(eyeV, GRIP_V.left);
      return { W: this.W, H: this.H, U: this.U, open: need / per + 0.04 * Math.sin(this.t * 0.5), gripL: 0, gripR: 0 };
    }
    return { W: this.W, H: this.H, U: this.U, open: this.motion.open, gripL: this.pose.gripL, gripR: this.pose.gripR };
  }

  private update(dt: number): void {
    this.t += dt;
    const t = this.t;

    if (this.phase === 'intro' || this.phase === 'play') {
      // the hands do it all: grip, then tear the curtains open in three tugs
      this.introT += dt * this.introSpeed;
      this.pose = introPose(this.introT);
      if (this.phase === 'intro' && this.pose.gripR >= 1) this.phase = 'play';
      const prev = this.motion.open;
      const open = autoOpen(this.introT - INTRO_GRIPPED);
      this.motion = { open, vel: dt > 0 ? (open - prev) / dt : 0 };
    } else if (this.phase === 'entering') {
      this.phaseT += dt;
      const p = clamp(this.phaseT / 1.6);
      this.motion.open = lerp(this.phaseOpen, 1.5, p * p);
      if (this.phaseT >= 1.6) {
        this.alive = false;
        this.opts.onEntered();
        return;
      }
    } else if (this.phase === 'exiting') {
      this.phaseT += dt;
      const p = this.phaseT;
      this.motion.open = this.phaseOpen * (1 - ease(clamp(p / 1.5)));
      const leave = smoothstep(1.4, 2.6, p);
      this.pose = {
        arriveL: 1 - leave,
        arriveR: 1 - smoothstep(1.6, 2.8, p),
        curlL: 1 - smoothstep(1.3, 1.8, p),
        curlR: 1 - smoothstep(1.5, 2.0, p),
        gripL: 1 - smoothstep(1.3, 1.7, p),
        gripR: 1 - smoothstep(1.5, 1.9, p),
      };
      if (p >= 3.1) {
        this.phase = 'closed';
        this.opts.onExited();
      }
    }

    const open = this.motion.open;
    const vel = this.motion.vel;
    if (this.phase === 'play') this.menu = menuShown(this.menu, open);
    else this.menu = false;

    // where she looks: with the tear while it moves, at the menu, otherwise at you
    if (t > this.look.nextSaccade) {
      this.look.nextSaccade = t + 1.5 + Math.random() * 3;
      this.look.tx = (Math.random() - 0.5) * 0.25;
      this.look.ty = (Math.random() - 0.5) * 0.2;
    }
    let tx = this.look.tx + this.mouse.x * 0.35;
    let ty = this.look.ty + this.mouse.y * 0.25;
    if (Math.abs(vel) > 0.02) {
      tx = (vel / MAX_SPEED) * 0.85;
      ty = 0.3;
    } else if (this.menu) {
      tx = 0;
      ty = this.selection === 'enter' ? 0.75 : 0.95;
    }
    if (this.phase === 'entering') {
      tx = 0;
      ty = 0;
    }
    const k = Math.min(1, dt * 7);
    this.look.x += (tx - this.look.x) * k;
    this.look.y += (ty - this.look.y) * k;
    const pupilTarget = this.phase === 'entering' ? 0 : 0.35 + 0.45 * smoothstep(0.4, 1, open) + (this.menu && this.selection === 'enter' ? 0.15 : 0);
    this.pupil += (pupilTarget - this.pupil) * Math.min(1, dt * 3);

    this.updateEdges();
    this.updateParticles(dt);
    this.updateGlitch();
    this.sendUi();
  }

  private eyeReveal(): number {
    if (this.phase === 'gate') return 1;
    if (this.phase === 'entering') return 1;
    return smoothstep(0.22, 0.5, this.motion.open);
  }

  private updateEdges(): void {
    const f = this.curtainFrame();
    for (let k = 0; k < this.edgeL.length; k++) {
      const y = k * this.edgeStep;
      this.edgeL[k] = f.W / 2 - halfGap(f, -1, y);
      this.edgeR[k] = f.W / 2 + halfGap(f, 1, y);
    }
  }

  private edgeAt(side: Side, y: number): number {
    const arr = side < 0 ? this.edgeL : this.edgeR;
    const k = clamp(Math.floor(y / this.edgeStep), 0, arr.length - 2);
    const f = clamp(y / this.edgeStep - k);
    return lerp(arr[k]!, arr[k + 1]!, f);
  }

  private updateParticles(dt: number): void {
    const { t, H } = this;
    for (const d of this.dust) {
      d.life += dt;
      d.x += (d.vx + Math.sin(t * 0.7 + d.max) * 4) * dt;
      d.y += d.vy * dt;
      if (d.y < -10 || d.life > d.max) Object.assign(d, this.newDust(Math.random, false), { y: H * (0.3 + Math.random() * 0.7) });
    }
    // torn bits fly off the edges while the curtains are pulled
    const f = this.curtainFrame();
    const vel = this.motion.vel;
    if ((this.phase === 'play' || this.phase === 'entering') && Math.abs(vel) > 0.05 && this.shreds.length < 260) {
      const rate = Math.abs(vel) * 90 * dt;
      for (const side of [-1, 1] as Side[]) {
        let n = rate + Math.random();
        while (n-- >= 1) {
          const y = gripY(f, side) + (Math.random() - 0.5) * this.H * 0.55;
          const x = this.edgeAt(side, y);
          this.shreds.push({
            x,
            y,
            vx: -side * (20 + Math.random() * 60) * (vel > 0 ? 1 : 0.4),
            vy: -10 + Math.random() * 25,
            life: 0,
            max: 1.4 + Math.random() * 1.8,
            code: BIN[Math.random() < 0.5 ? 0 : 1]!,
            color: this.binColors[4 + Math.floor(Math.random() * 4)]!,
            scale: 0.45 + Math.random() * 0.3,
          });
        }
      }
    }
    for (const s of this.shreds) {
      s.life += dt;
      s.vy += 26 * dt;
      s.vx *= 1 - dt * 0.6;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    this.shreds = this.shreds.filter((s) => s.life < s.max);

    // threads of code strung across the gap: they stretch, then snap
    for (const th of this.threads) {
      if (!th.broken && this.motion.open > th.snap && this.phase !== 'gate') {
        th.broken = true;
        this.burstThread(th, f);
      } else if (th.broken && this.motion.open < th.snap - 0.3) {
        th.broken = false;
        th.alpha = 0;
      }
      if (!th.broken) th.alpha = Math.min(1, th.alpha + dt * 0.6);
    }
  }

  private burstThread(th: Thread, f: CurtainFrame): void {
    const y = th.v * f.H;
    const xl = this.edgeAt(-1, y);
    const xr = this.edgeAt(1, y);
    const n = Math.floor((xr - xl) / (this.font * 0.55));
    for (let i = 0; i < n; i++) {
      const s = i / Math.max(1, n);
      const toward = s < 0.5 ? -1 : 1;
      this.shreds.push({
        x: lerp(xl, xr, s),
        y: y + Math.sin(Math.PI * s) * this.H * 0.02,
        vx: toward * (30 + Math.random() * 70),
        vy: -20 + Math.random() * 30,
        life: 0,
        max: 1.2 + Math.random() * 1.6,
        code: i % 2 ? 45 : BIN[Math.random() < 0.5 ? 0 : 1]!,
        color: this.binColors[6]!,
        scale: 0.55,
      });
    }
  }

  private updateGlitch(): void {
    const g = this.glitch;
    const t = this.t;
    if (t > g.next && this.phase !== 'entering') {
      const rare = this.opts.reducedMotion ? 3 : 1;
      g.next = t + (5 + Math.random() * 7) * rare;
      g.until = t + 0.1 + Math.random() * 0.16;
      g.h = this.H * (0.02 + Math.random() * 0.06);
      g.y = this.H * (0.1 + Math.random() * 0.8);
      g.shift = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 28);
      const all = [...this.strands.L, ...this.strands.R].filter((s) => !s.back);
      for (let i = 0; i < 2; i++) {
        const s = all[Math.floor(Math.random() * all.length)];
        if (s) s.corruptUntil = t + 0.2 + Math.random() * 0.3;
      }

    }
  }

  private sendUi(): void {
    const ui: SceneUi = { phase: this.phase, menu: this.menu };
    const key = `${ui.phase}|${ui.menu}`;
    if (key !== this.uiSent) {
      this.uiSent = key;
      this.opts.onUi(ui);
    }
  }

  // ------------------------------------------------------------------ drawing

  private render(): void {
    const { ctx, W, H, dpr, t } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#010201';
    ctx.fillRect(0, 0, W, H);

    const f = this.curtainFrame();
    const open = f.open;
    const gate = this.phase === 'gate';
    const glitching = t < this.glitch.until;

    this.drawCrimsonRain(f);

    // Death
    const reveal = gate ? 0.55 : this.phase === 'entering' ? 1 : smoothstep(0.06, 0.75, open);
    const eyes = this.eyeReveal();
    if (reveal > 0 || eyes > 0) {
      if (t - this.deathAt > 1 / 24 || this.deathAt < 0) {
        this.deathAt = t;
        const dRows = this.death.rows;
        const tear = glitching ? { r0: Math.floor(((this.glitch.y - this.death.top) / this.death.height) * dRows), r1: Math.floor(((this.glitch.y + this.glitch.h - this.death.top) / this.death.height) * dRows), shift: Math.round(this.glitch.shift / this.death.cw / 2) } : null;
        this.death.render({
          t,
          reveal,
          eyes,
          lookX: this.look.x,
          lookY: this.look.y,
          pupil: this.pupil,
          distort: clamp(Math.abs(this.motion.vel) / MAX_SPEED) * 0.8,
          tear,
        });
      }
      const lean = this.phase === 'entering' ? 1 + 0.7 * Math.pow(clamp(this.phaseT / 1.6), 2) : 1 + 0.035 * smoothstep(0.3, 1, open);
      const e0 = this.death.eye(0, this.look.x, this.look.y);
      const e1 = this.death.eye(1, this.look.x, this.look.y);
      const cx = (e0.x + e1.x) / 2;
      const cy = (e0.y + e1.y) / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(lean, lean);
      ctx.translate(-cx, -cy);
      ctx.drawImage(this.death.canvas, this.death.left, this.death.top, this.death.cols * this.death.cw, this.death.rows * this.death.ch);
      this.drawEyeGlow([e0, e1], eyes * (this.phase === 'entering' ? 1.6 : 1));
      ctx.restore();
    }

    // flowing shadows
    if (this.shadow) {
      for (let i = 0; i < 5; i++) {
        const x = W / 2 + Math.sin(t * 0.07 + i * 1.7) * W * 0.22;
        const y = H * (0.15 + 0.17 * i) + Math.sin(t * 0.11 + i) * H * 0.05;
        const r = H * (0.25 + 0.06 * Math.sin(t * 0.2 + i * 2));
        ctx.globalAlpha = 0.55;
        ctx.drawImage(this.shadow, x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }

    // title and tagline
    if (!gate) {
      const tr = this.phase === 'entering' ? 1 - clamp(this.phaseT / 0.8) : smoothstep(0.0, 0.32, open) * this.pose.gripR;
      const ty = H * (H < 900 ? 0.555 : 0.59); // higher on short screens, to leave room for the choice
      // centre the letters themselves (not the art's padding) on her face's centre line
      const cx = this.death.left + this.death.width / 2;
      const ti = this.title;
      const tx = Math.round(cx - (ti.inkLeft + ti.inkRight) / 2);
      const top = Math.round(ty - (ti.inkTop + ti.inkBottom) / 2);
      const g = glitching && Math.abs(this.glitch.y - ty) < this.title.height ? { r0: 2 + Math.floor(Math.random() * (this.title.rows - 4)), r1: 0, shift: Math.round(this.glitch.shift / 10) } : null;
      if (g) g.r1 = g.r0 + 1 + Math.floor(Math.random() * 3);
      this.title.render(t, tr, g);
      if (this.shadow && tr > 0) {
        // a pool of dark behind the words keeps them readable over her hair
        ctx.globalAlpha = clamp(tr * 1.3);
        const pw = this.title.width * 1.3;
        const ph = this.title.height * 2.6;
        for (let i = 0; i < 2; i++) ctx.drawImage(this.shadow, cx - pw / 2, ty - ph / 2 + this.title.height * 0.35, pw, ph);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(this.title.canvas, tx, top, this.title.width, this.title.height);
      this.title.drawDrips(ctx, tx, top, t, tr);
      // the tagline tucks in close under the letters' feet
      this.drawTagline(top + ti.inkBottom + H * 0.008, this.phase === 'entering' ? tr : smoothstep(0.16, 0.55, open) * this.pose.gripR);
    }

    this.drawLoose(f);
    this.drawCurtains(f);
    if (!gate) {
      this.drawHand(f, -1);
      this.drawHand(f, 1);
    }
    this.drawShreds(true);

    if (this.phase === 'exiting' || this.phase === 'closed') {
      // she is still there, behind the code
      const p = this.phase === 'closed' ? 4 : this.phaseT;
      const linger = smoothstep(1.0, 1.6, p) * (1 - smoothstep(2.4, 4.2, p));
      if (linger > 0) {
        const e0 = this.death.eye(0, 0, 0);
        const e1 = this.death.eye(1, 0, 0);
        this.drawEyeGlow([e0, e1], linger * 0.8);
      }
    }

    // disturbances, then the screen itself
    if (glitching && !this.opts.reducedMotion) {
      const g = this.glitch;
      ctx.drawImage(this.canvas, 0, g.y * dpr, W * dpr, g.h * dpr, g.shift, g.y, W, g.h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(120,0,14,0.10)';
      ctx.fillRect(0, g.y, W, g.h);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.grain) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.07;
      ctx.translate((Math.random() * 160) | 0, (Math.random() * 160) | 0);
      ctx.fillStyle = this.grain;
      ctx.fillRect(-160, -160, W + 160, H + 160);
      ctx.restore();
    }
    if (this.scan) {
      ctx.fillStyle = this.scan;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, W, H);

    if (this.phase === 'entering') {
      ctx.fillStyle = `rgba(0,0,0,${smoothstep(0.9, 1.55, this.phaseT)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  private drawEyeGlow(eyes: { x: number; y: number; r: number }[], a: number): void {
    if (a <= 0.01) return;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const e of eyes) {
      // a tighter, colder glow, so the bloodshot whites still show around the iris
      const R = e.r * 2.4;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, R);
      g.addColorStop(0, `rgba(120,236,255,${0.22 * a})`);
      g.addColorStop(0.3, `rgba(255,40,90,${0.1 * a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(e.x - R, e.y - R, R * 2, R * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawCrimsonRain(f: CurtainFrame): void {
    const { ctx, H, t } = this;
    const minX = this.edgeAt(-1, gripY(f, -1)) - 30;
    const maxX = this.edgeAt(1, gripY(f, 1)) + 30;
    if (maxX - minX < 8) return;
    const sp = this.red.fontPx * 1.5;
    const lh = this.red.fontPx * 1.15;
    const c0 = Math.floor(minX / sp);
    const c1 = Math.ceil(maxX / sp);
    for (let c = c0; c <= c1; c++) {
      const x = c * sp;
      const speed = 12 + hash2(c, 0, 41) * 16;
      const scroll = t * speed + hash2(c, 1, 41) * 3000;
      const off = scroll % lh;
      const base = Math.floor(scroll / lh);
      const centre = 1 - Math.abs(x - this.W / 2) / (this.W * 0.4);
      for (let r = -1; r < H / lh + 1; r++) {
        const y = r * lh + off;
        if (x < this.edgeAt(-1, y) - 12 || x > this.edgeAt(1, y) + 12) continue;
        const id = r - base;
        const h = hash2(c, id, 43);
        if (h > 0.42) continue;
        const lvl = clamp(Math.floor((h / 0.42) * 2 + centre * 2), 0, 3);
        this.red.draw(ctx, BIN[h < 0.21 ? 0 : 1]!, this.redColors[lvl]!, x, y);
      }
    }
  }

  private drawTagline(y: number, a: number): void {
    if (a <= 0.01) return;
    const ctx = this.ctx;
    const [l1, l2] = this.tagline;
    if (!l1 || !l2) return;
    const y1 = y + l1.size * 0.6;
    const y2 = y1 + l1.size * 0.55 + l2.size * 0.85;
    // a quiet pool of dark behind the words, so they stay sharp over her
    if (this.shadow) {
      const pw = Math.max(...l1.xs.slice(-1), ...l2.xs.slice(-1)) - Math.min(l1.xs[0]!, l2.xs[0]!) + l1.size * 4;
      const ph = (y2 - y1) + l1.size * 3;
      ctx.globalAlpha = clamp(a * 1.2);
      ctx.drawImage(this.shadow, this.W / 2 - pw / 2, (y1 + y2) / 2 - ph / 2, pw, ph);
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const [n, line] of [l1, l2].entries()) {
      ctx.font = line.font;
      ctx.fillStyle = line.color;
      ctx.shadowColor = line.glow;
      // tight glows keep the letters crisp
      ctx.shadowBlur = line.size * 0.3;
      const mid = line.text.length / 2;
      const lineA = clamp(a * 1.5 - n * 0.35);
      for (let i = 0; i < line.text.length; i++) {
        const ch = line.text[i]!;
        if (ch === ' ') continue;
        // letters surface from the centre outward
        const stagger = clamp(lineA * 1.6 - (Math.abs(i - mid) / mid) * 0.6);
        if (stagger <= 0) continue;
        const flicker = n === 1 ? 0.9 + 0.1 * Math.sin(this.t * 7 + i * 1.3) : 1;
        ctx.globalAlpha = stagger * flicker;
        ctx.fillText(ch, line.xs[i]!, (n === 0 ? y1 : y2) + (1 - stagger) * 6);
      }
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
  }

  private drawLoose(f: CurtainFrame): void {
    const { ctx, t } = this;
    for (const d of this.dust) {
      const fade = Math.min(1, d.life / 1.5, (d.max - d.life) / 1.5);
      if (fade <= 0) continue;
      ctx.globalAlpha = fade * 0.8;
      this.bin.draw(ctx, d.code, d.color, d.x, d.y, d.scale);
    }
    ctx.globalAlpha = 1;
    if (this.phase === 'gate') return;
    for (const th of this.threads) {
      if (th.broken || th.alpha <= 0.01) continue;
      const y = th.v * f.H;
      const xl = this.edgeAt(-1, y) - 2;
      const xr = this.edgeAt(1, y) + 2;
      const w = xr - xl;
      if (w < 12) continue;
      const n = Math.max(2, Math.floor(w / (this.font * 0.55)));
      const sag = this.H * 0.06 * (1 - clamp(f.open / th.snap)) + 3;
      ctx.globalAlpha = th.alpha * Math.min(1, w / 60);
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        const x = lerp(xl, xr, s);
        const yy = y + Math.sin(Math.PI * s) * sag + Math.sin(t * 2 + s * 9) * 1.5;
        const code = i % 2 ? 45 : BIN[hash2(i, Math.floor(t * 2), 51) < 0.5 ? 0 : 1]!;
        this.bin.draw(ctx, code, this.binColors[i % 2 ? 4 : 6]!, x, yy, 0.55);
      }
    }
    ctx.globalAlpha = 1;
    this.drawShreds(false);
  }

  private drawShreds(front: boolean): void {
    const ctx = this.ctx;
    for (let i = 0; i < this.shreds.length; i++) {
      if ((i % 3 === 0) !== front) continue;
      const s = this.shreds[i]!;
      ctx.globalAlpha = clamp(1 - s.life / s.max) * 0.9;
      this.bin.draw(ctx, s.code, s.color, s.x, s.y, s.scale);
    }
    ctx.globalAlpha = 1;
  }

  private drawCurtains(f: CurtainFrame): void {
    const { ctx, H, W, t } = this;
    const vel = this.motion.vel;
    for (const side of [-1, 1] as Side[]) {
      // the dark cloth behind the code hides whatever is behind it
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.shadowColor = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetX = -side * 10;
      ctx.beginPath();
      const outer = side < 0 ? -20 : W + 20;
      ctx.moveTo(outer, -20);
      for (let y = -20; y <= H + 20; y += 10) ctx.lineTo(strandX(f, side, 1, y) - side * 3, y);
      ctx.lineTo(outer, H + 20);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.globalCompositeOperation = 'lighter';
    const lh = this.lineH;
    const rows = Math.ceil(H / lh) + 2;
    for (const side of [-1, 1] as Side[]) {
      const list = side < 0 ? this.strands.L : this.strands.R;
      const gy = gripY(f, side);
      const grip = side < 0 ? f.gripL : f.gripR;
      const restReach = W / 2;
      const bw = bundleWidth(f.U);
      const n = list.length / 2;
      for (const s of list) {
        const rank = s.rank;
        const scroll = t * s.speed + s.phase;
        const off = scroll % lh;
        const base = Math.floor(scroll / lh);
        const corrupt = t < s.corruptUntil;
        const headY = ((t * s.speed * 1.7 + s.seed * 97) % (H * 1.7)) - H * 0.35;
        const sc0 = s.back ? 0.68 : 1;
        for (let r = -1; r < rows; r++) {
          if (s.back && (r & 1)) continue;
          const y = r * lh + off - lh;
          const reach = restReach - halfGap(f, side, y);
          const d = (y - gy) / (H * 0.12);
          const G = grip * Math.exp(-d * d);
          let x = strandX(f, side, s.u, y);
          // folds, the ripple of a pull, and loose strands hanging into the gap
          const comp = 1 - reach / restReach;
          let wob = Math.sin(s.u * 19 + y * 0.006 + t * 0.45 + s.seed) * (2 + 9 * comp);
          wob += Math.sin(y * 0.021 - t * 5.5 + s.u * 7) * Math.abs(vel) * 30 * s.u;
          if (s.u > 0.9) wob += ((s.u - 0.9) / 0.1) * (5 + 12 * Math.sin(y * 0.013 + t * 0.8 + s.seed)) * Math.min(1, f.open * 4);
          x += -side * wob * (1 - G);
          if (x < -20 || x > W + 20) continue;
          // Bunched strands fold behind one another: keep an even subset at nearly full size,
          // so a gathered curtain still reads as columns converging on the fist.
          const local = lerp(reach / n, (bw * 2) / n, G);
          const keep = Math.min(1, (1.7 * local) / this.spacing);
          const vis = keep >= 1 ? 1 : clamp((keep - rank) * n * 0.5 + 0.5);
          if (vis <= 0) continue;
          const scale = clamp(0.78 + (0.22 * local) / this.spacing, 0.78, 1) * sc0;
          const id = r - base;
          const code = BIN[hash2(Math.floor(s.seed * 1000), id, side + 3) < 0.5 ? 0 : 1]!;
          const rel = (headY - y) / (H * 0.32);
          let b = s.bright * (0.62 + 0.38 * Math.sin(id * 0.7 + s.seed));
          if (rel >= 0 && rel < 1) b += (1 - rel) * (1 - rel) * 0.55;
          if (s.u > 0.92 && !s.back) b += 0.18;
          let lvl = clamp(Math.round(b * 8.2), 0, 8);
          if (!s.back && Math.abs(headY - y) < lh * 0.5) lvl = 9;
          ctx.globalAlpha = vis * (s.back ? 0.8 : 1);
          this.bin.draw(ctx, code, corrupt && !s.back ? this.binCrimson : this.binColors[lvl]!, x, y, scale);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawHand(f: CurtainFrame, side: Side): void {
    const ctx = this.ctx;
    const hand = side < 0 ? this.hands.L : this.hands.R;
    const p = this.pose;
    const arrive = side < 0 ? p.arriveL : p.arriveR;
    if (arrive <= 0.001) return;
    const curl = lerp(0.35, 1, side < 0 ? p.curlL : p.curlR);
    const pulling = Math.abs(this.motion.vel) / MAX_SPEED;
    hand.update({ curl, squeeze: clamp(pulling * 1.2) });

    const a = handAnchor(f, side);
    const sl = hand.sleeve();
    const away = Math.pow(1 - arrive, 1.5) * this.W * 0.5;
    const tremble = 0.6 + pulling * 1.4;
    const x = a.x + sl.dx * away + Math.sin(this.t * 13 + side) * tremble * 0.6;
    const y = a.y + sl.dy * away + Math.sin(this.t * 11.3 + side * 2) * tremble * 0.5;
    const rot = side * this.motion.vel * 0.12;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = Math.pow(arrive, 1.3);
    ctx.drawImage(hand.canvas, -hand.ox, -hand.oy, hand.width, hand.height);
    this.drawSleeve(side, sl, arrive);
    ctx.restore();
  }

  /** The sleeve: dark cloth from the forearm off the edge of the screen, lit along one edge. */
  private drawSleeve(side: Side, sl: { x: number; y: number; dx: number; dy: number }, arrive: number): void {
    const ctx = this.ctx;
    const U = this.U;
    const nx = -sl.dy;
    const ny = sl.dx;
    const L = this.W * 1.2;
    const w0 = U * 2.55;
    const w1 = U * 3.2;
    // opaque at the cuff, dissolving into the dark further up the arm
    const fadeLen = U * 15;
    const grad = ctx.createLinearGradient(sl.x, sl.y, sl.x + sl.dx * fadeLen, sl.y + sl.dy * fadeLen);
    grad.addColorStop(0, 'rgba(2,3,2,1)');
    grad.addColorStop(0.3, 'rgba(2,3,2,0.97)');
    grad.addColorStop(1, 'rgba(2,3,2,0.35)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(sl.x + nx * w0, sl.y + ny * w0);
    ctx.lineTo(sl.x + sl.dx * L + nx * w1, sl.y + sl.dy * L + ny * w1);
    ctx.lineTo(sl.x + sl.dx * L - nx * w1, sl.y + sl.dy * L - ny * w1);
    ctx.lineTo(sl.x - nx * w0, sl.y - ny * w0);
    ctx.closePath();
    ctx.fill();

    const at = this.sleeveAtlas;
    const step = at.fontPx * 0.9;
    const across = at.fontPx * 1.15;
    // which side of the sleeve faces the gap (and the light)
    const litSign = ny * -1 < 0 ? -1 : 1;
    const m0 = ctx.getTransform();
    const lim = Math.max(this.W, this.H) * 1.1 * this.dpr;
    for (let m = 0; m < L; m += step) {
      const w = lerp(w0, w1, m / L);
      const fall = Math.exp(-m / (U * 6));
      if (fall < 0.04) break;
      const n = Math.ceil((2 * w) / across);
      const bx = sl.x + sl.dx * m;
      const by = sl.y + sl.dy * m;
      const sx = m0.a * bx + m0.c * by + m0.e;
      const sy = m0.b * bx + m0.d * by + m0.f;
      if (sx < -lim * 0.2 || sx > lim || sy > lim) break;
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * 2 - 1; // -1..1 across
        const x = bx + nx * s * w * 0.96;
        const y = by + ny * s * w * 0.96;
        const fold = Math.sin(m * 0.022 + s * 2.4 + side) + 0.6 * Math.sin(m * 0.06 - s * 5.1);
        const lit = s * litSign;
        let v = 0.05 + Math.max(0, fold) * 0.12;
        if (lit > 0.78) v += (lit - 0.78) * 3.2 * fall;
        if (m < step * 2) v += 0.25 * fall; // the cuff
        v *= 0.4 + 0.6 * fall;
        const lvl = clamp(Math.round(v * 7), 0, 7);
        if (lvl === 0 && hash2(i, Math.floor(m), 61) > 0.3) continue;
        const code = m < step * 2 ? 61 : lit > 0.78 ? SLEEVE_CH[side < 0 ? 0 : 1]! : SLEEVE_CH[2 + Math.floor(hash2(i, Math.floor(m / step), 63) * 5)]!;
        ctx.globalAlpha = arrive * Math.min(1, fall * 1.6);
        at.draw(ctx, code, this.sleeveColors[lvl]!, x, y);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// Screen 2's scene (UI-02's menu, D-181): a haunted night forest drawn entirely in characters, live.
// The mist is the light; the dead tree, the brambles and she are darkness carved out of it. A character grid is
// composed from the layers 24 times a second (fog, her, ground, trunk, limbs, brambles, ground mist) and drawn
// straight onto the page's canvas (only the cells that changed); her eyes, the logo and its blood live on a second, transparent
// canvas above it, redrawn every frame in the small areas they cover. Nothing full-screen happens per frame.
// The menu itself is real text in MenuScreen.tsx; this only draws, and reports when the lunge or the exit ends.

import type { Difficulty } from '../../rules/vocabulary';
import { FACES, GlyphAtlas, MONO, codes, strokeChar } from '../shared/atlas';
import { clamp, hash2, lerp, mulberry32, smoothstep } from '../shared/math';
import { CoverLayer, NoiseField } from './field';
import { Forest } from './forest';
import { Haunt } from './haunt';
import { LogoArt } from './logoArt';
import { Wraith, type WraithPose } from './wraith';

export interface MenuSceneOptions {
  title: string;
  difficulty: Difficulty;
  reducedMotion: boolean;
  /** Her lunge (Start Game) has ended in black. */
  onLunged: () => void;
  /** The fade back to the title (Exit, Escape) has ended. */
  onLeft: () => void;
}

/** Mist, thinnest to thickest; index 0 is empty. */
const FOG = codes(" .`',:;-~=+*");
const GRASS = codes(",'`\"");
const KNOT = codes('@O0');
const C_PAREN_L = 40;
const C_PAREN_R = 41;
const C_COLON = 58;
const C_DOT = 46;

/** Palettes, 16 steps dark to light: cold moonlit mist, the bark (a touch warmer), her edges (colder), grass, her face. */
const TONES = 5;
const STEPS = 16;
function tone(tn: number, q: number): string {
  const v = 8 + q * 12;
  switch (tn) {
    case 4:
      // bloodless, faintly green-grey, like something drowned
      return `rgb(${Math.round(v * 0.86)},${Math.round(v * 0.95)},${Math.round(v * 0.9)})`;
    case 1:
      return `rgb(${Math.round(v * 1.0)},${Math.round(v * 0.95)},${Math.round(v * 0.88)})`;
    case 2:
      return `rgb(${Math.round(v * 0.82)},${Math.round(v * 0.88)},${Math.round(Math.min(255, v * 1.02))})`;
    case 3:
      return `rgb(${Math.round(v * 0.86)},${Math.round(v * 0.92)},${Math.round(v * 0.86)})`;
    default:
      return `rgb(${Math.round(v * 0.92)},${Math.round(v * 0.96)},${Math.round(Math.min(255, v * 1.05))})`;
  }
}

type Phase = 'live' | 'lunge' | 'leaving' | 'gone';

const GRID_HZ = 24;
/** Black held after the lunge before handing over, seconds. */
const LUNGE_HOLD = 0.25;

export class MenuScene {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fxc: CanvasRenderingContext2D;
  /** What the overlay drew last frame (css px), cleared before the next. */
  private dirty: Array<[number, number, number, number]> = [];
  private W = 0;
  private H = 0;
  private dpr = 1;
  private cols = 0;
  private rows = 0;
  private cw = 8;
  private ch = 14;
  private t = 0;
  private last = 0;
  private raf = 0;
  private alive = true;
  private phase: Phase = 'live';
  private phaseT = 0;
  private gridAcc = 1;
  private bright = 0;

  private atlas!: GlyphAtlas;
  private pal: number[] = [];
  private sky = new Float32Array(0);
  private shade = new Float32Array(0);
  private lum = new Float32Array(0);
  private code = new Uint16Array(0);
  private tn = new Uint8Array(0);
  private readonly mistBig = new NoiseField(192, 96, 0xf06, 4);
  private readonly mistFine = new NoiseField(256, 128, 0xf07, 3);

  private readonly forest = new Forest();
  private readonly her = new CoverLayer();
  private readonly hair = new CoverLayer();
  private readonly skin = new CoverLayer();
  private mouth = 0;
  private readonly wraith = new Wraith();
  private readonly haunt: Haunt;
  private readonly logo: LogoArt;
  private pose: WraithPose = { x: 0, y: 0, hw: 1, tilt: 0, lean: 0, crouch: 0, ground: 0, face: 0, mouth: 0, grip: 0, bend: 0, part: 0, edgeAt: () => 0, t: 0, wind: 0 };
  private front = false;

  private readonly rnd = mulberry32(0xc01d);
  private dark = { next: 9, at: -1 };
  private glitch = { next: 8, until: -1, r0: 0, r1: 0, shift: 0 };
  /** What each cell shows on the canvas now (0 blank, -1 unknown), so a refresh only touches what changed. */
  private drawn = new Int32Array(0);
  private torn = new Uint8Array(0);
  private colX = new Int32Array(0);
  private rowY = new Int32Array(0);
  private repaint = true;
  private reported = false;
  private doneAt = -1;

  /** `canvas`: the forest, opaque; `fx`: a transparent canvas stacked above it for the eyes and the logo. */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly fx: HTMLCanvasElement,
    private readonly opts: MenuSceneOptions,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const fxc = fx.getContext('2d');
    if (!ctx || !fxc) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.fxc = fxc;
    this.haunt = new Haunt(0x5ee, opts.difficulty, true);
    this.logo = new LogoArt(opts.title);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    if (typeof document !== 'undefined' && document.fonts) {
      Promise.all(FACES.map((f) => document.fonts.load(f)))
        .then(() => {
          if (this.alive) this.logo.resize(this.W, this.H, this.dpr);
        })
        .catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ controls

  /** Start Game: she lunges, the screen goes black, then `onLunged`. */
  start(): void {
    if (this.phase !== 'live') return;
    this.phase = 'lunge';
    this.phaseT = 0;
    this.haunt.react('start');
  }

  /** Exit or Escape: she is gone in a blink, the forest fades, then `onLeft`. */
  leave(): void {
    if (this.phase !== 'live') return;
    this.phase = 'leaving';
    this.phaseT = 0;
    this.glitchAt(this.pose.y, 0.14);
  }

  destroy(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
  }

  // ------------------------------------------------------------------ sizing

  resize(): void {
    const W = Math.max(320, window.innerWidth);
    const H = Math.max(320, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.floor(W * dpr);
    this.canvas.height = Math.floor(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fx.width = this.canvas.width;
    this.fx.height = this.canvas.height;
    this.fx.style.width = `${W}px`;
    this.fx.style.height = `${H}px`;
    this.fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = [];

    this.ch = clamp(H / 74, 10, 16);
    this.cw = this.ch * 0.56;
    this.cols = Math.ceil(W / this.cw);
    this.rows = Math.ceil(H / this.ch);
    const n = this.cols * this.rows;
    this.lum = new Float32Array(n);
    this.code = new Uint16Array(n);
    this.tn = new Uint8Array(n);
    this.drawn = new Int32Array(n);
    this.torn = new Uint8Array(this.rows);
    this.colX = Int32Array.from({ length: this.cols + 1 }, (_, i) => Math.round(i * this.cw * dpr));
    this.rowY = Int32Array.from({ length: this.rows + 1 }, (_, j) => Math.round(j * this.ch * dpr));
    this.repaint = true;
    this.atlas = new GlyphAtlas(this.ch * 1.02, dpr, 0, 500, MONO);
    this.pal = [];
    for (let tt = 0; tt < TONES; tt++) for (let q = 0; q < STEPS; q++) this.pal.push(this.atlas.color(tone(tt, q)));

    // the moon is a glow in the mist behind where she hides; the menu's side sits in deeper dark
    this.sky = new Float32Array(n);
    this.shade = new Float32Array(n);
    for (let j = 0; j < this.rows; j++) {
      const y = (j + 0.5) * this.ch;
      for (let i = 0; i < this.cols; i++) {
        const x = (i + 0.5) * this.cw;
        const k = j * this.cols + i;
        // a wide moonlit haze, brightest behind her hiding place and high up among the limbs
        const mx = (x - W * 0.6) / (W * 0.42);
        const my = (y - H * 0.32) / (H * 0.55);
        const hx = (x - W * 0.62) / (W * 0.6);
        const hy = (y - H * 0.12) / (H * 0.32);
        this.sky[k] = 0.08 + 0.46 * Math.exp(-(mx * mx + my * my)) + 0.16 * Math.exp(-(hx * hx + hy * hy));
        const lx = (x - W * 0.2) / (W * 0.3);
        const ly = (y - H * 0.55) / (H * 0.5);
        // the menu's side is dimmer, but keeps enough mist for its glass to bend
        const menuDark = 1 - 0.38 * Math.exp(-(lx * lx + ly * ly));
        const vx = x / W - 0.56;
        const vy = y / H - 0.45;
        this.shade[k] = menuDark * clamp(1 - 1.25 * (vx * vx * 1.4 + vy * vy * 2), 0.18, 1);
      }
    }

    this.forest.resize(W, H, this.cols, this.rows, this.cw, this.ch);
    this.her.resize(this.cols, this.rows, this.cw, this.ch);
    this.hair.resize(this.cols, this.rows, this.cw, this.ch);
    this.skin.resize(this.cols, this.rows, this.cw, this.ch);
    this.logo.resize(W, H, dpr);
    this.gridAcc = 1;
  }

  // ------------------------------------------------------------------ loop

  private readonly frame = (now: number): void => {
    if (!this.alive) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.render(dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  private wind(t: number): number {
    return 0.55 * Math.sin(t * 0.37) + 0.3 * Math.sin(t * 0.91 + 1.3) + 0.15 * Math.sin(t * 2.3 + 0.4);
  }

  private update(dt: number): void {
    this.t += dt;
    this.phaseT += dt;
    const t = this.t;
    const rm = this.opts.reducedMotion;
    this.haunt.update(rm ? dt * 0.7 : dt);
    const h = this.haunt;

    // the light dips now and then (two quick dips, never more than three a second); she uses the dark
    let flicker = 1;
    if (!rm && this.phase === 'live') {
      if (t >= this.dark.next) {
        this.dark.at = t;
        this.dark.next = t + 16 + this.rnd() * 14;
        h.react('dark');
      }
      const s = t - this.dark.at;
      if (s >= 0 && s < 0.08) flicker = 0.55;
      else if (s >= 0.16 && s < 0.3) flicker = 0.4;
    }

    // a glitch where she vanished, and now and then on its own
    if (!rm) {
      if (h.flash > 0.95) this.glitchAt(this.pose.y, 0.08);
      if (t >= this.glitch.next) {
        this.glitchAt(this.H * (0.15 + 0.7 * this.rnd()), 0.07);
        this.glitch.next = t + 22 + this.rnd() * 20;
      }
    }

    // where she is and how she holds herself
    const place = this.forest.spot(h.spot);
    let hw = this.H * 0.125 * place.scale;
    const lean = h.shown;
    let x = lerp(place.edge + 0.7 * hw, place.edge - 0.95 * hw, lean);
    let y = place.y + Math.sin(t * 1.1) * 0.012 * hw + lean * 0.05 * hw;
    // bent sideways, her head hangs out past her shoulders and lower
    x -= h.bend * 0.4 * hw;
    y += h.bend * 0.35 * hw;
    let k = 0;
    if (this.phase === 'lunge' && !rm) {
      // she comes for the player: out from the tree and straight at the glass
      k = smoothstep(0.15, 0.9, h.lunge);
      hw *= 1 + 6.5 * k * k;
      x = lerp(x, this.W * 0.5, k);
      y = lerp(y, this.H * 0.42, k);
    }
    this.front = k > 0.05;
    // out in the open her face shows, and her mouth slowly falls open; in the lunge it gapes at once
    const mouthTo = this.phase === 'lunge' ? 1 : lean > 0.7 ? 1 : 0;
    const mouthRate = this.phase === 'lunge' ? 3 : mouthTo > this.mouth ? 0.22 : 1.2;
    this.mouth += Math.sign(mouthTo - this.mouth) * Math.min(Math.abs(mouthTo - this.mouth), mouthRate * dt);
    const face = this.front ? 1 : smoothstep(0.35, 0.85, lean);
    // her hands come round the trunk as she leans out of its shelter (not from the fork, not in the lunge)
    const grip = this.front || h.spot === 'fork' ? 0 : smoothstep(0.15, 0.55, lean);
    const f = this.forest;
    const edgeAt = (yy: number) => f.centre(yy) - f.half(yy);
    this.pose = { x, y, hw, tilt: h.tilt, lean, crouch: h.spot === 'roots' ? 1 : 0, ground: f.groundY(x), face, mouth: this.mouth, grip, bend: this.front ? 0 : h.bend, part: this.front ? 0 : h.part, edgeAt, t, wind: this.wind(t) };

    // overall light: the opening fade, the flickers, the lunge's dark, the exit's fade
    const intro = smoothstep(0.25, 2, t);
    let b = intro * flicker;
    if (this.phase === 'lunge') {
      b *= 1 - 0.85 * smoothstep(0.2, 0.8, h.lunge);
      if (h.done && h.lunge >= 1) b = 0;
      if (h.done && this.doneAt < 0) this.doneAt = t;
      if (this.doneAt >= 0 && !this.reported && t - this.doneAt > LUNGE_HOLD) {
        this.reported = true;
        this.phase = 'gone';
        this.opts.onLunged();
      }
    } else if (this.phase === 'leaving') {
      b *= 1 - smoothstep(0, 0.7, this.phaseT);
      if (this.phaseT >= 0.75 && !this.reported) {
        this.reported = true;
        this.phase = 'gone';
        this.opts.onLeft();
      }
    } else if (this.phase === 'gone') b = 0;
    this.bright = b;
  }

  private glitchAt(y: number, dur: number): void {
    if (this.opts.reducedMotion) return;
    const row = Math.floor(y / this.ch);
    const span = 1 + Math.floor(this.rnd() * 2);
    this.glitch.r0 = Math.max(0, row - span);
    this.glitch.r1 = Math.min(this.rows - 1, row + span);
    this.glitch.shift = (this.rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(this.rnd() * 2));
    this.glitch.until = this.t + dur;
  }

  // ------------------------------------------------------------------ the character grid

  private compose(): void {
    const { cols, rows, cw, ch, W, H, t } = this;
    const { lum, code, tn, sky, shade } = this;
    const f = this.forest;
    const trunk = f.trunk;
    const limbs = f.limbs;
    const br = f.brambles;
    const her = this.her;
    const h = this.haunt;
    const p = this.pose;
    const wind = this.wind(t);
    f.update(t, wind);
    const hair = this.hair;
    const skin = this.skin;
    her.clear();
    hair.clear();
    skin.clear();
    if (h.shown > 0.01 || h.eyes > 0.02 || this.front) this.wraith.paint(her, hair, skin, p);
    const wraith = this.wraith;
    let herC = 0;
    let herT = 2;
    // Her at one cell, or -1 where she isn't: the hair is a void with fine moonlit edges; between the hair,
    // when she is out, her face. Sets herC (the character, 0 for the ramp) and herT (the palette).
    const herAt = (k: number, x: number, y: number, L: number): number => {
      const wb = her.cover[k]!;
      const wh = hair.cover[k]!;
      if (wb <= 0.02 && wh <= 0.02) return -1;
      herC = 0;
      herT = 2;
      if (wh >= 0.7) return 0;
      if (wb >= 0.85) {
        const fv = p.face > 0 ? wraith.faceAt(p, x, y) : -1;
        if (fv < 0) {
          if (wh > 0.3) {
            herC = strokeChar(hair.angle[k]!);
            return 0.06;
          }
          // her shroud: long dark folds hanging straight, stirring
          const fold = 0.5 + 0.5 * Math.sin(x * 0.11 + 2.2 * Math.sin(y * 0.012 + t * 0.45));
          if (fold > 0.82) {
            herC = fold > 0.93 ? 124 : 58; // '|' ':'
            return 0.08 + 0.06 * (fold - 0.82) * 9;
          }
          return 0;
        }
        if (fv === 0) return 0;
        herT = 4;
        let fl = (0.05 + 0.4 * fv) * p.face;
        // strands across her face
        if (wh > 0.02) {
          fl *= 1 - wh;
          if (wh > 0.3) {
            herC = strokeChar(hair.angle[k]!);
            herT = 2;
          }
        }
        return fl;
      }
      // an edge: the moon catches the outermost hairs
      const w = Math.max(wb, wh);
      const rim = 0.36 * w * (1 - w) * 4;
      if (w > 0.25) herC = strokeChar((wh >= wb ? hair : her).angle[k]!);
      return L * (1 - w) * 0.6 + rim;
    };

    // her presence bends the mist around her; her eyes light it
    const presence = this.front ? 1 : clamp(Math.max(h.eyes * 0.55, h.shown));
    const R2 = (p.hw * 2.3) ** 2;
    const eyes = this.wraith.eyes(p);
    const seen = eyes.map((e) => this.front || !f.hides(e.x, e.y));
    const eyeLit = h.eyes * (1 - h.blink * 0.7);
    const rl2 = (p.hw * 0.55) ** 2;
    const bigX = 192 / W;
    const bigY = 96 / H;
    const fineX = 256 / W;
    const fineY = 128 / H;
    const mistTop = H * 0.7;
    const b = this.bright;

    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * ch;
      const gm = y > mistTop ? smoothstep(mistTop, H * 0.99, y) : 0;
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const x = (i + 0.5) * cw;
        let wx = x;
        let wy = y;
        let shimmer = 0;
        if (presence > 0.01) {
          const dx = x - p.x;
          const dy = y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2 * 5) {
            const a = presence * Math.exp(-d2 / R2);
            wx += Math.sin(y * 0.05 + t * 3.1) * a * 18;
            wy += Math.cos(x * 0.04 + t * 2.3) * a * 9;
            shimmer = a * 0.11 * Math.sin(Math.sqrt(d2) * 0.09 - t * 5);
          }
        }
        // sampled turned, so the noise's square lattice never shows as edges
        const m1 = this.mistBig.sample((wx * 0.83 - wy * 0.56) * bigX * 0.9 + t * 1.1, (wx * 0.56 + wy * 0.83) * bigY * 0.9);
        const m2 = this.mistFine.sample((wx * 0.91 + wy * 0.41) * fineX * 1.6 - t * 3.2, (wy * 0.91 - wx * 0.41) * fineY * 1.6 + t * 0.5);
        const m = smoothstep(0.12, 0.92, 0.58 * m1 + 0.42 * m2);
        let L = sky[k]! * (0.32 + 1.0 * m) + shimmer;
        let c = 0;
        let tt = 0;

        if (eyeLit > 0.02) {
          for (let e = 0; e < 2; e++) {
            if (!seen[e]) continue;
            const ex = x - eyes[e]!.x;
            const ey = y - eyes[e]!.y;
            L += 0.16 * eyeLit * Math.exp(-(ex * ex + ey * ey) / rl2);
          }
        }

        // her, behind the tree
        if (!this.front) {
          const hl = herAt(k, x, y, L);
          if (hl >= 0) {
            L = hl;
            c = herC;
            tt = herT;
          }
        }

        // ground: dark earth, a fringe of dead grass along its edge
        const g = f.groundRow[i]!;
        if (j >= g) {
          L = 0.025 + 0.03 * hash2(i, j, 7);
          c = j === g && hash2(i, 0, 9) < 0.55 ? GRASS[Math.floor(hash2(i, j, 13) * GRASS.length)]! : 0;
          tt = 3;
          if (c) L = 0.16 + 0.1 * hash2(i, 1, 4);
        }

        // the trunk: twisted bark, the left rim catching the moon
        const tc = trunk.cover[k]!;
        if (tc > 0.02) {
          const u = trunk.tone[k]!;
          const rim = Math.exp(-u * 7) * 0.62 + Math.exp(-(1 - u) * 14) * 0.08;
          const twist = 0.45 * Math.sin(y * 0.012 + u * 4.2) + 0.25 * Math.sin(y * 0.031 - u * 7);
          const grain = 0.5 + 0.5 * Math.sin(u * 34 + twist * 6 + this.mistBig.sample(i * 0.7, j * 0.35) * 7);
          const barkL = 0.02 + 0.08 * grain * grain + rim * 0.5;
          L = L * (1 - tc) + barkL * tc;
          tt = 1;
          if (tc < 0.85) {
            // the trunk's outline, catching the moon: brighter on the left
            c = u < 0.5 ? C_PAREN_L : C_PAREN_R;
            L = u < 0.5 ? 0.5 : 0.3;
          } else if (rim > 0.2) c = strokeChar(Math.PI / 2 + twist * 0.9);
          else if (hash2(i >> 1, j >> 1, 21) > 0.988) c = KNOT[Math.floor(hash2(i, j, 5) * KNOT.length)]!;
          else if (grain > 0.74) c = strokeChar(Math.PI / 2 + twist * 0.9);
          else if (grain > 0.55) c = hash2(i, j, 17) < 0.5 ? C_COLON : C_DOT;
          else c = 0;
          if (c === 0) L = Math.min(L, 0.03);
        }

        // the limbs: thick ones in bark, thin ones as dark strokes through the mist
        const lc = limbs.cover[k]!;
        if (lc > 0.04) {
          if (lc > 0.85) {
            // a black silhouette, with a grain line here and there
            const lit = hash2(i, j, 33) < 0.3;
            L = lit ? 0.05 + 0.05 * hash2(i, j, 31) : 0;
            c = lit ? strokeChar(limbs.angle[k]!) : 0;
          } else if (lc > 0.16) {
            // a limb's edge, or a twig: drawn as a moonlit line
            c = strokeChar(limbs.angle[k]!);
            L = 0.2 + 0.22 * lc;
          } else L *= 1 - 0.6 * lc;
          tt = 1;
        }

        // her fingers, pale over the dark bark
        const sk = skin.cover[k]!;
        if (sk > 0.12) {
          const neckSkin = skin.tone[k]! < 0.7;
          L = neckSkin ? 0.12 + 0.24 * sk : 0.2 + 0.36 * sk;
          c = sk > 0.75 ? (neckSkin ? 58 : 61) : strokeChar(skin.angle[k]!); // ':' '='
          tt = 4;
        }

        // her, in the lunge: in front of everything but the brambles
        if (this.front) {
          const hl = herAt(k, x, y, L);
          if (hl >= 0) {
            L = hl;
            c = herC;
            tt = herT;
          }
        }

        // brambles, black against everything
        const bc = br.cover[k]!;
        if (bc > 0.05) {
          if (bc > 0.8) {
            L = 0;
            c = 0;
          } else {
            L = L * (1 - bc) * 0.6 + 0.015;
            if (bc > 0.2) c = strokeChar(br.angle[k]!);
          }
          tt = 1;
        }

        // ground mist drifting in front, over the roots and the brambles
        if (gm > 0) {
          const mm = this.mistFine.sample(x * fineX * 0.7 + t * 2.2, y * fineY * 2.4);
          const add = gm * smoothstep(0.35, 0.9, mm) * 0.34;
          if (add > 0.02) {
            L = L + add * (1 - L);
            if (add > 0.1 && c !== 0 && tt !== 0) c = 0;
            if (c === 0) tt = 0;
          }
        }

        lum[k] = clamp(L * shade[k]! * b);
        code[k] = c;
        tn[k] = tt;
      }
    }
  }

  /**
   * Stamps the grid onto the canvas, but only the cells whose character or colour changed since the last
   * refresh: the mist drifts by less than a pixel a refresh, so most cells stay as they are. Rows a glitch
   * tears sideways (and puts back) are redrawn whole. Everything here is in device pixels, cell edges snapped,
   * so a cleared cell leaves no seam.
   */
  private drawGrid(): void {
    const g = this.ctx;
    const { cols, rows, cw, ch, lum, code, tn, atlas, pal, drawn, colX, rowY, dpr } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#020203';
    if (this.repaint) {
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      drawn.fill(0);
      this.repaint = false;
    }
    // a band torn sideways while a glitch lasts; the band it tore last time is put back
    const gl = this.glitch;
    const tearing = this.t < gl.until;
    const torn = this.torn;
    const r0 = tearing ? gl.r0 : -1;
    const r1 = tearing ? gl.r1 : -2;
    for (let j = 0; j < rows; j++) {
      const was = torn[j] === 1;
      const now = j >= r0 && j <= r1;
      if (was || now) {
        g.fillRect(0, rowY[j]!, this.canvas.width, rowY[j + 1]! - rowY[j]!);
        drawn.fill(-1, j * cols, (j + 1) * cols);
      }
      torn[j] = now ? 1 : 0;
    }
    const nf = FOG.length;
    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * ch * dpr;
      const ox = j >= r0 && j <= r1 ? gl.shift * cw * dpr : 0;
      const ya = rowY[j]!;
      const yh = rowY[j + 1]! - ya;
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const L = lum[k]!;
        let c = 0;
        let color = 0;
        if (L >= 0.035) {
          c = code[k]!;
          if (c === 0) {
            const idx = Math.floor(L * nf * 1.12 + (hash2(i, j, 2) - 0.5) * 0.9);
            c = idx <= 0 ? 0 : FOG[Math.min(nf - 1, idx)]!;
          }
          if (c !== 0) color = pal[tn[k]! * STEPS + Math.min(STEPS - 1, Math.floor(Math.pow(L, 0.82) * STEPS))]!;
        }
        const key = c === 0 ? 0 : c * 128 + color + 1;
        if (key === drawn[k]) continue;
        // an unchanged blank needs nothing; anything else clears its cell first
        if (drawn[k] !== 0 || ox !== 0) g.fillRect(colX[i]! + ox, ya, colX[i + 1]! - colX[i]!, yh);
        drawn[k] = key;
        if (c !== 0) atlas.draw(g, c, color, (i + 0.5) * cw * dpr + ox, y, dpr);
      }
    }
  }

  // ------------------------------------------------------------------ drawing

  private render(dt: number): void {
    const { W, H, t } = this;
    this.gridAcc += dt;
    if (this.gridAcc >= 1 / GRID_HZ) {
      this.gridAcc = 0;
      this.compose();
      this.drawGrid();
    }

    // the overlay: wipe only what was drawn last frame
    const fx = this.fxc;
    for (const [x, y, w, h] of this.dirty) fx.clearRect(x, y, w, h);
    this.dirty = [];

    // the logo, top left over the dark, bleeding
    const logo = this.logo;
    const reveal = this.phase === 'live' ? smoothstep(0.6, 2.6, t) : clamp(this.bright * 1.2);
    logo.render(t, reveal);
    if (reveal > 0) {
      const lx = Math.round(W * 0.03 - logo.inkLeft);
      const ly = Math.round(H * 0.04 - logo.inkTop);
      fx.drawImage(logo.canvas, lx, ly, logo.width, logo.height);
      logo.drawDrips(fx, lx, ly, t, reveal);
      // the drops fall up to about twenty-five of the logo's rows below it
      this.dirty.push([lx - 4, ly - 4, logo.width + 8, logo.height + logo.ch * 25 + 8]);
    }

    this.drawEyes();
  }

  private drawEyes(): void {
    const h = this.haunt;
    if (h.eyes < 0.02 || this.phase === 'gone') return;
    const ctx = this.fxc;
    const p = this.pose;
    const eyes = this.wraith.eyes(p);
    const lunge = this.phase === 'lunge' ? smoothstep(0.3, 0.95, h.lunge) : 0;
    // the eyes outlast the light: they stay through the flickers, and are the last thing in the lunge
    const fade = this.phase === 'leaving' ? 1 - smoothstep(0, 0.25, this.phaseT) : this.phase === 'lunge' && h.done ? 0 : 1;
    const a = h.eyes * fade * smoothstep(0.3, 0.9, this.t);
    if (a <= 0.01) return;
    const open = Math.max(0.08, 1 - h.blink);
    const red = lunge;
    const core = `rgb(255,${Math.round(lerp(250, 60, red))},${Math.round(lerp(245, 55, red))})`;
    const haloRgb = `${Math.round(lerp(205, 255, red))},${Math.round(lerp(222, 40, red))},${Math.round(lerp(255, 40, red))}`;
    for (const e of eyes) {
      if (!this.front && this.forest.hides(e.x, e.y)) continue;
      const r = Math.max(2.2, e.r);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // a tight halo, so the two eyes stay two points of light and never merge into one lamp
      const hr = r * (4.6 + 3 * red);
      const reach = Math.max(hr, r * 8) + 4;
      this.dirty.push([e.x - reach, e.y - reach, reach * 2, reach * 2]);
      const halo = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, hr);
      halo.addColorStop(0, `rgba(${haloRgb},${0.3 * a})`);
      halo.addColorStop(0.3, `rgba(${haloRgb},${0.08 * a})`);
      halo.addColorStop(1, `rgba(${haloRgb},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(e.x - hr, e.y - hr, hr * 2, hr * 2);
      ctx.restore();
      // an almond of white-hot light with a pinpoint pupil that never stops trembling
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = core;
      ctx.shadowBlur = r * 6;
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, r * 1.6, r * 0.78 * open, this.pose.tilt, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = r * 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, r * 1.05, r * 0.5 * open, this.pose.tilt, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (open > 0.35) {
        const jx = Math.sin(this.t * 23 + e.x) * r * 0.08;
        const jy = Math.cos(this.t * 19 + e.y) * r * 0.06;
        ctx.fillStyle = red > 0.3 ? 'rgba(40,0,0,0.95)' : 'rgba(6,8,12,0.95)';
        ctx.beginPath();
        ctx.ellipse(e.x + jx, e.y + jy, r * 0.22, r * 0.22 * Math.min(1, open * 1.4), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}


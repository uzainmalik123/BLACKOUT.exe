// How she haunts the menu (UI-02, D-181), free of the DOM so it can be tested. She hides only once, when the
// screen opens: her eyes come first, then she comes out. After that she never hides again. She stays on show and
// restless: she leans out, bends sideways with her head hanging, tilts and twitches her head, sweeps her hair off
// her neck, and every few seconds darts in and turns up somewhere else round the tree, coming out fast. Now and
// then her motion goes stop-motion. She moves on her own: nothing the player does in the menu reaches her, except
// Start Game, which makes her lunge as the screen ends. How far she dares is set once, by the difficulty the menu
// opened on.

import type { Difficulty } from '../../rules/vocabulary';
import { mulberry32 } from '../shared/math';

export type Spot = 'trunk' | 'fork' | 'roots';
export type Mode = 'hidden' | 'eyes' | 'peek' | 'lean' | 'bend' | 'shift' | 'lunge';
/** What reaches her: the light dipping (she is elsewhere when it returns) and the start (she lunges). */
export type HauntEvent = 'dark' | 'start';

/** How much she dares: Easy has her mostly peeking, Hard has her leaning and bending right out. */
export const BOLDNESS: Record<Difficulty, number> = { easy: 0.15, medium: 0.5, hard: 0.9 };
/** How far out each place lets her lean (1 = head and shoulders clear of the trunk). */
export const SPOT_MAX_LEAN: Record<Spot, number> = { trunk: 1.05, fork: 0.65, roots: 0.85 };
const SPOTS: readonly Spot[] = ['trunk', 'fork', 'roots'];

/** Lean per second coming out (sudden), darting back in to change place (sudden), easing between poses. */
export const EMERGE = 3.2;
export const DART = 3.6;
export const EASE = 1.1;
export const LUNGE_SECONDS = 1.5;
/** How far in she goes while changing place: never out of sight. */
export const SHIFT_LEAN = 0.24;
/** Shown lean is held this long per frame while her motion goes stop-motion. */
const STOP_MOTION_FRAME = 1 / 7;

export class Haunt {
  mode: Mode = 'hidden';
  spot: Spot = 'trunk';
  /** True lean: 0 behind the trunk, 1 head and shoulders out, past 1 only in the lunge. */
  lean = 0;
  /** Lean as drawn: lags behind `lean` while the motion is stop-motion. */
  shown = 0;
  /** 0 dark .. 1 glowing. */
  eyes = 0;
  /** Head tilt in radians; negative tips the crown out, away from the trunk. */
  tilt = 0;
  /** 0 upright .. 1 bent sideways out of the tree, head hanging low. */
  bend = 0;
  /** 0 hair down .. 1 hair swept off her neck. */
  part = 0;
  /** 0 open .. 1 shut. */
  blink = 0;
  /** 0..1 through the lunge. */
  lunge = 0;
  /** Kept for the scene's glitch hook; she no longer vanishes, so it stays 0. */
  flash = 0;
  /** The lunge has finished: the scene cuts to black and hands over. */
  done = false;
  /** She has come out once; from then on she never hides. */
  revealed = false;

  private t = 0;
  private modeT = 0;
  private modeDur = 0;
  private leanTarget = 0;
  private eyesTarget = 0;
  private tiltTarget = 0;
  private bendTarget = 0;
  private partTarget = 0;
  private boldness: number;
  private nextBlink = 2.5;
  private blinkT = -1;
  private doubleBlink = false;
  private holdUntil = 0;
  private stutterUntil = -1;
  private nextStutter: number;
  private nextTwitch: number;
  private nextShift: number;
  private readonly rnd: () => number;

  /** `opening`: dark for a moment, then her eyes, then she comes out. Without it she starts out already. */
  constructor(seed = 0x5ee, difficulty: Difficulty = 'medium', opening = true) {
    this.rnd = mulberry32(seed);
    this.boldness = BOLDNESS[difficulty];
    this.nextStutter = this.range(2, 4);
    this.nextTwitch = this.range(2, 4);
    this.nextShift = this.range(5, 8);
    if (opening) {
      this.mode = 'hidden';
      this.modeDur = 0.6;
    } else {
      this.revealed = true;
      this.eyes = 1;
      this.enter('peek');
      this.lean = this.shown = this.leanTarget;
    }
  }

  /** True while any of her shows. */
  get visible(): boolean {
    return this.eyes > 0.05 || this.shown > 0.02;
  }

  private range(a: number, b: number): number {
    return a + (b - a) * this.rnd();
  }

  private otherSpot(): Spot {
    const others = SPOTS.filter((s) => s !== this.spot);
    return others[Math.floor(this.rnd() * others.length)]!;
  }

  /** A pose to hold: bolder means further out and more often bent. */
  private pickPose(): Mode {
    const b = this.boldness;
    const r = this.rnd();
    if (r < 0.6 - 0.45 * b) return 'peek';
    if (r < 0.85 - 0.2 * b) return 'lean';
    return 'bend';
  }

  private enter(mode: Mode): void {
    this.mode = mode;
    this.modeT = 0;
    const b = this.boldness;
    const cap = mode === 'lunge' ? Infinity : SPOT_MAX_LEAN[this.spot];
    this.bendTarget = 0;
    this.eyesTarget = mode === 'hidden' ? 0 : 1;
    switch (mode) {
      case 'hidden':
        this.leanTarget = 0;
        this.modeDur = 0.6;
        break;
      case 'eyes':
        this.leanTarget = Math.min(cap, 0.2);
        this.modeDur = this.range(0.9, 1.4);
        this.tiltTarget = this.range(-0.1, 0.1);
        break;
      case 'peek':
        this.leanTarget = Math.min(cap, 0.38 + 0.3 * b);
        this.modeDur = this.range(2, 3.6);
        this.tiltTarget = -this.range(0.15, 0.55);
        break;
      case 'lean':
        this.leanTarget = Math.min(cap, 0.7 + 0.32 * b);
        this.modeDur = this.range(2, 3.6);
        this.tiltTarget = this.range(-0.75, 0.3);
        break;
      case 'bend':
        this.leanTarget = Math.min(cap, 1);
        this.bendTarget = 1;
        this.modeDur = this.range(1.8, 3);
        this.tiltTarget = -this.range(0.45, 0.85);
        break;
      case 'shift':
        // in, fast, but never out of sight; then she turns up somewhere else
        this.leanTarget = SHIFT_LEAN;
        this.modeDur = 0.05;
        break;
      case 'lunge':
        this.leanTarget = 1.25;
        this.modeDur = LUNGE_SECONDS;
        this.tiltTarget = -0.1;
        break;
    }
    // now and then, while she is out, she sweeps her hair off her neck
    if (mode === 'lean' || mode === 'bend') this.partTarget = this.rnd() < 0.55 ? 1 : 0;
    else if (mode !== 'shift') this.partTarget = 0;
  }

  /** She is somewhere else, already out: used after a dart and when the light dips. */
  private relocate(): void {
    this.spot = this.otherSpot();
    this.enter(this.pickPose());
  }

  private next(): void {
    switch (this.mode) {
      case 'hidden':
        this.spot = 'trunk';
        this.enter('eyes');
        break;
      case 'eyes':
        this.revealed = true;
        this.enter('peek');
        break;
      case 'shift':
        this.relocate();
        this.lean = this.shown = SHIFT_LEAN;
        break;
      case 'lunge':
        this.done = true;
        break;
      default:
        if (this.t >= this.nextShift) {
          this.nextShift = this.t + this.range(4, 8);
          this.enter('shift');
        } else this.enter(this.pickPose());
    }
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    // a pose is held for its time once she has reached it; a dart ends the moment she is in
    const arrived = Math.abs(this.leanTarget - this.lean) < 0.04;
    this.modeT += arrived || this.mode === 'hidden' ? dt : dt * 0.15;
    if (this.mode === 'lunge') {
      this.lunge = Math.min(1, this.lunge + dt / LUNGE_SECONDS);
      if (this.lunge >= 1) this.done = true;
    } else if (this.modeT >= this.modeDur) this.next();

    const d = this.leanTarget - this.lean;
    let rate: number;
    if (this.mode === 'lunge') rate = 7;
    else if (this.mode === 'shift') rate = DART;
    else if (d > 0) rate = this.lean < 0.4 ? EMERGE : EASE * 1.6;
    else rate = EASE;
    this.lean += Math.sign(d) * Math.min(Math.abs(d), rate * dt);

    // stop-motion: for a second or so at a time, she is drawn only a few times a second
    if (t >= this.nextStutter) {
      this.stutterUntil = t + this.range(0.5, 1.2);
      this.nextStutter = t + this.range(3, 7);
    }
    if (t < this.stutterUntil && this.mode !== 'lunge') {
      if (t >= this.holdUntil) {
        this.shown = this.lean;
        this.holdUntil = t + STOP_MOTION_FRAME;
      }
    } else this.shown = this.lean;

    const de = this.eyesTarget - this.eyes;
    this.eyes += Math.sign(de) * Math.min(Math.abs(de), 5 * dt);
    const db = this.bendTarget - this.bend;
    this.bend += Math.sign(db) * Math.min(Math.abs(db), 1.4 * dt);
    const dp = this.partTarget - this.part;
    this.part += Math.sign(dp) * Math.min(Math.abs(dp), (dp > 0 ? 0.7 : 0.45) * dt);

    // head: drifts toward where it wants to be, with sudden twitches
    const dtilt = this.tiltTarget - this.tilt;
    this.tilt += Math.sign(dtilt) * Math.min(Math.abs(dtilt), 1.1 * dt);
    if (t >= this.nextTwitch) {
      if (this.revealed && this.mode !== 'lunge') this.tilt += (this.rnd() < 0.5 ? -1 : 1) * this.range(0.25, 0.6);
      this.nextTwitch = t + this.range(1.8, 4.5);
    }

    // blinking, sometimes twice
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const len = 0.2;
      if (this.blinkT >= len) {
        this.blink = 0;
        if (this.doubleBlink) {
          this.doubleBlink = false;
          this.blinkT = -0.12;
        } else {
          this.blinkT = -1;
          this.nextBlink = t + this.range(2.5, 6);
        }
      } else this.blink = Math.sin((Math.PI * this.blinkT) / len);
    } else if (this.blinkT < -0.5) {
      if (t >= this.nextBlink && this.eyes > 0.5) {
        this.blinkT = 0;
        this.doubleBlink = this.rnd() < 0.2;
      }
    } else {
      // the pause inside a double blink
      this.blinkT += dt;
      if (this.blinkT >= 0) this.blinkT = 0;
    }
  }

  /** The dark and the start reach her here; nothing else does. */
  react(e: HauntEvent): void {
    if (this.mode === 'lunge') return;
    if (e === 'start') {
      this.spot = 'trunk';
      this.lean = this.shown = Math.max(this.lean, 0.3);
      this.eyes = 1;
      this.revealed = true;
      this.enter('lunge');
      return;
    }
    // when the light dips she is somewhere else by the time it comes back (not during the opening)
    if (!this.revealed) return;
    this.relocate();
    this.lean = this.shown = this.leanTarget;
  }
}

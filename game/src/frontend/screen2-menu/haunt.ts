// How she haunts the menu (UI-02, D-181), free of the DOM so it can be tested. She hides behind the dead tree
// and is never on show for long: her eyes come first, then she leans out and tilts her head, then she retreats,
// vanishes, or turns up somewhere else. She comes out fast, in a jerk, and withdraws slowly, watching, and now
// and then her motion goes stop-motion. She answers the menu: a move makes her peek further, shift or vanish; the difficulty sets
// how bold she is; Start Game makes her lunge.

import type { Difficulty } from '../../rules/vocabulary';
import { mulberry32 } from '../shared/math';

export type Spot = 'trunk' | 'fork' | 'roots';
export type Mode = 'hidden' | 'eyes' | 'peek' | 'lean' | 'retreat' | 'lunge';
export type HauntEvent = 'move' | 'scenario' | 'dark' | 'start' | { difficulty: Difficulty };

/** How much she dares: Easy keeps her mostly hidden, Hard has her lean right out. */
export const BOLDNESS: Record<Difficulty, number> = { easy: 0.15, medium: 0.5, hard: 0.9 };
/** How far out each hiding place lets her lean (1 = head and shoulders clear of the trunk). */
export const SPOT_MAX_LEAN: Record<Spot, number> = { trunk: 1, fork: 0.5, roots: 0.7 };
const SPOTS: readonly Spot[] = ['trunk', 'fork', 'roots'];

/** Lean per second coming out (sudden) and sinking back behind the trunk (slow, in pauses). */
export const EMERGE = 3.2;
export const SINK = 0.32;
export const LUNGE_SECONDS = 1.5;
/** A burst of menu moves gets one answer, not one per key. */
export const REACT_COOLDOWN = 0.3;
/** Shown lean is held this long per frame while her motion goes stop-motion. */
const STOP_MOTION_FRAME = 1 / 7;

const LEAN_OF: Record<Mode, number> = { hidden: 0, eyes: 0.17, peek: 0.5, lean: 0.92, retreat: 0, lunge: 1.25 };

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
  /** 0 open .. 1 shut. */
  blink = 0;
  /** 0..1 through the lunge. */
  lunge = 0;
  /** A vanish's glitch, 1 at the instant she goes, fading. */
  flash = 0;
  /** The lunge has finished: the scene cuts to black and hands over. */
  done = false;

  private t = 0;
  private modeT = 0;
  private modeDur = 0;
  private leanTarget = 0;
  private eyesTarget = 0;
  private tiltTarget = 0;
  private boldness: number;
  private nextBlink = 2.5;
  private blinkT = -1;
  private doubleBlink = false;
  private holdUntil = 0;
  private stutterUntil = -1;
  private nextStutter: number;
  private nextTwitch: number;
  private lastReact = -Infinity;
  private pendingSpot: Spot | null = null;
  private readonly rnd: () => number;

  /** `opening`: her eyes are the first thing the screen shows, a moment after it appears. */
  constructor(seed = 0x5ee, difficulty: Difficulty = 'medium', opening = true) {
    this.rnd = mulberry32(seed);
    this.boldness = BOLDNESS[difficulty];
    this.nextStutter = this.range(2, 4);
    this.nextTwitch = this.range(3, 6);
    if (opening) {
      this.mode = 'hidden';
      this.modeDur = 0.6;
      this.pendingSpot = 'trunk';
    } else this.enter('hidden');
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

  private enter(mode: Mode): void {
    this.mode = mode;
    this.modeT = 0;
    const b = this.boldness;
    // a bold one hides briefly and holds each pose longer; a timid one the other way round
    const hold = 0.55 + 0.9 * b;
    this.leanTarget = Math.min(LEAN_OF[mode], mode === 'lunge' ? Infinity : SPOT_MAX_LEAN[this.spot]);
    switch (mode) {
      case 'hidden':
        this.eyesTarget = 0;
        this.modeDur = this.range(3.5, 7.5) * (1.7 - b * 1.3);
        break;
      case 'eyes':
        this.eyesTarget = 1;
        this.modeDur = this.range(1.8, 3.2) * hold;
        this.tiltTarget = this.range(-0.08, 0.1);
        break;
      case 'peek':
        this.eyesTarget = 1;
        this.modeDur = this.range(2.5, 5) * hold;
        this.tiltTarget = -this.range(0.12, 0.42);
        break;
      case 'lean':
        this.eyesTarget = 1;
        this.modeDur = this.range(1.6, 3) * hold;
        this.tiltTarget = -this.range(0.25, 0.55);
        break;
      case 'retreat':
        this.modeDur = 0.8;
        break;
      case 'lunge':
        this.eyesTarget = 1;
        this.modeDur = LUNGE_SECONDS;
        this.tiltTarget = -0.1;
        break;
    }
  }

  /** Gone in a frame: no slide back, just absence, and a glitch where she was. */
  private vanish(returnSoon: boolean): void {
    this.lean = 0;
    this.shown = 0;
    this.eyes = 0;
    this.flash = 1;
    this.enter('hidden');
    if (returnSoon) {
      this.modeDur = 0.4;
      this.pendingSpot = this.otherSpot();
    }
  }

  private next(): void {
    const b = this.boldness;
    switch (this.mode) {
      case 'hidden':
        this.spot = this.pendingSpot ?? (this.rnd() < 0.6 ? 'trunk' : this.otherSpot());
        this.pendingSpot = null;
        this.enter('eyes');
        break;
      case 'eyes':
        this.enter(this.rnd() < 0.7 + 0.2 * b ? 'peek' : 'retreat');
        break;
      case 'peek':
        this.enter(this.rnd() < 0.25 + 0.5 * b ? 'lean' : 'retreat');
        break;
      case 'lean':
        if (this.rnd() < 0.12) this.vanish(false);
        else this.enter('retreat');
        break;
      case 'retreat':
        this.enter('hidden');
        break;
      case 'lunge':
        this.done = true;
        break;
    }
  }

  update(dt: number): void {
    this.t += dt;
    // a pose is held for its time once she has reached it, not while she is still moving into it; a retreat
    // lasts until she is all the way back (bounded, so a pose she cannot reach still ends)
    const arrived = Math.abs(this.leanTarget - this.lean) < 0.04;
    this.modeT += arrived || this.mode === 'hidden' ? dt : dt * 0.15;
    const t = this.t;
    if (this.mode === 'lunge') {
      this.lunge = Math.min(1, this.lunge + dt / LUNGE_SECONDS);
      if (this.lunge >= 1) this.done = true;
    } else if (this.modeT >= this.modeDur) this.next();

    // lean: out in a sudden jerk; back behind the trunk slowly, in pauses, never taking her eyes off you
    const d = this.leanTarget - this.lean;
    let rate: number;
    if (this.mode === 'lunge') rate = 7;
    else if (d > 0) rate = EMERGE;
    else {
      const surge = Math.max(0, Math.sin(t * 1.3 + 0.6));
      rate = SINK * (0.3 + 1.5 * surge * surge);
    }
    this.lean += Math.sign(d) * Math.min(Math.abs(d), rate * dt);

    // stop-motion: for a second or so at a time, she is drawn only a few times a second
    if (t >= this.nextStutter) {
      this.stutterUntil = t + this.range(0.5, 1.2);
      this.nextStutter = t + this.range(2.5, 6);
    }
    if (t < this.stutterUntil && this.mode !== 'lunge') {
      if (t >= this.holdUntil) {
        this.shown = this.lean;
        this.holdUntil = t + STOP_MOTION_FRAME;
      }
    } else this.shown = this.lean;

    // eyes: on quickly; while she withdraws they stay lit until she is behind the trunk
    if (this.mode === 'retreat' || this.mode === 'hidden') this.eyesTarget = this.lean > 0.06 ? 1 : 0;
    const de = this.eyesTarget - this.eyes;
    this.eyes += Math.sign(de) * Math.min(Math.abs(de), 5 * dt);

    // head: drifts toward where it wants to be, with an occasional twitch
    const dtilt = this.tiltTarget - this.tilt;
    this.tilt += Math.sign(dtilt) * Math.min(Math.abs(dtilt), 0.8 * dt);
    if (t >= this.nextTwitch) {
      if (this.visible) this.tilt += (this.rnd() - 0.5) * 0.45;
      this.nextTwitch = t + this.range(3, 8);
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

    this.flash = Math.max(0, this.flash - dt * 3);
  }

  /** The menu, the dark and the start reach her here. */
  react(e: HauntEvent): void {
    if (this.mode === 'lunge') return;
    if (e === 'start') {
      this.spot = 'trunk';
      this.lean = this.shown = Math.max(this.lean, 0.3);
      this.eyes = 1;
      this.enter('lunge');
      return;
    }
    if (this.t - this.lastReact < REACT_COOLDOWN) return;
    this.lastReact = this.t;
    if (e === 'move') {
      switch (this.mode) {
        case 'hidden':
          this.spot = this.rnd() < 0.5 ? this.otherSpot() : this.spot;
          this.enter('eyes');
          break;
        case 'eyes':
          this.enter('peek');
          break;
        case 'peek':
          this.enter('lean');
          break;
        case 'lean':
          // gone in a blink, and back somewhere else a moment later
          this.vanish(true);
          break;
        case 'retreat':
          break;
      }
    } else if (e === 'scenario') {
      this.tilt += this.tilt > 0 ? -0.5 : 0.5;
      if (this.mode === 'hidden') this.enter('eyes');
    } else if (e === 'dark') {
      // when the light dips she is somewhere else by the time it comes back
      if (this.visible && this.rnd() < 0.6) {
        this.spot = this.otherSpot();
        this.enter('peek');
        this.lean = this.shown = this.leanTarget;
      }
    } else {
      this.boldness = BOLDNESS[e.difficulty];
      if (e.difficulty === 'easy') {
        if (this.mode !== 'hidden') this.enter('retreat');
      } else if (e.difficulty === 'medium') this.enter(this.mode === 'hidden' ? 'eyes' : 'peek');
      else {
        if (this.spot !== 'trunk') {
          this.spot = 'trunk';
          this.lean = this.shown = 0.2;
        }
        this.enter('lean');
      }
    }
  }
}

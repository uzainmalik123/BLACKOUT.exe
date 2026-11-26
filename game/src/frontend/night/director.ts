// The night shift's director (UI-04..UI-10, D-223): the one frame loop behind screens 4 and 5, outside React. It runs
// the prologue's state machine (flow.ts), the engine's clock (`engine.advance`, from the login), turns the engine's
// events into the room's reactions (beats, sounds, Death's taunts, Kiro's lines), watches for the last chance and the
// ending, and paints the office (office.ts) and what haunts the monitors (haunt.ts). It tells the screen what to
// show through `NightUi`; the screen tells it what the player did. The engine decides everything that counts.

import { MOVE_TAUNTS, SPECIAL_TAUNTS } from '../../content/taunts';
import type { GameEvent } from '../../engine/log';
import type { Difficulty } from '../../rules/vocabulary';
import { Narrator, pickDeathVoice } from '../screen3-briefing/narrator';
import { loadBaseline, startRun } from './browser';
import { DURATION, SHAKE, handshake, prompt, startFlow, step, type Flow, type Input, type Phase } from './flow';
import { paintHaunt, type MonitorName, type Rect } from './haunt';
import { ENDINGS, STAGE_LINE, danger as dangerOf, reaction, type Beat, type Scene } from './judge';
import type { KiroLine } from './KiroPanel';
import { CAMS, lerpCam, onScreen, paintEyes, paintHands, paintOffice, walkCam, type Cam, type OfficeView } from './office';
import type { Run } from './run';
import { Soundscape, type Bus } from './sound';

/** What the director tells the screen. */
export interface NightUi {
  phase(p: Phase): void;
  prompt(text: string | null, grip: number): void;
  sub(line: { who: 'Kiro' | 'Death' | ''; text: string } | null): void;
  run(r: Run): void;
  error(message: string): void;
  /** Four times a second while the run is live: re-read the world. */
  tick(danger: 0 | 1 | 2 | 3): void;
  eyesInAccounts(on: boolean): void;
  shake(on: boolean): void;
  glitch(on: boolean): void;
  ending(scene: Scene): void;
  card(): void;
  kiro(line: Omit<KiroLine, 'id'>): void;
}

/** What the director needs from the page. */
export interface NightHost {
  office: HTMLCanvasElement;
  haunt: HTMLCanvasElement;
  monitors(): Record<MonitorName, Rect> | null;
  /** A generated handshake clip (`public/night/handshake.mp4`, D-224), shown in place of the painted hands when it has loaded. */
  clip(): HTMLVideoElement | null;
}

/** Kiro's lines in the prologue: phase, seconds into it, the line (the brief's words). */
export const KIRO_LINES: ReadonlyArray<readonly [Phase, number, string]> = [
  ['intro', 0.3, "You're late."],
  ['intro', 1.9, "I'm Kiro. Your guide tonight."],
  ['shake', 1.2, 'Welcome to the night shift. Try not to die.'],
  ['after', 0.3, "Come on. Your shift's waiting."],
  ['seat', 0.2, "That's your kingdom for tonight."],
  ['alarm', 1.0, "Well. That didn't last long."],
];

/** Kiro's three warnings as the run nears its end (D-223's last chance). */
export const LAST_CHANCE = {
  1: 'Careful. This is slipping away from you.',
  2: "Listen to me. It's getting worse, and he knows it.",
  3: "Look at me. You're running out of chances.",
} as const;

export const SEATED: ReadonlySet<Phase> = new Set(['login', 'alarm', 'shift']);

const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const ease = (u: number): number => {
  const x = clamp(u);
  return x * x * (3 - 2 * x);
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface KiroSpot {
  x: number;
  z: number;
  look: number;
  eyes: number;
  talk: number;
  hand: { x: number; y: number } | null;
  form: number;
  tint?: string;
}

export class Night {
  readonly sound = new Soundscape();
  private flow: Flow;
  private run: Run | null = null;
  private starting = false;
  private raf = 0;
  private last = 0;
  private lastTick = 0;
  private lastPhase: Phase;
  private lastPrompt = '';
  private reduce = reducedMotion();
  private voices: { kiro: Narrator | null; death: Narrator | null } = { kiro: null, death: null };
  private speakingUntil = 0;
  private subTimer = 0;
  private timers: number[] = [];
  private volume = 0.35;
  private menu = false;
  private paused = false;
  private focused: MonitorName | null = null;
  private mouse: { x: number; y: number } | null = null;
  private offs: Array<() => void> = [];
  private unhook: (() => void) | null = null;
  // the room's state, moved on by the loop
  private t = 0;
  private look = { x: 0, y: 0 };
  private lookTarget = { x: 0, y: 0 };
  private lookSpeed = 0;
  private turn = 0;
  private keys = new Set<string>();
  private said = new Set<string>();
  private events = 0;
  private lights = 1;
  private lightsTarget = 1;
  private crimson = 0;
  private crimsonSince = -1;
  private cold = 0;
  private rain = 0.6;
  private flash = 0;
  private bolt = 0;
  private nextFlash = 30;
  private voicesVolume = 0.8;
  private shadow = -1;
  private face: { at: MonitorName; start: number } | null = null;
  private ghosts = 0;
  private reflection = -1;
  private lunge = -1;
  private recoil = -1;
  private drain = -1;
  private lastChance = -1;
  private lastTaunt = -99;
  private warned = new Set<number>();
  private ending: { start: number; scene: Scene } | null = null;
  private monitors = 0;

  constructor(
    private readonly difficulty: Difficulty,
    skipPrologue: boolean,
    private readonly host: NightHost,
    private readonly ui: NightUi,
  ) {
    this.flow = skipPrologue ? step(startFlow(), { kind: 'skip' }) : startFlow();
    this.lastPhase = this.flow.phase;
  }

  // ------------------------------------------------------------------ life

  start(): void {
    if (Narrator.supported()) {
      this.voices.kiro = new Narrator();
      this.voices.death = new Narrator({ pick: pickDeathVoice, pitch: 0.2, rate: 0.78 });
    }
    this.sound.start();
    this.sound.setVolume(this.volume);
    void loadBaseline().catch((e: unknown) => this.ui.error(e instanceof Error ? e.message : String(e)));
    this.ui.phase(this.flow.phase);
    if (this.flow.phase === 'dark') this.sound.breathe(2);
    if (SEATED.has(this.flow.phase)) this.begin();
    this.listen();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    // the browser checks' hook (D-223): a dynamic import behind DEV, so the production build leaves the module out
    if (import.meta.env.DEV) void import('./devhook').then((m) => this.raf && (this.unhook = m.installHook(this)));
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const off of this.offs) off();
    this.offs = [];
    for (const t of this.timers) window.clearTimeout(t);
    window.clearTimeout(this.subTimer);
    this.sound.stop();
    this.voices.kiro?.dispose();
    this.voices.death?.dispose();
    this.voices = { kiro: null, death: null };
    if (this.run?.engine.world.clock.paused) this.run.engine.resume();
    this.unhook?.();
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  // ------------------------------------------------------------------ the player

  setMenu(open: boolean): void {
    this.menu = open;
  }

  setVolume(v: number): void {
    this.volume = v;
    this.sound.setVolume(v);
  }

  setFocused(m: MonitorName | null): void {
    this.focused = m;
  }

  /** Easy only (SYS-08): stop the engine's clock, or start it again. */
  togglePause(): boolean {
    const r = this.run;
    if (!r || r.difficulty !== 'easy') return this.paused;
    if (this.paused) {
      r.engine.resume();
      this.paused = false;
    } else if (r.engine.pause()) this.paused = true;
    return this.paused;
  }

  /** 0..1 one of the sound's buses (rain, heartbeat, effects). */
  setBus(b: Bus, v: number): void {
    this.sound.setBus(b, v);
  }

  /** 0..1 Kiro's and Death's voices. */
  setVoices(v: number): void {
    this.voicesVolume = v;
  }

  /** Straight to the desk (the menu's skip, a retry). */
  skip(): void {
    this.flow = step(this.flow, { kind: 'skip' });
    this.begin();
  }

  cue(c: Parameters<Soundscape['cue']>[0]): void {
    this.sound.cue(c);
  }

  sfx(k: Parameters<Soundscape['fx']>[0]): void {
    this.sound.fx(k);
  }

  // ------------------------------------------------------------------ the run

  /** The workstation logs in: the run starts on the engine. */
  private begin(): void {
    if (this.run || this.starting) return;
    this.starting = true;
    startRun(this.difficulty)
      .then((r) => {
        this.run = r;
        this.events = r.engine.world.events.length;
        this.ui.run(r);
      })
      .catch((e: unknown) => this.ui.error(e instanceof Error ? e.message : String(e)));
  }

  /** A line with its subtitle; Death's lines and urgent ones speak over what is being said, the rest wait. */
  say(who: 'Kiro' | 'Death' | '', text: string, opts: { voice?: boolean; urgent?: boolean } = {}): void {
    const words = text.split(/\s+/).length;
    const secs = Math.max(2.6, words * 0.42 + 1.2) * (who === 'Death' ? 1.35 : 1);
    this.ui.sub({ who, text });
    window.clearTimeout(this.subTimer);
    this.subTimer = window.setTimeout(() => this.ui.sub(null), secs * 1000);
    if (opts.voice === false || !who) return;
    const busy = this.speakingUntil > this.t;
    if (busy && !opts.urgent && who !== 'Death') return;
    const n = who === 'Death' ? this.voices.death : this.voices.kiro;
    if (!n) return;
    n.volume = this.voicesVolume;
    this.speakingUntil = this.t + secs;
    n.say(text);
    if (who === 'Death') {
      this.sound.deathWhisper();
      this.sound.rumble(Math.min(4, secs));
    }
  }

  private beat(b: Beat): void {
    switch (b) {
      case 'window-shadow':
        this.shadow = this.t;
        break;
      case 'monitor-face':
        this.face = { at: Math.random() < 0.5 ? 'left' : 'right', start: this.t };
        break;
      case 'lights-dim':
        this.lightsTarget = 0.35;
        this.later(10000, () => (this.lightsTarget = 1));
        this.ui.eyesInAccounts(true);
        this.later(4000, () => this.ui.eyesInAccounts(false));
        break;
      case 'ghosts':
        this.ghosts = 1;
        this.cold = 1;
        break;
      case 'reflection':
        this.reflection = this.t;
        break;
      case 'crimson':
        this.crimsonSince = this.t;
        this.sound.setRain(1);
        break;
      case 'lunge':
      case 'return':
        this.lunge = this.t;
        if (!this.reduce) {
          this.ui.shake(true);
          this.later(500, () => this.ui.shake(false));
        }
        break;
      case 'recoil':
        this.recoil = this.t;
        break;
      case 'drain':
        this.drain = this.t;
        this.ghosts = Math.max(this.ghosts, this.difficulty === 'hard' ? 0.9 : 0.6);
        break;
    }
  }

  private taunt(lines: readonly string[], force = false): void {
    const gap = this.difficulty === 'easy' ? 22 : this.difficulty === 'medium' ? 14 : 9;
    if (!force && this.t - this.lastTaunt < gap) return;
    if (lines.length === 0) return;
    this.lastTaunt = this.t;
    this.say('Death', pick(lines));
  }

  private onEvent(e: GameEvent): void {
    const r = reaction(e);
    if (r.beat) this.beat(r.beat);
    if (r.cue) this.sound.cue(r.cue);
    switch (e.kind) {
      case 'move-started': {
        const line = STAGE_LINE[e.stage];
        if (line) this.later(2600, () => this.say('Kiro', line, { urgent: e.stage === 6 }));
        this.taunt(MOVE_TAUNTS[e.move] ?? []);
        break;
      }
      case 'move-cut':
        this.taunt(SPECIAL_TAUNTS.blocked);
        break;
      case 'tip-off':
        this.taunt(SPECIAL_TAUNTS.tippedOff, true);
        break;
      case 'return':
        this.taunt(SPECIAL_TAUNTS.return, true);
        break;
      case 'banished':
        this.taunt(SPECIAL_TAUNTS.banished, true);
        break;
      case 'wave-started':
        // his minions: pale figures gather round the monitors while the wave runs (UI-05)
        this.ghosts = Math.max(this.ghosts, 0.55);
        break;
      case 'suggestion':
        void this.run?.kiro.hint().then((h) => h && this.ui.kiro({ who: 'kiro', text: h.text, offline: h.offline }));
        break;
      default:
        break;
    }
  }

  /** The last chance (D-223): three warnings as the run nears its end; the hint is `hint()`'s, or none. */
  private warn(level: 1 | 2 | 3): void {
    const r = this.run;
    if (!r) return;
    if (level === 3) {
      this.lastChance = this.t;
      this.ui.glitch(true);
      this.later(6000, () => this.ui.glitch(false));
      this.sound.setVolume(this.volume * 0.3);
      this.later(6000, () => this.sound.setVolume(this.volume));
    }
    this.say('Kiro', LAST_CHANCE[level], { voice: level > 1, urgent: level === 3 });
    this.ui.kiro({ who: 'kiro', text: LAST_CHANCE[level], urgent: true });
    void r.kiro.hint().then((h) => {
      if (!h) return;
      this.ui.kiro({ who: 'kiro', text: h.text, offline: h.offline, urgent: level === 3 });
      if (level > 1) this.later(4200, () => this.say('Kiro', h.text, { voice: false }));
    });
  }

  private enter(p: Phase): void {
    if (p === 'dark') this.sound.breathe(2);
    if (p === 'wake') this.sound.setRain(0.6);
    if (p === 'shake') this.later(1300, () => (this.shadow = this.t));
    if (p === 'login') this.begin();
    if (p === 'alarm') {
      this.sound.alarm(5);
      this.sound.cue('death');
      this.lightsTarget = 1;
    }
  }

  private startEnding(scene: Scene): void {
    this.ending = { start: this.t, scene };
    this.ui.ending(scene);
    if (scene === 'banished') {
      this.crimsonSince = -1;
      this.lightsTarget = 1;
      this.sound.setRain(0.25);
      this.sound.cue('recovery');
      this.later(4200, () => this.say('Kiro', 'Not bad. You might actually survive another shift.', { urgent: true }));
    } else if (scene === 'taken') {
      this.sound.setRain(1);
      this.sound.setVolume(Math.min(1, this.volume + 0.2));
      this.sound.heartStop();
      this.later(1800, () => this.sound.flatline(4));
      this.later(3800, () => this.sound.cue('death'));
    } else {
      this.lightsTarget = 0.5;
      this.sound.setRain(0.1);
      const end = this.run?.engine.world.ending;
      if (end) this.later(3000, () => this.say('Kiro', ENDINGS[end].line, { urgent: true }));
    }
    this.later(scene === 'taken' ? 10500 : 8500, () => this.ui.card());
  }

  // ------------------------------------------------------------------ the frame

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.menu && !SEATED.has(this.flow.phase)) {
      this.paint(0);
      return;
    }
    this.t += dt;
    let f = this.flow;
    if (this.keys.has('w') && f.phase === 'walk') f = step(f, { kind: 'walk', dt });
    f = step(f, { kind: 'time', dt });
    const r = this.run;
    // the operator is logged in: the alarm comes when the engine shows him
    if (f.phase === 'login' && r && r.engine.world.events.some((e) => e.kind === 'move-started' || e.kind === 'alert-opened')) f = step(f, { kind: 'alarm' });
    this.flow = f;
    if (f.phase !== this.lastPhase) {
      this.lastPhase = f.phase;
      this.ui.phase(f.phase);
      this.enter(f.phase);
    }
    const p = prompt(f);
    const key = `${p}`;
    if (key !== this.lastPrompt) {
      this.lastPrompt = key;
      this.ui.prompt(p, 0);
    }
    for (const [ph, at, line] of KIRO_LINES) {
      const k = `${ph}:${at}`;
      if (f.phase === ph && f.t >= at && !this.said.has(k)) {
        this.said.add(k);
        this.say('Kiro', line, { urgent: true });
      }
    }
    if (f.phase === 'eyes' && f.t > 1.6 && !this.said.has('death:eyes')) {
      this.said.add('death:eyes');
      this.say('Death', "I've been expecting you.");
    }
    // the engine's clock runs from the login
    if (r && SEATED.has(f.phase) && !this.ending && !this.paused) {
      r.engine.advance(dt * 1000);
      // what happened before the alarm is played out when it sounds
      if (f.phase === 'shift' || f.phase === 'alarm') {
        const evs = r.engine.world.events;
        for (let i = this.events; i < evs.length; i++) this.onEvent(evs[i]!);
        this.events = evs.length;
      }
      const w = r.engine.world;
      this.sound.setHealth(w.heartbeat / 100);
      if (w.ending && !this.ending) this.startEnding(ENDINGS[w.ending].scene);
    }
    if (now - this.lastTick > 250) {
      this.lastTick = now;
      if (r) {
        const w = r.engine.world;
        const d = dangerOf(w.heartbeat, w.souls.stolen.length, w.souls.total);
        this.ui.tick(d);
        if (f.phase === 'shift' && !this.ending) {
          for (const lvl of [1, 2, 3] as const) {
            if (d >= lvl && !this.warned.has(lvl)) {
              this.warned.add(lvl);
              this.warn(lvl);
              break;
            }
          }
        }
      }
    }
    this.paint(dt);
  };

  // ------------------------------------------------------------------ painting

  private paint(dt: number): void {
    const { office: c, haunt: hc } = this.host;
    const f = this.flow;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (W < 2 || H < 2) return;
    for (const cv of [c, hc]) {
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
    }
    const g = c.getContext('2d');
    const hg = hc.getContext('2d');
    if (!g || !hg) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    hg.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the head follows the mouse, eased; A and D turn it further
    const k = 1 - Math.exp(-dt * 5);
    const bx = this.look.x;
    const by = this.look.y;
    this.look.x += (this.lookTarget.x - this.look.x) * k;
    this.look.y += (this.lookTarget.y - this.look.y) * k;
    this.lookSpeed = dt > 0 ? Math.hypot(this.look.x - bx, this.look.y - by) / dt : 0;
    if (this.keys.has('a')) this.turn = Math.max(-0.5, this.turn - dt * 0.8);
    if (this.keys.has('d')) this.turn = Math.min(0.5, this.turn + dt * 0.8);
    if (!this.keys.has('a') && !this.keys.has('d')) this.turn *= 1 - Math.min(1, dt * 1.5);
    // lightning now and then, the thunder after it
    if (this.t > this.nextFlash) {
      this.flash = 1;
      this.bolt = (Math.random() - 0.5) * 1.6;
      this.nextFlash = this.t + (this.crimsonSince >= 0 ? 25 : 45) + Math.random() * 50;
      const strength = 0.5 + Math.random() * 0.5;
      this.later(900 + Math.random() * 2200, () => this.sound.thunder(strength));
    }
    this.flash = Math.max(0, this.flash - dt * 2.4);
    const flash = this.reduce ? 0 : this.flash > 0.5 ? this.flash : this.flash * (Math.sin(this.t * 60) > 0 ? 1 : 0.3);
    // the room's light and weather follow the beats
    if (this.crimsonSince >= 0) this.crimson = Math.min(1, this.crimson + dt * 0.25);
    else this.crimson = Math.max(0, this.crimson - dt * 0.3);
    const lt = this.crimson > 0.5 ? Math.min(0.75, this.lightsTarget) : this.lightsTarget;
    this.lights += (lt - this.lights) * (1 - Math.exp(-dt * 3));
    this.cold = Math.max(0, this.cold - dt / 40);
    this.ghosts = Math.max(0, this.ghosts - dt / 40);
    const rainTo = this.crimson > 0.5 ? 1 : this.ending?.scene === 'banished' ? 0.25 : this.ending?.scene === 'handover' ? 0.1 : 0.6;
    this.rain += (rainTo - this.rain) * (1 - Math.exp(-dt * 0.5));
    const seated = SEATED.has(f.phase);
    const look = { yaw: this.look.x * 0.38 + this.turn, pitch: -this.look.y * 0.14 };
    let cam: Cam = CAMS.start;
    let fade = 1;
    switch (f.phase) {
      case 'dark':
      case 'eyes':
        fade = 0;
        break;
      case 'wake':
        fade = ease(f.t / (DURATION.wake ?? 3));
        cam = { ...CAMS.start, yaw: look.yaw, pitch: look.pitch };
        break;
      case 'walk': {
        const wc = walkCam(f.walked);
        cam = { ...wc, yaw: wc.yaw + look.yaw * 0.6, pitch: wc.pitch + look.pitch * 0.6 };
        break;
      }
      case 'seat':
        cam = { ...CAMS.chair, yaw: CAMS.chair.yaw + look.yaw * 0.5, pitch: CAMS.chair.pitch + look.pitch * 0.5 };
        break;
      case 'sitting':
        cam = lerpCam(CAMS.chair, CAMS.seated, f.t / (DURATION.sitting ?? 2.2));
        break;
      default:
        if (seated) {
          const endTurn = this.ending ? ease((this.t - this.ending.start - 1.5) / 3) * -0.32 : 0;
          const deskLook = this.focused ? 0 : 0.035;
          cam = { ...CAMS.seated, yaw: CAMS.seated.yaw + look.yaw * deskLook + endTurn, pitch: CAMS.seated.pitch + look.pitch * deskLook };
        } else cam = { ...CAMS.start, yaw: look.yaw, pitch: look.pitch };
    }
    // the player's monitors come on as they sit
    const monTarget = f.phase === 'sitting' ? clamp(f.t / 2) : seated ? 1 : 0;
    this.monitors += (monTarget - this.monitors) * (1 - Math.exp(-dt * 4));
    // the endings
    let death: OfficeView['death'] = null;
    let dawn = 0;
    let monitorsOn = this.monitors;
    let kiro = this.kiroSpot(f);
    let hand = 0;
    let ink = 0;
    if (this.ending) {
      const e = this.t - this.ending.start;
      if (this.ending.scene === 'banished') {
        death = { x: 1.2, z: 10.6, form: clamp(1 - (e - 2) / 4), fragment: clamp((e - 1) / 4), point: 0 };
        kiro = e > 2.5 ? { x: 0.55, z: 7.6, look: 0.4, eyes: 0.8, talk: e > 4.2 && e < 7 ? 0.7 : 0, hand: null, form: clamp((e - 2.5) / 1.2) } : null;
      } else if (this.ending.scene === 'taken') {
        monitorsOn = clamp(1 - e / 2.5);
        kiro = e > 2 ? { x: 0.55, z: 7.5, look: 0.5, eyes: 0.25, talk: 0, hand: null, form: clamp((e - 2) / 1.2) } : null;
        death = e > 3.5 ? { x: -0.3, z: 8.9, form: clamp((e - 3.5) / 1.5), fragment: 0.05, point: clamp((e - 5) / 1.5) } : null;
        hand = clamp((e - 5.5) / 1.6);
        ink = clamp((e - 7) / 2.6);
      } else {
        dawn = clamp(e / 6);
        kiro = e > 2 ? { x: 0.55, z: 7.6, look: 0.3, eyes: 0.7, talk: e > 3 && e < 6 ? 0.6 : 0, hand: null, form: clamp((e - 2) / 1.2) } : null;
      }
    }
    const w = this.run?.engine.world;
    const alarm = f.phase === 'alarm' ? 1 : this.ending ? 0 : f.phase === 'shift' && w?.alerts.some((a) => a.closedAt === undefined) ? 0.55 : 0;
    const view: OfficeView = {
      t: this.t,
      cam,
      fade,
      lights: f.phase === 'alarm' && !this.reduce ? this.lights * (Math.sin(this.t * 23) > 0.2 ? 1 : 0.35) : this.lights,
      crimson: this.crimson,
      cold: this.cold,
      rain: this.rain,
      flash,
      bolt: this.bolt,
      dawn,
      monitors: monitorsOn,
      alarm,
      // the wall clock keeps the engine's time (the scenario starts at 22:00, D-24)
      clockMin: w ? 22 * 60 + Math.floor(w.clock.gameMs / 60000) : 21 * 60 + 58,
      hideDesk: seated && !this.ending,
      kiro: kiro ? { x: kiro.x, z: kiro.z, pose: { t: this.t, form: kiro.form, talk: kiro.talk, look: kiro.look, eyes: kiro.eyes, glitch: 0, hand: kiro.hand, eyeTint: kiro.tint } } : null,
      shadow: this.shadow >= 0 && this.t - this.shadow < 6 ? (this.t - this.shadow) / 6 : null,
      death,
    };
    if (f.phase === 'eyes') {
      const dur = DURATION.eyes ?? 6.5;
      const open = ease((f.t - 0.4) / 1.4) * (f.t > dur - 1 ? clamp(dur - f.t) : 1);
      paintEyes(g, W, H, this.t, open, this.look);
    } else paintOffice(g, W, H, dpr, view);
    // the handshake, close: the generated clip when there is one (its time follows the handshake), else painted
    const clip = this.host.clip();
    const clipReady = !!clip && clip.readyState >= 2 && clip.duration > 0;
    if (clip) clip.style.opacity = f.phase === 'shake' && clipReady ? '1' : '0';
    if (f.phase === 'shake') {
      const hs = handshake(f.t);
      if (clipReady) clip.currentTime = Math.min(clip.duration - 0.05, (f.t / (DURATION.shake ?? 3.4)) * clip.duration);
      else {
        // her right shoulder, where she stands (stand: x -0.35, z 2.25; her right is our left), as the camera sees it
        const shoulder = onScreen(cam, W, H, -0.35 - 0.28, 1.3, 2.25) ?? undefined;
        paintHands(g, W, H, this.t, hs.reach, hs.grip, hs.pump, hs.release, shoulder);
      }
    }
    // what haunts the monitors
    const rects = seated ? this.host.monitors() : null;
    const faceA = this.face ? this.faceAlpha(this.face, rects) : 0;
    if (this.face && this.t - this.face.start > 0.4 && faceA <= 0) this.face = null;
    const reflA = this.reflection >= 0 ? this.reflectionAlpha(this.t - this.reflection) : 0;
    if (this.reflection >= 0 && (this.t - this.reflection > 3.2 || reflA <= 0)) this.reflection = -1;
    const intensity = this.difficulty === 'easy' ? 0.7 : this.difficulty === 'hard' ? 1.15 : 1;
    paintHaunt(hg, W, H, dpr, {
      t: this.t,
      monitors: rects,
      face: this.face && faceA > 0 ? { at: this.face.at, a: faceA * intensity } : null,
      ghosts: this.ghosts * intensity,
      reflection: reflA * intensity,
      crimsonFace: this.crimsonSince >= 0 && !this.ending ? clamp((this.t - this.crimsonSince) / 30) * intensity : 0,
      lunge: this.lunge >= 0 ? this.t - this.lunge : -1,
      recoil: this.recoil >= 0 ? this.t - this.recoil : -1,
      drain: this.drain >= 0 ? this.t - this.drain : -1,
      lastChance: this.lastChance >= 0 && this.t - this.lastChance < 6.5 ? Math.sin(clamp((this.t - this.lastChance) / 6.5) * Math.PI) : 0,
      hand,
      ink,
    });
  }

  /** Where Kiro stands in each part of the prologue. */
  private kiroSpot(f: Flow): KiroSpot | null {
    const stand = { x: -0.35, z: 2.25 };
    switch (f.phase) {
      case 'approach': {
        const u = ease(f.t / (DURATION.approach ?? 4.5));
        return { x: -5.2 + (stand.x + 5.2) * u, z: 9.8 + (stand.z - 9.8) * u, look: 0.25 * (1 - u), eyes: 0.6, talk: 0, hand: null, form: clamp(0.25 + f.t / 1.5) };
      }
      case 'intro': {
        return { ...stand, look: 0, eyes: 0.85, talk: [0.3, 1.9].some((a) => f.t > a && f.t < a + 1.5) ? 0.7 : 0, hand: f.t > 3.6 ? { x: 0.2, y: -0.58 } : null, form: 1 };
      }
      case 'offer':
        return { ...stand, look: 0, eyes: 0.8, talk: 0, hand: { x: 0.2, y: -0.58 }, form: 1 };
      case 'shake':
        // she holds the player's eyes, then glances past them at the window; for a moment her eyes are not her own
        return { ...stand, look: f.t > SHAKE.grip + 0.6 && f.t < SHAKE.pumpEnd ? -0.75 : 0, eyes: 0.95, talk: f.t > 1.2 && f.t < 3 ? 0.6 : 0, hand: null, form: 1, tint: f.t > SHAKE.reach && f.t < SHAKE.grip + 0.25 ? '#ff2a4a' : undefined };
      case 'after':
        return { ...stand, look: 0.4, eyes: 0.6, talk: f.t > 0.3 && f.t < 1.8 ? 0.6 : 0, hand: null, form: 1 };
      case 'walk': {
        const u = ease(clamp(f.walked * 1.2 + 0.12));
        const back = Math.sin(this.t * 0.9) > 0.75; // she looks back to see the player is following
        return { x: stand.x + (0.5 - stand.x) * u, z: stand.z + (6.7 - stand.z) * u, look: back ? -0.6 : 0.2, eyes: 0.7, talk: 0, hand: null, form: 1 };
      }
      case 'seat':
        return { x: 0.5, z: 6.7, look: 0.5, eyes: 0.7, talk: f.t < 2 ? 0.6 : 0, hand: { x: 0.32, y: -0.5 }, form: 1 };
      case 'sitting':
      case 'login':
      case 'alarm':
        return { x: 0.35, z: 6.95, look: 0.5, eyes: f.phase === 'alarm' ? 0.95 : 0.7, talk: 0, hand: null, form: 1 };
      default:
        return null;
    }
  }

  /** The face in a monitor fades in, holds, fades; it is gone the moment the mouse is on that monitor. */
  private faceAlpha(face: { at: MonitorName; start: number }, rects: Record<MonitorName, Rect> | null): number {
    const e = this.t - face.start;
    if (e > 2.2) return 0;
    const r = rects?.[face.at];
    const m = this.mouse;
    if (r && m && e > 0.25 && m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) return 0;
    return e < 0.3 ? e / 0.3 : e > 1.8 ? (2.2 - e) / 0.4 : 1;
  }

  /** Behind the chair in the glass; the player turning round (a fast look) finds nothing there. */
  private reflectionAlpha(e: number): number {
    if (this.lookSpeed > 1.6 && e > 0.4) return 0;
    return e < 0.6 ? e / 0.6 : e > 2.6 ? clamp((3.2 - e) / 0.6) : 1;
  }

  // ------------------------------------------------------------------ input

  private listen(): void {
    const inField = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, button, .ns-kiro, .ns-desk, .ns-menu, .pl-root, .ns-card-end');
    const onMove = (e: MouseEvent) => {
      this.lookTarget = { x: clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1), y: clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1) };
      const host = this.host.office.getBoundingClientRect();
      this.mouse = { x: e.clientX - host.left, y: e.clientY - host.top };
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || inField(e.target) || this.menu) return;
      if (this.flow.phase === 'offer') this.input({ kind: 'interact' });
    };
    const onKey = (e: KeyboardEvent) => {
      if (inField(e.target) || this.menu) return;
      const k = e.key.toLowerCase();
      if (k === 'e') this.input({ kind: 'interact' });
      else if (['w', 'a', 's', 'd'].includes(k)) this.keys.add(k);
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const onBlur = () => this.keys.clear();
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn);
      this.offs.push(() => window.removeEventListener(type, fn));
    };
    on('mousemove', onMove);
    on('mousedown', onDown);
    on('keydown', onKey);
    on('keyup', onKeyUp);
    on('blur', onBlur);
  }

  /** A player input to the prologue (flow.ts ignores what does not fit the phase). */
  input(i: Input): void {
    this.flow = step(this.flow, i);
  }

  /** Where the prologue stands (the dev-only hook reads it). */
  get phaseNow(): Phase {
    return this.flow.phase;
  }

  /** The run, once the workstation has logged in. */
  get currentRun(): Run | null {
    return this.run;
  }
}

// The night shift's soundscape (UI-08, D-223, D-224), made live with Web Audio, no files. Three buses the player
// controls separately (voices are the narrators'):
//   rain     the room: rain heard through the glass (quiet and muffled, the player is inside), now and then a car,
//            the tubes' faint buzz, the fans, a low drone, a rare whisper, soft distant thunder after lightning
//   heart    the heartbeat, driven by the business's health: soft when healthy, louder and faster as it weakens,
//            fast and heavy near the end, slowing to a stop at defeat
//   effects  a cue per kind of event, the alarm, the rumble under Death's voice, the flatline
// It registers with the shared audio (D-220), so the page closing, the scene ending and the master mute silence it.

import { registerSound } from '../shared/audio';
import type { Cue } from './judge';

export type Bus = 'rain' | 'heart' | 'effects';
export const BUS_DEFAULTS: Record<Bus, number> = { rain: 0.35, heart: 0.75, effects: 0.6 };

const now: { playing: Soundscape | null } = { playing: null };

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private rainGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private level = 1;
  private bus: Record<Bus, number> = { ...BUS_DEFAULTS };
  private muted = false;
  private rain = 0.6;
  private health = 1;
  private stopping = -1;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private beatTimer: ReturnType<typeof setTimeout> | undefined;
  private unregister: (() => void) | null = null;

  static supported(): boolean {
    return typeof window !== 'undefined' && typeof window.AudioContext === 'function';
  }

  start(): void {
    if (this.ctx || !Soundscape.supported()) return;
    if (now.playing && now.playing !== this) now.playing.stop();
    now.playing = this;
    this.unregister = registerSound({
      stop: () => this.stop(),
      setMuted: (m) => {
        this.muted = m;
        this.apply();
      },
    });
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      this.master = master;
      for (const b of ['rain', 'heart', 'effects'] as const) {
        const g = ctx.createGain();
        g.gain.value = this.bus[b];
        g.connect(master);
        this.buses[b] = g;
      }
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // the glass: everything outside comes through a low-pass, soft and far
      const glass = ctx.createBiquadFilter();
      glass.type = 'lowpass';
      glass.frequency.value = 1100;
      glass.Q.value = 0.4;
      glass.connect(this.buses.rain!);
      const rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      rainGain.connect(glass);
      this.rainGain = rainGain;
      this.loop(1400, 0.5, 0.09, rainGain, 'bandpass');
      this.loop(420, 0.6, 0.07, rainGain, 'bandpass');
      // inside: the fans and the tubes, barely there
      this.loop(160, 0.7, 0.025, this.buses.rain!, 'lowpass');
      for (const [f, g] of [
        [100, 0.004],
        [200, 0.002],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const gain = ctx.createGain();
        gain.gain.value = g;
        o.connect(gain).connect(this.buses.rain!);
        o.start();
      }
      // a low drone, breathing slowly
      const drone = ctx.createGain();
      drone.gain.value = 0.025;
      drone.connect(this.buses.rain!);
      for (const f of [55, 55.6]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(drone);
        o.start();
      }
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05;
      const depth = ctx.createGain();
      depth.gain.value = 0.015;
      lfo.connect(depth).connect(drone.gain);
      lfo.start();
      void ctx.resume();
      this.apply(1.5);
      this.every(14000, 26000, () => this.car());
      this.every(45000, 90000, () => this.whisper());
      this.schedule();
    } catch {
      this.stop();
    }
  }

  /** 0..1 the whole soundscape. */
  setVolume(v: number): void {
    this.level = Math.max(0, Math.min(1, v));
    this.apply(0.3);
  }

  /** 0..1 one bus. */
  setBus(b: Bus, v: number): void {
    this.bus[b] = Math.max(0, Math.min(1, v));
    const g = this.buses[b];
    if (this.ctx && g) g.gain.setTargetAtTime(this.bus[b], this.ctx.currentTime, 0.1);
  }

  /** 0..1 how hard it rains (the storm thickens in the last stage). */
  setRain(r: number): void {
    this.rain = Math.max(0, Math.min(1, r));
    if (this.ctx && this.rainGain) this.rainGain.gain.setTargetAtTime(this.rain, this.ctx.currentTime, 1.2);
  }

  /** 0..1 the business's health (heartbeat / 100). */
  setHealth(h: number): void {
    this.health = Math.max(0, Math.min(1, h));
  }

  /** Defeat: the heartbeat slows over a few beats and stops. */
  heartStop(): void {
    if (this.stopping < 0) this.stopping = 0;
  }

  /** A sound for an event. */
  cue(c: Cue): void {
    if (!this.ctx) return;
    switch (c) {
      case 'warn':
        this.tone([660, 0], 0.06, 0.25, 'triangle');
        break;
      case 'login':
        this.tone([1320, 880], 0.07, 0.12, 'square', 0.04);
        this.tone([1320, 880], 0.07, 0.12, 'square', 0.04, 0.16);
        break;
      case 'theft':
        this.boom(48, 0.3, 1.6);
        this.swell(0.15, 1.8);
        break;
      case 'outage':
        this.tone([110, 98], 0.18, 1.6, 'sawtooth', 0.08);
        break;
      case 'death':
        for (const f of [61, 65, 92, 98]) this.tone([f, f * 0.94], 0.09, 2.6, 'sawtooth', 0.05);
        this.swell(0.25, 2.4);
        break;
      case 'recovery':
        for (const [f, at] of [
          [392, 0],
          [494, 0.12],
          [587, 0.24],
        ] as const)
          this.tone([f, f], 0.05, 1.2, 'sine', 0.05, at);
        break;
      case 'impact':
        this.boom(60, 0.32, 0.9);
        break;
    }
  }

  /** The battlefield's moments (D-225): a shield forming, a gate slamming shut, the stolen key shattering,
   *  evidence secured, an attack breaking through. */
  fx(k: 'shield' | 'gate' | 'key' | 'evidence' | 'breach' | 'recover'): void {
    if (!this.ctx) return;
    switch (k) {
      case 'shield':
        this.tone([523, 1046], 0.07, 0.6, 'sine', 0.05);
        this.tone([659, 1318], 0.05, 0.6, 'sine', 0.05, 0.05);
        this.burst(3000, 2, 0.05, 0.05, 0.5, 0, 6000);
        break;
      case 'gate':
        this.boom(55, 0.35, 0.6, 0.005);
        this.burst(900, 3, 0.18, 0.004, 0.25);
        this.burst(2400, 8, 0.07, 0.003, 0.45, 0.02);
        break;
      case 'key':
        for (let i = 0; i < 6; i++) this.burst(3500 + Math.random() * 4000, 6, 0.06, 0.002, 0.18 + Math.random() * 0.2, i * 0.03);
        break;
      case 'evidence':
        this.tone([880, 880], 0.05, 0.5, 'sine', 0.01);
        this.tone([1320, 1320], 0.04, 0.6, 'sine', 0.01, 0.12);
        break;
      case 'breach':
        this.burst(300, 0.8, 0.3, 0.01, 0.5);
        this.boom(45, 0.3, 1);
        break;
      case 'recover':
        this.cue('recovery');
        break;
    }
  }

  /** Death's whisper before he speaks: breath shaped like words, close. */
  deathWhisper(): void {
    for (let i = 0; i < 4; i++) this.burst(1600 + Math.random() * 1200, 5, 0.04, 0.12, 0.3, i * 0.22);
  }

  /** A deep rumble under Death's voice while he speaks. */
  rumble(seconds: number): void {
    this.boom(38, 0.2, seconds);
    this.swell(0.08, seconds);
  }

  /** Thunder after the lightning: far off, through the glass. */
  thunder(strength = 1): void {
    this.boom(30, 0.18 * strength, 3.5, 0.3, 'rain');
  }

  /** Slow breathing in the dark. */
  breathe(n = 2): void {
    for (let i = 0; i < n; i++) {
      this.burst(520, 0.9, 0.06, 1.1, 0.5, i * 3.2);
      this.burst(380, 0.9, 0.05, 0.3, 1.5, i * 3.2 + 1.7);
    }
  }

  /** The incident alarm: a two-tone klaxon, kept low. */
  alarm(times = 4): void {
    for (let i = 0; i < times; i++) {
      this.tone([740, 740], 0.05, 0.32, 'square', 0.02, i * 0.9);
      this.tone([540, 540], 0.05, 0.32, 'square', 0.02, i * 0.9 + 0.42);
    }
  }

  /** The heart monitor flatlining. */
  flatline(seconds = 4): void {
    this.tone([988, 988], 0.05, seconds, 'sine', 0.05);
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    clearTimeout(this.beatTimer);
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.buses = {};
    if (now.playing === this) now.playing = null;
    this.unregister?.();
    this.unregister = null;
    if (ctx) void ctx.close();
  }

  get running(): boolean {
    return this.ctx !== null;
  }

  // ------------------------------------------------------------------ the parts

  private apply(seconds = 0.2): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.level, t, seconds / 3);
    this.rainGain?.gain.setTargetAtTime(this.rain, t, 0.5);
  }

  private loop(freq: number, q: number, gain: number, out: AudioNode, type: BiquadFilterType): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(out);
    src.start();
  }

  private every(min: number, max: number, fn: () => void): void {
    const next = () => {
      if (!this.ctx) return;
      fn();
      this.timers.push(setTimeout(next, min + Math.random() * (max - min)));
    };
    this.timers.push(setTimeout(next, min + Math.random() * (max - min)));
  }

  private out(bus: Bus): AudioNode | null {
    return this.buses[bus] ?? null;
  }

  private burst(freq: number, q: number, peak: number, attack: number, decay: number, delay = 0, sweepTo?: number, bus: Bus = 'effects'): void {
    const ctx = this.ctx;
    const out = this.out(bus);
    if (!ctx || !out || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + attack + decay + 0.1);
  }

  /** A car passing far below, through the glass. */
  private car(): void {
    const up = Math.random() < 0.5;
    this.burst(up ? 250 : 600, 0.6, 0.05, 1.6, 2, 0, up ? 600 : 250, 'rain');
  }

  private whisper(): void {
    for (let i = 0; i < 3; i++) this.burst(1800 + Math.random() * 1400, 6, 0.025, 0.15, 0.35, i * 0.32 + Math.random() * 0.1, undefined, 'rain');
  }

  private boom(freq: number, peak: number, decay: number, attack = 0.02, bus: Bus = 'effects'): void {
    const ctx = this.ctx;
    const out = this.out(bus);
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + decay + 0.1);
    this.burst(120, 0.5, peak * 0.3, attack, decay, 0, undefined, bus);
  }

  private swell(peak: number, seconds: number): void {
    this.burst(400, 0.8, peak, seconds * 0.7, seconds * 0.3, 0, 2400);
  }

  private tone([f0, f1]: readonly [number, number], peak: number, decay: number, type: OscillatorType, attack = 0.01, delay = 0): void {
    const ctx = this.ctx;
    const out = this.out('effects');
    if (!ctx || !out) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 > 0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + decay + 0.1);
  }

  /** One thump of the heart: a low, round knock. */
  private thump(peak: number, delay = 0): void {
    const ctx = this.ctx;
    const out = this.out('heart');
    if (!ctx || !out) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(78, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    o.connect(g).connect(lp).connect(out);
    o.start(t);
    o.stop(t + 0.3);
  }

  /**
   * The heartbeat, from the business's health (D-224): healthy, a soft 62 bpm; below 70 clearly heard, quickening;
   * below 35 fast and heavy (up to 140 bpm). At defeat it slows over four beats and stops.
   */
  private schedule(): void {
    const beat = () => {
      if (!this.ctx) return;
      let { bpm, peak } = heartAt(this.health);
      if (this.stopping >= 0) {
        this.stopping++;
        if (this.stopping > 4) return;
        bpm = Math.max(28, bpm * (1 - 0.18 * this.stopping));
        peak *= 1 - 0.18 * this.stopping;
      }
      this.thump(peak);
      this.thump(peak * 0.65, 0.16 + 6 / bpm);
      this.beatTimer = setTimeout(beat, 60000 / bpm);
    };
    this.beatTimer = setTimeout(beat, 1200);
  }
}

/** The heartbeat's pace and loudness for a health of 0..1. */
export function heartAt(h: number): { bpm: number; peak: number } {
  const x = Math.max(0, Math.min(1, h));
  if (x >= 0.7) return { bpm: 62, peak: 0.18 };
  if (x >= 0.35) {
    const u = (0.7 - x) / 0.35;
    return { bpm: 75 + 25 * u, peak: 0.35 + 0.15 * u };
  }
  const u = (0.35 - x) / 0.35;
  return { bpm: 110 + 30 * u, peak: 0.6 + 0.25 * u };
}

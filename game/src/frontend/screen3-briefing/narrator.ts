// Kiro's voice (D-185, D-186): the briefing video's lines said aloud with the browser's own speech synthesis. No
// audio files and no music. `pickVoice` and `wordStart` are pure and tested; `Narrator` wraps `speechSynthesis`
// so that a line can be said, followed word by word, and cut off without its late events reaching the video. It
// registers with the shared audio (D-220): the master mute silences it, and closing the page cuts it off.

import { registerSound } from '../shared/audio';

/** The parts of a voice we choose by. */
export interface VoiceInfo {
  name: string;
  lang: string;
  localService?: boolean;
}

/** Kiro is a woman with a British voice (D-221): natural British female voices first, then the common ones. */
const PREFERRED: readonly RegExp[] = [
  /Microsoft (Sonia|Libby|Maisie|Abbi|Bella|Hollie|Olivia) .*Natural/i,
  /Google UK English Female/i,
  /Microsoft (Hazel|Susan)\b/i,
  /\b(Serena|Kate|Martha|Stephanie|Fiona|Moira)\b/i,
];

/** Names of female voices, for when no British one is there. */
const FEMALE = /female|zira|aria|jenny|samantha|victoria|karen|tessa|susan|hazel|sonia|libby|maisie|serena|kate|martha|fiona|moira|allison|ava|joanna|salli|emma|michelle|natasha|clara/i;

/** The voice he speaks with, or null when the browser has no English voice. */
export function pickVoice<V extends VoiceInfo>(voices: readonly V[]): V | null {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  for (const re of PREFERRED) {
    const hit = english.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  // any British voice that sounds like a woman, then any woman's voice, then any British voice, then any English one
  const female = english.filter((v) => FEMALE.test(v.name));
  const british = english.filter((v) => /^en[-_]GB/i.test(v.lang));
  return female.find((v) => /^en[-_]GB/i.test(v.lang)) ?? female[0] ?? british[0] ?? english[0] ?? null;
}

/** The start of the word at (or before) `i`, so a line picked up after a pause starts on a whole word. */
export function wordStart(text: string, i: number): number {
  let k = Math.max(0, Math.min(text.length, i));
  while (k > 0 && text[k - 1] !== ' ') k--;
  return k;
}

export interface SayOptions {
  /** He has started saying it. */
  onStart?: () => void;
  /** The browser could not say it (not when it was cut off). */
  onFail?: () => void;
  /** A word is about to be said, at this index of the text given to `say`. */
  onWord?: (index: number) => void;
  /** The line has been said to the end (not when it was cut off). */
  onEnd?: () => void;
}

export class Narrator {
  private readonly synth: SpeechSynthesis;
  private voice: SpeechSynthesisVoice | null = null;
  private token = 0;
  private timer = 0;
  /** 0..1, set by the player's narration volume. */
  volume = 1;
  /** Speaking speed; the cinematic briefing (D-189) runs a touch quicker than conversation. */
  rate = 1;
  private muted = false;
  private readonly unregister: () => void;

  /**
   * Browsers only let a page speak after a click or a key. Call this inside the gesture that opens the video
   * (Watch the briefing), so the narration can start by itself a moment later.
   */
  static unlock(): void {
    if (!Narrator.supported()) return;
    try {
      const s = window.speechSynthesis;
      s.cancel();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      s.speak(u);
      s.getVoices();
    } catch {
      // nothing to unlock
    }
  }

  /** True when this browser can speak at all. */
  static supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  }

  constructor() {
    this.synth = window.speechSynthesis;
    const load = () => {
      this.voice = pickVoice(this.synth.getVoices());
    };
    load();
    // the list often arrives a moment later
    this.synth.addEventListener?.('voiceschanged', load);
    this.unregister = registerSound({
      stop: () => this.stop(),
      setMuted: (m) => {
        this.muted = m;
        if (m) this.stop();
      },
    });
  }

  /** Stop, and leave the shared audio for good (the video has closed). */
  dispose(): void {
    this.stop();
    this.unregister();
  }

  /** Say a line, cutting off whatever he was saying. */
  say(text: string, opts: SayOptions = {}): void {
    this.stop();
    const token = this.token;
    if (!text.trim() || this.muted) return;
    // a speak() straight after cancel() is sometimes dropped by Chrome, so give the cancel a moment
    this.timer = window.setTimeout(() => {
      if (token !== this.token || this.muted) return;
      const u = new SpeechSynthesisUtterance(text);
      // the voice list can arrive late; look again before the first line
      if (!this.voice) this.voice = pickVoice(this.synth.getVoices());
      if (this.voice) {
        u.voice = this.voice;
        u.lang = this.voice.lang;
      } else u.lang = 'en-GB';
      u.pitch = 0.95;
      u.rate = this.rate;
      u.volume = this.volume;
      u.onboundary = (e) => {
        if (token === this.token && (e.name === 'word' || e.name === undefined)) opts.onWord?.(e.charIndex);
      };
      u.onstart = () => {
        if (token === this.token) opts.onStart?.();
      };
      u.onend = () => {
        if (token === this.token) opts.onEnd?.();
      };
      u.onerror = (e) => {
        if (token === this.token && e.error !== 'interrupted' && e.error !== 'canceled') opts.onFail?.();
      };
      this.synth.resume();
      this.synth.speak(u);
    }, 60);
  }

  /** Cut him off; nothing from the line he was saying reaches its callbacks after this. */
  stop(): void {
    this.token++;
    window.clearTimeout(this.timer);
    // always cancel: a queued line can report neither speaking nor pending for a moment, and must still go
    this.synth.cancel();
  }
}

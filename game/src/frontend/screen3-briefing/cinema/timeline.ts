// The cinematic briefing's timeline (D-189): eight shots in 60 seconds, each with what Kiro says and the caption on
// screen, and the playback state (playing, paused, the end card), free of the DOM so it can be tested. The clock is
// the timeline's: every line is written to fit its shot at Kiro's pace, and the tests hold it to that.

import { FACTS, say } from './facts';

export type ShotId = 'street' | 'kiro' | 'map' | 'gate' | 'logs' | 'admin' | 'death' | 'blackout';

export interface Shot {
  id: ShotId;
  /** Seconds from the top. */
  t0: number;
  t1: number;
  /** What Kiro says, starting a moment into the shot. */
  line: string;
  /** The caption set over the picture, or none. */
  caption: string | null;
}

/** The whole film, in seconds; playback never runs longer. */
export const TOTAL = 60;
/** Kiro starts speaking this long into each shot. */
export const LINE_DELAY = 0.35;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const SHOTS: readonly Shot[] = [
  {
    id: 'street',
    t0: 0,
    t1: 7,
    line: "One shop. One night. Someone's already inside the system. And you're the only one awake.",
    caption: 'ONE SHOP. ONE NIGHT. ONE DEFENDER.',
  },
  {
    id: 'kiro',
    t0: 7,
    t1: 15,
    line: "I'm Kiro, your familiar. I don't haunt the shop. I keep it alive.",
    caption: null,
  },
  {
    id: 'map',
    t0: 15,
    t1: 25,
    line: `${cap(say(FACTS.doors))} public doors. ${cap(say(FACTS.closable))} can close. ${FACTS.alwaysOpen.join(' and ')} stays open. Behind them: ${FACTS.customers} customers and every order they trusted us with.`,
    caption: `${say(FACTS.doors).toUpperCase()} DOORS. ${say(FACTS.closable).toUpperCase()} CAN CLOSE. ${say(FACTS.doors - FACTS.closable).toUpperCase()} NEVER DOES.`,
  },
  {
    id: 'gate',
    t0: 25,
    t1: 35,
    line: "Firewall: empty. Web protection: off. Backups run hourly. Those are your chances. Don't waste them.",
    caption: 'NO GUARDS AT THE GATE. JUST YOU.',
  },
  {
    id: 'logs',
    t0: 35,
    t1: 43,
    line: "Every visitor leaves footprints in the logs. Search requests. Failed logins. Strange tools. Find what doesn't belong.",
    caption: 'NOT EVERY REQUEST IS A CUSTOMER.',
  },
  {
    id: 'admin',
    t0: 43,
    t1: 50,
    line: 'An unfamiliar admin means trouble. Preserve the evidence before deleting anything. Panic destroys clues.',
    caption: "A NEW ADMIN AT 2 AM? HE'S ALREADY INSIDE.",
  },
  {
    id: 'death',
    t0: 50,
    t1: 56,
    line: 'Detect. Contain. Remove him. Recover. And remember: he only needs one mistake.',
    caption: "HE DOESN'T BREAK THE DOOR. HE BECOMES THE KEY.",
  },
  {
    id: 'blackout',
    t0: 56,
    t1: 60,
    line: 'Evidence first. Panic later. Your shift starts now.',
    caption: null,
  },
];

/** The shot playing at `t` (the last one at the end). */
export function shotIndex(t: number): number {
  for (let i = 0; i < SHOTS.length; i++) if (t < SHOTS[i]!.t1) return i;
  return SHOTS.length - 1;
}

/** 0..1 through shot `i` at time `t`. */
export function shotProgress(i: number, t: number): number {
  const s = SHOTS[i]!;
  return Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0)));
}

/** Seconds Kiro needs for a line at his pace (about 2.9 words a second). */
export function lineSeconds(line: string): number {
  return line.split(/\s+/).filter(Boolean).length / 2.9;
}

/** How long a line is to say, in characters: a number is said as words, so it counts for more. */
export function spokenLength(text: string): number {
  return text.length + (text.match(/\d/g)?.length ?? 0) * 5;
}

/**
 * The speaking rate that fits `text` into `seconds`, for a voice that says `cps` characters a second at rate 1.
 * Never slower than a touch quicker than conversation, never so fast it can't be followed.
 */
export function paceFor(text: string, seconds: number, cps: number): number {
  const need = spokenLength(text) / (Math.max(0.5, seconds) * Math.max(4, cps));
  return Math.min(1.7, Math.max(1.05, need));
}

export interface Playback {
  t: number;
  playing: boolean;
  /** The film has reached its end card. */
  ended: boolean;
  /** Shots reached so far (the furthest, plus one). */
  seen: number;
}

export const startPlayback = (): Playback => ({ t: 0, playing: true, ended: false, seen: 1 });

/** Advance by `dt` seconds of playback. */
export function advance(p: Playback, dt: number): Playback {
  if (!p.playing || p.ended || !(dt > 0)) return p;
  const t = p.t + dt;
  if (t >= TOTAL) return { t: TOTAL, playing: false, ended: true, seen: SHOTS.length };
  return { ...p, t, seen: Math.max(p.seen, shotIndex(t) + 1) };
}

export function togglePlay(p: Playback): Playback {
  if (p.ended) return replay(p);
  return { ...p, playing: !p.playing };
}

/** Jump to a moment (the progress line); the end of the film is the end card. */
export function seekTo(p: Playback, t: number): Playback {
  const c = Math.max(0, Math.min(TOTAL, t));
  if (c >= TOTAL) return skipToEnd(p);
  return { t: c, playing: true, ended: false, seen: Math.max(p.seen, shotIndex(c) + 1) };
}

/** Skip: straight to the end card. */
export function skipToEnd(p: Playback): Playback {
  return { t: TOTAL, playing: false, ended: true, seen: p.seen };
}

/** From the top, keeping how far it got. */
export function replay(p: Playback): Playback {
  return { ...startPlayback(), seen: p.seen };
}

/** m:ss */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

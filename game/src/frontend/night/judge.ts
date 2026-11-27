// The night shift's small judgements (D-223), pure so they can be tested, and made only from what the engine
// reports: the first check's readings and Kiro's answer to the player's call, how close the run is to its end (for
// Kiro's "last chance"), which horror beat and sound each engine event earns, each ending's words, and Kiro's
// verdict on the report. Nothing here changes the world or scores anything the engine does not.

import type { GameEvent } from '../../engine/log';
import type { Ending, Stage } from '../../rules/vocabulary';
import type { Mood } from '../shared/ghost';
import type { Outcome } from './results';

// ------------------------------------------------------------------ the first check

/** What the first check reads off the live world. */
export interface Readings {
  /** The web server: running, or stopped (the plug). */
  nginx: 'running' | 'stopped';
  /** Requests, 4xx and 5xx in the current real minute (the error-rate strip's last point). */
  requests: number;
  clientErrors: number;
  serverErrors: number;
  openAlerts: number;
  heartbeat: number;
  heartbeatMax: number;
  /** Login requests in the window, and how many failed (401). */
  logins: number;
  loginFailures: number;
  /** The busiest address in the last real minute, if any. */
  top?: { ip: string; requests: number; errors: number };
  /** Requests in the window from a tool that names itself (the briefing's list), and the first such name. */
  toolAgents: number;
  toolName?: string;
}

/** The things in the readings that are not normal, in plain words, worst first. */
export function anomalies(r: Readings): string[] {
  const out: string[] = [];
  if (r.nginx === 'stopped') out.push('the web server is down');
  if (r.openAlerts > 0) out.push(`${r.openAlerts} alert${r.openAlerts > 1 ? 's are' : ' is'} open`);
  if (r.top && r.top.requests >= 100 && r.top.requests >= r.requests * 0.5) out.push(`one address, ${r.top.ip}, made ${r.top.requests} requests in a minute`);
  else if (r.top && r.top.errors >= 10 && r.top.errors >= r.top.requests * 0.5) out.push(`one address, ${r.top.ip}, made ${r.top.requests} requests and ${r.top.errors} of them failed`);
  if (r.toolAgents > 0) out.push(`${r.toolAgents} request${r.toolAgents > 1 ? 's' : ''} came from a tool that names itself${r.toolName ? `: ${r.toolName}` : ''}`);
  if (r.loginFailures >= 5) out.push(`${r.loginFailures} failed logins`);
  if (r.serverErrors > 0) out.push(`${r.serverErrors} server error${r.serverErrors > 1 ? 's' : ''}`);
  if (r.clientErrors >= 10 && r.clientErrors >= r.requests * 0.3 && !out.some((x) => x.includes('failed'))) out.push(`${r.clientErrors} of ${r.requests} requests failed`);
  return out;
}

/**
 * What Kiro sees in the live numbers, when the player asks and the hint rules give her nothing to add (D-224):
 * the facts, worst first, never what to do about them.
 */
export function whatKiroSees(r: Readings): string {
  const bad = anomalies(r);
  if (bad.length) return `Here's what I see: ${bad.slice(0, 2).join('; ')}. Look closer at that.`;
  return `${r.requests} requests this minute, ${r.openAlerts} alerts open, the shop is ${r.nginx === 'running' ? 'up' : 'down'}. Quiet. Don't trust it.`;
}

// ------------------------------------------------------------------ the last chance

/** How close the run is to its end, 0 (fine) to 3 (one more mistake): from the two meters only. */
export function danger(heartbeat: number, stolen: number, total: number): 0 | 1 | 2 | 3 {
  const h = heartbeat / 100;
  const s = total > 0 ? stolen / total : 0;
  if (h <= 0.12 || s >= 0.85) return 3;
  if (h <= 0.22 || s >= 0.65) return 2;
  if (h <= 0.35 || s >= 0.45) return 1;
  return 0;
}

// ------------------------------------------------------------------ the room's reactions

export type Beat = 'window-shadow' | 'monitor-face' | 'lights-dim' | 'ghosts' | 'reflection' | 'crimson' | 'lunge' | 'recoil' | 'drain' | 'return';
export type Cue = 'warn' | 'login' | 'theft' | 'outage' | 'death' | 'recovery' | 'impact';

/** The horror beat for each stage Death enters (the brief's six reactions). */
export const STAGE_BEAT: Record<Stage, Beat> = { 1: 'window-shadow', 2: 'monitor-face', 3: 'lights-dim', 4: 'ghosts', 5: 'reflection', 6: 'crimson' };
const STAGE_CUE: Record<Stage, Cue> = { 1: 'warn', 2: 'warn', 3: 'login', 4: 'theft', 5: 'warn', 6: 'outage' };

/** Kiro's line when Death enters a stage, where the brief gives her one. */
export const STAGE_LINE: Partial<Record<Stage, string>> = {
  3: 'Someone just gave our guest a key.',
  5: "Don't trust silence. That's when he hides.",
  6: "This is it. Whatever you're going to do, do it now.",
};

/** What the room does for an engine event: a beat to show, a sound to play, or nothing. */
export function reaction(e: GameEvent): { beat?: Beat; cue?: Cue } {
  switch (e.kind) {
    case 'move-started':
      return { beat: STAGE_BEAT[e.stage], cue: STAGE_CUE[e.stage] };
    case 'move-landed':
      return { beat: 'lunge', cue: 'impact' };
    case 'move-cut':
    case 'door-shut':
    case 'patch-applied':
      return { beat: 'recoil', cue: 'recovery' };
    case 'souls-stolen':
      return { beat: 'drain', cue: 'theft' };
    case 'alert-opened':
    case 'wave-started':
      return { cue: 'warn' };
    case 'customer-lost':
      return { cue: 'outage' };
    case 'decision-missed': // UI-15 (D-261): the window ran out
      return { cue: 'impact' };
    case 'return':
      return { beat: 'return', cue: 'death' };
    case 'banished':
      return { cue: 'recovery' };
    default:
      return {};
  }
}

// ------------------------------------------------------------------ the endings

export type Scene = 'banished' | 'taken' | 'handover';

export interface EndingWords {
  scene: Scene;
  /** The run counts as survived. */
  won: boolean;
  title: string;
  line: string;
}

export const ENDINGS: Record<Ending, EndingWords> = {
  banished: { scene: 'banished', won: true, title: 'Death banished', line: 'The system survived. Did you?' },
  'souls-lost': { scene: 'taken', won: false, title: 'You lost', line: "He took every soul. Death didn't need to destroy everything. One mistake was enough." },
  flatline: { scene: 'taken', won: false, title: 'You lost', line: "The heartbeat stopped. Death didn't need to destroy everything. One mistake was enough." },
  return: { scene: 'taken', won: false, title: 'He came back', line: "You closed every door but one. Death didn't need to destroy everything. One mistake was enough." },
  'clean-handover': { scene: 'handover', won: true, title: 'Shift ends: clean handover', line: 'The next shift takes over a system you kept alive.' },
  'rough-handover': { scene: 'handover', won: false, title: 'Shift ends: rough handover', line: 'The next shift takes over a mess. He is still in there somewhere.' },
  'walked-away': { scene: 'handover', won: false, title: 'Shift ends: walked away', line: 'The clock ran out while he walked the halls. Nobody stopped him.' },
};

/** Kiro's word on the report, from its grades: three or more A or B is following the evidence. */
/** What Kiro's mood on the play screen is read from (D-250): only what the engine and the last result report. */
export interface MoodInput {
  ending?: Ending;
  /** The last action's result while its banner shows, or null. */
  outcome: Outcome | null;
  danger: 0 | 1 | 2 | 3;
  /** Real seconds since the newest open alert opened, or null when none is open. */
  alertAge: number | null;
}

const DEFENDED: ReadonlySet<Outcome> = new Set(['contained', 'evidence', 'restored', 'deploying']);
const MISTAKES: ReadonlySet<Outcome> = new Set(['failed', 'shutdown', 'disrupted']);
const WON: ReadonlySet<Ending> = new Set(['banished', 'clean-handover']);

/**
 * Kiro's mood (D-250): the ending first (won: happy; his return: shock; any other loss: sad), then the last result
 * (a defence that worked: happy; a mistake: a wince), then the danger and a fresh alert (alarm), else calm.
 */
export function kiroMood(i: MoodInput): Mood {
  if (i.ending) return WON.has(i.ending) ? 'happy' : i.ending === 'return' ? 'shock' : 'sad';
  if (i.outcome && DEFENDED.has(i.outcome)) return 'happy';
  if (i.outcome && MISTAKES.has(i.outcome)) return 'oops';
  if (i.danger >= 2 || (i.alertAge !== null && i.alertAge < 6)) return 'alarm';
  if (i.danger === 1 || i.alertAge !== null || i.outcome === 'still-active') return 'concern';
  return 'calm';
}

/** What Kiro says when the grades were good and the night was still lost: each loss its own reason. */
const GOOD_BUT_LOST: Partial<Record<Ending, string>> = {
  return: 'You read the evidence well. He only needed the one way in you missed.',
  'souls-lost': 'You read the evidence well. He was faster with the records than you were with the doors.',
  flatline: 'You read the evidence well. The business could not survive what it cost.',
  'walked-away': 'You read the evidence well. You just never shut him out before the shift ran out.',
};

/** Kiro's verdict on the report: the grades, and (D-256) the ending, so she never praises a night that was lost. */
export function kiroVerdict(grades: Record<string, 'A' | 'B' | 'C' | 'D' | 'F'>, ending?: Ending): string {
  const good = Object.values(grades).filter((g) => g === 'A' || g === 'B').length >= 3;
  const lost = ending !== undefined && !WON.has(ending) && ending !== 'rough-handover';
  if (lost) return good ? (GOOD_BUT_LOST[ending] ?? 'You read the evidence well, and still lost the night.') : 'You panicked when you needed to think. Death counted on that.';
  return good ? "You followed the evidence. That's why you're still here." : 'You got through it. Next time, follow the evidence sooner.';
}

// The difficulty dial on screen (SYS-08, UI-11, D-234, D-241): what each level's screens help with. One table, read by
// the play screen (which buttons exist, what opens first, Kiro's "apply it") and by the menu's per-level lists (UI-02),
// so the menu can only promise what the screens do. The timings come from the engine's own config, never typed here.

import { CONFIG } from '../../engine/config';
import type { Difficulty } from '../../rules/vocabulary';

export interface Dial {
  /** Every investigation is a click: log filters by address, status and path, the uploads list, the firewall's buttons. */
  investigate: boolean;
  /** "block" and "flag" on every log line and top-talkers row. */
  rowActions: boolean;
  /** Tab completes in the terminal (the shell offers it on Easy only). */
  autocomplete: boolean;
  /** Kiro's "apply it" runs her drafted lines; elsewhere they are pasted into the terminal. */
  kiroApply: boolean;
  /** Hovering a log line explains it in plain words. */
  explainOnHover: boolean;
  /** Kiro speaks up: "always" explains and suggests, "stuck" hints when stuck, "asked" only when asked. */
  kiro: 'always' | 'stuck' | 'asked';
  /** The terminal window is open from the start (Medium: both; Hard: terminal first). */
  terminalAtStart: boolean;
  /** Alerts add the gate sentence and light that gate's console on the dock (D-235). */
  gateSentence: boolean;
}

export const DIAL: Readonly<Record<Difficulty, Dial>> = {
  easy: { investigate: true, rowActions: true, autocomplete: true, kiroApply: true, explainOnHover: true, kiro: 'always', terminalAtStart: false, gateSentence: true },
  medium: { investigate: true, rowActions: true, autocomplete: false, kiroApply: false, explainOnHover: false, kiro: 'stuck', terminalAtStart: true, gateSentence: false },
  hard: { investigate: false, rowActions: false, autocomplete: false, kiroApply: false, explainOnHover: false, kiro: 'asked', terminalAtStart: true, gateSentence: false },
};

/** The line above the three lists (D-234): what no level changes. */
export const SAME_AT_EVERY_LEVEL = 'Identical at every level: the attacks, their consequences and the report’s verdict.';

const realS = (gameMs: number, d: Difficulty) => Math.round(gameMs / CONFIG[d].gameMsPerRealMs / 1000);
const range = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);

/** What a level switches on, in plain words, generated from DIAL and CONFIG[level] (UI-02, D-234). */
export function dialLines(d: Difficulty): string[] {
  const dial = DIAL[d];
  const c = CONFIG[d];
  const out: string[] = [];
  if (dial.investigate) out.push(dial.terminalAtStart ? 'Buttons for every investigation, and the terminal' : 'No typing needed: every investigation is a click');
  else out.push('Terminal first: buttons only on the consoles');
  if (dial.rowActions) out.push('“Block” and “flag” on every log line');
  if (dial.autocomplete) out.push('Tab completes your commands');
  if (dial.explainOnHover) out.push('Hover a log line for a plain-words explanation');
  if (dial.gateSentence) out.push('Alerts say which gate is under attack');
  out.push(dial.kiro === 'always' ? (dial.kiroApply ? 'Kiro explains, suggests, and runs her drafts for you' : 'Kiro explains and suggests') : dial.kiro === 'stuck' ? 'Kiro hints when you’re stuck' : 'Kiro stays quiet unless asked');
  out.push(c.pausable ? 'You can pause' : 'No pausing');
  out.push(`The calm before the first sign of trouble: ${range(c.firstMoveDelayRealMs.min / 1000, c.firstMoveDelayRealMs.max / 1000)} s`);
  const rest = range(realS(c.breatherGameMs.min, d), realS(c.breatherGameMs.max, d));
  // D-259: on Medium and Hard a second move may start while one plays
  out.push(`Death rests ${rest} s between moves${c.movesAtOnce > 1 ? `, and runs up to ${c.movesAtOnce === 2 ? 'two' : c.movesAtOnce} at once` : ''}`);
  out.push(`The shift lasts about ${Math.round(realS(c.shiftGameMs, d) / 60)} minutes`);
  return out;
}

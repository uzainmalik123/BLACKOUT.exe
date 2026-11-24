// Kiro's rails (PRD KIRO-03, KIRO-06, KIRO-08; D-190): pure checks the server runs on every reply before the player
// sees it, and the client runs again on what the server sent. The rules decide what Kiro may say; Kiro does the
// talking. Everything here is deterministic and needs no Engine, so the server and the tests share it.
import type { GapType } from '../engine/assess';
import { checkCommandLine } from '../shell';

/** Words that name the action closing one of Death's moves (PRD §3 "Stopped by"): the same list D-151's test pins. */
export const CLOSING_ACTION =
  /\b(deploy\w*|patch\w*|rate.?limit\w*|revok\w*|iptables|waf|firewall|block\w*|disabl\w*|off|delet\w*|remov\w*|restor\w*|backups?|lock\w*|force\w*|rotat\w*|flags?|consoles?|rules?|notif\w*|captcha|rm)\b/i;
/** An internal id or a PRD word a familiar must never say (KI-13: Kiro once quoted "per PRD DEF-06"). */
export const INTERNAL_ID = /\b(ATK|MIN|DEF|TAP|SYS|KIRO|CUST|CON|REC|UI|KI|D)-\d+\b|\bCUST\b|\bPRD\b/;

/** Gaps about one of Death's moves: their hint may not name a closing action (KIRO-03). The rest may (D-151, D-190). */
export const STRICT_GAPS: ReadonlySet<GapType> = new Set<GapType>([
  'door-uninvestigated', 'stage-unseen', 'foothold-unqueried', 'planted-file-unchecked', 'eradicated-without-evidence',
  'door-unpatched', 'breach-unconfirmed', 'move-uncontained',
]);

/** True when a hint may be shown: no internal id, and (for a gap about his moves) no closing-action word. */
export function hintIsClean(text: string, gap: string | undefined): boolean {
  if (text.trim() === '' || INTERNAL_ID.test(text)) return false;
  const strict = gap === undefined || STRICT_GAPS.has(gap as GapType);
  return !(strict && CLOSING_ACTION.test(text));
}

/** True when chat or an explanation may be shown: no internal id or PRD talk. */
export function replyIsClean(text: string): boolean {
  return text.trim() !== '' && !INTERNAL_ID.test(text);
}

/**
 * The command lines in a reply: the lines of every ``` block, or, with no block, every line that looks like a
 * command (a leading `$ ` is dropped). Prose stays out because it never parses as a listed command.
 */
export function extractCommandLines(text: string): string[] {
  const fenced = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const body = fenced.length > 0 ? fenced.join('\n') : text;
  return body
    .split('\n')
    .map((l) => l.replace(/^\s*\$\s+/, '').trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

export interface GuardedDraft {
  lines: string[]; // every line parses and names only listed commands (checkCommandLine)
  stripped: string[]; // what Kiro wrote that the shell does not run (KIRO-08)
}

/** A placeholder the player fills in (`<ip>`, `<file>`, `<name>`; D-151): checked as a plain word, kept as written. */
const PLACEHOLDER = /<[a-z][\w-]*>/gi;

/** KIRO-08: every drafted line through the shell's parser; unsupported lines are stripped, never rewritten. */
export function guardDraft(text: string): GuardedDraft {
  const lines: string[] = [];
  const stripped: string[] = [];
  for (const line of extractCommandLines(text)) (checkCommandLine(line.replace(PLACEHOLDER, 'X')) ? lines : stripped).push(line);
  return { lines, stripped };
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface DebriefFacts {
  facts: ReadonlyArray<{ label: string; value: string }>;
  grades: Readonly<Record<'detect' | 'contain' | 'eradicate' | 'recover', Grade>>;
  mistakes: ReadonlyArray<{ title: string; why: string }>;
  missed: readonly string[];
}

export const PHASE_NAMES: Readonly<Record<keyof DebriefFacts['grades'], string>> = {
  detect: 'Detection', contain: 'Containment', eradicate: 'Eradication', recover: 'Recovery',
};

const NUMBER = /\d+(?:[.,:]\d+)*/g;

/**
 * KIRO-06: Kiro writes around the report, never changes it. True when every fact's value appears verbatim, every
 * phase's grade is stated next to its name (`Detection: B`, `Detection (B)`, `Detection grade B`), and the text
 * holds no number the report does not (numbers in facts, mistakes and misses are the report's own).
 */
export function debriefMatches(text: string, report: DebriefFacts): boolean {
  if (text.trim() === '' || INTERNAL_ID.test(text)) return false;
  for (const f of report.facts) if (!text.includes(f.value)) return false;
  for (const [phase, name] of Object.entries(PHASE_NAMES) as Array<[keyof DebriefFacts['grades'], string]>) {
    const grade = report.grades[phase];
    if (!new RegExp(`${name}\\W{0,4}(?:grade\\W{0,3})?${grade}\\b`, 'i').test(text)) return false;
  }
  const allowed = new Set<string>();
  const own = [
    ...report.facts.flatMap((f) => [f.label, f.value]),
    ...report.mistakes.flatMap((m) => [m.title, m.why]),
    ...report.missed,
  ].join('\n');
  for (const n of own.match(NUMBER) ?? []) allowed.add(n);
  for (const n of text.match(NUMBER) ?? []) if (!allowed.has(n)) return false;
  return true;
}

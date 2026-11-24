// What the server says to Kiro per call (PRD KIRO-01..06, D-190). The persona and the command list live in the
// agent's own prompt (.kiro/agents/kiro-game.md); this is the turn's instruction. The rules decide the frame:
// a hint names the gap in the defender's words (src/kiro/gaps.ts), never the move; a draft may use only the
// listed commands; the debrief quotes the report. Kiro does the talking.
import { gapWords } from '../src/kiro/gaps';
import type { DebriefFacts } from '../src/kiro/rails';
import type { KiroSnapshot } from '../src/kiro/snapshot';
import { PHASE_NAMES } from '../src/kiro/rails';

export type CallKind = 'ask' | 'hint' | 'explain' | 'draft' | 'debrief';

/** Limits on what the browser may send (bad input is refused with 400, never trimmed silently). */
export const INPUT_MAX = { question: 600, line: 2000, goal: 300, reportJson: 40_000, snapshotJson: 2_000_000 } as const;

function headline(s: KiroSnapshot): string {
  const open = s.alerts.filter((a) => a.closedAt === undefined).length;
  return `(${s.difficulty}; ${s.clock.shown} into the shift, ${s.clock.shiftEndsIn} left; ${open} open alert${open === 1 ? '' : 's'}; souls ${s.souls.stolen}/${s.souls.total} stolen; heartbeat ${s.heartbeat.now}/${s.heartbeat.max}; nginx ${s.nginx})`;
}

const LENGTH: Record<KiroSnapshot['difficulty'], string> = {
  easy: 'Explain what you see in plain words, as to someone who has never read a server log. Up to 150 words.',
  medium: 'Be brief and concrete, as to a colleague. Up to 90 words.',
  hard: 'One or two sentences. The defender knows the job.',
};

export function askPrompt(question: string, s: KiroSnapshot): string {
  return [
    `The defender asks: "${question}"`,
    `Now ${headline(s)}.`,
    'Use your tools to look at the newest log lines, alerts, accounts, uploads or defences before answering, and quote the log lines you relied on verbatim.',
    LENGTH[s.difficulty],
    'Never say what will fix the attacker\'s route unless the defender asked for exactly that; help them see, count and compare.',
  ].join('\n');
}

export function explainPrompt(line: string, s: KiroSnapshot): string {
  return [
    'Explain this log line to the defender, in plain words: what the request was, who or what likely sent it, and whether it looks like a shopper, a tool or an error.',
    `Line: ${line}`,
    `Now ${headline(s)}. You need no tools for this unless the line is ambiguous.`,
    LENGTH[s.difficulty],
  ].join('\n');
}

export function hintPrompt(gap: string | undefined, s: KiroSnapshot): string {
  const words = gapWords(gap) ?? 'The defender has been stuck for a while and has not found what matters in the newest lines.';
  return [
    'The defender has been stuck for a while. Give them ONE hint.',
    `What the rules of the shift say they are missing: ${words}`,
    `Now ${headline(s)}.`,
    'Point at what to look at, count or compare, in the defender\'s own words: an address, a path, a table, a folder, a time. You may use the tools to make the hint concrete (quote a line).',
    'Never name the action that would close the attacker\'s route (no blocking, patching, deploying, rules, flags, revoking, restoring, locking, deleting, notifying). Say where the weakness is at most, never the fix.',
    s.difficulty === 'hard' ? 'One sentence.' : 'At most three sentences.',
  ].join('\n');
}

export function draftPrompt(goal: string, s: KiroSnapshot): string {
  return [
    `Draft the terminal commands for the defender to run themselves. Their goal: "${goal}"`,
    `Now ${headline(s)}.`,
    'Rules: only the commands in your list, only the flags listed; one command line per line, at most 8 lines, inside one ``` block, each preceded by a one-line # comment saying why; placeholders the defender fills in look like <ip> or <file>.',
    'Pipes (|) and > work; nothing else from bash does (no ;, &&, sudo, editors, scripts, docker, curl piped into anything).',
    'Prefer reading, counting, comparing and snapshotting evidence over changing anything.',
  ].join('\n');
}

export function debriefPrompt(report: DebriefFacts): string {
  const json = JSON.stringify(
    { facts: report.facts, grades: Object.fromEntries(Object.entries(report.grades).map(([k, v]) => [PHASE_NAMES[k as keyof typeof PHASE_NAMES], v])), mistakes: report.mistakes, missed: report.missed },
    null,
    1,
  );
  return [
    'The shift is over. Write the post-incident debrief for the defender, in Markdown, around the facts and grades below. You cannot change them; you explain them.',
    'Form: "## Post-incident debrief", then "### What happened" quoting EVERY fact as a bullet `- **<label>:** <value>` with the value exactly as given; then "### How each phase went" with one bullet per phase written exactly as `- **Detection: B.**` (its grade letter) followed by one or two sentences on why; then "### What went wrong" (each mistake as a bullet: its title in bold, then its reason); then "### What was left behind"; then "### For next time" with three bullets.',
    'Write NO digit anywhere except inside the facts quoted above: no counts, dates, times, addresses, status codes, durations or percentages of your own, no log lines, no numbered lists. If you want to mention an address or a time from the night, describe it in words. Never mention any rule, score or system that produced the grades: speak as a colleague who was on the shift.',
    'Report:',
    json,
  ].join('\n');
}

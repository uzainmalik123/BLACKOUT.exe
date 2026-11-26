// The post-incident report's reading of the night (UI-07, D-256): an overall grade by a documented formula, and what
// went right, what went wrong, the defences that failed, the threats that were missed, the damage, and what to learn.
// Everything is read from the engine: the assessor's grades, facts and mistakes (`evaluate`, SYS-11) and the event
// log; nothing is scored that the engine did not record. The teaching texts are the playbook's (NIST SP 800-61
// phases) and only chosen, never filled in, by the night's results.

import { PHASES, evaluate, fmtGameMs } from '../../engine/assess';
import type { GameEvent } from '../../engine/log';
import type { World } from '../../engine/state';
import { describeAction } from '../../kiro/snapshot';
import { ACTION_BY_ID } from '../../rules/actions';
import { MOVE_BY_ID } from '../../rules/moves';
import { TAP_BY_ID } from '../../rules/taps';
import type { Ending } from '../../rules/vocabulary';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Phase = (typeof PHASES)[number];

/** The points of a grade, as on a transcript. */
export const POINTS: Readonly<Record<Grade, number>> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const ORDER: readonly Grade[] = ['A', 'B', 'C', 'D', 'F'];
const worse = (a: Grade, b: Grade): Grade => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

/** The letter for a mean of points: 3.5 and up A, 2.5 B, 1.5 C, 0.5 D, below F. */
export function letterOf(mean: number): Grade {
  return mean >= 3.5 ? 'A' : mean >= 2.5 ? 'B' : mean >= 1.5 ? 'C' : mean >= 0.5 ? 'D' : 'F';
}

const LOSSES: ReadonlySet<Ending> = new Set(['souls-lost', 'flatline', 'return', 'walked-away']);
const CAP_WHY: Partial<Record<Ending, string>> = {
  'souls-lost': 'he took every customer record',
  flatline: 'the business died',
  return: 'he came back in through a way you missed',
  'walked-away': 'the shift ended with him still walking the halls',
  'rough-handover': 'the next shift inherits a mess',
};

export interface Overall {
  grade: Grade;
  /** The mean of the four phases' points. */
  mean: number;
  /** The highest grade the ending allows, if it limits it. */
  cap: Grade | null;
  result: 'Victory' | 'Defeat' | 'Shift over' | 'Unfinished';
  why: string;
}

/**
 * The overall grade (D-256): the mean of the four phase grades on a 4-point scale (A 4, B 3, C 2, D 1, F 0), as a
 * letter (3.5 A, 2.5 B, 1.5 C, 0.5 D); a loss caps it at D and a rough handover at C, because how the night ended
 * outweighs how well each part went.
 */
export function overallGrade(grades: Readonly<Record<Phase, Grade>>, ending?: Ending): Overall {
  const letters = PHASES.map((p) => grades[p]);
  const mean = letters.reduce((s, g) => s + POINTS[g], 0) / letters.length;
  const letter = letterOf(mean);
  const cap: Grade | null = ending && LOSSES.has(ending) ? 'D' : ending === 'rough-handover' ? 'C' : null;
  const grade = cap ? worse(letter, cap) : letter;
  const result: Overall['result'] = !ending ? 'Unfinished' : LOSSES.has(ending) ? 'Defeat' : ending === 'rough-handover' ? 'Shift over' : 'Victory';
  const base = `The four phases (${letters.join(', ')}) average ${mean.toFixed(2)} of 4: ${letter}.`;
  const capped = cap && grade !== letter ? ` Capped at ${cap}: ${CAP_WHY[ending!] ?? 'how the night ended'}.` : '';
  return { grade, mean, cap, result, why: base + capped };
}

/** What a professional does in each phase (the playbook, NIST SP 800-61). */
export const PRACTICE: Readonly<Record<Phase, string>> = {
  detect: 'Watch the logs, the alerts and the busiest addresses from the first minute; confirm an alert in the evidence before acting, and declare the incident as soon as it is real.',
  contain: 'Stop the attack at its cause, not at its address: block the tool or the pattern, disable the exploited feature, and keep the shop serving its customers.',
  eradicate: 'Preserve the evidence first, then remove everything he left behind (accounts, sessions, files, tokens) and patch the hole he came through.',
  recover: 'Bring every service back, turn off the temporary blocks once the patch is live, check nothing is still leaking, and notify legal inside the deadline when data was taken.',
};

/** One concrete thing to try next time, for a phase that went badly. */
export const NEXT_TIME: Readonly<Record<Phase, string>> = {
  detect: 'Next time, open the alerts and the top talkers at the start and look again every minute; flag an address only when its lines look wrong.',
  contain: 'Next time, read the evidence for what the attack has in common (a tool, a path, a pattern) and block that, not one address at a time.',
  eradicate: 'Next time, take an evidence snapshot before you delete anything, then check accounts, sessions and uploads for what he planted.',
  recover: 'Next time, deploy the patch, then lift the temporary blocks and restore the shop; if records were taken, notify legal straight away.',
};

/** Words for each phase, for headings. */
export const PHASE_NAMES: Readonly<Record<Phase, string>> = { detect: 'Detect', contain: 'Contain', eradicate: 'Eradicate', recover: 'Recover' };

export interface Aftermath {
  overall: Overall;
  grades: Record<Phase, Grade>;
  /** One line per phase: its first mistake, or that it had none. */
  phaseWhy: Record<Phase, string>;
  right: string[];
  wrong: Array<{ phase: Phase; title: string; why: string }>;
  failed: string[];
  missed: string[];
  damage: { soulsLost: number; total: number; heartbeat: number; max: number; downtime: string; customersLost: string };
  professional: Array<{ phase: Phase; text: string }>;
  lessons: string[];
  nextTime: string[];
}

const firstSentence = (s: string) => {
  const i = s.search(/\.(\s|$)/);
  return i > 0 ? s.slice(0, i + 1) : s;
};
const at = (t: number) => fmtGameMs(t);

/** The report's reading of a finished (or unfinished) night, from the engine only. */
export function aftermathOf(world: World): Aftermath {
  const a = evaluate(world);
  const grades = a.grades as Record<Phase, Grade>;
  const overall = overallGrade(grades, world.ending);
  const events = world.events;
  const of = <K extends GameEvent['kind']>(k: K) => events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === k);
  // a name in a sentence: its first letter lowered, unless it starts an acronym ("IP", "WAF")
  const inSentence = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const name = (m: string) => inSentence((MOVE_BY_ID as Record<string, { name: string } | undefined>)[m]?.name ?? m);
  const actionName = (id: string) => inSentence((ACTION_BY_ID as Record<string, { name: string } | undefined>)[id]?.name ?? id);

  // ---- what went right: his attacks stopped by the player's own actions, ways in shut, leaks closed, patches
  const right: string[] = [];
  const stopped = new Set<string>();
  for (const e of of('move-cut')) {
    if (stopped.has(e.move)) continue;
    stopped.add(e.move);
    right.push(`Stopped ${name(e.move)} with ${actionName(e.by)} (${at(e.t)} in).`);
  }
  for (const e of of('door-shut')) right.push(`Shut the way in behind ${name(e.move)} with ${actionName(e.by)} (${at(e.t)} in).`);
  for (const e of of('tap-closed')) if (e.by) right.push(`Closed a leak (${TAP_BY_ID[e.tap].name.toLowerCase()}) with ${actionName(e.by)}.`);
  for (const e of of('patch-applied')) right.push(`Deployed the code fix: ${e.patch} (${at(e.t)} in).`);
  const declared = of('incident-declared')[0];
  if (declared) right.push(`The incident was declared ${declared.by === 'alert' ? 'at the first alert' : declared.by === 'flag' ? 'when a flagged address proved hostile' : 'by escalating it'} (${at(declared.t)} in).`);
  if (world.ending === 'banished') right.push('Closed every way back in: Death banished.');
  for (const p of PHASES) if (grades[p] === 'A') right.push(`${PHASE_NAMES[p]}: graded A.`);

  // ---- what went wrong: the assessor's mistakes, each with its consequence
  const order = (p: Phase) => -POINTS[grades[p]];
  const wrong = [...a.mistakes].map((m) => ({ phase: m.phase as Phase, title: m.title, why: m.why })).sort((x, y) => order(y.phase) - order(x.phase));

  // ---- defences that did not hold
  const failed: string[] = [];
  for (const e of of('action')) if (!e.ok) failed.push(`${describeAction(e.action)}: refused${e.note ? ` (${e.note})` : ''}.`);
  for (const e of of('rule-evaded')) failed.push(`A WAF rule held for a while, then ${name(e.move)} slipped past it: the hole itself was never patched.`);
  if (of('proxies').length) failed.push('Blocking his addresses one by one: he came back from address after address.');
  for (const e of of('door-reopened')) failed.push(`A way in you had shut (${name(e.move)}) was opened again.`);

  // ---- threats missed: what got through and was never stopped, what he left behind, what still leaks
  const missed: string[] = [];
  const landed = new Set(of('move-landed').map((e) => e.move));
  for (const m of landed) if (!stopped.has(m) && !of('door-shut').some((e) => e.move === m)) missed.push(`${name(m)[0]!.toUpperCase()}${name(m).slice(1)} got through and was never stopped.`);
  for (const f of a.missed) missed.push(`Left behind: ${f}.`);
  const taps = a.facts.find((f) => f.label === 'Leaky taps still open at the end')?.value;
  if (taps && taps !== 'none') missed.push(`Still leaking at the end: ${taps}.`);

  const fact = (label: string) => a.facts.find((f) => f.label === label)?.value ?? '';
  const damage = {
    soulsLost: world.souls.stolen.length,
    total: world.souls.total,
    heartbeat: Math.round(world.heartbeat),
    max: Math.round(world.heartbeatMax),
    downtime: fact('Downtime caused (plug pulled)'),
    customersLost: fact('Customers lost for good'),
  };

  // ---- learning: the weak phases' practice, three lessons (the worst mistakes' reasons first), next time
  const weak = PHASES.filter((p) => POINTS[grades[p]] <= 2).sort((x, y) => POINTS[grades[x]] - POINTS[grades[y]]);
  const professional = weak.map((p) => ({ phase: p, text: PRACTICE[p] }));
  const lessons: string[] = [];
  for (const m of wrong) {
    const l = firstSentence(m.why);
    if (!lessons.includes(l)) lessons.push(l);
    if (lessons.length === 3) break;
  }
  for (const p of [...weak, ...PHASES]) {
    if (lessons.length >= 3) break;
    const l = firstSentence(PRACTICE[p]);
    if (!lessons.includes(l)) lessons.push(l);
  }
  const nextTime = (weak.length ? weak : [...PHASES].sort((x, y) => POINTS[grades[x]] - POINTS[grades[y]])).slice(0, 2).map((p) => NEXT_TIME[p]);
  const phaseWhy = Object.fromEntries(PHASES.map((p) => [p, wrong.find((m) => m.phase === p)?.title ?? 'No mistakes in this phase.'])) as Record<Phase, string>;

  return { overall, grades, phaseWhy, right, wrong, failed, missed, damage, professional, lessons, nextTime };
}

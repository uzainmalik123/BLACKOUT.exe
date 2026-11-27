// The post-incident report's presentation (UI-07, D-263): the night as a case file. Pure, so it can be tested:
// the ending's name, the six metrics, the mistakes grouped by their shared reason, the incident timeline with each
// line's category and recorded details, the full report's sections, and the download. Nothing here grades or scores:
// every value is read from the world, its events, the assessor's facts (SYS-11) or `aftermath.ts` (D-256), and a
// timeline line only ever shows fields its own event holds.

import { fmtGameMs } from '../../engine/assess';
import { CONFIG } from '../../engine/config';
import type { GameEvent } from '../../engine/log';
import { renderMarkdown, type Report } from '../../engine/report';
import type { World } from '../../engine/state';
import { describeAction } from '../../kiro/snapshot';
import { ACTION_BY_ID } from '../../rules/actions';
import { MOVE_BY_ID } from '../../rules/moves';
import { TAP_BY_ID } from '../../rules/taps';
import type { Ending } from '../../rules/vocabulary';
import { PHASE_NAMES, type Aftermath, type Phase } from './aftermath';
import { clockAt, eventWords, timelineOf } from './words';

// ------------------------------------------------------------------ the ending's name

export type Tone = 'won' | 'mixed' | 'lost';

export interface Headline {
  /** Above the name: "Threat contained" on a win, else the result. */
  kicker: string;
  /** The ending's own name: no two endings share one. */
  title: string;
  tone: Tone;
  /** Death's silhouette stays at the edge of the screen. */
  death: boolean;
}

export const HEADLINES: Readonly<Record<Ending, Headline>> = {
  banished: { kicker: 'Threat contained', title: 'Death banished', tone: 'won', death: false },
  'clean-handover': { kicker: 'Threat contained', title: 'Clean handover', tone: 'won', death: false },
  'rough-handover': { kicker: 'Shift over', title: 'Rough handover', tone: 'mixed', death: true },
  'walked-away': { kicker: 'Defeat', title: 'Walked away', tone: 'lost', death: true },
  'souls-lost': { kicker: 'Defeat', title: 'Souls lost', tone: 'lost', death: true },
  flatline: { kicker: 'Defeat', title: 'Flatline', tone: 'lost', death: true },
  return: { kicker: 'Defeat', title: 'The return', tone: 'lost', death: true },
};

export const UNFINISHED: Headline = { kicker: 'Unfinished', title: 'Shift unfinished', tone: 'mixed', death: false };

export const headlineOf = (ending?: Ending): Headline => (ending ? HEADLINES[ending] : UNFINISHED);

/** The metric each ending turned on, lit on the overview. */
export const FOCUS: Partial<Record<Ending, MetricId>> = { 'souls-lost': 'souls', flatline: 'heartbeat' };

// ------------------------------------------------------------------ the case

export const factOf = (facts: ReadonlyArray<{ label: string; value: string }>, label: string): string | undefined => facts.find((f) => f.label === label)?.value;

/** The shift on the log clock: from `shift-begun` (else the start) to the ending (else now). */
export function shiftSpan(world: World): { from: string; to: string } {
  const begun = world.events.find((e) => e.kind === 'shift-begun')?.t ?? 0;
  const ended = world.events.find((e) => e.kind === 'ending')?.t ?? world.clock.gameMs;
  return { from: clockAt(world, begun).slice(0, 5), to: clockAt(world, ended).slice(0, 5) };
}

// ------------------------------------------------------------------ the metrics

export type MetricId = 'souls' | 'heartbeat' | 'downtime' | 'response' | 'mistakes' | 'missed';

export interface Metric {
  id: MetricId;
  label: string;
  /** The number or time shown large. */
  value: string;
  /** Shown small after it ("/325"). */
  of?: string;
  /** 0..1 a bar under it, when it is a share. */
  bar?: number;
  /** Lines under it. */
  sub: string[];
  tone: 'bad' | 'good' | 'neutral';
}

/** The overview's six metrics, from the world, the assessor's facts and the aftermath (D-263). */
export function metricsOf(world: World, m: Aftermath, facts: ReadonlyArray<{ label: string; value: string }>): Metric[] {
  const d = m.damage;
  const fact = (label: string) => factOf(facts, label);
  const pct = d.total ? Math.round((100 * d.soulsLost) / d.total) : 0;
  const downtime = fact('Downtime caused (plug pulled)') ?? d.downtime;
  const contain = fact('Time to contain');
  const notice = fact('Time to notice stage 1');
  const byPhase = (['detect', 'contain', 'eradicate', 'recover'] as const)
    .map((p) => [p, m.wrong.filter((x) => x.phase === p).length] as const)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${PHASE_NAMES[p]} ${n}`);
  const customers = Number(d.customersLost || '0');
  return [
    {
      id: 'souls',
      label: 'Souls lost',
      value: String(d.soulsLost),
      of: `/${d.total}`,
      bar: d.total ? d.soulsLost / d.total : 0,
      sub: [d.soulsLost ? `${pct} % of customer records, taken for good` : 'No customer record taken'],
      tone: d.soulsLost ? 'bad' : 'good',
    },
    {
      id: 'heartbeat',
      label: 'Heartbeat',
      value: String(d.heartbeat),
      of: '/100',
      bar: d.heartbeat / 100,
      sub: [`Could reach ${d.max} at most`, customers ? `${customers} customer${customers === 1 ? '' : 's'} lost for good` : 'No customer lost for good'],
      tone: d.heartbeat >= 70 ? 'good' : d.heartbeat >= 35 ? 'neutral' : 'bad',
    },
    {
      id: 'downtime',
      label: 'Downtime you caused',
      value: downtime,
      sub: [/^0 min$/.test(downtime) ? 'The shop stayed online' : 'The plug was pulled'],
      tone: /^0 min$/.test(downtime) ? 'good' : 'bad',
    },
    {
      id: 'response',
      label: 'Time to contain',
      value: contain ?? '–',
      sub: [notice !== undefined ? `First stage noticed: ${notice === 'never' ? 'never' : `after ${notice}`}` : 'He never moved', ...(d.decisions ? [`Decisions in time: ${d.decisions}`] : [])],
      tone: contain === undefined ? 'neutral' : contain === 'never' ? 'bad' : 'neutral',
    },
    {
      id: 'mistakes',
      label: 'Mistakes',
      value: String(m.wrong.length),
      sub: [byPhase.length ? byPhase.join(' · ') : 'None in any phase'],
      tone: m.wrong.length ? 'bad' : 'good',
    },
    {
      id: 'missed',
      label: 'Threats missed',
      value: String(m.missed.length),
      sub: [m.missed.length ? 'Got through, left behind or still leaking' : 'Nothing got past you'],
      tone: m.missed.length ? 'bad' : 'good',
    },
  ];
}

// ------------------------------------------------------------------ what went wrong, each reason once

export interface Finding {
  phase: Phase;
  /** Every mistake that shares this reason, in the assessor's words. */
  titles: string[];
  why: string;
}

/** The mistakes grouped by their shared reason (D-263): every title kept, every reason read once. */
export function findingsOf(wrong: Aftermath['wrong']): Finding[] {
  const out: Finding[] = [];
  for (const w of wrong) {
    const same = out.find((f) => f.why === w.why);
    if (same) same.titles.push(w.title);
    else out.push({ phase: w.phase, titles: [w.title], why: w.why });
  }
  return out;
}

// ------------------------------------------------------------------ the incident timeline

export type Category = 'attack' | 'detected' | 'access' | 'loss' | 'evidence' | 'action' | 'refused' | 'contained' | 'recovery' | 'missed' | 'business';

export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  attack: 'Attack activity',
  detected: 'Attack detected',
  access: 'Unauthorized access',
  loss: 'Data loss',
  evidence: 'Evidence inspected',
  action: 'Defensive action',
  refused: 'Action refused',
  contained: 'Threat contained',
  recovery: 'Recovery',
  missed: 'Missed',
  business: 'Business impact',
};

export type Filter = 'all' | 'key' | 'attacks' | 'defence' | 'losses';
export const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'key', label: 'Key moments' },
  { id: 'attacks', label: 'Attacks' },
  { id: 'defence', label: 'Defence' },
  { id: 'losses', label: 'Losses' },
];
const GROUP: Readonly<Record<Category, Exclude<Filter, 'all' | 'key'>>> = {
  attack: 'attacks',
  detected: 'attacks',
  access: 'attacks',
  loss: 'losses',
  business: 'losses',
  missed: 'losses',
  evidence: 'defence',
  action: 'defence',
  refused: 'defence',
  contained: 'defence',
  recovery: 'defence',
};

/** What a key moment changed. */
export type KeyReason = 'souls' | 'heartbeat' | 'downtime' | 'outcome';
export const KEY_LABEL: Readonly<Record<KeyReason, string>> = {
  souls: 'Changed the souls count',
  heartbeat: 'Changed the heartbeat',
  downtime: 'Changed the downtime',
  outcome: 'Shaped the outcome',
};

export interface TimelineItem {
  /** The (first) event's id. */
  id: number;
  t: number;
  until?: number;
  clock: string;
  untilClock?: string;
  /** How far into the shift. */
  into: string;
  text: string;
  tone: 'bad' | 'good' | 'info';
  category: Category;
  /** Only when its event changed the souls, the heartbeat, the downtime or the outcome. */
  key?: KeyReason;
  /** The event's own fields, in words. */
  details: Array<{ label: string; value: string }>;
  /** What it did, when its event records it. */
  impact?: string;
}

export const inFilter = (x: TimelineItem, f: Filter): boolean => f === 'all' || (f === 'key' ? x.key !== undefined : GROUP[x.category] === f);

const moveName = (m: string): string => (MOVE_BY_ID as Record<string, { name: string } | undefined>)[m]?.name ?? m;
const actionName = (a: string): string => (ACTION_BY_ID as Record<string, { name: string } | undefined>)[a]?.name ?? a;

function classify(world: World, e: GameEvent): Pick<TimelineItem, 'category' | 'key' | 'details' | 'impact'> {
  const dips = CONFIG[world.difficulty].heartbeat.dip;
  switch (e.kind) {
    case 'move-started': {
      const mv = MOVE_BY_ID[e.move];
      return { category: 'attack', details: [{ label: 'Attack', value: `${mv.name} (MITRE ATT&CK ${mv.attack})` }, { label: 'Stage', value: `${e.stage} of 6` }, { label: 'From address', value: e.ip }] };
    }
    case 'proxies':
      return { category: 'attack', details: [{ label: 'What changed', value: 'He plays from rotating proxies for the rest of the night' }] };
    case 'tip-off':
      return { category: 'attack', details: [{ label: 'Set off by', value: actionName(e.by) }] };
    case 'alert-opened':
      return { category: 'detected', details: [{ label: 'Alert', value: `#${e.alert}` }, { label: 'Route', value: e.route }, { label: 'Symptom', value: e.symptom }] };
    case 'breach-confirmed':
      return { category: 'detected', details: [{ label: 'Confirmed by', value: actionName(e.by) }], impact: 'The 72-hour notification clock started' };
    case 'move-landed':
      return { category: 'access', key: 'outcome', details: [{ label: 'Attack', value: moveName(e.move) }], impact: 'The intrusion went through' };
    case 'door-reopened':
      return { category: 'access', key: 'outcome', details: [{ label: 'Way in', value: moveName(e.move) }], impact: 'A way in you had shut opened again' };
    case 'return':
      return { category: 'access', key: 'outcome', details: [{ label: 'Through', value: e.through.replace(/-/g, ' ') }], impact: 'He came back in' };
    case 'souls-stolen':
      return { category: 'loss', key: 'souls', details: [], impact: `${e.count} customer record${e.count === 1 ? '' : 's'} taken` };
    case 'tap-opened':
      return { category: 'loss', key: 'souls', details: [{ label: 'Leak', value: TAP_BY_ID[e.tap].name }], impact: 'Records began to leak' };
    case 'tap-closed':
      return e.by
        ? { category: 'contained', details: [{ label: 'Leak', value: TAP_BY_ID[e.tap].name }, { label: 'Closed by', value: actionName(e.by) }] }
        : { category: 'loss', details: [{ label: 'Leak', value: TAP_BY_ID[e.tap].name }], impact: 'It ran dry: nothing closed it' };
    case 'customer-lost':
      return { category: 'business', key: 'heartbeat', details: [{ label: 'Customer errand', value: e.about }], impact: `The heartbeat can reach ${Math.round(e.max)} at most now` };
    case 'decision-missed': {
      const dip = CONFIG[world.difficulty].decision.dip;
      return { category: 'missed', key: 'heartbeat', details: [{ label: 'Alert', value: `#${e.alert}` }], impact: `No decision in time: heartbeat −${dip}` };
    }
    case 'notification-overdue':
      return { category: 'missed', key: 'outcome', details: [], impact: 'Legal was not notified inside the window' };
    case 'move-cut':
      return { category: 'contained', key: 'outcome', details: [{ label: 'Attack', value: moveName(e.move) }, { label: 'Stopped by', value: actionName(e.by) }], impact: 'The intrusion was stopped' };
    case 'door-shut':
      return { category: 'contained', key: 'outcome', details: [{ label: 'Way in', value: moveName(e.move) }, { label: 'Shut by', value: actionName(e.by) }], impact: 'A way in was shut' };
    case 'banished':
      return { category: 'contained', key: 'outcome', details: [], impact: 'Every way in closed: Death banished' };
    case 'patch-applied':
      return { category: 'recovery', key: 'outcome', details: [{ label: 'Patch', value: e.patch }], impact: 'The hole is fixed in the code' };
    case 'action': {
      const a = e.action;
      const row = ACTION_BY_ID[a.type];
      const details = [
        { label: 'Action', value: `${row.name} (${a.type})` },
        { label: 'Command', value: describeAction(a) },
        { label: 'Result', value: e.ok ? 'accepted' : 'refused' },
        ...(e.note ? [{ label: 'Note', value: e.note }] : []),
      ];
      if (!e.ok) return { category: 'refused', details };
      const dip = dips[a.type] ?? 0;
      const plug = a.type === 'DEF-11';
      const back = a.type === 'DEF-18' && a.what === 'nginx';
      const category: Category = row.phase === 'investigate' || row.phase === 'preserve' ? 'evidence' : row.phase === 'recover' ? 'recovery' : 'action';
      if (plug) return { category, key: 'downtime', details, impact: 'The shop went offline' };
      if (back) return { category, key: 'downtime', details, impact: 'The shop came back online' };
      if (dip > 0) return { category, key: 'heartbeat', details, impact: `Its own cost: heartbeat −${dip}` };
      return { category, details };
    }
    default:
      return { category: 'attack', details: [] };
  }
}

/**
 * The incident timeline (D-263): every line of `timelineOf` (thefts merged) and every missed decision, in order, each
 * with its category, its event's own fields and, for a key moment, what it changed.
 */
export function timelineItems(world: World): TimelineItem[] {
  const events = world.events;
  const index = new Map(events.map((e, i) => [e.id, i]));
  const begun = events.find((e) => e.kind === 'shift-begun')?.t ?? 0;
  const lines = timelineOf(events).map((x) => ({ ...x, event: events[index.get(x.id)!]! }));
  for (const e of events) if (e.kind === 'decision-missed') lines.push({ id: e.id, t: e.t, text: `Alert #${e.alert}: no decision before the bar ran out`, tone: 'bad', event: e });
  lines.sort((a, b) => a.t - b.t || a.id - b.id);
  return lines.map(({ event, ...x }) => {
    const c = classify(world, event);
    let details = c.details;
    let impact = c.impact;
    if (event.kind === 'souls-stolen') {
      // the run timelineOf merged: every theft from this one up to the next line it shows
      const run = theftsFrom(events, index.get(event.id)!);
      const last = run[run.length - 1]!;
      const count = run.reduce((s, e) => s + e.count, 0);
      details = [
        { label: 'Records taken', value: String(count) },
        { label: 'Gone in all', value: `${last.stolen} of ${last.total}` },
        ...(x.until !== undefined ? [{ label: 'Between', value: `${clockAt(world, x.t)} and ${clockAt(world, x.until)}` }] : []),
      ];
      impact = `−${count} customer record${count === 1 ? '' : 's'}`;
    }
    return {
      id: x.id,
      t: x.t,
      ...(x.until !== undefined && { until: x.until, untilClock: clockAt(world, x.until) }),
      clock: clockAt(world, x.t),
      into: fmtGameMs(Math.max(0, x.t - begun)),
      text: x.text,
      tone: x.tone,
      category: c.category,
      ...(c.key && { key: c.key }),
      details,
      ...(impact !== undefined && { impact }),
    };
  });
}

type Theft = Extract<GameEvent, { kind: 'souls-stolen' }>;

/** The thefts `timelineOf` merges into the line that starts at `i`: up to the next event it shows. */
function theftsFrom(events: readonly GameEvent[], i: number): Theft[] {
  const out: Theft[] = [];
  for (let j = i; j < events.length; j++) {
    const e = events[j]!;
    if (e.kind === 'souls-stolen') out.push(e);
    else if (e.kind !== 'alert-closed' && e.kind !== 'ticket' && eventWords(e)) break;
  }
  return out;
}

// ------------------------------------------------------------------ the full report

export type SectionId = 'overview' | 'progression' | 'detection' | 'containment' | 'impact' | 'evidence' | 'lessons';

export const SECTIONS: ReadonlyArray<{ id: SectionId; title: string }> = [
  { id: 'overview', title: 'Incident overview' },
  { id: 'progression', title: 'Attack progression' },
  { id: 'detection', title: 'Detection and response' },
  { id: 'containment', title: 'Containment and recovery' },
  { id: 'impact', title: 'Business impact' },
  { id: 'evidence', title: 'Evidence and timeline' },
  { id: 'lessons', title: 'Lessons learned' },
];

/** The heading each of the assessor's facts belongs under; a fact it does not know goes in the overview. */
export function sectionOfFact(label: string): SectionId {
  if (/^Time to notice|^Addresses flagged|^False leads|^Decisions in time/.test(label)) return 'detection';
  if (/^Time to contain|^IP blocks|^Leaky taps/.test(label)) return 'containment';
  if (/^Souls lost|^Downtime|^Breach notification|^Customers lost|^Heartbeat/.test(label)) return 'impact';
  if (/^Evidence/.test(label)) return 'evidence';
  return 'overview';
}

/** Every fact under its heading, each once. */
export function factsBySection(facts: ReadonlyArray<{ label: string; value: string }>): Record<SectionId, Array<{ label: string; value: string }>> {
  const out = Object.fromEntries(SECTIONS.map((s) => [s.id, [] as Array<{ label: string; value: string }>])) as Record<SectionId, Array<{ label: string; value: string }>>;
  for (const f of facts) out[sectionOfFact(f.label)].push(f);
  return out;
}

export interface Progression {
  move: string;
  name: string;
  technique: string;
  stage: number;
  firstSeen: string;
  /** "stopped at 22:11:23 (Block an IP)", "got through", "still running". */
  result: string;
  tone: 'bad' | 'good' | 'info';
}

/** His moves in the order he first played them, and how each ended, from the event log. */
export function progressionOf(world: World): Progression[] {
  const out: Progression[] = [];
  const seen = new Set<string>();
  for (const e of world.events) {
    if (e.kind !== 'move-started' || seen.has(e.move)) continue;
    seen.add(e.move);
    const mv = MOVE_BY_ID[e.move];
    const cut = world.events.find((x): x is Extract<GameEvent, { kind: 'move-cut' }> => x.kind === 'move-cut' && x.move === e.move);
    const shut = world.events.find((x): x is Extract<GameEvent, { kind: 'door-shut' }> => x.kind === 'door-shut' && x.move === e.move);
    const landed = world.events.some((x) => x.kind === 'move-landed' && x.move === e.move);
    const stop = cut ?? shut;
    const result = stop ? `${cut ? 'stopped' : 'shut'} at ${clockAt(world, stop.t)} (${actionName(stop.by)})${landed ? ', after it had got through once' : ''}` : landed ? 'got through' : 'never finished';
    out.push({ move: e.move, name: mv.name, technique: mv.attack, stage: e.stage, firstSeen: clockAt(world, e.t), result, tone: stop ? 'good' : landed ? 'bad' : 'info' });
  }
  return out;
}

// ------------------------------------------------------------------ the download

/** The report's own sections, appended to the engine's Markdown for the download (D-256, unchanged by D-263). */
export function aftermathMarkdown(m: Aftermath): string {
  const list = (xs: string[], none: string) => (xs.length ? xs.map((x) => `- ${x}`) : [none]);
  return [
    `## Overall: ${m.overall.grade} (${m.overall.result})`,
    '',
    m.overall.why,
    '',
    '## What went right',
    '',
    ...list(m.right, 'Nothing stopped him.'),
    '',
    '## Defences that did not hold',
    '',
    ...list(m.failed, 'None.'),
    '',
    '## Threats missed',
    '',
    ...list(m.missed, 'None.'),
    '',
    '## What a professional would have done',
    '',
    ...list(
      m.professional.map((p) => `**${PHASE_NAMES[p.phase]}.** ${p.text}`),
      'Every phase went well.',
    ),
    '',
    '## Three lessons',
    '',
    ...m.lessons.map((l, i) => `${i + 1}. ${l}`),
    '',
    '## Next time',
    '',
    ...list(m.nextTime, ''),
    '',
  ].join('\n');
}

/** The downloaded report: the engine's Markdown (with Kiro's debrief once she has written it), then the aftermath. */
export function reportMarkdown(report: Report, debrief: { text: string; offline: boolean } | null, m: Aftermath): string {
  return `${debrief ? renderMarkdown(report, debrief) : report.markdown}\n${aftermathMarkdown(m)}`;
}

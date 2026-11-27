// The post-incident report as a case file (UI-07, D-263): the ending's names, the metrics, the mistakes read once,
// every fact once in the full report, the timeline made only of real events, and the download for every ending.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../engine/engine';
import type { GameEvent } from '../../engine/log';
import { buildReport } from '../../engine/report';
import { WHOLE_RUN_TIMEOUT_MS } from '../../engine/test-fixtures/timeouts';
import type { Ending } from '../../rules/vocabulary';
import { aftermathOf } from './aftermath';
import {
  CATEGORY_LABEL,
  FILTERS,
  HEADLINES,
  UNFINISHED,
  factsBySection,
  findingsOf,
  headlineOf,
  inFilter,
  metricsOf,
  progressionOf,
  reportMarkdown,
  shiftSpan,
  timelineItems,
  type Category,
} from './reportView';
import { runOn } from './run';
import { timelineOf } from './words';

const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));
const ENDINGS: readonly Ending[] = ['banished', 'souls-lost', 'flatline', 'return', 'clean-handover', 'rough-handover', 'walked-away'];

/** A night left to him: every alert runs out, he takes what he can. */
function leftToHim() {
  const r = runOn(new Engine({ seed: 3, difficulty: 'hard', baseline: baseline() }));
  r.engine.beginShift();
  for (let i = 0; i < 6000 && !r.engine.world.ending; i++) r.engine.advance(500);
  return r.engine.world;
}

/** A night with a player in it: an evidence snapshot and a block of the loudest address on each alert. */
function played() {
  const r = runOn(new Engine({ seed: 7, difficulty: 'medium', baseline: baseline() }));
  const e = r.engine;
  e.beginShift();
  for (let i = 0; i < 6000 && !e.world.ending; i++) {
    const open = e.world.alerts.filter((a) => a.closedAt === undefined && a.answeredAt === undefined && a.missedAt === undefined);
    if (open.length) {
      e.act({ type: 'DEF-05', name: `snap-${i}` });
      const top = e.topTalkers(1)[0]?.ip;
      if (top && !e.world.firewall.blocked.includes(top)) e.act({ type: 'DEF-06', op: 'add', ip: top });
    }
    e.advance(500);
  }
  return e.world;
}

describe("the ending's name (D-263)", () => {
  it('every ending has its own name; a win says "Threat contained", a loss "Defeat"', () => {
    expect(Object.keys(HEADLINES).sort()).toEqual([...ENDINGS].sort());
    const titles = ENDINGS.map((e) => HEADLINES[e].title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).not.toContain('You lost');
    for (const e of ['banished', 'clean-handover'] as const) expect(HEADLINES[e]).toMatchObject({ kicker: 'Threat contained', tone: 'won', death: false });
    for (const e of ['souls-lost', 'flatline', 'return', 'walked-away'] as const) expect(HEADLINES[e]).toMatchObject({ kicker: 'Defeat', tone: 'lost', death: true });
    expect(HEADLINES['rough-handover']).toMatchObject({ kicker: 'Shift over', tone: 'mixed' });
    expect(HEADLINES['souls-lost'].title).toBe('Souls lost');
    expect(HEADLINES.flatline.title).toBe('Flatline');
    expect(headlineOf(undefined)).toBe(UNFINISHED);
  });
});

describe('what went wrong, each reason once (D-263)', () => {
  it('groups the mistakes that share a reason, keeping every title in order', () => {
    const why = (n: number) => `Reason ${n}.`;
    const wrong = [
      { phase: 'detect' as const, title: 'Stage 2 was never noticed', why: why(1) },
      { phase: 'contain' as const, title: 'IP whack-a-mole', why: why(2) },
      { phase: 'detect' as const, title: 'Stage 3 was never noticed', why: why(1) },
      { phase: 'detect' as const, title: 'Stage 4 was never noticed', why: why(1) },
      { phase: 'recover' as const, title: 'Never notified', why: why(3) },
    ];
    const f = findingsOf(wrong);
    expect(f.map((x) => x.why)).toEqual([why(1), why(2), why(3)]);
    expect(f[0]).toEqual({ phase: 'detect', titles: ['Stage 2 was never noticed', 'Stage 3 was never noticed', 'Stage 4 was never noticed'], why: why(1) });
    expect(f.flatMap((x) => x.titles).sort()).toEqual(wrong.map((x) => x.title).sort());
  });
});

describe('the case file reads only the engine (D-263)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  const nights = [
    ['left to him', leftToHim],
    ['played', played],
  ] as const;
  for (const [name, night] of nights) {
    it(`${name}: the metrics, the facts, the timeline and his moves`, async () => {
      const w = night();
      expect(w.ending).toBeDefined();
      const m = aftermathOf(w);
      const report = await buildReport(w);
      const fact = (label: string) => report.facts.find((f) => f.label === label)?.value;

      // the six metrics
      const metrics = Object.fromEntries(metricsOf(w, m, report.facts).map((x) => [x.id, x]));
      expect(Object.keys(metrics)).toEqual(['souls', 'heartbeat', 'downtime', 'response', 'mistakes', 'missed']);
      expect(metrics.souls).toMatchObject({ value: String(w.souls.stolen.length), of: `/${w.souls.total}` });
      expect(metrics.heartbeat).toMatchObject({ value: String(Math.round(w.heartbeat)), of: '/100' });
      expect(metrics.downtime!.value).toBe(fact('Downtime caused (plug pulled)'));
      expect(metrics.response!.value).toBe(fact('Time to contain'));
      expect(metrics.mistakes!.value).toBe(String(m.wrong.length));
      expect(metrics.missed!.value).toBe(String(m.missed.length));
      if (fact('Decisions in time')) expect(metrics.response!.sub).toContain(`Decisions in time: ${fact('Decisions in time')}`);

      // every fact once, under one heading
      const sections = factsBySection(report.facts);
      expect(Object.values(sections).flat()).toHaveLength(report.facts.length);
      expect(Object.values(sections).flat().map((f) => f.label).sort()).toEqual(report.facts.map((f) => f.label).sort());
      expect(sections.impact.map((f) => f.label)).toContain('Souls lost');
      expect(sections.detection.map((f) => f.label)).toContain('Time to notice stage 1');

      // the timeline: every line the old one showed, every missed decision, and nothing else
      const items = timelineItems(w);
      const byId = new Map<number, GameEvent>(w.events.map((e) => [e.id, e]));
      const missed = w.events.filter((e) => e.kind === 'decision-missed');
      expect(items.map((x) => x.id).sort((a, b) => a - b)).toEqual([...timelineOf(w.events).map((x) => x.id), ...missed.map((e) => e.id)].sort((a, b) => a - b));
      for (let i = 1; i < items.length; i++) expect(items[i]!.t).toBeGreaterThanOrEqual(items[i - 1]!.t);
      const KINDS: Record<Category, ReadonlyArray<GameEvent['kind']>> = {
        attack: ['move-started', 'proxies', 'tip-off'],
        detected: ['alert-opened', 'breach-confirmed'],
        access: ['move-landed', 'door-reopened', 'return'],
        loss: ['souls-stolen', 'tap-opened', 'tap-closed'],
        evidence: ['action'],
        action: ['action'],
        refused: ['action'],
        contained: ['move-cut', 'door-shut', 'banished', 'tap-closed'],
        recovery: ['patch-applied', 'action'],
        missed: ['decision-missed', 'notification-overdue'],
        business: ['customer-lost'],
      };
      const KEYED: ReadonlySet<GameEvent['kind']> = new Set(['souls-stolen', 'tap-opened', 'customer-lost', 'decision-missed', 'notification-overdue', 'move-landed', 'door-reopened', 'return', 'move-cut', 'door-shut', 'banished', 'patch-applied', 'action']);
      for (const x of items) {
        const e = byId.get(x.id)!;
        expect(e, `item ${x.id}`).toBeDefined();
        expect(KINDS[x.category], `${e.kind} as ${x.category}`).toContain(e.kind);
        expect(CATEGORY_LABEL[x.category]).toBeTruthy();
        if (x.key) expect(KEYED.has(e.kind), `${e.kind} marked key`).toBe(true);
        if (e.kind === 'action' && x.key) expect(e.ok && (e.action.type === 'DEF-11' || e.action.type === 'DEF-18' || x.key === 'heartbeat')).toBe(true);
        if (e.kind === 'move-started') expect(x.details.find((d) => d.label === 'From address')?.value).toBe(e.ip);
      }
      // the thefts: every record taken is counted once across the merged lines
      const takenInLines = items.filter((x) => byId.get(x.id)!.kind === 'souls-stolen').reduce((s, x) => s + Number(x.details.find((d) => d.label === 'Records taken')!.value), 0);
      const takenInLog = w.events.reduce((s, e) => s + (e.kind === 'souls-stolen' ? e.count : 0), 0);
      expect(takenInLines).toBe(takenInLog);
      for (const x of items.filter((y) => byId.get(y.id)!.kind === 'decision-missed')) expect(x).toMatchObject({ category: 'missed', key: 'heartbeat' });
      // the filters split the lines without losing any
      expect(items.filter((x) => inFilter(x, 'all'))).toHaveLength(items.length);
      expect(FILTERS.filter((f) => f.id !== 'all' && f.id !== 'key').reduce((s, f) => s + items.filter((x) => inFilter(x, f.id)).length, 0)).toBe(items.length);

      // his moves: one row each, in the order he first played them
      const started = [...new Set(w.events.flatMap((e) => (e.kind === 'move-started' ? [e.move] : [])))];
      const rows = progressionOf(w);
      expect(rows.map((r) => r.move)).toEqual(started);
      for (const r of rows) {
        const stopped = w.events.some((e) => (e.kind === 'move-cut' || e.kind === 'door-shut') && e.move === r.move);
        const landed = w.events.some((e) => e.kind === 'move-landed' && e.move === r.move);
        expect(r.result.startsWith('stopped') || r.result.startsWith('shut')).toBe(stopped);
        if (!stopped) expect(r.result).toBe(landed ? 'got through' : 'never finished');
      }

      const span = shiftSpan(w);
      expect(span.from).toMatch(/^\d\d:\d\d$/);
      expect(span.to).toMatch(/^\d\d:\d\d$/);
    });
  }

  it('the played night has a player in its timeline: defences, evidence, a stopped move', () => {
    const w = played();
    const items = timelineItems(w);
    expect(items.some((x) => x.category === 'evidence')).toBe(true);
    expect(items.some((x) => x.category === 'action')).toBe(true);
    expect(items.some((x) => x.category === 'contained' && x.key === 'outcome')).toBe(true);
  });

  it('the download is the whole report for every ending: facts, grades, mistakes, the overall grade, the lessons, the debrief', async () => {
    const w = leftToHim();
    for (const ending of ENDINGS) {
      w.ending = ending;
      const report = await buildReport(w);
      const m = aftermathOf(w);
      for (const debrief of [null, { text: 'Kiro wrote this.', offline: false }]) {
        const md = reportMarkdown(report, debrief, m);
        for (const f of report.facts) expect(md, `${ending}: ${f.label}`).toContain(`**${f.label}:** ${f.value}`);
        for (const p of ['Detect', 'Contain', 'Eradicate', 'Recover']) expect(md).toMatch(new RegExp(`\\| ${p} \\| [A-F] \\|`));
        for (const x of report.mistakes) expect(md).toContain(x.title);
        expect(md).toContain(`## Overall: ${m.overall.grade} (${m.overall.result})`);
        for (const l of m.lessons) expect(md).toContain(l);
        for (const x of m.nextTime) expect(md).toContain(x);
        for (const x of m.missed) expect(md).toContain(x);
        expect(md).toContain('## Debrief');
        if (debrief) expect(md).toContain(debrief.text);
      }
    }
  });
});

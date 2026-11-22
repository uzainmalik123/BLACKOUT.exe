// D-42, PRD §4.1: leaky taps open over time (at most 2 at once), drip about 1 % of the souls a real minute from the rows
// they really leak, and stop the moment their WAF path block goes in. Runs with no recordings (no Death, silent minion
// waves) unless a test says otherwise, so every soul counted here is a tap's or MIN-02's.
import { describe, expect, it } from 'vitest';
import { TAP_BY_ID, TAPS } from '../rules/taps';
import { TAP_IDS, type Difficulty, type TapId } from '../rules/vocabulary';
import { applyAction } from './actions';
import { CONFIG } from './config';
import { runSim } from './sim';
import { committedLibrary } from './test-fixtures/committed';
import { eventsOfKind, type GameEvent } from './log';
import { SEED_ACCOUNTS } from './seed';
import { initialWorld, type World } from './state';
import { stepTaps } from './taps';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';
import { readFileSync } from 'node:fs';
import type { AccessEvent, Recording } from '../recordings/format';
import { gameTimeIso } from './clock';

const REAL_S = 30_000; // game ms
const REAL_MIN = 60 * REAL_S;
const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

/** Taps alone: the world's clock moves in the engine's sub-steps and only the taps act. */
function tapsOnly(seed: number, difficulty: Difficulty, realMinutes: number, each?: (w: World) => void): World {
  const w = initialWorld(seed, difficulty);
  const tick = CONFIG[difficulty].tickGameMs;
  for (let t = 0; t < realMinutes * REAL_MIN; t += tick) {
    w.clock.gameMs += tick;
    each?.(w);
    stepTaps(w);
  }
  return w;
}

function mostOpenAtOnce(events: GameEvent[]): number {
  let open = 0, most = 0;
  for (const e of events) {
    if (e.kind === 'tap-opened') most = Math.max(most, ++open);
    if (e.kind === 'tap-closed') open--;
  }
  return most;
}

const tapSouls = (w: World, id: TapId) => eventsOfKind(w, 'souls-stolen').filter((e) => e.by === id);

describe('leaky taps open on schedule (D-42)', () => {
  for (const level of LEVELS) {
    const { min, max } = CONFIG[level].taps.everyGameMs;
    it(`${level}: the first opens ${min / REAL_MIN}–${max / REAL_MIN} real minutes in, the rest at least that far apart, each once, never more than 2 at once`, { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const w = tapsOnly(seed, level, 40);
        const opened = eventsOfKind(w, 'tap-opened');
        expect(opened.length, `${level} seed ${seed}`).toBeGreaterThanOrEqual(1);
        expect(opened[0]!.t).toBeGreaterThanOrEqual(min);
        expect(opened[0]!.t).toBeLessThanOrEqual(max + CONFIG[level].tickGameMs);
        for (let i = 1; i < opened.length; i++) expect(opened[i]!.t - opened[i - 1]!.t).toBeGreaterThanOrEqual(min);
        expect(new Set(opened.map((e) => e.tap)).size).toBe(opened.length);
        expect(mostOpenAtOnce(w.events)).toBeLessThanOrEqual(CONFIG[level].taps.maxOpen);
      }
    });
  }

  it('a tap that falls due while 2 are open waits until one closes', () => {
    const w = initialWorld(1, 'medium');
    // TAP-01 can't run dry quickly and TAP-03's 12 rows last four drips: force both open, then let the third fall due.
    w.taps.nextAt = 0;
    stepTaps(w);
    w.taps.nextAt = 0;
    stepTaps(w);
    expect(w.taps.open).toHaveLength(2);
    w.taps.nextAt = 0;
    stepTaps(w);
    expect(w.taps.open).toHaveLength(2);
    const waiting = TAPS.find((t) => !w.taps.opened.includes(t.id))!;
    for (const t of w.taps.open) applyAction(w, { type: 'DEF-12', rule: TAP_BY_ID[t.id].closedBy.rule });
    stepTaps(w);
    expect(w.taps.open.map((t) => t.id)).toEqual([waiting.id]);
  });

  it('every opening raises an alert about the tap and writes a scraper line for its route', () => {
    const w = tapsOnly(1, 'hard', 15);
    for (const e of eventsOfKind(w, 'tap-opened')) {
      expect(eventsOfKind(w, 'alert-opened').some((a) => a.about === e.tap && a.t === e.t)).toBe(true);
      const line = w.logs.access.find((l) => l.by === e.tap && l.t === e.t)!;
      expect(line).toMatchObject({ method: 'GET', status: 200, userAgent: 'python-requests/2.32.3' });
      expect(line.target.startsWith(TAP_BY_ID[e.tap].closedBy.rule.path.replace('/*/reviews', '/'))).toBe(true);
    }
  });

  it('taps draw from their own stream: Death and the minions see the same seeded draws with or without them', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
    const w = tapsOnly(1, 'medium', 30);
    expect(eventsOfKind(w, 'tap-opened').length).toBeGreaterThan(0);
    expect(w.rng).toBe(initialWorld(1, 'medium').rng);
  });
});

describe('a tap plays its recording\'s real lines (KI-59, D-130)', () => {
  const recorded = (id: TapId) => (JSON.parse(readFileSync(new URL(`../recordings/taps/${id}.a.json`, import.meta.url), 'utf8')) as Recording)
    .events.filter((e): e is AccessEvent => e.kind === 'access');
  const DATE = /\d{4}-\d\d-\d\d/;
  const shape = (l: { method: string; target: string; protocol: string; status: number; bytes: number; referer: string; userAgent: string }) =>
    ({ method: l.method, target: l.target.replace(DATE, 'DATE'), protocol: l.protocol, status: l.status, bytes: l.bytes, referer: l.referer, userAgent: l.userAgent });

  it('each opening plays the recording\'s first request and each drip the next one, round again when they run out', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
    for (const seed of [1, 2, 3]) {
      const w = tapsOnly(seed, 'hard', 60);
      for (const id of TAP_IDS) {
        const lines = w.logs.access.filter((l) => l.by === id);
        if (lines.length === 0) continue;
        const rec = recorded(id);
        const drips = rec.length > 1 ? rec.slice(1) : rec;
        expect(shape(lines[0]!), `${id} opening`).toEqual(shape(rec[0]!));
        lines.slice(1).forEach((l, i) => expect(shape(l), `${id} drip ${i + 1}`).toEqual(shape(drips[i % drips.length]!)));
      }
    }
  });

  it('the open logs are served under the game\'s date, not the day they were recorded', () => {
    // a seed whose first tap is the open logs
    const w = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => { const v = initialWorld(seed, 'medium'); v.taps.nextAt = 0; stepTaps(v); return v; })
      .find((v) => v.taps.opened[0] === 'TAP-01')!;
    for (let i = 0; i < 2 * 600; i++) { w.clock.gameMs += CONFIG.medium.tickGameMs; stepTaps(w); } // two real minutes
    const fetches = w.logs.access.filter((l) => l.by === 'TAP-01' && l.target.includes('access.log'));
    expect(fetches.length).toBeGreaterThanOrEqual(1);
    for (const l of fetches) expect(l.target).toBe(`/support/logs/access.log.${gameTimeIso(w, l.t).slice(0, 10)}`);
  });
});

describe('an open tap drips about 1 % a real minute until it is closed (D-42)', () => {
  const size = Math.round(325 * CONFIG.medium.taps.dripFraction);

  it('over a long run each open tap drips at most 1 % of the souls, once per real minute, the first a minute after it opens, only from the rows it leaks', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
    for (const level of LEVELS) {
      const w = tapsOnly(1, level, 60);
      for (const id of TAP_IDS) {
        const opened = eventsOfKind(w, 'tap-opened').find((e) => e.tap === id);
        if (!opened) continue;
        const drips = w.logs.access.filter((l) => l.by === id && l.t > opened.t).map((l) => l.t);
        drips.forEach((t, i) => expect(t - opened.t, `${level} ${id} drip ${i + 1}`).toBe((i + 1) * CONFIG[level].taps.dripEveryGameMs));
        const leaks = TAP_BY_ID[id].leaks;
        for (const e of tapSouls(w, id)) expect(e.count).toBeLessThanOrEqual(size);
        const keys = w.souls.stolen.slice();
        if (leaks !== 'every-customer') expect(tapSouls(w, id).reduce((n, e) => n + e.count, 0)).toBeLessThanOrEqual(leaks.length);
        expect(keys.every((k) => SEED_ACCOUNTS.some((a) => a.id === k.key))).toBe(true);
      }
      // the open logs leak every customer: forgotten for an hour, they keep dripping about 1 % a minute
      const logs = eventsOfKind(w, 'tap-opened').find((e) => e.tap === 'TAP-01');
      if (logs) {
        const minutes = Math.floor((60 * REAL_MIN - logs.t) / REAL_MIN);
        expect(tapSouls(w, 'TAP-01').reduce((n, e) => n + e.count, 0), level).toBe(minutes * size);
      }
    }
  });

  it('closing a tap (its WAF path block) stops its drip at once, closes its alert, and it never reopens', () => {
    const w = initialWorld(1, 'medium');
    w.taps.nextAt = 0;
    stepTaps(w);
    const id = w.taps.open[0]!.id;
    for (let i = 0; i < 2 * 600; i++) { w.clock.gameMs += CONFIG.medium.tickGameMs; stepTaps(w); } // two real minutes
    expect(tapSouls(w, id).length).toBeGreaterThanOrEqual(1);
    applyAction(w, { type: 'DEF-12', rule: TAP_BY_ID[id].closedBy.rule });
    const closedAt = w.clock.gameMs;
    for (let i = 0; i < 30 * 600; i++) { w.clock.gameMs += CONFIG.medium.tickGameMs; stepTaps(w); } // thirty real minutes
    expect(tapSouls(w, id).filter((e) => e.t > closedAt)).toEqual([]);
    expect(eventsOfKind(w, 'tap-closed').find((e) => e.tap === id)).toMatchObject({ by: 'DEF-12', t: closedAt + CONFIG.medium.tickGameMs });
    expect(w.alerts.find((a) => a.about === id)!.closedAt).toBe(closedAt + CONFIG.medium.tickGameMs);
    expect(eventsOfKind(w, 'tap-opened').filter((e) => e.tap === id)).toHaveLength(1);
  });

  it('a tap whose rows are all gone runs dry: its alert closes and it no longer counts as open; one with nothing left never opens', () => {
    const w = initialWorld(1, 'medium');
    for (const k of (TAP_BY_ID['TAP-02'].leaks as readonly number[])) w.souls.stolen.push({ table: 'Users', key: k });
    for (let i = 0; i < 3; i++) { w.taps.nextAt = 0; stepTaps(w); }
    expect(w.taps.opened).not.toContain('TAP-02');
    const v = initialWorld(2, 'medium');
    v.taps.nextAt = 0;
    stepTaps(v);
    const id = v.taps.open[0]!.id;
    const leaks = TAP_BY_ID[id].leaks;
    for (const k of leaks === 'every-customer' ? SEED_ACCOUNTS.map((a) => a.id) : leaks) v.souls.stolen.push({ table: 'Users', key: k });
    stepTaps(v);
    expect(v.taps.open).toEqual([]);
    expect(eventsOfKind(v, 'tap-closed')).toMatchObject([{ tap: id }]);
    expect(eventsOfKind(v, 'tap-closed')[0]).not.toHaveProperty('by');
  });

  it('nothing drips while the plug is pulled, and no drips pile up for when it comes back', () => {
    const w = initialWorld(1, 'medium');
    w.taps.nextAt = 0;
    stepTaps(w);
    applyAction(w, { type: 'DEF-11' });
    for (let i = 0; i < 5 * 600; i++) { w.clock.gameMs += CONFIG.medium.tickGameMs; stepTaps(w); } // five real minutes
    expect(eventsOfKind(w, 'souls-stolen')).toEqual([]);
    applyAction(w, { type: 'DEF-18', what: 'nginx' });
    w.clock.gameMs += CONFIG.medium.tickGameMs;
    stepTaps(w);
    expect(eventsOfKind(w, 'souls-stolen').length).toBeLessThanOrEqual(1);
  });

  it('in whole idle runs on the committed recordings, taps take souls alongside Death and the minions, and the minions still stay within their 5 %', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
    for (const level of LEVELS) {
      const r = runSim({ seed: 1, difficulty: level, library: committedLibrary(), maxRealMs: 30 * 60_000, player: () => [] });
      expect(TAP_IDS.some((id) => tapSouls(r.world, id).length > 0), level).toBe(true);
      expect(mostOpenAtOnce(r.events), level).toBeLessThanOrEqual(2);
      expect(r.world.souls.byMinions, level).toBeLessThanOrEqual(Math.floor(r.world.souls.total * 0.05));
    }
  });
});

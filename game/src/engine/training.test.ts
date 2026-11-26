// SYS-24 (D-236): the training shift. A scripted drill, not Death: three loud variants, one per step, each step
// waiting for the player's taught action or its timeout, ending in "drill complete" with no verdict and no report.
import { describe, expect, it } from 'vitest';
import { DRILL_COMPLETE, TRAINING_STEPS } from '../content/kiro-fallback';
import { MOVE_BY_ID } from '../rules/moves';
import type { PlayerAction } from '../rules/vocabulary';
import { COMMITTED_LIBRARY, Engine } from './engine';
import { eventsOfKind } from './log';
import { buildReport } from './report';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';
import { TRAINING_SCRIPT } from './training';

const REAL_S = 1000;
const FRAME = 100; // real ms per advance, like a screen's frame loop (coarser, for speed)

/** Plays a training run to "drill complete" (or `limitRealMs`), calling `onStep` once when each step starts. */
function play(engine: Engine, onStep: (id: string) => void = () => {}, limitRealMs = 10 * 60 * REAL_S): number {
  engine.beginShift();
  let real = 0;
  let seen = -1;
  while (engine.training()?.complete !== true && real < limitRealMs) {
    engine.advance(FRAME);
    real += FRAME;
    const view = engine.training()!;
    if (view.index !== seen && view.state === 'teach' && view.startedAt !== undefined) {
      seen = view.index;
      onStep(view.step.id);
    }
  }
  return real;
}

/** The player who does every taught step the moment it is taught (and once more each second, in case it was too early). */
function diligent(engine: Engine): (id: string) => void {
  const scanner = () => engine.topTalkers(1)[0]?.ip;
  const actions: Record<string, () => PlayerAction | undefined> = {
    flag: () => (scanner() ? { type: 'DEF-21', ip: scanner()! } : undefined),
    block: () => {
      const confirmed = engine.world.flags.find((f) => f.confirmedAt !== undefined)?.ip ?? scanner();
      return confirmed ? { type: 'DEF-06', op: 'add', ip: confirmed } : undefined;
    },
    'rate-limit': () => ({ type: 'DEF-07' }),
    'search-off': () => ({ type: 'DEF-10', feature: 'search', enabled: false }),
    patch: () => ({ type: 'DEF-13', patch: 'search' }),
    evidence: () => ({ type: 'DEF-05', name: 'drill' }),
  };
  return (id) => {
    const a = actions[id]?.();
    if (a) engine.act(a);
  };
}

describe('the training script (SYS-24, D-236)', () => {
  it('carries one TRAINING_STEPS entry per step, in order, as its teach', () => {
    expect(TRAINING_SCRIPT.map((s) => s.teach)).toEqual(TRAINING_STEPS);
  });

  it('plays only the loud variants the spec names (ATK-01.a, ATK-04.a, ATK-08.c), at most one per step', () => {
    const moves = TRAINING_SCRIPT.flatMap((s) => (s.move ? [`${s.move.move}.${s.move.variant}`] : []));
    expect(new Set(moves)).toEqual(new Set(['ATK-01.a', 'ATK-04.a', 'ATK-08.c']));
    for (const s of TRAINING_SCRIPT) {
      if (!s.move) continue;
      const v = COMMITTED_LIBRARY.variantsOf(s.move.move).find((x) => x.variant === s.move!.variant)!;
      expect(v.info.quiet, `${s.move.move}.${s.move.variant}`).toBe(false);
      expect(v.recording.label, `${s.move.move}.${s.move.variant}`).toMatch(/^loud/);
      expect(MOVE_BY_ID[s.move.move].foothold).toBeUndefined();
    }
  });
});

describe('the training shift (SYS-24, D-236)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  it('starts with `new Engine({ scenario: "training" })` and nothing happens before beginShift()', () => {
    const e = new Engine({ scenario: 'training' });
    expect(e.world.training).toBeDefined();
    expect(e.training()).toMatchObject({ index: 0, count: TRAINING_STEPS.length, state: 'teach', complete: false });
    expect(e.training()!.step).toBe(TRAINING_STEPS[0]);
    e.advance(60 * REAL_S);
    expect(eventsOfKind(e.world, 'move-started')).toEqual([]);
    expect(e.training()!.startedAt).toBeUndefined();
  });

  it('the real game has no training state', () => {
    const e = new Engine({ seed: 1, difficulty: 'medium' });
    expect(e.world.training).toBeUndefined();
    expect(e.training()).toBeUndefined();
  });

  it('a diligent player: every step waits for its action and advances on it, in order; the freeze is on for the first step', () => {
    const e = new Engine({ scenario: 'training' });
    const act = diligent(e);
    const frozenAtStart: boolean[] = [];
    const real = play(e, (id) => {
      if (id === 'room') frozenAtStart.push(e.act({ type: 'DEF-07' }).ok);
      act(id);
    });
    expect(frozenAtStart).toEqual([false]); // the change freeze holds during the room
    expect(e.world.waf).toEqual([expect.objectContaining({ kind: 'rate-limit' })]); // only the taught one, later
    const started = eventsOfKind(e.world, 'training-step').map((x) => x.step);
    const done = eventsOfKind(e.world, 'training-step-done');
    expect(started).toEqual(TRAINING_STEPS.map((s) => s.id));
    expect(done.map((x) => [x.step, x.by])).toEqual(TRAINING_STEPS.map((s) => [s.id, 'action']));
    expect(e.world.incident.by).toBeDefined(); // the first alert (or the flag) declared it
    expect(eventsOfKind(e.world, 'drill-complete')).toHaveLength(1);
    expect(real).toBeLessThan(6 * 60 * REAL_S);
    expect(e.training()).toMatchObject({ complete: true, state: 'done', index: TRAINING_STEPS.length - 1 });
  });

  it('the password and the dump steps start on their own alert, so their text ("a new alert…") is true', () => {
    const e = new Engine({ scenario: 'training' });
    play(e, diligent(e));
    const at = (step: string) => eventsOfKind(e.world, 'training-step').find((x) => x.step === step)!.t;
    const alertOf = (route: string) => e.world.alerts.find((a) => a.route === route)!.openedAt;
    expect(at('rate-limit')).toBe(alertOf('/rest/user/login'));
    expect(at('search-off')).toBe(alertOf('/rest/products/search'));
  });

  it('the block step shows the drill coming back from a new address', () => {
    const e = new Engine({ scenario: 'training' });
    const act = diligent(e);
    let blocked: string | undefined;
    play(e, (id) => {
      act(id);
      if (id === 'block') blocked = e.world.firewall.blocked[0];
    });
    expect(blocked).toBeDefined();
    const scans = eventsOfKind(e.world, 'move-started').filter((m) => m.move === 'ATK-01');
    const after = scans.filter((m) => m.ip !== blocked);
    expect(after.length).toBeGreaterThan(0);
  });

  it('a do-nothing player: each step after the room advances on its timeout and the drill completes in under seven real minutes', () => {
    const e = new Engine({ scenario: 'training' });
    const real = play(e);
    const done = eventsOfKind(e.world, 'training-step-done');
    expect(done.map((x) => x.step)).toEqual(TRAINING_STEPS.map((s) => s.id));
    expect(done[0]!.by).toBe('action'); // the first alert opens by itself: the room needs no act
    expect(done.slice(1).every((x) => x.by === 'timeout')).toBe(true);
    expect(real).toBeLessThan(7 * 60 * REAL_S);
    expect(e.world.souls.stolen.length).toBeGreaterThan(0); // the meters move so they are seen
    expect(e.world.souls.stolen.length).toBeLessThanOrEqual(Math.ceil(e.world.souls.total * 0.1));
    expect(e.world.heartbeat).toBeGreaterThan(0);
  });

  it('never plays a quiet variant, a minion, a tap, a foothold or Death\'s other moves; never ends with a verdict or a report', async () => {
    for (const run of [(e: Engine) => play(e), (e: Engine) => play(e, diligent(e))]) {
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        const e = new Engine({ scenario: 'training', seed: 7, difficulty });
        run(e);
        const started = eventsOfKind(e.world, 'move-started');
        expect(started.length).toBeGreaterThan(0);
        for (const m of started) {
          expect(['ATK-01.a', 'ATK-04.a', 'ATK-08.c']).toContain(`${m.move}.${m.variant}`);
        }
        expect(eventsOfKind(e.world, 'wave-started')).toEqual([]);
        expect(eventsOfKind(e.world, 'tap-opened')).toEqual([]);
        expect(eventsOfKind(e.world, 'rule-evaded')).toEqual([]);
        expect(eventsOfKind(e.world, 'customer-lost')).toEqual([]);
        expect(eventsOfKind(e.world, 'ending')).toEqual([]);
        expect(eventsOfKind(e.world, 'suggestion')).toEqual([]);
        expect(e.world.ending).toBeUndefined();
        expect(e.training()!.complete).toBe(true);
        await expect(buildReport(e.world)).rejects.toThrow(/training/);
        // after the drill, time stops: the screens show the card
        const t = e.world.clock.gameMs;
        e.advance(10 * REAL_S);
        expect(e.world.clock.gameMs).toBe(t);
      }
    }
  });

  it('every step the drill plays raises an alert the player can read (route and symptom, never who)', () => {
    const e = new Engine({ scenario: 'training' });
    play(e);
    const routes = new Set(e.world.alerts.map((a) => a.route));
    expect([...routes]).toEqual(expect.arrayContaining(['/', '/rest/user/login', '/rest/products/search']));
    for (const a of e.world.alerts) expect(a.symptom).not.toMatch(/ATK-|Death/);
  });

  it('the view the screens read names no move and the drill-complete card is the content\'s', () => {
    const e = new Engine({ scenario: 'training' });
    play(e, diligent(e));
    const view = e.training()!;
    expect(JSON.stringify(view)).not.toMatch(/ATK-|MIN-|TAP-/);
    for (const x of [...eventsOfKind(e.world, 'training-step'), ...eventsOfKind(e.world, 'training-step-done')]) expect(JSON.stringify(x)).not.toMatch(/ATK-/);
    expect(DRILL_COMPLETE.title).toBe('Drill complete');
  });

  it('is deterministic for a seed', () => {
    const a = new Engine({ scenario: 'training', seed: 3 });
    const b = new Engine({ scenario: 'training', seed: 3 });
    play(a, diligent(a));
    play(b, diligent(b));
    expect(a.world.events).toEqual(b.world.events);
  });
});

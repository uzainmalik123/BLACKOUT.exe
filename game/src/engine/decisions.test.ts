// SYS-25 (D-261): timed decisions. Every alert gives the player a window to act; a decision answers it, a window that
// ends with none costs a heartbeat dip, once; an alert that closes first needed no decision.
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { advance } from './advance';
import { openAlert, closeAlert } from './alerts';
import { evaluate } from './assess';
import { CONFIG } from './config';
import { decideBy, decisionsTally, stepDecisions } from './decisions';
import { eventsOfKind } from './log';
import { runSim } from './sim';
import { initialWorld, type World } from './state';
import { lab } from './test-fixtures/lab';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';

const REAL_S = 30_000;

/** A lab world on `level` with one open alert about his scan. */
function withAlert(level: 'easy' | 'medium' | 'hard' = 'medium'): World {
  const w = lab(initialWorld(1, level));
  openAlert(w, 'ATK-01', '/', 'a burst of requests from one address');
  return w;
}
const at = (w: World, gameMs: number) => {
  w.clock.gameMs = gameMs;
  stepDecisions(w);
};

describe('the decision window (SYS-25)', () => {
  it('is Easy 20, Medium 12, Hard 10 real seconds, and a miss costs 2, 3 and 4 heartbeat', () => {
    expect((['easy', 'medium', 'hard'] as const).map((l) => CONFIG[l].decision.windowGameMs / REAL_S)).toEqual([20, 12, 10]);
    expect((['easy', 'medium', 'hard'] as const).map((l) => CONFIG[l].decision.dip)).toEqual([2, 3, 4]);
  });

  for (const level of ['easy', 'medium', 'hard'] as const) {
    it(`${level}: an alert left past its window is missed once: one dip, one event`, () => {
      const w = withAlert(level);
      const a = w.alerts[0]!;
      const before = w.heartbeat;
      at(w, decideBy(w, a) - 1);
      expect(a.missedAt).toBeUndefined();
      at(w, decideBy(w, a));
      expect(a.missedAt).toBe(decideBy(w, a));
      expect(w.heartbeat).toBe(before - CONFIG[level].decision.dip);
      expect(eventsOfKind(w, 'decision-missed')).toMatchObject([{ alert: a.id, about: 'ATK-01' }]);
      at(w, decideBy(w, a) + 10 * REAL_S);
      expect(w.heartbeat).toBe(before - CONFIG[level].decision.dip); // once
      expect(eventsOfKind(w, 'decision-missed')).toHaveLength(1);
    });
  }

  it('a change taken inside the window answers every alert waiting; no dip follows', () => {
    const w = withAlert();
    openAlert(w, 'MIN-01', '/rest/user/login', 'failed logins from many addresses');
    w.clock.gameMs += 5 * REAL_S;
    expect(applyAction(w, { type: 'DEF-06', ip: '203.0.113.50', op: 'add' }).ok).toBe(true);
    expect(w.alerts.map((a) => a.answeredAt)).toEqual([w.clock.gameMs, w.clock.gameMs]);
    const before = w.heartbeat;
    at(w, decideBy(w, w.alerts[0]!) + REAL_S);
    expect(w.heartbeat).toBe(before);
    expect(eventsOfKind(w, 'decision-missed')).toEqual([]);
    expect(decisionsTally(w)).toEqual({ inTime: 2, of: 2 });
  });

  it('a read, a refused action or asking nothing never answers', () => {
    const w = withAlert();
    applyAction(w, { type: 'DEF-01', query: 'grep 404', shown: [], shownTotal: 0 });
    applyAction(w, { type: 'DEF-03', path: '/srv/juice-shop' });
    expect(applyAction(w, { type: 'DEF-06', ip: 'not-an-ip', op: 'add' }).ok).toBe(false);
    expect(w.alerts[0]!.answeredAt).toBeUndefined();
    at(w, decideBy(w, w.alerts[0]!));
    expect(w.alerts[0]!.missedAt).toBeDefined();
  });

  it('an action after the window answers nothing; an alert opened after an action waits for its own', () => {
    const w = withAlert();
    at(w, decideBy(w, w.alerts[0]!));
    applyAction(w, { type: 'DEF-06', ip: '203.0.113.50', op: 'add' });
    expect(w.alerts[0]!.answeredAt).toBeUndefined();
    openAlert(w, 'MIN-01', '/rest/user/login', 'failed logins from many addresses');
    expect(w.alerts[1]!.answeredAt).toBeUndefined();
    expect(decisionsTally(w)).toEqual({ inTime: 0, of: 1 });
  });

  it('an alert that closes inside its window (his move landed or was cut) needed no decision', () => {
    const w = withAlert();
    w.clock.gameMs += 3 * REAL_S;
    closeAlert(w, 'ATK-01');
    const before = w.heartbeat;
    at(w, decideBy(w, w.alerts[0]!) + REAL_S);
    expect(w.alerts[0]!.missedAt).toBeUndefined();
    expect(w.heartbeat).toBe(before);
    expect(decisionsTally(w)).toEqual({ inTime: 0, of: 0 });
  });

  it('a paused clock holds the window (Easy)', () => {
    const w = withAlert('easy');
    w.clock.paused = true;
    advance(w, FIXTURE_LIBRARY, 60_000);
    expect(w.alerts[0]!.missedAt).toBeUndefined();
  });

  it('an idle night misses alerts, and the report counts the decisions in time as a fact', () => {
    const r = runSim({ seed: 1, player: () => [], library: FIXTURE_LIBRARY, maxRealMs: 4 * 60_000 });
    const missed = eventsOfKind(r.world, 'decision-missed');
    expect(missed.length).toBeGreaterThan(0);
    expect(evaluate(r.world).facts).toContainEqual({ label: 'Decisions in time', value: `0 of ${missed.length}` });
  });
});

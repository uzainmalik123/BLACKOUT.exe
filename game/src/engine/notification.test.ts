// SYS-14 (D-112): the notification clock. Starts at the first DEF-05 or DEF-19 after souls are taken, runs for the
// window (72 h compressed to the run length) as a 72-hour countdown, stops at the legal notification, logs overdue.
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { advance } from './advance';
import { CONFIG } from './config';
import { Engine } from './engine';
import { EMPTY_LIBRARY } from './library';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';
import { emit, eventsOfKind } from './log';
import { notificationClock, stepNotificationClock } from './notification';
import { initialWorld } from './state';

const REAL_S = 30_000;
const window = CONFIG.medium.notification.windowGameMs;

function stolen(w: ReturnType<typeof initialWorld>): void {
  w.souls.stolen.push({ table: 'Users', key: 1 });
  emit(w, { kind: 'souls-stolen', by: 'ATK-08', count: 1, stolen: 1, total: w.souls.total });
}

describe('the notification clock (SYS-14)', () => {
  it('is idle until a breach is confirmed: a snapshot before any theft starts nothing', () => {
    const w = initialWorld(1, 'medium');
    applyAction(w, { type: 'DEF-05', name: 'early' });
    expect(notificationClock(w)).toEqual({ state: 'idle', label: '--:--:--' });
    expect(eventsOfKind(w, 'breach-confirmed')).toEqual([]);
  });

  it('starts at the escalation after souls are taken (D-116; a snapshot never starts it), once, and counts 72 hours down over the window', () => {
    for (const [first, by] of [[{ type: 'DEF-19' }, 'DEF-19']] as const) {
      const w = initialWorld(1, 'medium');
      w.clock.gameMs = 10 * REAL_S;
      stolen(w);
      applyAction(w, first);
      expect(eventsOfKind(w, 'breach-confirmed')).toMatchObject([{ by, t: 10 * REAL_S }]);
      expect(notificationClock(w)).toEqual({ state: 'running', confirmedAt: 10 * REAL_S, deadline: 10 * REAL_S + window, remainingGameMs: window, label: '72:00:00' });
      applyAction(w, { type: 'DEF-19' }); // a second confirmation changes nothing
      applyAction(w, { type: 'DEF-05', name: 'y' }); // a snapshot never did
      expect(eventsOfKind(w, 'breach-confirmed')).toHaveLength(1);
      w.clock.gameMs = 10 * REAL_S + window / 2;
      expect(notificationClock(w)).toMatchObject({ state: 'running', remainingGameMs: window / 2, label: '36:00:00' });
      w.clock.gameMs = 10 * REAL_S + window / 4;
      expect(notificationClock(w).label).toBe('54:00:00');
    }
  });

  it('stops at the legal notification (the face freezes there); notifying customers alone does not stop it', () => {
    const w = initialWorld(1, 'medium');
    stolen(w);
    applyAction(w, { type: 'DEF-19' });
    w.clock.gameMs = window / 3;
    applyAction(w, { type: 'DEF-20', to: 'customers' });
    expect(notificationClock(w).state).toBe('running');
    w.clock.gameMs = window / 2;
    applyAction(w, { type: 'DEF-20', to: 'legal' });
    expect(notificationClock(w)).toMatchObject({ state: 'notified', notifiedAt: window / 2, remainingGameMs: window / 2, label: '36:00:00' });
    w.clock.gameMs = 2 * window;
    expect(notificationClock(w)).toMatchObject({ state: 'notified', remainingGameMs: window / 2, label: '36:00:00' });
    stepNotificationClock(w);
    expect(eventsOfKind(w, 'notification-overdue')).toEqual([]);
  });

  it('past the window with legal not told: overdue, 00:00:00, one notification-overdue event', () => {
    const w = initialWorld(1, 'medium');
    stolen(w);
    applyAction(w, { type: 'DEF-19' });
    w.clock.gameMs = window - 1;
    stepNotificationClock(w);
    expect(notificationClock(w).state).toBe('running');
    expect(eventsOfKind(w, 'notification-overdue')).toEqual([]);
    w.clock.gameMs = window;
    stepNotificationClock(w);
    expect(notificationClock(w)).toMatchObject({ state: 'overdue', remainingGameMs: 0, label: '00:00:00' });
    expect(eventsOfKind(w, 'notification-overdue')).toMatchObject([{ t: window }]);
    w.clock.gameMs = 2 * window;
    stepNotificationClock(w);
    expect(eventsOfKind(w, 'notification-overdue')).toHaveLength(1);
    applyAction(w, { type: 'DEF-20', to: 'legal' }); // late, but told
    expect(notificationClock(w)).toMatchObject({ state: 'notified', remainingGameMs: 0 });
  });

  it('runs inside advance(): the clock starts from a real confirmation and the overdue event lands on the tick the window passes', () => {
    const w = initialWorld(1, 'medium');
    stolen(w);
    w.clock.gameMs = REAL_S;
    applyAction(w, { type: 'DEF-19' });
    w.comms.breachConfirmedAt = REAL_S - window + 2 * CONFIG.medium.tickGameMs; // as if confirmed almost a window ago
    advance(w, FIXTURE_LIBRARY, 100); // one tick: not yet
    expect(eventsOfKind(w, 'notification-overdue')).toEqual([]);
    advance(w, FIXTURE_LIBRARY, 100);
    expect(eventsOfKind(w, 'notification-overdue')).toHaveLength(1);
  });

  it('the Engine exposes it, and the window is the same on every level', () => {
    const engine = new Engine({ seed: 1, difficulty: 'hard', library: EMPTY_LIBRARY });
    expect(engine.notificationClock().state).toBe('idle');
    for (const d of ['easy', 'medium', 'hard'] as const) expect(CONFIG[d].notification.windowGameMs).toBe(window);
  });
});

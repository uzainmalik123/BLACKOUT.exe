// UI-15 (D-261): the countdown on the choices, read from the engine.
import { describe, expect, it } from 'vitest';
import { applyAction } from '../../engine/actions';
import { openAlert } from '../../engine/alerts';
import { CONFIG } from '../../engine/config';
import { stepDecisions } from '../../engine/decisions';
import { initialWorld, type World } from '../../engine/state';
import { lab } from '../../engine/test-fixtures/lab';
import { countdownOf, countdownWords, SHOW } from './countdown';

const REAL_S = 30_000;
const fresh = (): World => {
  const w = lab(initialWorld(1, 'medium'));
  openAlert(w, 'ATK-01', '/', 'a burst of requests from one address');
  return w;
};

describe('the countdown on the choices (UI-15)', () => {
  it('counts the shown alert down from its window, the bar emptying with it', () => {
    const w = fresh();
    const window = CONFIG.medium.decision.windowGameMs / REAL_S;
    expect(countdownOf(w)).toEqual({ state: 'deciding', left: window, share: 1 });
    w.clock.gameMs += 4.5 * REAL_S;
    const c = countdownOf(w)!;
    expect(c.left).toBeCloseTo(window - 4.5);
    expect(c.share).toBeCloseTo((window - 4.5) / window);
    expect(countdownWords(c)).toBe(`Decide: ${Math.ceil(window - 4.5)} s`);
    expect(countdownOf(w, true)!.share).toBe(Math.ceil(window - 4.5) / window); // reduced motion: whole seconds
  });

  it('says "In time" when the player acts, then shows nothing while nothing waits', () => {
    const w = fresh();
    w.clock.gameMs += 2 * REAL_S;
    applyAction(w, { type: 'DEF-06', ip: '203.0.113.50', op: 'add' });
    expect(countdownOf(w)!.state).toBe('in-time');
    expect(countdownWords(countdownOf(w)!)).toBe('In time');
    w.clock.gameMs += SHOW['in-time'] * REAL_S;
    expect(countdownOf(w)).toBeNull();
  });

  it('says "Too late" when the window runs out, then counts the next alert', () => {
    const w = fresh();
    w.clock.gameMs += CONFIG.medium.decision.windowGameMs;
    stepDecisions(w);
    expect(countdownOf(w)!.state).toBe('too-late');
    expect(countdownWords(countdownOf(w)!)).toMatch(/^Too late/);
    w.clock.gameMs += SHOW['too-late'] * REAL_S;
    expect(countdownOf(w)).toBeNull(); // the missed alert waits no more
    openAlert(w, 'MIN-01', '/rest/user/login', 'failed logins from many addresses');
    expect(countdownOf(w)!.state).toBe('deciding');
  });

  it('shows nothing in the quiet', () => {
    expect(countdownOf(lab(initialWorld(1, 'medium')))).toBeNull();
  });
});

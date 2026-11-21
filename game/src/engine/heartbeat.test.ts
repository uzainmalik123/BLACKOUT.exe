import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { backlash, churn, customersFailing, dip, drainPerRealMinute, integrateHeartbeat } from './heartbeat';
import { eventsOfKind } from './log';
import { initialWorld, type Replay, type Wave, type World } from './state';

const STEP_GAME_MS = 3_000; // the engine's 100 real ms sub-step
const cust = CONFIG.medium.customers;

const deathReplay: Replay = { id: 1, owner: 'death', move: 'ATK-08', variant: 'b', ip: '203.0.113.82', recordedIp: '203.0.113.82', startedAt: 0, cursor: 0 };
const wave: Wave = { id: 2, minion: 'MIN-01', n: 1, ips: ['203.0.113.100'], startedAt: 0, endsAt: 1, successesDone: 0 };

/** Real seconds from 100 to 0 with only this cause present, in the engine's own sub-steps. */
function secondsToFlatline(setUp: (w: World) => void): number {
  const w = initialWorld(1, 'medium');
  setUp(w);
  let steps = 0;
  while (w.heartbeat > 0 && steps < 1_000_000) {
    integrateHeartbeat(w, STEP_GAME_MS);
    steps++;
  }
  return steps / 10;
}

/** One real minute of the heartbeat alone, with the clock moving. */
function minute(w: World): void {
  for (let i = 0; i < 600; i++) {
    w.clock.gameMs += STEP_GAME_MS;
    integrateHeartbeat(w, STEP_GAME_MS);
  }
}

describe('heartbeat (SYS-06), rates per real minute (D-33)', () => {
  it('with only the plug pulled, flatlines a little after 3 real minutes (100 / 33 per minute = 181.8 s)', () => {
    expect(secondsToFlatline((w) => { w.nginx = 'stopped'; })).toBeCloseTo(181.9, 1);
  });

  it('target times for each cause alone: defacement 5 min, one open door 33 min, one minion 67 min', () => {
    expect(secondsToFlatline((w) => { w.defacements.push({ productId: 1, kind: 'deface', by: 'ATK-15' }); })).toBeCloseTo(300, 0);
    expect(secondsToFlatline((w) => { w.defacements.push({ productId: 1, kind: 'deface', by: 'ATK-17' }); })).toBeCloseTo(300, 0);
    expect(secondsToFlatline((w) => { w.defacements.push({ productId: 2, kind: 'xss', by: 'ATK-16' }); })).toBeCloseTo(300, 0);
    expect(secondsToFlatline((w) => { w.replays.push(deathReplay); })).toBeCloseTo(2000, 0);
    expect(secondsToFlatline((w) => { w.waves.push(wave); })).toBeCloseTo(4000, 0);
  });

  it('a feature off has no weight of its own (D-65): the cost is what its customers\' failed requests cost (customers.test.ts)', () => {
    const w = initialWorld(1, 'medium');
    for (const f of ['search', 'registration', 'password-reset', 'uploads', 'ftp'] as const) w.features[f] = false;
    w.features['feedback-captcha'] = true;
    expect(drainPerRealMinute(w)).toBe(0);
    expect('featureWeight' in CONFIG.medium.heartbeat).toBe(false);
  });

  it('drains per real minute: 33 plug, 20 defaced or XSS, 3 per open door, 1.5 per minion', () => {
    const w = initialWorld(1, 'medium');
    expect(drainPerRealMinute(w)).toBe(0);
    w.replays.push(deathReplay);
    expect(drainPerRealMinute(w)).toBe(3);
    w.waves.push(wave, { ...wave, id: 3, minion: 'MIN-03' });
    expect(drainPerRealMinute(w)).toBe(6);
    w.defacements.push({ productId: 1, kind: 'xss', by: 'ATK-16' }, { productId: 2, kind: 'deface', by: 'ATK-15' });
    expect(drainPerRealMinute(w)).toBeCloseTo(26); // defaced and XSS together count once
    w.nginx = 'stopped';
    expect(drainPerRealMinute(w)).toBeCloseTo(59);
  });

  it('recovers +2 per real minute while nothing drains, and never above 100', () => {
    const w = initialWorld(1, 'medium');
    w.heartbeat = 50;
    for (let i = 0; i < 600; i++) integrateHeartbeat(w, STEP_GAME_MS); // one real minute
    expect(w.heartbeat).toBeCloseTo(52);
    w.heartbeat = 99.5;
    for (let i = 0; i < 600; i++) integrateHeartbeat(w, STEP_GAME_MS);
    expect(w.heartbeat).toBe(100);
  });

  it('never goes below 0 or above 100 through a dip', () => {
    const w = initialWorld(1, 'medium');
    w.heartbeat = 3;
    dip(w, 10);
    expect(w.heartbeat).toBe(0);
    dip(w, -5);
    expect(w.heartbeat).toBe(0);
    w.heartbeat = 100;
    dip(w, 0);
    expect(w.heartbeat).toBe(100);
  });

  it('integrates fractionally: 30 real s with the plug pulled is −16.5', () => {
    const w = initialWorld(1, 'medium');
    w.nginx = 'stopped';
    integrateHeartbeat(w, 30 * 30_000);
    expect(w.heartbeat).toBeCloseTo(83.5);
  });

  it('uses the same rates and the same customer prices on every level; only the customers\' share differs (D-65)', () => {
    expect(CONFIG.easy.heartbeat).toEqual(CONFIG.medium.heartbeat);
    expect(CONFIG.hard.heartbeat).toEqual(CONFIG.medium.heartbeat);
    expect({ ...CONFIG.easy.customers, share: 0 }).toEqual({ ...CONFIG.medium.customers, share: 0 });
    expect({ ...CONFIG.hard.customers, share: 0 }).toEqual({ ...CONFIG.medium.customers, share: 0 });
    expect([CONFIG.easy.customers.share, CONFIG.medium.customers.share, CONFIG.hard.customers.share]).toEqual([0.2, 0.4, 0.8]);
  });
});

describe('the backlash (SYS-06, SYS-19, D-65)', () => {
  it('a failed customer request costs its class\'s price at once: a search less than a sign-up, a page bit least', () => {
    const w = initialWorld(1, 'medium');
    backlash(w, 'search');
    expect(w.heartbeat).toBeCloseTo(100 - cust.cost.search);
    backlash(w, 'signup');
    expect(w.heartbeat).toBeCloseTo(100 - cust.cost.search - cust.cost.signup);
    expect(cust.cost.page).toBeLessThan(cust.cost.search);
    expect(cust.cost.search).toBeLessThan(cust.cost.signup);
    expect(w.customers.failed).toBe(2);
    expect(w.customers.lastFailureAt).toBe(w.clock.gameMs);
  });

  it('nothing recovers for a real minute after a failure; then +2 per minute as before', () => {
    const w = initialWorld(1, 'medium');
    w.heartbeat = 50;
    backlash(w, 'search');
    expect(customersFailing(w)).toBe(true);
    const after = w.heartbeat;
    for (let i = 0; i < 599; i++) { w.clock.gameMs += STEP_GAME_MS; integrateHeartbeat(w, STEP_GAME_MS); }
    expect(w.heartbeat).toBe(after); // 59.9 s: still waiting
    minute(w);
    expect(customersFailing(w)).toBe(false);
    expect(w.heartbeat).toBeCloseTo(after + 2, 1); // the minute after: recovering
  });

  it('churn lowers the maximum for good, the heartbeat with it when it was at the top, and recovery stops there', () => {
    const w = initialWorld(1, 'medium');
    churn(w, 'search');
    expect(w.heartbeatMax).toBe(100 - cust.churn);
    expect(w.heartbeat).toBe(100 - cust.churn);
    expect(eventsOfKind(w, 'customer-lost')).toMatchObject([{ about: 'search', max: 100 - cust.churn }]);
    expect(w.customers.lost).toBe(1);
    w.heartbeat = 50;
    for (let i = 0; i < 200; i++) churn(w, 'signup'); // many lost: the ceiling comes down to 0 at worst, never below
    expect(w.heartbeatMax).toBe(0);
    expect(w.heartbeat).toBe(0);
    w.heartbeatMax = 90;
    w.heartbeat = 89.9;
    for (let i = 0; i < 5; i++) minute(w);
    expect(w.heartbeat).toBe(90); // capped at the maximum, not 100
    dip(w, -5);
    expect(w.heartbeat).toBe(90);
  });
});

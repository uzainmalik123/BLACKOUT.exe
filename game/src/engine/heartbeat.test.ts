import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { dip, drainPerRealMinute, integrateHeartbeat } from './heartbeat';
import { initialWorld, type Replay, type Wave, type World } from './state';

const weight = CONFIG.medium.heartbeat.featureWeight;
const STEP_GAME_MS = 3_000; // the engine's 100 real ms sub-step

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

describe('heartbeat (SYS-06), rates per real minute (D-33)', () => {
  it('with only the plug pulled, flatlines a little after 3 real minutes (100 / 33 per minute = 181.8 s)', () => {
    expect(secondsToFlatline((w) => { w.nginx = 'stopped'; })).toBeCloseTo(181.9, 1);
  });

  it('target times for each cause alone: defacement 5 min, one open door 33 min, one minion 67 min, search off 333 min', () => {
    expect(secondsToFlatline((w) => { w.defacements.push({ productId: 1, kind: 'deface', by: 'ATK-15' }); })).toBeCloseTo(300, 0);
    expect(secondsToFlatline((w) => { w.bannerDefacedBy = 'ATK-17'; })).toBeCloseTo(300, 0);
    expect(secondsToFlatline((w) => { w.defacements.push({ productId: 2, kind: 'xss', by: 'ATK-16' }); })).toBeCloseTo(300, 0);
    expect(secondsToFlatline((w) => { w.replays.push(deathReplay); })).toBeCloseTo(2000, 0);
    expect(secondsToFlatline((w) => { w.waves.push(wave); })).toBeCloseTo(4000, 0);
    expect(secondsToFlatline((w) => { w.features.search = false; })).toBeCloseTo(20_000, -1);
  });

  it('drains per real minute: 33 plug, 20 defaced or XSS, 3 per open door, 1.5 per minion, D-24 weights per disabled feature', () => {
    const w = initialWorld(1, 'medium');
    expect(drainPerRealMinute(w)).toBe(0);
    w.replays.push(deathReplay);
    expect(drainPerRealMinute(w)).toBe(3);
    w.waves.push(wave, { ...wave, id: 3, minion: 'MIN-03' });
    expect(drainPerRealMinute(w)).toBe(6);
    w.features.search = false;
    w.features['feedback-captcha'] = true;
    expect(drainPerRealMinute(w)).toBeCloseTo(6 + weight.search + weight['feedback-captcha']);
    w.defacements.push({ productId: 1, kind: 'xss', by: 'ATK-16' }, { productId: 2, kind: 'deface', by: 'ATK-15' });
    expect(drainPerRealMinute(w)).toBeCloseTo(26 + weight.search + weight['feedback-captcha']); // defaced and XSS together count once
    w.nginx = 'stopped';
    expect(drainPerRealMinute(w)).toBeCloseTo(59 + weight.search + weight['feedback-captcha']);
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

  it('uses the same rates on every level', () => {
    expect(CONFIG.easy.heartbeat).toEqual(CONFIG.medium.heartbeat);
    expect(CONFIG.hard.heartbeat).toEqual(CONFIG.medium.heartbeat);
  });
});

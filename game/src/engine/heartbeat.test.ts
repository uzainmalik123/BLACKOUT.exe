import { describe, expect, it } from 'vitest';
import { dip, drainPerGameMinute, integrateHeartbeat } from './heartbeat';
import { CONFIG } from './config';
import { initialWorld, type Replay, type Wave } from './state';

const weight = CONFIG.medium.heartbeat.featureWeight;

const deathReplay: Replay = { id: 1, owner: 'death', move: 'ATK-08', variant: 'a', ip: '203.0.113.81', recordedIp: '203.0.113.81', startedAt: 0, cursor: 0 };
const wave: Wave = { id: 2, minion: 'MIN-01', n: 1, ips: ['203.0.113.100'], startedAt: 0, endsAt: 1, successesDone: 0 };

describe('heartbeat (SYS-06)', () => {
  it('with only the plug pulled, flatlines at game minute 25', () => {
    const w = initialWorld(1, 'medium');
    w.nginx = 'stopped';
    for (let m = 0; m < 24; m++) integrateHeartbeat(w, 60_000);
    expect(w.heartbeat).toBe(4);
    integrateHeartbeat(w, 60_000);
    expect(w.heartbeat).toBe(0);
  });

  it('drains 1 per open door, 0.5 per minion, the feature weight per disabled feature, 3 while defaced', () => {
    const w = initialWorld(1, 'medium');
    expect(drainPerGameMinute(w)).toBe(0);
    w.replays.push(deathReplay);
    expect(drainPerGameMinute(w)).toBe(1);
    w.waves.push(wave, { ...wave, id: 3, minion: 'MIN-03' });
    expect(drainPerGameMinute(w)).toBe(2);
    w.features.search = false;
    w.features['feedback-captcha'] = true;
    expect(drainPerGameMinute(w)).toBeCloseTo(2 + weight.search + weight['feedback-captcha']);
    w.defacements.push({ productId: 1, kind: 'xss', by: 'ATK-16' });
    expect(drainPerGameMinute(w)).toBeCloseTo(5 + weight.search + weight['feedback-captcha']);
    w.defacements = [];
    w.bannerDefacedBy = 'ATK-17';
    expect(drainPerGameMinute(w)).toBeCloseTo(5 + weight.search + weight['feedback-captcha']);
  });

  it('recovers +1 per game minute while nothing drains and never above 100', () => {
    const w = initialWorld(1, 'medium');
    w.heartbeat = 98.5;
    integrateHeartbeat(w, 60_000);
    expect(w.heartbeat).toBe(99.5);
    integrateHeartbeat(w, 60_000);
    expect(w.heartbeat).toBe(100);
    integrateHeartbeat(w, 60_000);
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

  it('integrates fractionally: 30 s at −4/min is −2', () => {
    const w = initialWorld(1, 'medium');
    w.nginx = 'stopped';
    integrateHeartbeat(w, 30_000);
    expect(w.heartbeat).toBe(98);
  });
});

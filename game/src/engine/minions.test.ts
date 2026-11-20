import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { CONFIG } from './config';
import { gains } from './facts';
import { integrateHeartbeat } from './heartbeat';
import { eventsOfKind } from './log';
import { activeWaves, minionClosed, stepWaves } from './minions';
import { stepReplays } from './replay';
import { soulsStolen } from './souls';
import { initialWorld, type World } from './state';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';

const medium = CONFIG.medium;
const REAL_S = 30_000; // game ms
const lib = FIXTURE_LIBRARY;

/** Runs the minion side alone (no Director), in the engine's 100 real ms sub-steps. */
function runWaves(w: World, realMs: number): void {
  for (let i = 0; i < realMs / 100; i++) {
    w.clock.gameMs += medium.tickGameMs;
    stepReplays(w, lib);
    stepWaves(w, lib);
    integrateHeartbeat(w, medium.tickGameMs);
  }
}
const started = (w: World, minion: string) => eventsOfKind(w, 'wave-started').filter((e) => e.minion === minion);

describe('minion waves (PRD §4)', () => {
  it('waves start at the configured times and repeat with their period, each opening an alert and a replay', () => {
    const w = initialWorld(1, 'medium');
    runWaves(w, 29_000);
    expect(started(w, 'MIN-01')).toEqual([]);
    runWaves(w, 2_000);
    expect(started(w, 'MIN-01')).toMatchObject([{ wave: 1 }]);
    expect(started(w, 'MIN-01')[0]!.ips).toHaveLength(3);
    expect(w.alerts).toMatchObject([{ about: 'MIN-01' }]);
    expect(w.replays).toMatchObject([{ owner: 'MIN-01', move: 'MIN-01' }]);
    runWaves(w, 120_000);
    expect(started(w, 'MIN-01')).toHaveLength(2);
    expect(started(w, 'MIN-02')).toHaveLength(1);
    expect(started(w, 'MIN-03')).toHaveLength(1);
    expect(started(w, 'MIN-04')).toHaveLength(1);
    expect(w.nextWaveAt['MIN-01']).toBe(medium.minions.firstWaveGameMs['MIN-01'] + 2 * medium.minions.periodGameMs['MIN-01']);
  });

  it('a wave ends after its duration, closing its alert', () => {
    const w = initialWorld(1, 'medium');
    runWaves(w, 31_000);
    expect(activeWaves(w)).toHaveLength(1);
    runWaves(w, 60_000);
    expect(activeWaves(w).filter((x) => x.minion === 'MIN-01')).toHaveLength(0); // MIN-02/03 have started meanwhile
    expect(eventsOfKind(w, 'wave-ended')).toMatchObject([{ minion: 'MIN-01', wave: 1 }]);
    expect(eventsOfKind(w, 'wave-ended')[0]!.closedBy).toBeUndefined();
    expect(w.alerts[0]!.closedAt).toBeDefined();
  });

  it('MIN-02 steals one soul per success and hands Death a user-session; DEF-07 closes the wave', () => {
    const w = initialWorld(2, 'medium');
    runWaves(w, 61_000);
    expect(started(w, 'MIN-02')).toHaveLength(1);
    expect(soulsStolen(w)).toBe(0);
    runWaves(w, 30_000);
    expect(soulsStolen(w)).toBe(1);
    expect(eventsOfKind(w, 'souls-stolen')).toMatchObject([{ by: 'MIN-02', count: 1 }]);
    expect(w.sessions).toMatchObject([{ kind: 'user', issuedBy: 'MIN-02' }]);
    expect(gains(w).has('user-session')).toBe(true);
    applyAction(w, { type: 'DEF-07' });
    runWaves(w, 100);
    expect(eventsOfKind(w, 'wave-ended').filter((e) => e.minion === 'MIN-02')).toMatchObject([{ closedBy: 'DEF-07' }]);
    expect(minionClosed(w, 'MIN-02')).toBe(true);
  });

  it('MIN-01 is closed by the scanner user-agent rule or by blocking every IP of the wave', () => {
    const w = initialWorld(1, 'medium');
    runWaves(w, 31_000);
    for (const ip of activeWaves(w)[0]!.ips) applyAction(w, { type: 'DEF-06', ip, op: 'add' });
    runWaves(w, 100);
    expect(eventsOfKind(w, 'wave-ended')).toMatchObject([{ minion: 'MIN-01', closedBy: 'DEF-06' }]);
    const v = initialWorld(1, 'medium');
    applyAction(v, { type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'scanner' } });
    runWaves(v, 60_000);
    expect(started(v, 'MIN-01')).toEqual([]);
    expect(minionClosed(v, 'MIN-01')).toBe(true);
  });

  it('a closed minion type stays closed while the closer holds; the plug holds every wave', () => {
    const w = initialWorld(1, 'medium');
    applyAction(w, { type: 'DEF-07' });
    applyAction(w, { type: 'DEF-10', feature: 'feedback-captcha', enabled: true });
    applyAction(w, { type: 'DEF-12', rule: { kind: 'rate-limit', path: '/api/*' } });
    runWaves(w, 10 * 60_000);
    expect(eventsOfKind(w, 'wave-started').map((e) => e.minion)).toEqual(['MIN-01', 'MIN-01', 'MIN-01', 'MIN-01', 'MIN-01']);
    const p = initialWorld(1, 'medium');
    applyAction(p, { type: 'DEF-11' });
    runWaves(p, 3 * 60_000);
    expect(eventsOfKind(p, 'wave-started')).toEqual([]);
  });

  it('minions drain 0.5 heartbeat per game minute each while active', () => {
    const w = initialWorld(1, 'medium');
    runWaves(w, 31_000);
    const before = w.heartbeat;
    runWaves(w, 2_000); // 60 game s with one wave: −0.5
    expect(before - w.heartbeat).toBeCloseTo(0.5, 5);
    expect(REAL_S).toBe(30_000);
  });
});

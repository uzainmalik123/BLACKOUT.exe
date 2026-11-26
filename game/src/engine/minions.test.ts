import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { stepAlerts } from './alerts';
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
const lib = FIXTURE_LIBRARY;

/** Runs the minion side alone (no Director), in the engine's 100 real ms sub-steps. */
function runWaves(w: World, realMs: number): void {
  for (let i = 0; i < realMs / 100; i++) {
    w.clock.gameMs += medium.tickGameMs;
    stepReplays(w, lib);
    stepWaves(w, lib);
    stepAlerts(w); // D-232: a wave's alert opens when a detector sees its lines
    integrateHeartbeat(w, medium.tickGameMs);
  }
}
const started = (w: World, minion: string) => eventsOfKind(w, 'wave-started').filter((e) => e.minion === minion);

describe('minion waves (PRD §4)', () => {
  it('waves start at the configured times and repeat with their period, each opening an alert (by its probes, D-232) and a replay', () => {
    const w = initialWorld(1, 'medium');
    runWaves(w, 29_000);
    expect(started(w, 'MIN-01')).toEqual([]);
    runWaves(w, 2_000);
    expect(started(w, 'MIN-01')).toMatchObject([{ wave: 1 }]);
    expect(started(w, 'MIN-01')[0]!.ips).toHaveLength(3);
    expect(w.alerts).toMatchObject([{ about: 'MIN-01', route: '/', gate: 'front door' }]);
    expect(w.alerts[0]!.symptom).toMatch(/PHP, WordPress or config paths/);
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
    expect(eventsOfKind(w, 'wave-ended')[0]).toMatchObject({ minion: 'MIN-01', wave: 1 });
    expect(eventsOfKind(w, 'wave-ended')[0]!.closedBy).toBeUndefined();
    expect(w.alerts[0]!.closedAt).toBeDefined();
  });

  it('MIN-02 steals one soul per success and hands Death a user-session; DEF-07 closes the wave', () => {
    const w = initialWorld(2, 'medium');
    runWaves(w, 60_100);
    expect(started(w, 'MIN-02')).toHaveLength(1);
    expect(soulsStolen(w)).toBe(0);
    runWaves(w, 1000); // its recorded success, an exfil 0.5 s in (D-41)
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
    runWaves(w, 33_000);
    const seen = new Set(w.logs.access.filter((l) => l.by === 'MIN-01').map((l) => l.ip));
    expect(seen.size).toBe(3); // every address of the wave shows in the log, so the player can block them
    for (const ip of seen) applyAction(w, { type: 'DEF-06', ip, op: 'add' });
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

  it('minions drain 1.5 heartbeat per real minute each while active (D-33)', () => {
    const w = initialWorld(1, 'medium');
    runWaves(w, 31_000);
    expect(activeWaves(w)).toHaveLength(1);
    w.heartbeat = 50; // below the cap, so the drain shows
    runWaves(w, 10_000); // 10 real s with one wave: −1.5 × 10/60
    expect(50 - w.heartbeat).toBeCloseTo(medium.heartbeat.drainPerRealMin.minion / 6, 5);
  });
});

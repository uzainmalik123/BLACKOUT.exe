import { SEED_ACCOUNTS } from './seed';
import { describe, expect, it } from 'vitest';
import { initialWorld } from './state';

describe('initialWorld (SYS-04)', () => {
  it('starts with 100 heartbeat, no souls stolen and one Users row per soul', () => {
    const w = initialWorld(1, 'medium');
    expect(w.heartbeat).toBe(100);
    expect(w.souls).toEqual({ total: SEED_ACCOUNTS.length, stolen: [] });
    expect(w.accounts).toHaveLength(SEED_ACCOUNTS.length);
  });

  it('has the PRD defaults: every feature on except the feedback CAPTCHA, nginx running, nothing blocked', () => {
    const w = initialWorld(1, 'medium');
    expect(w.features).toEqual({
      search: true, registration: true, 'password-reset': true, uploads: true, ftp: true, 'feedback-captcha': false,
    });
    expect(w.nginx).toBe('running');
    expect(w.firewall.blocked).toEqual([]);
    expect(w.waf).toEqual([]);
    expect(w.sessions).toEqual([]);
    expect(w.signingKey.version).toBe(1);
    expect(w.backups).toHaveLength(1);
    expect(w.backups[0]).toMatchObject({ id: 0, takenAt: 0 });
    expect(w.ending).toBeUndefined();
  });

  it('is plain JSON: a round-trip is deep-equal', () => {
    const w = initialWorld(7, 'hard');
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it('is deterministic for a seed and differs between seeds only in seed and rng', () => {
    expect(initialWorld(3, 'easy')).toEqual(initialWorld(3, 'easy'));
    expect({ ...initialWorld(3, 'easy'), seed: 0, rng: 0 }).toEqual({ ...initialWorld(4, 'easy'), seed: 0, rng: 0 });
    expect(initialWorld(3, 'easy').rng).not.toBe(initialWorld(4, 'easy').rng);
  });

  it('schedules the first minion waves from the config', () => {
    const w = initialWorld(1, 'medium');
    expect(w.nextWaveAt).toEqual({ 'MIN-01': 900_000, 'MIN-02': 1_800_000, 'MIN-03': 2_700_000, 'MIN-04': 3_600_000 });
  });
});

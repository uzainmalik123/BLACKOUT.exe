import { LEAKED_PASSWORD_REUSERS, SEED_ACCOUNTS } from './seed';
import { describe, expect, it } from 'vitest';
import { eventsOfKind } from './log';
import { soulsLeft, soulsStolen, steal, stuffOneReuser } from './souls';
import { initialWorld } from './state';

describe('souls (SYS-05)', () => {
  it('the number shown equals the stolen rows replayed so far', () => {
    const w = initialWorld(1, 'medium');
    expect(steal(w, 'ATK-08', 'Users', [1, 2, 3])).toBe(3);
    expect(soulsStolen(w)).toBe(3);
    expect(soulsLeft(w)).toBe(SEED_ACCOUNTS.length - 3);
  });

  it('counts a row stolen twice once and ignores tables that are not souls', () => {
    const w = initialWorld(1, 'medium');
    expect(steal(w, 'ATK-08', 'Users', [1, 1])).toBe(1);
    expect(steal(w, 'ATK-09', 'Users', [1])).toBe(0);
    expect(steal(w, 'ATK-10', 'Baskets', [1, 2])).toBe(0);
    expect(soulsStolen(w)).toBe(1);
  });

  it('emits one souls-stolen event per steal that took something, with count, stolen and total', () => {
    const w = initialWorld(1, 'medium');
    steal(w, 'ATK-08', 'Users', [1, 2]);
    steal(w, 'ATK-08', 'Users', [2]);
    steal(w, 'MIN-02', 'Users', [7]);
    expect(eventsOfKind(w, 'souls-stolen')).toMatchObject([
      { by: 'ATK-08', count: 2, stolen: 2, total: SEED_ACCOUNTS.length },
      { by: 'MIN-02', count: 1, stolen: 3, total: SEED_ACCOUNTS.length },
    ]);
  });

  it("never counts an account Death created himself (ATK-06's or ATK-11's admin), even when a dump takes its row", () => {
    const w = initialWorld(1, 'medium');
    w.accounts.push({ id: 326, email: 'reaper@example.org', role: 'admin', createdBy: 'ATK-06' }, { id: 327, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' });
    expect(steal(w, 'ATK-08', 'Users', [325, 326, 327])).toBe(1);
    expect(steal(w, 'ATK-09', 'Users', [326])).toBe(0);
    expect(w.souls.stolen).toEqual([{ table: 'Users', key: 325 }]);
    expect(soulsLeft(w)).toBe(SEED_ACCOUNTS.length - 1);
  });

  it('MIN-02 only ever breaks into customers who reuse a leaked password (D-26), never an admin, each new one once', () => {
    const w = initialWorld(3, 'medium');
    const seen = new Set<number>();
    for (let i = 0; i < LEAKED_PASSWORD_REUSERS.length; i++) {
      const a = stuffOneReuser(w, 'MIN-02')!;
      expect(LEAKED_PASSWORD_REUSERS).toContain(a.id);
      expect(a.role).toBe('customer');
      expect(seen.has(a.id)).toBe(false);
      seen.add(a.id);
    }
    expect(soulsStolen(w)).toBe(LEAKED_PASSWORD_REUSERS.length);
    const again = stuffOneReuser(w, 'MIN-02')!; // every reuser taken: still a login (a session for Death), no new soul
    expect(LEAKED_PASSWORD_REUSERS).toContain(again.id);
    expect(soulsStolen(w)).toBe(LEAKED_PASSWORD_REUSERS.length);
  });

  it('MIN-02 cannot use a locked or force-reset account, and finds nothing once every reuser is closed', () => {
    const w = initialWorld(1, 'medium');
    for (const a of w.accounts) if (LEAKED_PASSWORD_REUSERS.includes(a.id)) a.lockedAt = 0;
    w.accounts.find((a) => a.id === LEAKED_PASSWORD_REUSERS[0])!.lockedAt = undefined;
    w.accounts.find((a) => a.id === LEAKED_PASSWORD_REUSERS[0])!.passwordResetAt = 5;
    expect(stuffOneReuser(w, 'MIN-02')).toBeUndefined();
    expect(soulsStolen(w)).toBe(0);
  });
});

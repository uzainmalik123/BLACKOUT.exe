import { describe, expect, it } from 'vitest';
import { eventsOfKind } from './log';
import { soulsLeft, soulsStolen, steal, stealOneUnstolenCustomer } from './souls';
import { initialWorld } from './state';

describe('souls (SYS-05)', () => {
  it('the number shown equals the stolen rows replayed so far', () => {
    const w = initialWorld(1, 'medium');
    expect(steal(w, 'ATK-08', 'Users', [1, 2, 3])).toBe(3);
    expect(soulsStolen(w)).toBe(3);
    expect(soulsLeft(w)).toBe(22);
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
      { by: 'ATK-08', count: 2, stolen: 2, total: 25 },
      { by: 'MIN-02', count: 1, stolen: 3, total: 25 },
    ]);
  });

  it('MIN-02 steals one customer not stolen before and returns undefined when none is left', () => {
    const w = initialWorld(3, 'medium');
    const seen = new Set<number>();
    for (let i = 0; i < 25; i++) {
      const a = stealOneUnstolenCustomer(w, 'MIN-02');
      expect(a).toBeDefined();
      expect(seen.has(a!.id)).toBe(false);
      seen.add(a!.id);
    }
    expect(soulsStolen(w)).toBe(25);
    expect(stealOneUnstolenCustomer(w, 'MIN-02')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { emit, eventsOfKind } from './log';
import { initialWorld } from './state';

describe('the event log (SYS-10)', () => {
  it('emit stamps the current game time and increasing ids', () => {
    const w = initialWorld(1, 'medium');
    w.clock.gameMs = 12_345;
    const a = emit(w, { kind: 'tip-off', by: 'DEF-04' });
    w.clock.gameMs = 20_000;
    const b = emit(w, { kind: 'banished' });
    expect(a).toEqual({ id: 1, t: 12_345, kind: 'tip-off', by: 'DEF-04' });
    expect(b).toMatchObject({ id: 2, t: 20_000, kind: 'banished' });
    expect(w.events).toEqual([a, b]);
  });

  it('eventsOfKind filters by kind with the narrowed type', () => {
    const w = initialWorld(1, 'medium');
    emit(w, { kind: 'souls-stolen', by: 'ATK-08', count: 3, stolen: 3, total: 25 });
    emit(w, { kind: 'banished' });
    emit(w, { kind: 'souls-stolen', by: 'MIN-02', count: 1, stolen: 4, total: 25 });
    const stolen = eventsOfKind(w, 'souls-stolen');
    expect(stolen.map((e) => e.count)).toEqual([3, 1]);
    expect(eventsOfKind(w, 'return')).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ReadTracker } from './tracker';
import { makeFixture } from './test-fixtures/fixture';

const LINE = 'cat access.log | grep x';

describe('ReadTracker', () => {
  it('sends one DEF-01, one DEF-02 and one DEF-03 per line, however often each is read', () => {
    const { engine, actions } = makeFixture({ baseline: false });
    const before = actions().length;
    const act = vi.spyOn(engine, 'act');
    const t = new ReadTracker(engine, LINE);

    for (let i = 0; i < 3; i++) {
      t.log();
      t.db(`select ${i}`);
      t.uploads(`/srv/juice-shop/uploads/f${i}`);
    }

    expect(act.mock.calls.map(([a]) => a)).toEqual([
      { type: 'DEF-01', query: LINE },
      { type: 'DEF-02', sql: 'select 0' },
      { type: 'DEF-03', path: '/srv/juice-shop/uploads/f0' },
    ]);
    expect(actions()).toHaveLength(before + 3);
    expect([...t.sent].sort()).toEqual(['db', 'log', 'uploads']);
    expect(t.notices).toEqual([]);
  }, 30_000);

  it('sends a kind only when it is read', () => {
    const { engine } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    const t = new ReadTracker(engine, LINE);
    t.log();
    expect(act).toHaveBeenCalledTimes(1);
    expect([...t.sent]).toEqual(['log']);
  }, 30_000);

  it('marks the kind as sent before calling act', () => {
    const { engine } = makeFixture({ baseline: false });
    const t = new ReadTracker(engine, LINE);
    let sentDuringAct: boolean | undefined;
    vi.spyOn(engine, 'act').mockImplementation(() => {
      sentDuringAct = t.sent.has('log');
      return { ok: true, message: '' };
    });
    t.log();
    expect(sentDuringAct).toBe(true);
  }, 30_000);

  it('marks the kind as sent even when act throws, so it is not retried', () => {
    const { engine } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act').mockImplementation(() => {
      throw new Error('boom');
    });
    const t = new ReadTracker(engine, LINE);
    expect(() => t.log()).toThrow('boom');
    expect(t.sent.has('log')).toBe(true);
    t.log();
    expect(act).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('records the bare message of an ok:false answer after an ending and does not retry', () => {
    const { engine } = makeFixture({ baseline: false });
    engine.world.ending = 'flatline';
    const act = vi.spyOn(engine, 'act');
    const t = new ReadTracker(engine, LINE);

    const first = t.log();
    expect(first).toBe('The incident is over: flatline');
    expect(t.notices).toEqual(['The incident is over: flatline']);
    expect(t.log()).toBeUndefined();
    expect(act).toHaveBeenCalledTimes(1);
    expect(t.notices).toHaveLength(1);
    expect(t.sent.has('log')).toBe(true);
  }, 30_000);

  it('collects one notice per refused kind, in order', () => {
    const { engine } = makeFixture({ baseline: false });
    engine.world.ending = 'flatline';
    const t = new ReadTracker(engine, LINE);
    t.log();
    t.db('select 1');
    t.uploads('/srv/juice-shop/uploads/a');
    t.db('select 2');
    expect(t.notices).toHaveLength(3);
  }, 30_000);

  it('starts a fresh line with a fresh tracker', () => {
    const { engine } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    new ReadTracker(engine, 'cat a').log();
    new ReadTracker(engine, 'cat b').log();
    expect(act).toHaveBeenCalledTimes(2);
  }, 30_000);
});

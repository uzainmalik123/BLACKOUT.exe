import { describe, expect, it, vi } from 'vitest';
import { SHOWN_LINES_MAX } from '../rules/vocabulary';
import { ReadTracker } from './tracker';
import { makeFixture } from './test-fixtures/fixture';

const LINE = 'cat access.log | grep x';

describe('ReadTracker', () => {
  it('queues reads without sending, then flush sends one of each kind in first-read order', () => {
    const { engine } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    const t = new ReadTracker(engine, LINE);

    for (let i = 0; i < 3; i++) {
      t.uploads(`/srv/juice-shop/uploads/f${i}`);
      t.db(`select ${i}`);
      t.log();
    }
    expect(act).not.toHaveBeenCalled();
    expect([...t.sent].sort()).toEqual(['db', 'log', 'uploads']);

    t.flush('a\nb\n');
    const shown = { shown: ['a', 'b'], shownTotal: 2 };
    expect(act.mock.calls.map(([a]) => a)).toEqual([
      { type: 'DEF-03', path: '/srv/juice-shop/uploads/f0', ...shown },
      { type: 'DEF-02', sql: 'select 0', ...shown },
      { type: 'DEF-01', query: LINE, ...shown },
    ]);
    expect(t.notices).toEqual([]);
  }, 30_000);

  it('sends nothing when nothing was queued', () => {
    const { engine } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    new ReadTracker(engine, LINE).flush('x\n');
    expect(act).not.toHaveBeenCalled();
  }, 30_000);

  it('cuts shown to SHOWN_LINES_MAX and keeps the full count in shownTotal', () => {
    const { engine } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    const t = new ReadTracker(engine, LINE);
    t.log();
    const lines = Array.from({ length: 10_000 }, (_, i) => `line ${i}`);
    t.flush(lines.join('\n') + '\n');
    const sent = act.mock.calls[0]![0] as { shown: string[]; shownTotal: number };
    expect(SHOWN_LINES_MAX).toBe(200);
    expect(sent.shown).toEqual(lines.slice(0, 200));
    expect(sent.shownTotal).toBe(10_000);
  }, 30_000);

  it('sends shown [] and shownTotal 0 for empty final stdout', () => {
    const { engine } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    const t = new ReadTracker(engine, LINE);
    t.log();
    t.flush('');
    expect(act.mock.calls[0]![0]).toMatchObject({ shown: [], shownTotal: 0 });
  }, 30_000);

  it('records the first queueing command as cmd on a refusal', () => {
    const { engine } = makeFixture({ baseline: false });
    engine.world.ending = 'flatline';
    const t = new ReadTracker(engine, LINE);
    t.stage = 'cat';
    t.log();
    t.stage = 'grep';
    t.log();
    t.flush('x\n');
    expect(t.notices).toEqual([{ cmd: 'cat', message: 'The incident is over: flatline' }]);
  }, 30_000);

  it('stops sending after the first refusal', () => {
    const { engine } = makeFixture({ baseline: false });
    engine.world.ending = 'flatline';
    const act = vi.spyOn(engine, 'act');
    const t = new ReadTracker(engine, LINE);
    t.log();
    t.db('select 1');
    t.uploads('/srv/juice-shop/uploads/a');
    t.flush('x\n');
    expect(act).toHaveBeenCalledTimes(1);
    expect(t.notices).toHaveLength(1);
  }, 30_000);

  it('does not requeue a kind after flush, and a fresh tracker starts empty', () => {
    const { engine } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    const t = new ReadTracker(engine, LINE);
    t.log();
    t.flush('');
    t.log();
    t.flush('');
    expect(act).toHaveBeenCalledTimes(1);
    const u = new ReadTracker(engine, 'cat b');
    u.log();
    u.flush('');
    expect(act).toHaveBeenCalledTimes(2);
  }, 30_000);
});

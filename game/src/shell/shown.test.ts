// Task 24.2 (R14.8, D-160): exec flushes the queued reads once per line, with what reached the screen.
import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from './test-fixtures/fixture';

const LOG = '/var/log/nginx/access.log';
const DEATH = '203.0.113.9';
const line = (ip: string, i: number): string => `${ip} - - [01/Jan/2026:00:00:00 +0000] "GET /r${i} HTTP/1.1" 200 5 "-" "ua"`;

/** A fixture whose access log is `lines` (the fixture's own log is not under test here). */
function setup(lines: string[]) {
  const f = makeFixture({ baseline: false });
  vi.spyOn(f.engine, 'accessLog').mockReturnValue(lines.join('\n') + '\n');
  const act = vi.spyOn(f.engine, 'act');
  return { f, act };
}

const mixed = [line('198.51.100.1', 0), line(DEATH, 1), line('198.51.100.2', 2), line(DEATH, 3), line('198.51.100.1', 4)];
const deathLines = [mixed[1]!, mixed[3]!];

describe('read actions carry shown and shownTotal (task 24.2)', () => {
  it('a grep that prints Death’s lines sends exactly those lines', async () => {
    const { f, act } = setup(mixed);
    await f.shell.run(`grep ${DEATH} ${LOG}`);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act.mock.calls[0]![0]).toEqual({ type: 'DEF-01', query: `grep ${DEATH} ${LOG}`, shown: deathLines, shownTotal: 2 });
  }, 30_000);

  it('cat | grep sends one DEF-01 with only grep’s lines', async () => {
    const { f, act } = setup(mixed);
    await f.shell.run(`cat ${LOG} | grep ${DEATH}`);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act.mock.calls[0]![0]).toMatchObject({ type: 'DEF-01', shown: deathLines, shownTotal: 2 });
  }, 30_000);

  it('a 10,000-line cat sends 200 lines and shownTotal 10000', async () => {
    const all = Array.from({ length: 10_000 }, (_, i) => line('198.51.100.1', i));
    const { f, act } = setup(all);
    await f.shell.run(`cat ${LOG}`);
    expect(act).toHaveBeenCalledTimes(1);
    const a = act.mock.calls[0]![0] as { shown: string[]; shownTotal: number };
    expect(a.shown).toEqual(all.slice(0, 200));
    expect(a.shownTotal).toBe(10_000);
  }, 30_000);

  it('a > redirect sends shown: [] and shownTotal: 0', async () => {
    const { f, act } = setup(mixed);
    await f.shell.run(`grep ${DEATH} ${LOG} > /tmp/o`);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act.mock.calls[0]![0]).toMatchObject({ type: 'DEF-01', shown: [], shownTotal: 0 });
  }, 30_000);

  it('a failing line still sends, with the stdout it printed', async () => {
    const { f, act } = setup(mixed);
    const r = await f.shell.run(`cat ${LOG} /tmp/missing-file`);
    expect(r.exitCode).not.toBe(0);
    expect(act).toHaveBeenCalledTimes(1);
    expect(act.mock.calls[0]![0]).toMatchObject({ type: 'DEF-01', shown: mixed, shownTotal: 5 });
  }, 30_000);

  it('a line that reads nothing sends nothing', async () => {
    const { f, act } = setup(mixed);
    await f.shell.run('pwd');
    await f.shell.run('ls /var/log');
    await f.shell.run('nosuchcmd');
    expect(act).not.toHaveBeenCalled();
  }, 30_000);

  it('a refusal after an ending prints <cmd>: <message> once', async () => {
    const { f, act } = setup(mixed);
    f.engine.world.ending = 'flatline';
    const r = await f.shell.run(`cat ${LOG} | grep ${DEATH}`);
    expect(act).toHaveBeenCalledTimes(1);
    const hits = r.output.split('\n').filter((l) => l.startsWith('cat: '));
    expect(hits).toEqual(['cat: The incident is over: flatline']);
  }, 30_000);
});

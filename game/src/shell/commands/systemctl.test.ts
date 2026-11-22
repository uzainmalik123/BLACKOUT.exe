import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const USAGE = 'systemctl: usage: systemctl <status|stop|start|restart> <unit>';
const STOP = { type: 'DEF-11' };
const START = { type: 'DEF-18', what: 'nginx' };

type NginxState = 'running' | 'stopped';

async function setup(state: NginxState) {
  const f = makeFixture({ baseline: false });
  if (state === 'stopped') expect((await f.shell.run('systemctl stop nginx')).exitCode).toBe(0);
  expect(f.world.nginx).toBe(state);
  const spy = vi.spyOn(f.engine, 'act');
  return { ...f, spy };
}

// verb x unit x nginx state: [verb, unit, state, actions, output, exitCode, nginx after]
type Row = [string, string, NginxState, object[], string, number, NginxState];
const TABLE: Row[] = [
  ['stop', 'nginx', 'running', [STOP], '', 0, 'stopped'],
  ['stop', 'nginx', 'stopped', [STOP], 'nginx is already stopped', 1, 'stopped'],
  ['start', 'nginx', 'running', [START], 'nginx is already running', 1, 'running'],
  ['start', 'nginx', 'stopped', [START], '', 0, 'running'],
  ['restart', 'nginx', 'running', [STOP, START], '', 0, 'running'],
  ['restart', 'nginx', 'stopped', [STOP, START], 'nginx is already stopped', 1, 'running'],
  ['status', 'nginx', 'running', [], 'active (running)', 0, 'running'],
  ['status', 'nginx', 'stopped', [], 'inactive (dead)', 0, 'stopped'],
  ...(['stop', 'start', 'restart', 'status'] as const).flatMap((verb): Row[] =>
    (['running', 'stopped'] as const).map((s): Row => [
      verb,
      'sshd',
      s,
      [],
      'Unit sshd.service could not be found.',
      1,
      s,
    ]),
  ),
];

describe('systemctl verb by unit by nginx state (R10.1 to R10.8, R10.11, R16.2)', () => {
  it.each(TABLE)('%s %s while nginx is %s', async (verb, unit, state, actions, output, code, after) => {
    const { shell, world, spy } = await setup(state);
    const r = await shell.run(`systemctl ${verb} ${unit}`);
    expect(r).toEqual({ output, exitCode: code });
    expect(spy.mock.calls.map((c) => c[0])).toEqual(actions);
    expect(world.nginx).toBe(after);
  }, 30_000);
});

describe('systemctl actions and World (R10.1 to R10.6, R16.2)', () => {
  it('stop calls act once with DEF-11 and stops nginx', async () => {
    const { shell, world, spy } = await setup('running');
    await shell.run('systemctl stop nginx');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ type: 'DEF-11' });
    expect(world.nginx).toBe('stopped');
  }, 30_000);

  it('start calls act once with DEF-18 nginx and starts nginx', async () => {
    const { shell, world, spy } = await setup('stopped');
    await shell.run('systemctl start nginx');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ type: 'DEF-18', what: 'nginx' });
    expect(world.nginx).toBe('running');
  }, 30_000);

  it('restart calls DEF-11 then DEF-18 in that order and nothing else', async () => {
    const { shell, world, spy } = await setup('running');
    await shell.run('systemctl restart nginx');
    expect(spy.mock.calls.map((c) => c[0])).toEqual([STOP, START]);
    expect(world.nginx).toBe('running');
  }, 30_000);

  it('restart on a stopped service attempts both and prints the stop message', async () => {
    const { shell, world, spy } = await setup('stopped');
    const r = await shell.run('systemctl restart nginx');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]?.[0]).toEqual(STOP);
    expect(spy.mock.calls[1]?.[0]).toEqual(START);
    expect(r).toEqual({ output: 'nginx is already stopped', exitCode: 1 });
    expect(world.nginx).toBe('running');
  }, 30_000);

  it('restart prints every ok:false message in order when both refuse, leaving the World alone', async () => {
    const { shell, world, spy } = await setup('running');
    spy.mockReturnValue({ ok: false, message: 'The run has ended' });
    const r = await shell.run('systemctl restart nginx');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ output: 'The run has ended\nThe run has ended', exitCode: 1 });
    expect(world.nginx).toBe('running');
  }, 30_000);

  it('status calls no action and does not change the World', async () => {
    const { shell, world, spy } = await setup('running');
    const before = structuredClone(world.nginx);
    await shell.run('systemctl status nginx');
    expect(spy).not.toHaveBeenCalled();
    expect(world.nginx).toBe(before);
  }, 30_000);
});

describe('systemctl usage errors (R10.9, R10.10)', () => {
  const bad: [string, string][] = [
    ['no verb', 'systemctl'],
    ['an unknown verb', 'systemctl reload nginx'],
    ['a unit in place of the verb', 'systemctl nginx'],
    ['stop with no unit', 'systemctl stop'],
    ['start with no unit', 'systemctl start'],
    ['restart with no unit', 'systemctl restart'],
    ['status with no unit', 'systemctl status'],
    ['an extra operand', 'systemctl stop nginx now'],
  ];
  it.each(bad)('rejects %s with the usage line and no action', async (_name, line) => {
    const { shell, world, spy } = await setup('running');
    const r = await shell.run(line);
    expect(r).toEqual({ output: USAGE, exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
    expect(world.nginx).toBe('running');
  }, 30_000);
});

describe('systemctl units (R10.11)', () => {
  it('names another unit as not found and calls no action', async () => {
    const { shell, spy } = await setup('running');
    const r = await shell.run('systemctl stop apache2');
    expect(r).toEqual({ output: 'Unit apache2.service could not be found.', exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);

  it('treats nginx.service as another unit (only the bare name exists)', async () => {
    const { shell, spy } = await setup('running');
    const r = await shell.run('systemctl stop nginx.service');
    expect(r).toEqual({ output: 'Unit nginx.service.service could not be found.', exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);
});

describe('systemctl unsupported flag (R16.1)', () => {
  it('rejects an unsupported flag naming it, with the usage line and no action', async () => {
    const { shell, world, spy } = await setup('running');
    const r = await shell.run('systemctl --now stop nginx');
    expect(r).toEqual({ output: `systemctl: unsupported flag '--now'\n${USAGE}`, exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
    expect(world.nginx).toBe('running');
  }, 30_000);

  it('rejects a short flag after the verb', async () => {
    const { shell, spy } = await setup('running');
    const r = await shell.run('systemctl status -l nginx');
    expect(r).toEqual({ output: `systemctl: unsupported flag '-l'\n${USAGE}`, exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);
});

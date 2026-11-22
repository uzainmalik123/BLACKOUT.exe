// Output redirection `> file` through shell.run (R3.2, R3.3, R3.4, R4.10, R4.11, R4.14, R4.18, R14.1).
// Every test builds an Engine, so each has an explicit 30_000 ms timeout (KI-81).
import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const T = 30_000;
const UP = '/srv/juice-shop/uploads';
const ACCESS = '/var/log/nginx/access.log';

describe('a successful redirect', () => {
  it('writes the output, prints nothing and exits 0', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('ls /srv/juice-shop > /tmp/out');
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect((await shell.run('cat /tmp/out')).output).toBe('data\nuploads');
  }, T);

  it('creates the file, and a second redirect overwrites it', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect((await shell.run('ls /tmp')).output).toBe('');
    await shell.run('ls /srv/juice-shop > /tmp/out');
    expect((await shell.run('ls /tmp')).output).toBe('out');
    await shell.run('ls /var > /tmp/out');
    expect((await shell.run('cat /tmp/out')).output).toBe('log');
    expect((await shell.run('ls /tmp')).output).toBe('out');
  }, T);

  it('an empty output creates an empty file', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect((await shell.run('ls /tmp > /tmp/empty')).exitCode).toBe(0);
    expect((await shell.run('ls /tmp')).output).toBe('empty');
    expect((await shell.run('cat /tmp/empty')).output).toBe('');
  }, T);

  it('a ~ target resolves to the home directory, which is outside the Writable_Area', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('ls / > ~/out');
    expect(r).toEqual({ output: '~/out: Permission denied', exitCode: 1 });
  }, T);

  it('a bare ~ target is refused as a directory or as unwritable, never written', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('ls / > ~');
    expect(r.exitCode).toBe(1);
    expect(r.output).toBe('~: Permission denied');
  }, T);

  it('a relative target resolves against the cwd', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('cd /tmp');
    expect((await shell.run('ls /srv > rel')).output).toBe('');
    expect((await shell.run('ls /tmp')).output).toBe('rel');
    expect((await shell.run('cat /tmp/rel')).output).toBe('juice-shop');
    await shell.run('ls /var > ../evidence/up');
    expect((await shell.run('ls /evidence')).output).toBe('up');
  }, T);

  it('a pipeline then redirect writes the last stage output', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('ls /srv/juice-shop | grep up > /tmp/p');
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect((await shell.run('cat /tmp/p')).output).toBe('uploads');
  }, T);

  it('a redirected file can be read through a pipe', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('ls /srv/juice-shop > /tmp/l');
    expect((await shell.run('cat /tmp/l | wc -l')).output).toMatch(/^\s*2$/);
  }, T);

  it('the exit code is the last stage code (grep with no match writes nothing and exits 1)', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('ls /srv/juice-shop | grep zzz > /tmp/none');
    expect(r).toEqual({ output: '', exitCode: 1 });
    expect((await shell.run('ls /tmp')).output).toBe('');
  }, T);
});

describe('a refused target writes nothing and runs no stage (R3.3, R4.10, R4.14)', () => {
  const refusals: [string, string, string][] = [
    ['outside the Writable_Area', '/etc/x', 'Permission denied'],
    ['the home directory', '/srv/juice-shop/x', 'Permission denied'],
    ['uploads', `${UP}/x`, 'Permission denied'],
    ['an access log', ACCESS, 'Permission denied'],
    ['the database file', '/srv/juice-shop/data/juiceshop.sqlite', 'Permission denied'],
    ['an Engine evidence file', '/evidence/snap.tgz', 'Operation not permitted'],
    ['a directory', '/tmp', 'Is a directory'],
    ['a directory in evidence', '/evidence', 'Is a directory'],
    ['a missing parent', '/tmp/nodir/x', 'No such file or directory'],
  ];

  it.each(refusals)('%s', async (_name, target, message) => {
    const { shell, engine, world } = makeFixture({ baseline: false, advanceMs: 5_000, evidence: ['snap'], plant: [{ path: 'rip.php', content: 'x' }] });
    const act = vi.spyOn(engine, 'act');
    const accessSpy = vi.spyOn(engine, 'accessLog');
    const before = structuredClone(world);
    const r = await shell.run(`cat ${ACCESS} > ${target}`);
    expect(r).toEqual({ output: `${target}: ${message}`, exitCode: 1 });
    // No stage ran: no read of the log and no DEF-01.
    expect(accessSpy).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
    expect(world).toEqual(before);
    expect((await shell.run('ls /tmp')).output).toBe('');
    expect((await shell.run('ls /evidence')).output).toBe('snap.tgz');
    expect((await shell.run(`ls ${UP}`)).output).toBe('rip.php');
  }, T);

  it('an action stage does not run when the target is refused', async () => {
    const { shell, engine, world } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    const r = await shell.run('iptables -A INPUT -s 1.2.3.4 -j DROP > /etc/x');
    expect(r).toEqual({ output: '/etc/x: Permission denied', exitCode: 1 });
    expect(act).not.toHaveBeenCalled();
    expect(world.firewall.blocked).toEqual([]);
  }, T);

  it('a target whose parent is a file is Not a directory', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('ls / > /tmp/f');
    expect(await shell.run('ls / > /tmp/f/x')).toEqual({ output: '/tmp/f/x: Not a directory', exitCode: 1 });
  }, T);

  it('an unknown command still wins over the redirect check (127, nothing runs)', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('nope > /etc/x')).toEqual({ output: 'nope: command not found', exitCode: 127 });
  }, T);
});

describe('a failing stage writes nothing (R3.3)', () => {
  it('shows stderr, exits nonzero and creates no file', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('cat /nope > /tmp/out');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('/nope');
    expect((await shell.run('ls /tmp')).output).toBe('');
  }, T);

  it('keeps an existing file when a later run fails', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('ls /srv > /tmp/out');
    const r = await shell.run('cat /nope > /tmp/out');
    expect(r.exitCode).toBe(1);
    expect((await shell.run('cat /tmp/out')).output).toBe('juice-shop');
  }, T);

  it('an earlier failing stage in a pipeline also writes nothing', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('cat /nope | wc -l > /tmp/out');
    expect(r.output).toContain('/nope');
    expect((await shell.run('ls /tmp')).output).toBe('');
  }, T);
});

describe('reads inside a redirected line (R14.1, R3.4)', () => {
  it('redirecting a log read sends DEF-01 once and stores the text', async () => {
    const { shell, engine, actsOfType } = makeFixture({ baseline: false, advanceMs: 60_000 });
    const text = engine.accessLog();
    expect(text.length).toBeGreaterThan(0);
    const r = await shell.run(`cat ${ACCESS} > /tmp/a`);
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(actsOfType('DEF-01')).toHaveLength(1);
    expect((await shell.run('cat /tmp/a')).output).toBe(text.replace(/\n$/, ''));
    // Reading the copy is not a log read.
    expect(actsOfType('DEF-01')).toHaveLength(1);
  }, T);

  it('a pipeline of two log readers redirected still sends one DEF-01', async () => {
    const { shell, actsOfType } = makeFixture({ baseline: false, advanceMs: 60_000 });
    await shell.run(`cat ${ACCESS} | grep GET > /tmp/g`);
    expect(actsOfType('DEF-01')).toHaveLength(1);
  }, T);

  it('an action stage before the redirect still runs and the output is written', async () => {
    const { shell, world } = makeFixture({ baseline: false });
    const r = await shell.run('iptables -A INPUT -s 1.2.3.4 -j DROP > /tmp/o');
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(world.firewall.blocked).toEqual(['1.2.3.4']);
    expect((await shell.run('ls /tmp')).output).toBe('o');
  }, T);
});

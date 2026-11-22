import { describe, expect, it, vi } from 'vitest';
import type { PlayerAction } from '../../rules/vocabulary';
import { runPipeline } from '../exec';
import { parseLine } from '../parser';
import { createSession } from '../session';
import { makeFixture } from '../test-fixtures/fixture';
import { VirtualFs } from '../vfs';

const UP = '/srv/juice-shop/uploads';
const T = 30_000;
type Spy = { mock: { calls: [PlayerAction][] } };

/** The DEF-15 paths sent through a spy on `engine.act`, in order. */
function def15(spy: Spy): string[] {
  return spy.mock.calls.flatMap(([a]) => (a.type === 'DEF-15' ? [a.path] : []));
}
function acts(spy: Spy): string[] {
  return spy.mock.calls.map(([a]) => a.type);
}

describe('rm of an Uploaded_File (R11.1, R11.7, R16.2)', () => {
  it('sends one DEF-15 with the path relative to uploads/ and the next ls omits the file', async () => {
    const { shell, engine } = makeFixture({
      baseline: false,
      plant: [{ path: 'rip.php', content: '<?php' }, { path: 'keep.txt', content: 'k' }],
    });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run(`rm ${UP}/rip.php`);
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(acts(spy)).toEqual(['DEF-15']);
    expect(def15(spy)).toEqual(['rip.php']);
    expect((await shell.run(`ls ${UP}`)).output).toBe('keep.txt');
  }, T);

  it('a nested file sends the nested relative path', async () => {
    const { shell, engine } = makeFixture({ baseline: false, plant: [{ path: 'complaints/rip.php', content: 'x' }] });
    const spy = vi.spyOn(engine, 'act');
    expect((await shell.run(`rm ${UP}/complaints/rip.php`)).exitCode).toBe(0);
    expect(def15(spy)).toEqual(['complaints/rip.php']);
    // The directory disappears with its last file (R11.10).
    expect((await shell.run(`ls ${UP}`)).output).toBe('');
  }, T);

  it('a file without recorded bytes can be removed', async () => {
    const { shell, engine } = makeFixture({ baseline: false, plant: [{ path: 'blob.bin', size: 99 }] });
    const spy = vi.spyOn(engine, 'act');
    expect((await shell.run(`rm ${UP}/blob.bin`)).exitCode).toBe(0);
    expect(def15(spy)).toEqual(['blob.bin']);
    expect((await shell.run(`ls ${UP}`)).output).toBe('');
  }, T);

  it('relative paths resolve against the cwd and the typed path appears in messages', async () => {
    const { shell, engine } = makeFixture({ baseline: false, plant: [{ path: 'complaints/a.php', content: 'x' }] });
    const spy = vi.spyOn(engine, 'act');
    await shell.run(`cd ${UP}/complaints`);
    expect((await shell.run('rm a.php')).exitCode).toBe(0);
    expect(def15(spy)).toEqual(['complaints/a.php']);
    const r = await shell.run('rm ../nope.txt');
    expect(r).toEqual({ output: "rm: cannot remove '../nope.txt': No such file or directory", exitCode: 1 });
  }, T);

  it('an ok:false answer prints the message and the file stays listed', async () => {
    const { shell, engine } = makeFixture({ baseline: false, plant: [{ path: 'rip.php', content: 'x' }] });
    const mock = vi.spyOn(engine, 'act').mockReturnValue({ ok: false, message: 'The run has ended' });
    const r = await shell.run(`rm ${UP}/rip.php`);
    expect(r).toEqual({ output: 'The run has ended', exitCode: 1 });
    mock.mockRestore();
    expect((await shell.run(`ls ${UP}`)).output).toBe('rip.php');
  }, T);
});

describe('rm -r, several operands and globs (R11.10, R11.11)', () => {
  it('rm -r of the uploads directory sends one DEF-15 per file in ascending order', async () => {
    const { shell, engine } = makeFixture({
      baseline: false,
      plant: [
        { path: 'b.txt', content: '1' },
        { path: 'a/z.php', content: '2' },
        { path: 'a/y.php', content: '3' },
      ],
    });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run(`rm -r ${UP}`);
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(def15(spy)).toEqual(['a/y.php', 'a/z.php', 'b.txt']);
    expect((await shell.run(`ls ${UP}`)).output).toBe('');
  }, T);

  it('rm -r continues after a refusal', async () => {
    const { shell, engine } = makeFixture({
      baseline: false,
      plant: [{ path: 'd/a', content: '1' }, { path: 'd/b', content: '2' }, { path: 'd/c', content: '3' }],
    });
    const real = engine.act.bind(engine);
    const spy = vi.spyOn(engine, 'act').mockImplementation((a) =>
      a.type === 'DEF-15' && a.path === 'd/b' ? { ok: false, message: 'refused b' } : real(a),
    );
    const r = await shell.run(`rm -r ${UP}/d`);
    expect(r).toEqual({ output: 'refused b', exitCode: 1 });
    expect(def15(spy)).toEqual(['d/a', 'd/b', 'd/c']);
    expect((await shell.run(`ls ${UP}/d`)).output).toBe('b');
  }, T);

  it('several operands and a glob run left to right and exit 1 if any failed', async () => {
    const { shell, engine } = makeFixture({
      baseline: false,
      plant: [{ path: 'x.php', content: '1' }, { path: 'y.php', content: '2' }, { path: 'z.txt', content: '3' }],
    });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run(`rm ${UP}/z.txt ${UP}/missing ${UP}/*.php`);
    expect(def15(spy)).toEqual(['z.txt', 'x.php', 'y.php']);
    expect(r).toEqual({ output: `rm: cannot remove '${UP}/missing': No such file or directory`, exitCode: 1 });
    expect((await shell.run(`ls ${UP}`)).output).toBe('');
  }, T);

  it('an expanded glob alone exits 0', async () => {
    const { shell, engine } = makeFixture({
      baseline: false,
      plant: [{ path: 'x.php', content: '1' }, { path: 'y.php', content: '2' }],
    });
    const spy = vi.spyOn(engine, 'act');
    expect(await shell.run(`rm ${UP}/*.php`)).toEqual({ output: '', exitCode: 0 });
    expect(def15(spy)).toEqual(['x.php', 'y.php']);
  }, T);
});

describe('rm refusals (R11.3, R11.4, R11.6, R11.9, R11.12, R11.13)', () => {
  it('a directory without -r prints Is a directory and sends nothing', async () => {
    const { shell, engine } = makeFixture({ baseline: false, plant: [{ path: 'd/a', content: '1' }] });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run(`rm ${UP}/d`);
    expect(r).toEqual({ output: `rm: cannot remove '${UP}/d': Is a directory`, exitCode: 1 });
    expect(acts(spy)).toEqual([]);
    expect((await shell.run(`ls ${UP}/d`)).output).toBe('a');
  }, T);

  it('a missing path prints No such file or directory', async () => {
    const { shell, engine } = makeFixture({ baseline: false });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run('rm nothing-here');
    expect(r).toEqual({ output: "rm: cannot remove 'nothing-here': No such file or directory", exitCode: 1 });
    expect(acts(spy)).toEqual([]);
  }, T);

  it('a log, the database file, / and /var print Permission denied with no action', async () => {
    const { shell, engine } = makeFixture({ baseline: false });
    const spy = vi.spyOn(engine, 'act');
    const log = '/var/log/nginx/access.log';
    const db = '/srv/juice-shop/data/juiceshop.sqlite';
    for (const [line, typed] of [
      [`rm ${log}`, log],
      [`rm ${db}`, db],
      ['rm -r /', '/'],
      ['rm -r /var', '/var'],
    ] as const) {
      const r = await shell.run(line);
      expect(r).toEqual({ output: `rm: cannot remove '${typed}': Permission denied`, exitCode: 1 });
    }
    expect(acts(spy)).toEqual([]);
  }, T);

  it('an Engine evidence file prints Operation not permitted with no action', async () => {
    const { shell, engine } = makeFixture({ baseline: false, advanceMs: 5_000, evidence: ['snap1'] });
    expect((await shell.run('ls /evidence')).output).toContain('snap1.tgz');
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run('rm /evidence/snap1.tgz');
    expect(r).toEqual({ output: "rm: cannot remove '/evidence/snap1.tgz': Operation not permitted", exitCode: 1 });
    expect(acts(spy)).toEqual([]);
    expect((await shell.run('ls /evidence')).output).toContain('snap1.tgz');
  }, T);

  it('no operand prints missing operand', async () => {
    const { shell, engine } = makeFixture({ baseline: false });
    const spy = vi.spyOn(engine, 'act');
    expect(await shell.run('rm')).toEqual({ output: 'rm: missing operand', exitCode: 1 });
    expect(acts(spy)).toEqual([]);
  }, T);

  it.each(['-f', '-R'])('%s is an unsupported flag (R16.1)', async (flag) => {
    const { shell, engine } = makeFixture({ baseline: false, plant: [{ path: 'a', content: '1' }] });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run(`rm ${flag} ${UP}/a`);
    expect(r.output).toBe(`rm: unsupported flag '${flag}'\nrm: usage: rm [-r] <path>...`);
    expect(r.exitCode).toBe(1);
    expect(acts(spy)).toEqual([]);
    expect((await shell.run(`ls ${UP}`)).output).toBe('a');
  }, T);
});

describe('rm in the Writable_Area (R11.2, R11.8, R11.10, R4.19)', () => {
  /** A shell-less rig so tests can pre-build /tmp and /evidence directories (mkdir is not implemented yet). */
  function rig(opts: Parameters<typeof makeFixture>[0] = { baseline: false }) {
    const fx = makeFixture(opts);
    const session = createSession(fx.engine);
    const vfs = new VirtualFs(fx.engine, session.overlay);
    const run = async (line: string) => {
      const parsed = parseLine(line);
      if (!parsed.ok) throw new Error(parsed.error);
      return runPipeline({ engine: fx.engine, vfs, session }, parsed.pipeline, line);
    };
    return { ...fx, vfs, run };
  }
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

  it('removes a /tmp file and an /evidence file with no Engine action', async () => {
    const { shell, engine } = makeFixture({ baseline: false });
    await shell.run('ls / > /tmp/a');
    await shell.run('ls / > /evidence/b');
    const spy = vi.spyOn(engine, 'act');
    expect(await shell.run('rm /tmp/a /evidence/b')).toEqual({ output: '', exitCode: 0 });
    expect(acts(spy)).toEqual([]);
    expect((await shell.run('ls /tmp')).output).toBe('');
    expect((await shell.run('ls /evidence')).output).toBe('');
  }, T);

  it('rm -r removes a directory tree; without -r it prints Is a directory', async () => {
    const { vfs, run, engine } = rig();
    vfs.mkdir('/tmp/d/e', { parents: true });
    vfs.writeFile('/tmp/d/e/f', enc('x'));
    vfs.mkdir('/evidence/ed');
    const spy = vi.spyOn(engine, 'act');
    expect(await run('rm /tmp/d')).toEqual({ output: "rm: cannot remove '/tmp/d': Is a directory", exitCode: 1 });
    expect(vfs.stat('/tmp/d/e/f')).toBeDefined();
    expect(await run('rm /evidence/ed')).toEqual({ output: "rm: cannot remove '/evidence/ed': Is a directory", exitCode: 1 });
    expect(await run('rm -r /tmp/d /evidence/ed')).toEqual({ output: '', exitCode: 0 });
    expect(vfs.list('/tmp')).toEqual([]);
    expect(vfs.list('/evidence')).toEqual([]);
    expect(acts(spy)).toEqual([]);
  }, T);

  it('/tmp and /evidence themselves print Permission denied, with and without -r', async () => {
    const { vfs, run, engine } = rig();
    vfs.writeFile('/tmp/keep', enc('x'));
    const spy = vi.spyOn(engine, 'act');
    for (const line of ['rm /tmp', 'rm -r /tmp', 'rm /evidence', 'rm -r /evidence', 'rm -r /tmp/']) {
      const typed = line.split(' ').pop()!;
      expect(await run(line)).toEqual({ output: `rm: cannot remove '${typed}': Permission denied`, exitCode: 1 });
    }
    expect(vfs.list('/tmp')).toEqual(['keep']);
    expect(acts(spy)).toEqual([]);
  }, T);

  it('a mixed line removes both, and only the uploads file produces an action', async () => {
    const { shell, engine } = makeFixture({ baseline: false, plant: [{ path: 'rip.php', content: 'x' }] });
    await shell.run('ls / > /tmp/t');
    const spy = vi.spyOn(engine, 'act');
    expect(await shell.run(`rm ${UP}/rip.php /tmp/t`)).toEqual({ output: '', exitCode: 0 });
    expect(acts(spy)).toEqual(['DEF-15']);
    expect(def15(spy)).toEqual(['rip.php']);
    expect((await shell.run('ls /tmp')).output).toBe('');
    expect((await shell.run(`ls ${UP}`)).output).toBe('');
  }, T);

  it('a mixed line with a refused operand still removes the others and exits 1', async () => {
    const { shell, engine } = makeFixture({ baseline: false, plant: [{ path: 'rip.php', content: 'x' }] });
    await shell.run('ls / > /tmp/t');
    const spy = vi.spyOn(engine, 'act');
    const log = '/var/log/nginx/access.log';
    const r = await shell.run(`rm /tmp/t ${log} ${UP}/rip.php`);
    expect(r).toEqual({ output: `rm: cannot remove '${log}': Permission denied`, exitCode: 1 });
    expect(def15(spy)).toEqual(['rip.php']);
    expect((await shell.run('ls /tmp')).output).toBe('');
  }, T);

  it('a missing /tmp path prints No such file or directory', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('rm /tmp/none')).toEqual({ output: "rm: cannot remove '/tmp/none': No such file or directory", exitCode: 1 });
  }, T);

  it('an Engine evidence file is refused while a player evidence file next to it is removed', async () => {
    const { shell } = makeFixture({ baseline: false, advanceMs: 5_000, evidence: ['snap'] });
    await shell.run('ls / > /evidence/mine');
    const r = await shell.run('rm /evidence/snap.tgz /evidence/mine');
    expect(r).toEqual({ output: "rm: cannot remove '/evidence/snap.tgz': Operation not permitted", exitCode: 1 });
    expect((await shell.run('ls /evidence')).output).toBe('snap.tgz');
  }, T);
});

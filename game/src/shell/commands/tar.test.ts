import { describe, expect, it, vi } from 'vitest';
import { runPipeline } from '../exec';
import { parseLine } from '../parser';
import { createSession } from '../session';
import { sha256Hex } from '../sha256';
import { makeFixture } from '../test-fixtures/fixture';
import { VirtualFs } from '../vfs';

const T = 30_000;
const UP = '/srv/juice-shop/uploads';
const LOGS = '/var/log/nginx /var/log/juice-shop';

/** A fixture plus a runner that keeps the VirtualFs, so archive bytes can be read directly. */
function rig(opts: Parameters<typeof makeFixture>[0] = { baseline: false, advanceMs: 20_000 }) {
  const fx = makeFixture(opts);
  const session = createSession(fx.engine);
  const vfs = new VirtualFs(fx.engine, session.overlay);
  const spy = vi.spyOn(fx.engine, 'act');
  const run = async (line: string) => {
    const parsed = parseLine(line);
    if (!parsed.ok) throw new Error(parsed.error);
    return runPipeline({ engine: fx.engine, vfs, session }, parsed.pipeline, line);
  };
  const types = (): string[] => spy.mock.calls.map(([a]) => a.type);
  const digest = async (path: string): Promise<string> => sha256Hex(await vfs.readBytes(path));
  return { ...fx, vfs, run, spy, types, digest };
}

describe('tar czf /evidence (R8.1, R8.2, R8.3, R16.2)', () => {
  it('sends exactly one DEF-05 with the name and lists the archive once', async () => {
    const r = rig();
    const out = await r.run(`tar czf /evidence/x.tgz ${LOGS}`);
    expect(out).toEqual({ output: '', exitCode: 0 });
    expect(r.spy.mock.calls.map(([a]) => a)).toEqual([{ type: 'DEF-05', name: 'x' }]);
    expect(r.world.evidence.map((e) => e.name)).toEqual(['x']);
    const ls = (await r.run('ls /evidence')).output.split('\n').filter((l) => l.includes('x'));
    expect(ls).toEqual(['x.tgz']);
  }, T);

  it('the dashed spelling and v behave the same', async () => {
    for (const flags of ['-czf', 'czvf', '-czvf']) {
      const r = rig();
      const out = await r.run(`tar ${flags} /evidence/x.tgz /var/log/nginx`);
      expect(out.exitCode).toBe(0);
      expect(r.types()).toEqual(['DEF-05']);
      expect((await r.run('ls /evidence')).output).toBe('x.tgz');
    }
  }, T);

  it('tzf lists the sources and their descendants', async () => {
    const r = rig();
    await r.run(`tar czf /evidence/x.tgz ${LOGS}`);
    const out = (await r.run('tar tzf /evidence/x.tgz')).output.split('\n');
    expect(out).toContain('var/log/nginx/');
    expect(out).toContain('var/log/juice-shop/');
    expect(out.some((l) => l.startsWith('var/log/nginx/') && l !== 'var/log/nginx/')).toBe(true);
    expect(out.some((l) => l.startsWith('var/log/juice-shop/') && l !== 'var/log/juice-shop/')).toBe(true);
    expect(out.every((l) => l.startsWith('var/log/'))).toBe(true);
    expect((await r.run('tar tzf /evidence/x.tgz')).exitCode).toBe(0);
  }, T);

  it('the bytes are deterministic and differ when content differs', async () => {
    const a = rig({ baseline: false, plant: [{ path: 'a.txt', content: 'one' }] });
    const b = rig({ baseline: false, plant: [{ path: 'a.txt', content: 'one' }] });
    const c = rig({ baseline: false, plant: [{ path: 'a.txt', content: 'two' }] });
    for (const r of [a, b, c]) await r.run(`tar czf /evidence/x.tgz ${UP}`);
    const [da, db, dc] = [await a.digest('/evidence/x.tgz'), await b.digest('/evidence/x.tgz'), await c.digest('/evidence/x.tgz')];
    expect(da).toBe(db);
    expect(da).not.toBe(dc);
    // Reading twice gives the same bytes.
    expect(await a.digest('/evidence/x.tgz')).toBe(da);
  }, T);

  it('a later change to a source does not change the archive', async () => {
    const r = rig({ baseline: false, plant: [{ path: 'a.txt', content: 'one' }] });
    await r.run(`tar czf /evidence/x.tgz ${UP}`);
    const before = await r.digest('/evidence/x.tgz');
    await r.run(`rm ${UP}/a.txt`);
    expect(await r.digest('/evidence/x.tgz')).toBe(before);
  }, T);

  it('sources are read without DEF-01/DEF-02/DEF-03 (D-98)', async () => {
    const r = rig({ baseline: false, advanceMs: 20_000, plant: [{ path: 'a.txt', content: 'one' }] });
    await r.run(`tar czf /evidence/x.tgz ${LOGS} ${UP}`);
    expect(r.types()).toEqual(['DEF-05']);
    expect(r.actions().map((a) => a.action.type)).toEqual(['DEF-05']);
  }, T);

  it('a duplicate name prints the Engine message, exits 1 and leaves the first archive alone', async () => {
    const r = rig({ baseline: false, advanceMs: 20_000, plant: [{ path: 'a.txt', content: 'one' }] });
    await r.run('tar czf /evidence/x.tgz /var/log/nginx');
    const before = await r.digest('/evidence/x.tgz');
    const out = await r.run(`tar czf /evidence/x.tgz ${UP}`);
    expect(out.exitCode).toBe(1);
    expect(out.output).toBe('Evidence x already exists');
    expect(await r.digest('/evidence/x.tgz')).toBe(before);
    expect(r.world.evidence).toHaveLength(1);
    expect((await r.run('ls /evidence')).output).toBe('x.tgz');
  }, T);

  it('a name the Engine already holds (made via engine.act) is a duplicate with no archive', async () => {
    const r = rig({ baseline: false, advanceMs: 20_000, evidence: ['pre'] });
    const out = await r.run('tar czf /evidence/pre.tgz /var/log/nginx');
    expect(out).toEqual({ output: 'Evidence pre already exists', exitCode: 1 });
    expect(r.world.evidence).toHaveLength(1);
  }, T);

  it('16 sources are fine, 17 are a usage error with no action', async () => {
    const r = rig();
    const dirs = Array.from({ length: 16 }, () => '/var/log/nginx').join(' ');
    expect((await r.run(`tar czf /evidence/a.tgz ${dirs}`)).exitCode).toBe(0);
    expect(r.types()).toEqual(['DEF-05']);
    const r2 = rig();
    const out = await r2.run(`tar czf /evidence/a.tgz ${dirs} /var/log/nginx`);
    expect(out.exitCode).toBe(1);
    expect(out.output).toContain('tar: usage:');
    expect(r2.types()).toEqual([]);
  }, T);
});

describe('tar czf refusals (R8.4 to R8.9)', () => {
  it('the first missing source is reported with no action and no archive', async () => {
    const r = rig();
    const out = await r.run('tar czf /evidence/x.tgz /var/log/nginx /nope /nope2');
    expect(out).toEqual({ output: 'tar: /nope: No such file or directory', exitCode: 1 });
    expect(r.types()).toEqual([]);
    expect((await r.run('ls /evidence')).output).toBe('');
  }, T);

  it('an archive under /tmp sends no action and can be listed', async () => {
    const r = rig();
    expect((await r.run('tar czf /tmp/t.tgz /var/log/nginx')).exitCode).toBe(0);
    expect(r.types()).toEqual([]);
    expect((await r.run('ls /tmp')).output).toBe('t.tgz');
    expect((await r.run('tar tzf /tmp/t.tgz')).output).toContain('var/log/nginx/');
    expect(r.world.evidence).toEqual([]);
  }, T);

  it.each(['/srv/x.tgz', `${UP}/x.tgz`, '/var/log/x.tgz', '/etc/x.tgz'])('%s is permission denied', async (dest) => {
    const r = rig();
    const out = await r.run(`tar czf ${dest} /var/log/nginx`);
    expect(out).toEqual({ output: `tar: ${dest}: Permission denied`, exitCode: 1 });
    expect(r.types()).toEqual([]);
  }, T);

  it.each([
    '/evidence/.tgz',
    `/evidence/${'a'.repeat(65)}.tgz`,
    '/evidence/a b.tgz',
    '/evidence/sub/a.tgz',
    '/evidence/a.tar',
    '/evidence/a',
    '/evidence/a.tar.gz',
    '/evidence/a@b.tgz',
  ])('invalid name %s prints the invalid-name error with no action', async (dest) => {
    const r = rig();
    const line = dest.includes(' ') ? `tar czf "${dest}" /var/log/nginx` : `tar czf ${dest} /var/log/nginx`;
    const out = await r.run(line);
    expect(out.exitCode).toBe(1);
    expect(out.output).toBe(`tar: invalid archive name '${dest}'`);
    expect(r.types()).toEqual([]);
    expect(r.world.evidence).toEqual([]);
  }, T);

  it('a 64-character name is accepted', async () => {
    const r = rig();
    const out = await r.run(`tar czf /evidence/${'a'.repeat(64)}.tgz /var/log/nginx`);
    expect(out.exitCode).toBe(0);
    expect(r.types()).toEqual(['DEF-05']);
  }, T);

  it('an archive name relative to the cwd resolves against it', async () => {
    const r = rig();
    await r.run('cd /evidence');
    expect((await r.run('tar czf rel.tgz /var/log/nginx')).exitCode).toBe(0);
    expect(r.spy.mock.calls.map(([a]) => a)).toEqual([{ type: 'DEF-05', name: 'rel' }]);
  }, T);
});

describe('tar flags (R8.10, R16.1)', () => {
  it.each(['-x', '-j', 'xzf', '-czfj'])('unsupported flags in %s are refused with no action', async (flags) => {
    const r = rig();
    const out = await r.run(`tar ${flags} /evidence/x.tgz /var/log/nginx`);
    expect(out.exitCode).toBe(1);
    expect(out.output).toMatch(/^tar: (unsupported flag '-[a-z]'|usage:)/);
    expect(out.output).toContain('tar: usage:');
    expect(r.types()).toEqual([]);
  }, T);

  it.each(['czf', 'tzf'])('%s with an unsupported flag names the flag', async (base) => {
    const r = rig();
    const out = await r.run(`tar -${base}j /evidence/x.tgz /var/log/nginx`);
    expect(out.output).toContain("tar: unsupported flag '-j'");
  }, T);

  it.each([
    'tar ctzf /evidence/x.tgz /var/log/nginx', // both c and t
    'tar zf /evidence/x.tgz /var/log/nginx', // neither
    'tar cf /evidence/x.tgz /var/log/nginx', // no z
    'tar cz /evidence/x.tgz /var/log/nginx', // no f
    'tar tf /evidence/x.tgz',
    'tar',
    'tar czf',
    'tar czf /evidence/x.tgz', // no sources
    'tar tzf /evidence/x.tgz /var/log/nginx', // extra operand
  ])('%s is a usage error with no action', async (line) => {
    const r = rig({ baseline: false, advanceMs: 20_000, evidence: ['x'] });
    r.spy.mockClear();
    const out = await r.run(line);
    expect(out.exitCode).toBe(1);
    expect(out.output).toContain('tar: usage:');
    expect(r.types()).toEqual([]);
  }, T);
});

describe('tar tzf (R8.11)', () => {
  it('"Cannot read archive" for a missing path, a plain file, a directory and Engine evidence', async () => {
    const r = rig({ baseline: false, advanceMs: 20_000, evidence: ['made'], plant: [{ path: 'a.txt', content: 'one' }] });
    r.spy.mockClear();
    for (const p of ['/nope.tgz', `${UP}/a.txt`, '/var/log/nginx', '/evidence', '/evidence/made.tgz']) {
      const out = await r.run(`tar tzf ${p}`);
      expect(out).toEqual({ output: `tar: ${p}: Cannot read archive`, exitCode: 1 });
    }
    expect(r.types()).toEqual([]);
  }, T);

  it('lists nested uploads with their descendants', async () => {
    const r = rig({ baseline: false, plant: [{ path: 'c/a.txt', content: 'one' }, { path: 'b.txt', content: 'two' }] });
    await r.run(`tar czf /tmp/u.tgz ${UP}`);
    const lines = (await r.run('tar tzf /tmp/u.tgz')).output.split('\n');
    const rel = UP.slice(1);
    expect(lines).toEqual([`${rel}/`, `${rel}/b.txt`, `${rel}/c/`, `${rel}/c/a.txt`]);
  }, T);
});

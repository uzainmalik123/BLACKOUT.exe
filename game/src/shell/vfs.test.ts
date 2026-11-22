/// <reference types="node" />
// VFS read side (R4.1 to R4.5, R4.15, R4.18, R4.20, R6.1). Every test that builds an Engine has an explicit 30_000 ms timeout (KI-81).
import { describe, expect, it, vi } from 'vitest';
import { gameTimeIso } from '../engine/clock';
import { eventsOfKind } from '../engine/log';
import { makeFixture } from './test-fixtures/fixture';
import { compareCodePoints, splitLines } from './text';
import { FsError, VirtualFs } from './vfs';
import type { Overlay } from './types';

const T = 30_000;
const ACCESS = '/var/log/nginx/access.log';
const APP = '/var/log/juice-shop/app.log';
const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const UPLOADS = '/srv/juice-shop/uploads';
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

function vfsOf(opts: Parameters<typeof makeFixture>[0] = {}) {
  const fx = makeFixture(opts);
  const overlay: Overlay = new Map();
  return { fx, vfs: new VirtualFs(fx.engine, overlay), overlay };
}

async function errorOf(p: Promise<unknown>): Promise<FsError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof FsError) return e;
    throw e;
  }
  throw new Error('expected an FsError');
}

describe('initial layout (R4.1)', () => {
  it('has the skeleton directories and files', () => {
    const { vfs } = vfsOf({ baseline: false });
    expect(vfs.list('/')).toEqual(['evidence', 'srv', 'tmp', 'var']);
    expect(vfs.list('/var/log')).toEqual(['juice-shop', 'nginx']);
    expect(vfs.list('/var/log/nginx')).toEqual(['access.log']);
    expect(vfs.list('/var/log/juice-shop')).toEqual(['app.log']);
    expect(vfs.list('/srv/juice-shop')).toEqual(['data', 'uploads']);
    expect(vfs.list('/srv/juice-shop/data')).toEqual(['juiceshop.sqlite']);
    expect(vfs.list('/tmp')).toEqual([]);
    expect(vfs.list('/evidence')).toEqual([]);
    expect(vfs.list(UPLOADS)).toEqual([]);
    expect(vfs.stat(ACCESS)).toMatchObject({ kind: 'file', area: 'log-access', readonly: true });
    expect(vfs.stat(APP)).toMatchObject({ kind: 'file', area: 'log-app' });
    expect(vfs.stat(DB)).toMatchObject({ kind: 'file', area: 'db' });
    expect(vfs.stat('/tmp')).toMatchObject({ kind: 'dir', readonly: false });
    expect(vfs.stat('/nope')).toBeUndefined();
    expect(vfs.list(ACCESS)).toBeUndefined();
  }, T);
});

describe('logs (R4.2, R6.1)', () => {
  it('two reads separated by an advance differ and equal the Engine text', async () => {
    const { fx, vfs } = vfsOf({ baseline: false, advanceMs: 60_000 });
    const first = dec(await vfs.readBytes(ACCESS));
    expect(first).toBe(fx.engine.accessLog());
    fx.engine.advance(120_000);
    const second = dec(await vfs.readBytes(ACCESS));
    expect(second).toBe(fx.engine.accessLog());
    expect(second).not.toBe(first);
    expect(dec(await vfs.readBytes(APP))).toBe(fx.engine.appLog());
  }, T);

  it('no rendered nginx line is stamped later than the game time', async () => {
    const { fx, vfs } = vfsOf({ baseline: false, advanceMs: 180_000 });
    const lines = splitLines(dec(await vfs.readBytes(ACCESS)));
    expect(lines.length).toBeGreaterThan(0);
    const now = Date.parse(gameTimeIso(fx.world));
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (const line of lines) {
      const m = /\[(\d\d)\/(\w{3})\/(\d{4}):(\d\d:\d\d:\d\d) \+0000\]/.exec(line);
      expect(m, line).not.toBeNull();
      const iso = `${m![3]}-${String(MONTHS.indexOf(m![2]!) + 1).padStart(2, '0')}-${m![1]}T${m![4]}Z`;
      expect(Date.parse(iso)).toBeLessThanOrEqual(now);
    }
  }, T);

  it('the per-invocation snapshot renders each log once', async () => {
    const { fx, vfs } = vfsOf({ baseline: false, advanceMs: 60_000 });
    const access = vi.spyOn(fx.engine, 'accessLog');
    const app = vi.spyOn(fx.engine, 'appLog');
    vfs.beginInvocation();
    await vfs.readBytes(ACCESS);
    await vfs.readBytes(ACCESS);
    await vfs.readBytes(APP);
    await vfs.readBytes(APP);
    vfs.endInvocation();
    expect(access).toHaveBeenCalledTimes(1);
    expect(app).toHaveBeenCalledTimes(1);
    await vfs.readBytes(ACCESS);
    await vfs.readBytes(ACCESS);
    expect(access).toHaveBeenCalledTimes(3); // no snapshot: each read renders fresh
  }, T);
});

describe('uploads (R4.3)', () => {
  it('lists the direct children of Engine.files(), sorted by code point', () => {
    const { fx, vfs } = vfsOf({
      baseline: false,
      plant: [{ path: 'b.txt', content: 'b' }, { path: 'A.txt', content: 'A' }, { path: 'a.txt', content: 'a' }, { path: 'sub/deep/x.php', content: 'x' }],
    });
    const direct = new Set(fx.engine.files().map((f) => f.path.split('/')[0]!));
    const listing = vfs.list(UPLOADS)!;
    expect(new Set(listing)).toEqual(direct);
    expect(listing).toEqual(['A.txt', 'a.txt', 'b.txt', 'sub']);
    expect(listing).toEqual([...listing].sort(compareCodePoints));
  }, T);

  it('derives directories from nested upload paths', async () => {
    const { vfs } = vfsOf({ baseline: false, plant: [{ path: 'sub/deep/x.php', content: '<?php' }] });
    expect(vfs.stat(`${UPLOADS}/sub`)).toMatchObject({ kind: 'dir', area: 'uploads' });
    expect(vfs.list(`${UPLOADS}/sub`)).toEqual(['deep']);
    expect(vfs.list(`${UPLOADS}/sub/deep`)).toEqual(['x.php']);
    expect(vfs.stat(`${UPLOADS}/sub/deep/x.php`)).toMatchObject({ kind: 'file' });
    expect(dec(await vfs.readBytes(`${UPLOADS}/sub/deep/x.php`))).toBe('<?php');
    expect((await errorOf(vfs.readBytes(`${UPLOADS}/sub`))).code).toBe('EISDIR');
  }, T);

  it('a planted file without contentBase64 lists with its size and recorded sha256, and reads fail', async () => {
    const sha = 'ab'.repeat(32);
    const { vfs } = vfsOf({ baseline: false, plant: [{ path: 'ghost.bin', size: 1234, sha256: sha }] });
    const p = `${UPLOADS}/ghost.bin`;
    expect(vfs.list(UPLOADS)).toContain('ghost.bin');
    expect(await vfs.size(p)).toBe(1234);
    expect(vfs.recordedSha256(p)).toBe(sha);
    const err = await errorOf(vfs.readBytes(p));
    expect(err.code).toBe('EIO');
    expect(err.message).toBe('Input/output error');
  }, T);

  it('a file with content has no recordedSha256 and reads back its bytes', async () => {
    const { vfs } = vfsOf({ baseline: false, plant: [{ path: 'ok.txt', content: 'hello' }] });
    expect(vfs.recordedSha256(`${UPLOADS}/ok.txt`)).toBeUndefined();
    expect(await vfs.size(`${UPLOADS}/ok.txt`)).toBe(5);
    expect(dec(await vfs.readBytes(`${UPLOADS}/ok.txt`))).toBe('hello');
  }, T);

  it('sends DEF-03 to the sink for upload reads and DEF-01 for log reads', async () => {
    const { vfs } = vfsOf({ baseline: false, plant: [{ path: 'ok.txt', content: 'hello' }] });
    const sink = { log: vi.fn(() => undefined), uploads: vi.fn(() => undefined) };
    await vfs.readBytes(`${UPLOADS}/ok.txt`, sink);
    await vfs.readBytes(ACCESS, sink);
    expect(sink.uploads).toHaveBeenCalledWith(`${UPLOADS}/ok.txt`);
    expect(sink.log).toHaveBeenCalledTimes(1);
  }, T);
});

describe('evidence (R4.4, R4.18)', () => {
  it('lists <name>.tgz for each Engine evidence entry with no duplicates', () => {
    const { vfs, overlay } = vfsOf({ baseline: false, advanceMs: 60_000, evidence: ['snap1', 'snap2'] });
    overlay.set('/evidence/snap1.tgz', { kind: 'file', bytes: new Uint8Array([1]) }); // the player's copy of the same name
    overlay.set('/evidence/notes.txt', { kind: 'file', bytes: new Uint8Array([2]) });
    const listing = vfs.list('/evidence')!;
    expect(listing).toEqual(['notes.txt', 'snap1.tgz', 'snap2.tgz']);
    expect(new Set(listing).size).toBe(listing.length);
    expect(vfs.canWrite('/evidence/snap1.tgz')).toBe(false);
    expect(vfs.canWrite('/evidence/notes.txt')).toBe(true);
  }, T);

  it('synthesizes content from the log prefixes the snapshot held', async () => {
    const { fx, vfs } = vfsOf({ baseline: false, advanceMs: 120_000, evidence: ['snap'] });
    const ev = fx.engine.evidence()[0]!;
    const accessAtSnapshot = splitLines(fx.engine.accessLog()).slice(0, ev.accessLines);
    const appAtSnapshot = splitLines(fx.engine.appLog()).slice(0, ev.appLines);
    fx.engine.advance(120_000); // later lines must not leak into the evidence
    const text = dec(await vfs.readBytes('/evidence/snap.tgz'));
    expect(splitLines(text)).toEqual([...accessAtSnapshot, ...appAtSnapshot]);
    expect(fx.engine.accessLog().length).toBeGreaterThanOrEqual(accessAtSnapshot.join('\n').length);
  }, T);

  it('an evidence name with a slash is not listed', () => {
    const { vfs } = vfsOf({ baseline: false, advanceMs: 30_000, evidence: ['a/b'] });
    expect(vfs.list('/evidence')).toEqual([]);
  }, T);
});

describe('the database file (R4.5, R4.15, R4.20)', () => {
  it('bytes equal export() and no DEF-02 is sent', async () => {
    const { fx, vfs } = vfsOf();
    const sink = { log: vi.fn(() => undefined), uploads: vi.fn(() => undefined) };
    const bytes = await vfs.readBytes(DB, sink);
    const expected = (await fx.engine.db()).db.export();
    expect(bytes.length).toBe(expected.length);
    expect(Buffer.from(bytes).equals(Buffer.from(expected))).toBe(true);
    expect(sink.log).not.toHaveBeenCalled();
    expect(sink.uploads).not.toHaveBeenCalled();
    expect(fx.actsOfType('DEF-02')).toEqual([]);
    expect(eventsOfKind(fx.world, 'action')).toEqual([]);
  }, T);

  it('with no baseline a read fails with Input/output error', async () => {
    const { vfs } = vfsOf({ baseline: false });
    const err = await errorOf(vfs.readBytes(DB));
    expect(err.code).toBe('EIO');
    expect(err.message).toBe('Input/output error');
  }, T);
});

describe('overlay writes (task 14.1 smoke)', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (e) {
      if (e instanceof FsError) return e.code;
      throw e;
    }
    return undefined;
  };

  it('writes, copies, lists and removes under /tmp; refuses elsewhere', async () => {
    const { vfs } = vfsOf({ baseline: false });
    vfs.mkdir('/tmp/a');
    vfs.writeFile('/tmp/a/f', enc('hi'));
    expect(dec(await vfs.readBytes('/tmp/a/f'))).toBe('hi');
    await vfs.copy('/tmp/a/f', '/tmp/g');
    expect(vfs.list('/tmp')).toEqual(['a', 'g']);
    expect(codeOf(() => vfs.writeFile('/tmp/a', enc('x')))).toBe('EISDIR');
    expect(codeOf(() => vfs.writeFile('/tmp/no/f', enc('x')))).toBe('ENOENT');
    expect(codeOf(() => vfs.writeFile('/tmp/g/f', enc('x')))).toBe('ENOTDIR');
    expect(codeOf(() => vfs.mkdir('/tmp/a'))).toBe('EEXIST');
    vfs.mkdir('/tmp/p/q/r', { parents: true });
    expect(vfs.stat('/tmp/p/q')?.kind).toBe('dir');
    expect(codeOf(() => vfs.writeFile('/etc/x', enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile(ACCESS, enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile(DB, enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile(`${UPLOADS}/x`, enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.remove('/tmp/a'))).toBe('EISDIR');
    vfs.remove('/tmp/a', { recursive: true });
    vfs.remove('/tmp/g');
    expect(vfs.list('/tmp')).toEqual(['p']);
    expect(codeOf(() => vfs.remove('/tmp/g'))).toBe('ENOENT');
  }, T);
});

describe('VFS writes (R4.10, R4.11, R4.12, R4.14, R4.18, R4.19)', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (e) {
      if (e instanceof FsError) return e.code;
      throw e;
    }
    return undefined;
  };
  const codeOfAsync = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
    } catch (e) {
      if (e instanceof FsError) return e.code;
      throw e;
    }
    return undefined;
  };
  const withEvidence = () =>
    vfsOf({ baseline: false, advanceMs: 5_000, evidence: ['snap'], plant: [{ path: 'rip.php', content: 'x' }, { path: 'd/a', content: 'y' }] });

  it('writeFile creates, then overwrites, and the overlay shows in stat, list and readBytes', async () => {
    const { vfs } = vfsOf({ baseline: false });
    vfs.writeFile('/tmp/f', enc('one'));
    expect(vfs.stat('/tmp/f')).toMatchObject({ kind: 'file', area: 'tmp', readonly: false });
    expect(vfs.list('/tmp')).toEqual(['f']);
    expect(dec(await vfs.readBytes('/tmp/f'))).toBe('one');
    expect(await vfs.size('/tmp/f')).toBe(3);
    vfs.writeFile('/tmp/f', enc('second'));
    expect(dec(await vfs.readBytes('/tmp/f'))).toBe('second');
    expect(vfs.list('/tmp')).toEqual(['f']);
    vfs.writeFile('/evidence/n.txt', enc('e'));
    expect(vfs.list('/evidence')).toEqual(['n.txt']);
    expect(vfs.stat('/evidence/n.txt')).toMatchObject({ kind: 'file', area: 'evidence', readonly: false });
  }, T);

  it('writeFile stores a copy of the bytes', async () => {
    const { vfs } = vfsOf({ baseline: false });
    const b = enc('abc');
    vfs.writeFile('/tmp/f', b);
    b[0] = 0;
    expect(dec(await vfs.readBytes('/tmp/f'))).toBe('abc');
  }, T);

  it('every FsError code for writeFile', () => {
    const { vfs } = withEvidence();
    vfs.mkdir('/tmp/d');
    vfs.writeFile('/tmp/file', enc('x'));
    expect(codeOf(() => vfs.writeFile(ACCESS, enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile(APP, enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile(DB, enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile(`${UPLOADS}/new`, enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile(`${UPLOADS}/rip.php`, enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile('/var/x', enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile('/x', enc('x')))).toBe('EACCES');
    expect(codeOf(() => vfs.writeFile('/evidence/snap.tgz', enc('x')))).toBe('EPERM');
    expect(codeOf(() => vfs.writeFile('/tmp/missing/f', enc('x')))).toBe('ENOENT');
    expect(codeOf(() => vfs.writeFile('/tmp/file/f', enc('x')))).toBe('ENOTDIR');
    expect(codeOf(() => vfs.writeFile('/tmp/d', enc('x')))).toBe('EISDIR');
    expect(codeOf(() => vfs.writeFile('/tmp', enc('x')))).toBe('EISDIR');
    expect(vfs.list('/tmp')).toEqual(['d', 'file']);
  }, T);

  it('mkdir without parents', () => {
    const { vfs } = withEvidence();
    vfs.mkdir('/tmp/a');
    expect(vfs.stat('/tmp/a')).toMatchObject({ kind: 'dir', area: 'tmp', readonly: false });
    expect(vfs.list('/tmp/a')).toEqual([]);
    vfs.mkdir('/tmp/a/b');
    expect(vfs.list('/tmp/a')).toEqual(['b']);
    vfs.mkdir('/evidence/x');
    expect(vfs.list('/evidence')).toEqual(['snap.tgz', 'x']);
    expect(codeOf(() => vfs.mkdir('/tmp/a'))).toBe('EEXIST');
    expect(codeOf(() => vfs.mkdir('/tmp'))).toBe('EEXIST');
    expect(codeOf(() => vfs.mkdir('/tmp/q/r'))).toBe('ENOENT');
    vfs.writeFile('/tmp/file', enc('x'));
    expect(codeOf(() => vfs.mkdir('/tmp/file'))).toBe('EEXIST');
    expect(codeOf(() => vfs.mkdir('/tmp/file/z'))).toBe('ENOTDIR');
    expect(codeOf(() => vfs.mkdir('/srv/x'))).toBe('EACCES');
    expect(codeOf(() => vfs.mkdir(`${UPLOADS}/x`))).toBe('EACCES');
    expect(codeOf(() => vfs.mkdir('/var/log/x'))).toBe('EACCES');
    expect(codeOf(() => vfs.mkdir('/evidence/snap.tgz'))).toBe('EPERM');
  }, T);

  it('mkdir with parents creates the chain and is idempotent on a directory', () => {
    const { vfs } = withEvidence();
    vfs.mkdir('/tmp/p/q/r', { parents: true });
    expect(vfs.list('/tmp')).toEqual(['p']);
    expect(vfs.list('/tmp/p')).toEqual(['q']);
    expect(vfs.stat('/tmp/p/q/r')?.kind).toBe('dir');
    vfs.mkdir('/tmp/p/q', { parents: true });
    vfs.mkdir('/tmp', { parents: true });
    vfs.mkdir('/evidence/e1/e2', { parents: true });
    expect(vfs.stat('/evidence/e1/e2')?.kind).toBe('dir');
    vfs.writeFile('/tmp/file', enc('x'));
    expect(codeOf(() => vfs.mkdir('/tmp/file', { parents: true }))).toBe('EEXIST');
    expect(codeOf(() => vfs.mkdir('/tmp/file/x/y', { parents: true }))).toBe('ENOTDIR');
    expect(codeOf(() => vfs.mkdir('/srv/x/y', { parents: true }))).toBe('EACCES');
    expect(codeOf(() => vfs.mkdir(`${UPLOADS}/n/m`, { parents: true }))).toBe('EACCES');
    expect(vfs.stat('/srv/x')).toBeUndefined();
  }, T);

  it('copy of a /tmp file, a log and an upload; a refused destination is never a read (DEF-03 sink)', async () => {
    const { vfs } = withEvidence();
    const sink = { log: vi.fn(() => undefined), uploads: vi.fn(() => undefined) };
    vfs.writeFile('/tmp/f', enc('data'));
    await vfs.copy('/tmp/f', '/tmp/g', sink);
    expect(dec(await vfs.readBytes('/tmp/g'))).toBe('data');
    expect(sink.uploads).not.toHaveBeenCalled();

    await vfs.copy(`${UPLOADS}/rip.php`, '/tmp/rip', sink);
    expect(sink.uploads).toHaveBeenCalledTimes(1);
    expect(sink.uploads).toHaveBeenCalledWith(`${UPLOADS}/rip.php`);
    expect(dec(await vfs.readBytes('/tmp/rip'))).toBe('x');

    await vfs.copy(ACCESS, '/evidence/access.copy', sink);
    expect(sink.log).toHaveBeenCalledTimes(1);
    expect(vfs.list('/evidence')).toEqual(['access.copy', 'snap.tgz']);

    await vfs.copy('/evidence/snap.tgz', '/tmp/snapcopy');
    expect(vfs.stat('/tmp/snapcopy')).toMatchObject({ kind: 'file' });

    // Destination refused first: the source is never read, so no sink call.
    sink.uploads.mockClear();
    sink.log.mockClear();
    expect(await codeOfAsync(vfs.copy(`${UPLOADS}/rip.php`, `${UPLOADS}/copy`, sink))).toBe('EACCES');
    expect(await codeOfAsync(vfs.copy(`${UPLOADS}/rip.php`, '/tmp/nodir/x', sink))).toBe('ENOENT');
    expect(await codeOfAsync(vfs.copy(`${UPLOADS}/rip.php`, '/tmp/f/x', sink))).toBe('ENOTDIR');
    expect(await codeOfAsync(vfs.copy(`${UPLOADS}/rip.php`, '/evidence/snap.tgz', sink))).toBe('EPERM');
    expect(await codeOfAsync(vfs.copy(ACCESS, '/etc/x', sink))).toBe('EACCES');
    vfs.mkdir('/tmp/dir');
    expect(await codeOfAsync(vfs.copy(`${UPLOADS}/rip.php`, '/tmp/dir', sink))).toBe('EISDIR');
    expect(sink.uploads).not.toHaveBeenCalled();
    expect(sink.log).not.toHaveBeenCalled();
  }, T);

  it('copy source errors: missing and directory', async () => {
    const { vfs } = withEvidence();
    expect(await codeOfAsync(vfs.copy('/tmp/none', '/tmp/x'))).toBe('ENOENT');
    expect(await codeOfAsync(vfs.copy(`${UPLOADS}/d`, '/tmp/x'))).toBe('EISDIR');
    expect(await codeOfAsync(vfs.copy('/tmp', '/tmp/x'))).toBe('EISDIR');
    expect(vfs.stat('/tmp/x')).toBeUndefined();
  }, T);

  it('copy of an upload without stored bytes fails with EIO and creates nothing', async () => {
    const { vfs } = vfsOf({ baseline: false, plant: [{ path: 'ghost.bin', size: 5 }] });
    expect(await codeOfAsync(vfs.copy(`${UPLOADS}/ghost.bin`, '/tmp/ghost'))).toBe('EIO');
    expect(vfs.stat('/tmp/ghost')).toBeUndefined();
  }, T);

  it('remove: files, directories with and without recursive, and every error code', async () => {
    const { vfs } = withEvidence();
    vfs.mkdir('/tmp/d/e', { parents: true });
    vfs.writeFile('/tmp/d/e/f', enc('x'));
    vfs.writeFile('/tmp/d2', enc('y'));
    vfs.writeFile('/tmp/dd', enc('z')); // shares a prefix with /tmp/d
    expect(codeOf(() => vfs.remove('/tmp/d'))).toBe('EISDIR');
    expect(vfs.stat('/tmp/d/e/f')).toBeDefined();
    vfs.remove('/tmp/d', { recursive: true });
    expect(vfs.stat('/tmp/d')).toBeUndefined();
    expect(vfs.stat('/tmp/d/e/f')).toBeUndefined();
    expect(vfs.list('/tmp')).toEqual(['d2', 'dd']);
    vfs.remove('/tmp/d2');
    expect(vfs.list('/tmp')).toEqual(['dd']);
    vfs.remove('/tmp/dd', { recursive: true }); // recursive on a file is fine
    expect(vfs.list('/tmp')).toEqual([]);
    vfs.writeFile('/evidence/n.txt', enc('e'));
    vfs.remove('/evidence/n.txt');
    expect(vfs.list('/evidence')).toEqual(['snap.tgz']);

    expect(codeOf(() => vfs.remove('/tmp/none'))).toBe('ENOENT');
    expect(codeOf(() => vfs.remove(ACCESS))).toBe('EACCES');
    expect(codeOf(() => vfs.remove(DB))).toBe('EACCES');
    expect(codeOf(() => vfs.remove(`${UPLOADS}/rip.php`))).toBe('EACCES');
    expect(codeOf(() => vfs.remove(`${UPLOADS}/d`, { recursive: true }))).toBe('EACCES');
    expect(codeOf(() => vfs.remove('/var', { recursive: true }))).toBe('EACCES');
    expect(codeOf(() => vfs.remove('/', { recursive: true }))).toBe('EACCES');
    expect(codeOf(() => vfs.remove('/evidence/snap.tgz'))).toBe('EPERM');
    expect(vfs.stat('/evidence/snap.tgz')).toBeDefined();
  }, T);

  it('/tmp and /evidence themselves cannot be removed', () => {
    const { vfs } = withEvidence();
    vfs.writeFile('/tmp/f', enc('x'));
    expect(codeOf(() => vfs.remove('/tmp'))).toBe('EACCES');
    expect(codeOf(() => vfs.remove('/tmp', { recursive: true }))).toBe('EACCES');
    expect(codeOf(() => vfs.remove('/evidence', { recursive: true }))).toBe('EACCES');
    expect(vfs.list('/tmp')).toEqual(['f']);
    expect(vfs.stat('/evidence')?.kind).toBe('dir');
  }, T);

  it('putArchive stores an archive node that shows in stat, list and readBytes, and copy keeps it an archive', async () => {
    const { vfs, overlay } = vfsOf({ baseline: false, advanceMs: 5_000, evidence: ['snap'] });
    const entries = [{ path: 'a.txt', type: 'file' as const, bytes: enc('A') }];
    vfs.putArchive('/tmp/x.tgz', entries, enc('TGZ'));
    expect(vfs.stat('/tmp/x.tgz')).toMatchObject({ kind: 'file', area: 'tmp' });
    expect(vfs.list('/tmp')).toEqual(['x.tgz']);
    expect(dec(await vfs.readBytes('/tmp/x.tgz'))).toBe('TGZ');
    entries[0]!.bytes[0] = 0; // the node holds its own copy
    const node = overlay.get('/tmp/x.tgz');
    expect(node?.kind).toBe('archive');
    if (node?.kind === 'archive') expect(dec(node.entries[0]!.bytes)).toBe('A');
    await vfs.copy('/tmp/x.tgz', '/tmp/y.tgz');
    expect(overlay.get('/tmp/y.tgz')?.kind).toBe('archive');
    vfs.putArchive('/tmp/empty.tgz', []);
    expect((await vfs.readBytes('/tmp/empty.tgz')).length).toBe(0);
    expect(codeOf(() => vfs.putArchive(`${UPLOADS}/x.tgz`, []))).toBe('EACCES');
    expect(codeOf(() => vfs.putArchive('/evidence/snap.tgz', []))).toBe('EPERM');
    expect(codeOf(() => vfs.putArchive('/tmp/none/x.tgz', []))).toBe('ENOENT');
    vfs.mkdir('/tmp/dir');
    expect(codeOf(() => vfs.putArchive('/tmp/dir', []))).toBe('EISDIR');
  }, T);
});

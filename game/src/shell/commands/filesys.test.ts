import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../sha256';
import { makeFixture } from '../test-fixtures/fixture';

const T = 30_000;
const UP = '/srv/juice-shop/uploads';
const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const SHA = /^[0-9a-f]{64}$/;

describe('file (R5.15, R6.2, R16.1)', () => {
  it('describes each kind of file', async () => {
    const binary = new Uint8Array([0, 1, 2, 255, 128]);
    const { shell } = makeFixture({
      baseline: true,
      advanceMs: 20_000,
      plant: [
        { path: 'empty.txt', content: '' },
        { path: 'a.txt', content: 'hello world\n' },
        { path: 'rip.php', content: '<?php system($_GET["c"]); ?>' },
        { path: 'plain.php', content: 'just words' },
        { path: 'run.sh', content: '#!/bin/sh\nid\n' },
        { path: 'blob.bin', content: binary },
      ],
    });
    const f = async (line: string) => shell.run(line);
    expect(await f(`file ${UP}/empty.txt`)).toEqual({ output: `${UP}/empty.txt: empty`, exitCode: 0 });
    expect((await f(`file ${UP}/a.txt`)).output).toBe(`${UP}/a.txt: ASCII text`);
    expect((await f(`file ${UP}/rip.php`)).output).toBe(`${UP}/rip.php: PHP script, ASCII text`);
    expect((await f(`file ${UP}/plain.php`)).output).toBe(`${UP}/plain.php: PHP script, ASCII text`);
    expect((await f(`file ${UP}/run.sh`)).output).toBe(`${UP}/run.sh: script, ASCII text executable`);
    expect((await f(`file ${UP}/blob.bin`)).output).toBe(`${UP}/blob.bin: data`);
    expect((await f(`file ${DB}`)).output).toBe(`${DB}: SQLite 3.x database`);
    expect(await f('file /tmp')).toEqual({ output: '/tmp: directory', exitCode: 0 });
    expect(await f('tar czf /tmp/a.tgz /var/log/nginx')).toEqual({ output: '', exitCode: 0 });
    expect((await f('file /tmp/a.tgz')).output).toBe('/tmp/a.tgz: gzip compressed data');
  }, T);

  it('a missing path prints an error and the other operands continue', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('file /nope /tmp');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('file: /nope: No such file or directory');
    expect(r.output).toContain('/tmp: directory');
  }, T);

  it('sends one DEF-03 for a line that reads uploads, none for other paths', async () => {
    const fx = makeFixture({ baseline: false, plant: [{ path: 'a.txt', content: 'x' }, { path: 'b.txt', content: 'y' }] });
    await fx.shell.run(`file ${UP}/a.txt ${UP}/b.txt`);
    expect(fx.actsOfType('DEF-03')).toHaveLength(1);
    await fx.shell.run('file /tmp');
    expect(fx.actsOfType('DEF-03')).toHaveLength(1);
  }, T);

  it('an unsupported flag prints the flag and the usage line', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('file -i /tmp')).toEqual({
      output: "file: unsupported flag '-i'\nfile: usage: file <path>...",
      exitCode: 1,
    });
  }, T);
});

describe('sha256sum (R5.16, R5.17, R8.7, R8.11, R16.1)', () => {
  it('matches sha256Hex of the bytes, and a pipe uses `-`', async () => {
    const bytes = enc('hello\n');
    const { shell } = makeFixture({ baseline: false, plant: [{ path: 'a.txt', content: bytes }] });
    const digest = sha256Hex(bytes);
    expect(await shell.run(`sha256sum ${UP}/a.txt`)).toEqual({ output: `${digest}  ${UP}/a.txt`, exitCode: 0 });
    expect((await shell.run(`cat ${UP}/a.txt | sha256sum`)).output).toBe(`${digest}  -`);
  }, T);

  it('prints the recorded sha256 for a file with no recorded bytes', async () => {
    const recorded = 'ab'.repeat(32);
    const { shell } = makeFixture({ baseline: false, plant: [{ path: 'blob.bin', size: 9, sha256: recorded }] });
    expect(await shell.run(`sha256sum ${UP}/blob.bin`)).toEqual({ output: `${recorded}  ${UP}/blob.bin`, exitCode: 0 });
  }, T);

  it('a directory and a missing path print an error, and later operands still run', async () => {
    const bytes = enc('z');
    const { shell } = makeFixture({ baseline: false, plant: [{ path: 'z.txt', content: bytes }] });
    const r = await shell.run(`sha256sum /tmp /nope ${UP}/z.txt`);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('sha256sum: /tmp: Is a directory');
    expect(r.output).toContain('sha256sum: /nope: No such file or directory');
    expect(r.output).toContain(`${sha256Hex(bytes)}  ${UP}/z.txt`);
  }, T);

  it('an archive digest repeats and differs when content differs (R8.7)', async () => {
    const run = async (content: string) => {
      const { shell } = makeFixture({ baseline: false, plant: [{ path: 'a.txt', content }] });
      expect(await shell.run(`tar czf /evidence/x.tgz ${UP}`)).toEqual({ output: '', exitCode: 0 });
      const first = await shell.run('sha256sum /evidence/x.tgz');
      const second = await shell.run('sha256sum /evidence/x.tgz');
      return { first, second };
    };
    const one = await run('one');
    const again = await run('one');
    const two = await run('two');
    expect(one.first.exitCode).toBe(0);
    expect(one.first.output).toMatch(/^[0-9a-f]{64} {2}\/evidence\/x\.tgz$/);
    expect(one.second).toEqual(one.first);
    expect(again.first).toEqual(one.first);
    expect(two.first.output).not.toBe(one.first.output);
    expect(two.first.output.split(' ')[0]).toMatch(SHA);
  }, T);

  it('an unsupported flag prints the flag and the usage line', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('sha256sum -c /tmp')).toEqual({
      output: "sha256sum: unsupported flag '-c'\nsha256sum: usage: sha256sum [file...]",
      exitCode: 1,
    });
  }, T);
});

describe('cp (R4.11, R4.12, R5.17, R16.1, R16.2)', () => {
  it('copies an uploads file to /tmp byte-identical with one DEF-03', async () => {
    const bytes = new Uint8Array([0, 10, 200, 13, 65, 255]);
    const fx = makeFixture({ baseline: false, plant: [{ path: 'b.bin', content: bytes }] });
    expect(await fx.shell.run(`cp ${UP}/b.bin /tmp/c.bin`)).toEqual({ output: '', exitCode: 0 });
    expect(fx.actsOfType('DEF-03')).toHaveLength(1);
    expect((await fx.shell.run('sha256sum /tmp/c.bin')).output).toBe(`${sha256Hex(bytes)}  /tmp/c.bin`);
    expect(fx.actsOfType('DEF-03')).toHaveLength(1);
  }, T);

  it('keeps the text readable with cat, and copies into an existing directory as the basename', async () => {
    const fx = makeFixture({ baseline: false, plant: [{ path: 'sub/a.txt', content: 'alpha\nbeta' }] });
    await fx.shell.run('mkdir /tmp/d');
    expect(await fx.shell.run(`cp ${UP}/sub/a.txt /tmp/d`)).toEqual({ output: '', exitCode: 0 });
    expect((await fx.shell.run('ls /tmp/d')).output).toBe('a.txt');
    expect((await fx.shell.run('cat /tmp/d/a.txt')).output).toBe('alpha\nbeta');
  }, T);

  it('refuses without sending a DEF-03', async () => {
    const fx = makeFixture({
      baseline: false,
      evidence: ['snap'],
      plant: [{ path: 'a.txt', content: 'x' }, { path: 'dir/b.txt', content: 'y' }],
    });
    const cases: [string, string][] = [
      [`cp ${UP}/a.txt /srv/x`, 'cp: /srv/x: Permission denied'],
      [`cp ${UP}/a.txt ${UP}/z.txt`, `cp: ${UP}/z.txt: Permission denied`],
      [`cp ${UP}/a.txt /evidence/snap.tgz`, 'cp: /evidence/snap.tgz: Operation not permitted'],
      [`cp ${UP}/a.txt /tmp/nodir/x`, 'cp: /tmp/nodir/x: No such file or directory'],
      [`cp ${UP}/dir /tmp/e`, `cp: ${UP}/dir: Is a directory`],
      ['cp /nope /tmp/e', 'cp: /nope: No such file or directory'],
    ];
    for (const [line, output] of cases) expect(await fx.shell.run(line)).toEqual({ output, exitCode: 1 });
    expect(fx.actsOfType('DEF-03')).toHaveLength(0);
    for (const line of ['cp', `cp ${UP}/a.txt`, `cp ${UP}/a.txt /tmp/a /tmp/b`]) {
      const r = await fx.shell.run(line);
      expect(r.exitCode).toBe(1);
      expect(r.output).toContain('cp: usage: cp <source> <destination>');
    }
    expect(fx.actsOfType('DEF-03')).toHaveLength(0);
    expect((await fx.shell.run('ls /tmp')).output).toBe('');
  }, T);

  it('an unsupported flag prints the flag and the usage line', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('cp -r /tmp /tmp/x')).toEqual({
      output: "cp: unsupported flag '-r'\ncp: usage: cp <source> <destination>",
      exitCode: 1,
    });
  }, T);
});

describe('mkdir (R4.10, R4.12, R5.18, R16.1)', () => {
  it('creates a directory, reports File exists, and -p tolerates an existing one', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('mkdir /tmp/a')).toEqual({ output: '', exitCode: 0 });
    expect((await shell.run('ls /tmp')).output).toBe('a');
    expect(await shell.run('mkdir /tmp/a')).toEqual({ output: 'mkdir: /tmp/a: File exists', exitCode: 1 });
    expect(await shell.run('mkdir -p /tmp/a')).toEqual({ output: '', exitCode: 0 });
  }, T);

  it('needs -p for missing parents', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('mkdir /tmp/p/q')).toEqual({ output: 'mkdir: /tmp/p/q: No such file or directory', exitCode: 1 });
    expect(await shell.run('mkdir -p /tmp/p/q/r')).toEqual({ output: '', exitCode: 0 });
    expect((await shell.run('ls /tmp/p/q')).output).toBe('r');
  }, T);

  it('prints Permission denied outside the writable area, including uploads and with -p', async () => {
    const fx = makeFixture({ baseline: false, plant: [{ path: 'a.txt', content: 'x' }] });
    for (const line of ['mkdir /srv/x', `mkdir ${UP}/new`, 'mkdir -p /srv/x/y', `mkdir -p ${UP}/n/m`]) {
      const typed = line.split(' ').pop();
      expect(await fx.shell.run(line)).toEqual({ output: `mkdir: ${typed}: Permission denied`, exitCode: 1 });
    }
    expect((await fx.shell.run(`ls ${UP}`)).output).toBe('a.txt');
    expect(fx.actions().filter((a) => a.action.type !== 'DEF-03')).toHaveLength(0);
  }, T);

  it('an unsupported flag prints the flag and the usage line', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('mkdir -m /tmp/x')).toEqual({
      output: "mkdir: unsupported flag '-m'\nmkdir: usage: mkdir [-p] <path>...",
      exitCode: 1,
    });
  }, T);
});

describe('mkdir, cp, cat and rm -r round trip (R11.2, R11.10)', () => {
  it('creates, copies, reads back and removes a tree without any Engine removal', async () => {
    const fx = makeFixture({ baseline: false, plant: [{ path: 'a.txt', content: 'keep me' }] });
    expect((await fx.shell.run('mkdir -p /tmp/w/x')).exitCode).toBe(0);
    expect((await fx.shell.run(`cp ${UP}/a.txt /tmp/w/x`)).exitCode).toBe(0);
    expect((await fx.shell.run('cat /tmp/w/x/a.txt')).output).toBe('keep me');
    expect(await fx.shell.run('rm -r /tmp/w')).toEqual({ output: '', exitCode: 0 });
    expect((await fx.shell.run('ls /tmp')).output).toBe('');
    expect((await fx.shell.run('cat /tmp/w/x/a.txt')).exitCode).toBe(1);
    expect(fx.actsOfType('DEF-15')).toHaveLength(0);
    expect((await fx.shell.run(`ls ${UP}`)).output).toBe('a.txt');
  }, T);
});

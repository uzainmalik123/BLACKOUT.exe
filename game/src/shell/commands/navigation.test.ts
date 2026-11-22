import { describe, expect, it } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const HOME = '/srv/juice-shop';
const UPLOADS = `${HOME}/uploads`;
const DB = `${HOME}/data/juiceshop.sqlite`;

describe('ls flags (R5.1, R5.2, R5.3)', () => {
  it('plain ls lists code-point order and hides dot names', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('ls /');
    expect(r).toEqual({ output: 'evidence\nsrv\ntmp\nvar', exitCode: 0 });
  }, 30_000);

  it('ls -l prints mode, size and name with no times', async () => {
    const { shell } = makeFixture({ baseline: false, plant: [{ path: 'a.txt', content: 'hello' }] });
    const r = await shell.run(`ls -l ${UPLOADS}`);
    expect(r).toEqual({ output: '-rw-r--r-- 5 a.txt', exitCode: 0 });
  }, 30_000);

  it('ls -a includes dot names, ls does not', async () => {
    const { shell } = makeFixture({
      baseline: false,
      plant: [
        { path: '.hidden', content: 'x' },
        { path: 'b', content: 'y' },
      ],
    });
    expect((await shell.run(`ls ${UPLOADS}`)).output).toBe('b');
    expect((await shell.run(`ls -a ${UPLOADS}`)).output).toBe('.hidden\nb');
  }, 30_000);

  it('ls -la combines both flags', async () => {
    const { shell } = makeFixture({
      baseline: false,
      plant: [
        { path: '.hidden', content: 'x' },
        { path: 'b', content: 'yy' },
      ],
    });
    const r = await shell.run(`ls -la ${UPLOADS}`);
    expect(r).toEqual({ output: '-rw-r--r-- 1 .hidden\n-rw-r--r-- 2 b', exitCode: 0 });
  }, 30_000);

  it('rejects an unsupported flag with the R5.19 text', async () => {
    const { shell, actions } = makeFixture({ baseline: false });
    const before = actions().length;
    const r = await shell.run('ls -z');
    expect(r.output).toBe("ls: unsupported flag '-z'\nls: usage: ls [-l] [-a] [path...]");
    expect(r.exitCode).toBe(1);
    expect(actions()).toHaveLength(before);
  }, 30_000);
});

describe('ls operands (R5.1)', () => {
  it('several operands print path: headings, files first', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('ls /var /tmp');
    expect(r.exitCode).toBe(0);
    expect(r.output).toBe('/tmp:\n\n/var:\nlog');
  }, 30_000);

  it('a missing path prints an error, exits 1 and the others still list', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('ls /nope /var');
    expect(r.exitCode).toBe(1);
    expect(r.output).toBe("ls: /nope: No such file or directory\n/var:\nlog");
  }, 30_000);

  it('ls with no operand lists the working directory', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('cd /var/log');
    expect((await shell.run('ls')).output).toBe('juice-shop\nnginx');
  }, 30_000);
});

describe('cd and pwd (R4.6 to R4.9, R4.13)', () => {
  it('pwd starts at /srv/juice-shop', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('pwd')).toEqual({ output: HOME, exitCode: 0 });
  }, 30_000);

  it('cd with no argument goes home', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('cd /tmp');
    expect((await shell.run('cd')).exitCode).toBe(0);
    expect((await shell.run('pwd')).output).toBe(HOME);
  }, 30_000);

  it('cd into a file fails with Not a directory and keeps cwd', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('cd /var/log/nginx/access.log');
    expect(r).toEqual({ output: 'cd: /var/log/nginx/access.log: Not a directory', exitCode: 1 });
    expect((await shell.run('pwd')).output).toBe(HOME);
  }, 30_000);

  it('cd .. at / stays at /', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('cd /');
    expect((await shell.run('cd ..')).exitCode).toBe(0);
    expect((await shell.run('pwd')).output).toBe('/');
  }, 30_000);

  it('a missing path leaves cwd unchanged and echoes the path as typed', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('cd nowhere/../x');
    expect(r).toEqual({ output: 'cd: nowhere/../x: No such file or directory', exitCode: 1 });
    expect((await shell.run('pwd')).output).toBe(HOME);
  }, 30_000);

  it('resolves relative paths against the cwd', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('cd uploads');
    expect((await shell.run('pwd')).output).toBe(UPLOADS);
    await shell.run('cd ../data');
    expect((await shell.run('pwd')).output).toBe(`${HOME}/data`);
    await shell.run('cd ./../../../var/log/');
    expect((await shell.run('pwd')).output).toBe('/var/log');
  }, 30_000);
});

describe('ls read tracking (DEF-01, DEF-03)', () => {
  it('ls of uploads sends exactly one DEF-03, even with two uploads operands', async () => {
    const { shell, actsOfType } = makeFixture({ baseline: false, plant: [{ path: 'a', content: 'x' }] });
    await shell.run(`ls ${UPLOADS}`);
    expect(actsOfType('DEF-03')).toHaveLength(1);
    await shell.run(`ls ${UPLOADS} ${UPLOADS}/a`);
    expect(actsOfType('DEF-03')).toHaveLength(2); // two operands on one line add exactly one more
  }, 30_000);

  it('ls of a log directory and a log file sends no DEF-01', async () => {
    const { shell, actsOfType, actions } = makeFixture({ baseline: false, advanceMs: 60_000 });
    const before = actions().length;
    await shell.run('ls -l /var/log/nginx');
    await shell.run('ls /var/log/nginx/access.log');
    expect(actsOfType('DEF-01')).toHaveLength(0);
    expect(actions()).toHaveLength(before);
  }, 30_000);
});

describe('ls -l of the database file without a baseline', () => {
  it('shows ? for the size and exits 1', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run(`ls -l ${DB}`);
    expect(r.exitCode).toBe(1);
    expect(r.output).toBe(`ls: ${DB}: Input/output error\n-rw-r--r-- ? ${DB}`);
  }, 30_000);
});

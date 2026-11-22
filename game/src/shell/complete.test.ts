// Task 19.2: Easy-only autocomplete (R13.1-13.5, R1.2, R1.7).
import { describe, expect, it } from 'vitest';
import { COMMAND_LIST } from './index';
import { compareCodePoints } from './text';
import { makeFixture } from './test-fixtures/fixture';

const UP = '/srv/juice-shop/uploads';
const T = 30_000;

function easy(opts: Parameters<typeof makeFixture>[0] = {}) {
  const f = makeFixture({ baseline: false, difficulty: 'easy', ...opts });
  const complete = f.shell.complete;
  if (!complete) throw new Error('complete missing on Easy');
  return { ...f, complete };
}

describe('complete: command names (R13.1)', () => {
  it('completes a unique prefix', () => {
    expect(easy().complete('ca')).toEqual(['cat']);
  }, T);

  it('lists every matching name, sorted', () => {
    const expected = COMMAND_LIST.filter((n) => n.startsWith('s')).sort(compareCodePoints);
    expect(expected.length).toBeGreaterThan(1);
    expect(easy().complete('s')).toEqual(expected);
  }, T);

  it('returns [] when nothing matches and is case-sensitive', () => {
    const { complete } = easy();
    expect(complete('zzz')).toEqual([]);
    expect(complete('CA')).toEqual([]);
  }, T);

  it('returns at most 20 results', () => {
    const r = easy().complete('');
    expect(r.length).toBe(20);
    expect(r).toEqual([...COMMAND_LIST].sort(compareCodePoints).slice(0, 20));
  }, T);
});

describe('complete: paths (R13.2, R13.3)', () => {
  it('completes with a directory part', () => {
    expect(easy().complete('cat /var/log/ng')).toEqual(['/var/log/nginx/']);
  }, T);

  it('completes in the cwd when there is no directory part', () => {
    expect(easy().complete('ls up')).toEqual(['uploads/']);
  }, T);

  it('follows cd', async () => {
    const { shell, complete } = easy();
    await shell.run('cd /var/log');
    expect(complete('ls ng')).toEqual(['nginx/']);
  }, T);

  it('lists planted files, directories with a trailing slash, sorted and unique', () => {
    const { complete } = easy({
      plant: [
        { path: 'b.txt', content: 'x' },
        { path: 'a.txt', content: 'x' },
        { path: 'a.png', content: 'x' },
        { path: 'sub/one.txt', content: 'x' },
        { path: 'sub/two.txt', content: 'x' },
        { path: '.hidden', content: 'x' },
      ],
    });
    expect(complete(`ls ${UP}/`)).toEqual([`${UP}/a.png`, `${UP}/a.txt`, `${UP}/b.txt`, `${UP}/sub/`]);
    expect(complete(`ls ${UP}/a.`)).toEqual([`${UP}/a.png`, `${UP}/a.txt`]);
    expect(complete(`ls ${UP}/su`)).toEqual([`${UP}/sub/`]);
    expect(complete(`ls ${UP}/sub/t`)).toEqual([`${UP}/sub/two.txt`]);
  }, T);

  it('hides dot names unless the prefix starts with a dot', () => {
    const { complete } = easy({ plant: [{ path: '.hidden', content: 'x' }, { path: 'h.txt', content: 'x' }] });
    expect(complete(`ls ${UP}/`)).toEqual([`${UP}/h.txt`]);
    expect(complete(`ls ${UP}/.`)).toEqual([`${UP}/.hidden`]);
  }, T);

  it('handles ~', () => {
    const { complete } = easy();
    expect(complete('ls ~')).toEqual(['~/']);
    expect(complete('ls ~/up')).toEqual(['~/uploads/']);
  }, T);

  it('returns [] for an unknown prefix or directory', () => {
    const { complete } = easy();
    expect(complete('ls zzz')).toEqual([]);
    expect(complete('ls /no/such/dir/a')).toEqual([]);
  }, T);

  it('stays within the Command_List or the VFS, after rm and after mkdir', async () => {
    const { shell, complete } = easy({ plant: [{ path: 'gone.txt', content: 'x' }, { path: 'kept.txt', content: 'x' }] });
    expect(complete(`ls ${UP}/g`)).toEqual([`${UP}/gone.txt`]);
    const rm = await shell.run(`rm ${UP}/gone.txt`);
    expect(rm.exitCode).toBe(0);
    expect(complete(`ls ${UP}/g`)).toEqual([]);
    expect(complete(`ls ${UP}/k`)).toEqual([`${UP}/kept.txt`]);

    expect(complete('ls /tmp/n')).toEqual([]);
    expect((await shell.run('mkdir /tmp/newdir')).exitCode).toBe(0);
    expect(complete('ls /tmp/n')).toEqual(['/tmp/newdir/']);

    // every result is a real listing entry
    for (const r of [...complete('ls /'), ...complete('ls /tmp/')]) {
      const out = await shell.run(`ls ${r}`);
      expect(out.exitCode, r).toBe(0);
    }
  }, T);
});

describe('complete: availability and purity (R1.2, R1.7, R13.4)', () => {
  it('is a function on Easy and absent on Medium and Hard', () => {
    expect(typeof easy().shell.complete).toBe('function');
    for (const difficulty of ['medium', 'hard'] as const) {
      const { shell } = makeFixture({ baseline: false, difficulty });
      expect('complete' in shell).toBe(false);
      expect(shell.complete).toBeUndefined();
    }
  }, T);

  it('sends no action and changes neither the World nor the history', async () => {
    const { shell, complete, world, actions, worldWithoutReads } = easy({ plant: [{ path: 'a.txt', content: 'x' }] });
    await shell.run('pwd');
    const history = (await shell.run('history')).output;
    const before = JSON.stringify(worldWithoutReads());
    const count = actions().length;
    const eventCount = world.events.length;

    for (const p of ['', 'ca', 's', 'cat /var/log/ng', `ls ${UP}/`, 'ls ~', 'ls zzz']) complete(p);

    expect(actions().length).toBe(count);
    expect(world.events.length).toBe(eventCount);
    expect(JSON.stringify(worldWithoutReads())).toBe(before);
    const after = (await shell.run('history')).output;
    expect(after.split('\n').slice(0, history.split('\n').length)).toEqual(history.split('\n'));
    expect((await shell.run('pwd')).output).toBe('/srv/juice-shop');
  }, T);
});

// Feature: shell, Property 7: Path resolution
// **Validates: Requirements 4.6, 4.7, 4.8, 4.9, 4.13**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { resolvePath } from '../path';
import { makeFixture } from '../test-fixtures/fixture';

const DIRS = [
  '/',
  '/srv',
  '/srv/juice-shop',
  '/srv/juice-shop/data',
  '/srv/juice-shop/uploads',
  '/var',
  '/var/log',
  '/var/log/nginx',
  '/var/log/juice-shop',
  '/tmp',
  '/evidence',
];
const DIR_SET = new Set(DIRS);

const arbCwd = fc.constantFrom(...DIRS);
const arbSeg = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('srv', 'juice-shop', 'data', 'uploads', 'var', 'log', 'nginx', 'tmp', 'evidence') },
  { weight: 2, arbitrary: fc.constantFrom('.', '..') },
  { weight: 1, arbitrary: fc.constantFrom('zz_missing', 'nope') },
);
const arbRelative = fc
  .tuple(fc.array(arbSeg, { minLength: 1, maxLength: 8 }), fc.boolean())
  .map(([segs, slash]) => segs.join('/') + (slash ? '/' : ''));

/** Independent reference: apply the segments in order. */
function model(cwd: string, typed: string): string {
  const stack = typed.startsWith('/') ? [] : cwd.split('/').filter(Boolean);
  for (const s of typed.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') stack.pop();
    else stack.push(s);
  }
  return '/' + stack.join('/');
}

describe('Property 7: path resolution', () => {
  it('resolvePath normalizes, `..` at / stays, absolute ignores cwd', () => {
    fc.assert(
      fc.property(arbCwd, arbRelative, (cwd, rel) => {
        const r = resolvePath(cwd, rel);
        expect(r).toBe(model(cwd, rel));
        expect(resolvePath('/anywhere/else', r)).toBe(r);
        expect(resolvePath(cwd, `${'../'.repeat(20)}${rel}`)).toBe(model('/', rel));
      }),
      { numRuns: 100 },
    );
  });

  it('cd then pwd prints the resolved directory; a missing path leaves cwd and the World unchanged', async () => {
    const { shell, engine, worldWithoutReads } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    await fc.assert(
      fc.asyncProperty(arbCwd, arbRelative, async (cwd, typed) => {
        expect((await shell.run(`cd ${cwd}`)).exitCode).toBe(0);
        const before = structuredClone(worldWithoutReads());
        const expected = model(cwd, typed);
        const r = await shell.run(`cd ${typed}`);
        const pwd = await shell.run('pwd');
        if (r.exitCode === 0) {
          expect(r.output).toBe('');
          expect(pwd.output).toBe(expected);
          expect(DIR_SET.has(expected) || expected.startsWith('/srv/juice-shop/')).toBe(true);
        } else {
          expect(r.exitCode).toBe(1);
          expect(r.output).toContain(typed);
          expect(r.output).toMatch(/No such file or directory|Not a directory/);
          expect(pwd.output).toBe(cwd);
          expect(worldWithoutReads()).toEqual(before);
        }
        if (DIR_SET.has(expected)) expect(r.exitCode).toBe(0);
        expect(act).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('an absolute path ignores the working directory', async () => {
    const { shell } = makeFixture({ baseline: false });
    await fc.assert(
      fc.asyncProperty(arbCwd, arbCwd, arbRelative, async (c1, c2, rel) => {
        const abs = model('/', rel);
        await shell.run(`cd ${c1}`);
        const a = await shell.run(`cd ${abs}`);
        const pa = (await shell.run('pwd')).output;
        await shell.run(`cd ${c2}`);
        const b = await shell.run(`cd ${abs}`);
        const pb = (await shell.run('pwd')).output;
        expect(a.exitCode).toBe(b.exitCode);
        if (a.exitCode === 0) expect(pa).toBe(pb);
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});

// Feature: shell, Property 24: `rm` of uploads sends one relative-path action
// **Validates: Requirements 11.1, 11.5, 11.6, 11.7**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const TIMEOUT_MS = 30_000;
const UPLOADS = '/srv/juice-shop/uploads';

// Directory names start with `d` and file names with `f`, so no planted path is a prefix directory of another file.
const arbTail = fc.stringMatching(/^[a-z0-9]{1,5}$/);
const arbFileName = fc.tuple(arbTail, fc.constantFrom('', '.txt', '.php')).map(([t, ext]) => `f${t}${ext}`);
const arbDirName = arbTail.map((t) => `d${t}`);
const arbRel = fc.tuple(fc.option(arbDirName, { nil: undefined }), arbFileName).map(([d, f]) => (d === undefined ? f : `${d}/${f}`));

type How = 'absolute' | 'relative' | 'glob';
const arbOutside = fc.record({
  path: fc.constantFrom('/var/log/nginx/access.log', '/var/log/juice-shop/app.log', '/srv/juice-shop/data/juiceshop.sqlite'),
  planted: fc.uniqueArray(arbRel, { maxLength: 3 }),
});

const arbCase = fc.record({
  paths: fc.uniqueArray(arbRel, { minLength: 1, maxLength: 8 }),
  pick: fc.nat(),
  how: fc.constantFrom<How>('absolute', 'relative', 'glob'),
  globAt: fc.nat(),
  refuse: fc.boolean(),
});

const dirOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

/** The operand naming `target`, and the planted files that operand matches. */
function operandFor(paths: string[], target: string, how: How, globAt: number): { operand: string; matched: string[] } {
  if (how === 'absolute') return { operand: `${UPLOADS}/${target}`, matched: [target] };
  if (how === 'relative') return { operand: `uploads/${target}`, matched: [target] };
  // `*` in place of a basename stretch that keeps the first character (which tells files from directories apart).
  const base = baseOf(target);
  const i = 1 + (globAt % base.length);
  const j = i + (Math.floor(globAt / base.length) % (base.length - i + 1));
  const head = base.slice(0, i);
  const tail = base.slice(j);
  const pattern = `${head}*${tail}`;
  const matches = (other: string): boolean => {
    const b = baseOf(other);
    return dirOf(other) === dirOf(target) && b.length >= head.length + tail.length && b.startsWith(head) && b.endsWith(tail);
  };
  const dir = dirOf(target);
  return { operand: `uploads/${dir === '' ? '' : `${dir}/`}${pattern}`, matched: paths.filter(matches) };
}

/** Names `ls` prints for one uploads directory, sorted. */
async function listing(f: ReturnType<typeof makeFixture>, dir: string): Promise<string[]> {
  const r = await f.shell.run(`ls ${UPLOADS}${dir === '' ? '' : `/${dir}`}`);
  return r.output.split('\n').filter((l) => l !== '').sort();
}

describe('Property 24: `rm` of uploads sends one relative-path action', () => {
  it(
    'sends one DEF-15 per matched file with its uploads-relative path and nothing else; ok:true drops it from ls, ok:false prints the message and keeps it; paths outside uploads/ print Permission denied and send nothing',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.oneof(arbCase.map((c) => ({ c })), arbOutside.map((o) => ({ o }))), async (x) => {
          if ('o' in x) {
            const f = makeFixture({ baseline: false, plant: x.o.planted.map((p) => ({ path: p, content: p })) });
            const spy = vi.spyOn(f.engine, 'act');
            const before = spy.mock.calls.length;
            const r = await f.shell.run(`rm ${x.o.path}`);
            expect(spy.mock.calls.slice(before)).toEqual([]);
            expect(r.output).toBe(`rm: cannot remove '${x.o.path}': Permission denied`);
            expect(r.exitCode).toBe(1);
            expect(f.world.files).toHaveLength(x.o.planted.length);
            return;
          }
          const c = x.c;
          const f = makeFixture({ baseline: false, plant: c.paths.map((path) => ({ path, content: path })) });
          const target = c.paths[c.pick % c.paths.length]!;
          const { operand, matched } = operandFor(c.paths, target, c.how, c.globAt);
          expect(matched).toContain(target);

          const real = f.engine.act.bind(f.engine);
          const spy = vi.spyOn(f.engine, 'act').mockImplementation((a) =>
            c.refuse && a.type === 'DEF-15' ? { ok: false, message: `refused ${a.path}` } : real(a),
          );
          const before = spy.mock.calls.length;
          const r = await f.shell.run(`rm ${operand}`);
          const sent = spy.mock.calls.slice(before).map(([a]) => a);

          expect([...sent].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
            matched.map((path) => ({ type: 'DEF-15', path })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
          );
          spy.mockRestore();

          const dirs = new Set(c.paths.map(dirOf));
          for (const d of dirs) {
            const inDir = c.paths.filter((p) => dirOf(p) === d).map(baseOf);
            const gone = matched.filter((p) => dirOf(p) === d).map(baseOf);
            const kept = c.refuse ? inDir : inDir.filter((n) => !gone.includes(n));
            const subdirs = d === '' ? [...dirs].filter((x) => x !== '') : [];
            const expected = [...kept, ...subdirs.filter((s) => (c.refuse ? true : c.paths.some((p) => dirOf(p) === s && !matched.includes(p))))];
            // A directory with no file left no longer exists (it is derived from Engine.files()), so it is not listed.
            if (d !== '' && !expected.length) continue;
            const names = await listing(f, d);
            expect(names).toEqual(expected.sort());
          }

          if (c.refuse) {
            expect(r.exitCode).toBe(1);
            expect(r.output.split('\n').filter((l) => l !== '').sort()).toEqual(matched.map((p) => `refused ${p}`).sort());
          } else {
            expect(r.exitCode).toBe(0);
            expect(r.output).toBe('');
          }
        }),
        { numRuns: 100 },
      );
    },
    TIMEOUT_MS,
  );
});

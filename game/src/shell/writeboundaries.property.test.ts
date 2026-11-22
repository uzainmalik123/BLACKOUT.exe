// Feature: shell, Property 8: Write boundaries
// **Validates: Requirements 3.2, 3.3, 3.4, 4.10, 4.12, 4.14, 11.2, 11.6**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { makeFixture, type Fixture } from './test-fixtures/fixture';

const TIMEOUT_MS = 30_000;
const LOG = '/var/log/nginx/access.log';
const APP = '/var/log/juice-shop/app.log';
const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const UP = '/srv/juice-shop/uploads';
const EV_FILE = '/evidence/ev1.tgz'; // an Engine evidence file (made through DEF-05 in the fixture)
const PLANTED = ['a.txt', 'd1/b.php'];
const REFUSAL = /Permission denied|Operation not permitted|No such file or directory|Not a directory|Is a directory|File exists|already exists|invalid|Invalid/;

// Targets inside the Writable_Area (parents may be missing or be files).
const arbWritablePath = fc.constantFrom(
  '/tmp/x', '/tmp/y.txt', '/tmp/d', '/tmp/d/z', '/tmp/d/e/f', '/tmp/missing/z', '/tmp', '/tmp/x/sub',
  '/evidence/n1.tgz', '/evidence/n2.tgz', '/evidence/plain.txt', '/evidence/sub/q.tgz', '/evidence/d',
);
// Targets outside it: logs, database, uploads, system directories, and an Engine evidence file.
const arbForbiddenPath = fc.constantFrom(
  LOG, APP, DB, `${UP}/a.txt`, `${UP}/new.txt`, `${UP}/d1`, `${UP}/d1/b.php`, `${UP}/d1/new`, UP,
  '/etc/passwd', '/etc/x', '/etc/missing/x', '/', '/var', '/var/log', '/var/x', '/srv/juice-shop/x', '/srv/juice-shop/data/x',
  '/srv/juice-shop/data', EV_FILE,
);

type Op = 'redirect' | 'cp' | 'mkdir' | 'mkdir-p' | 'rm' | 'rm-r' | 'tar';
const arbOp = fc.constantFrom<Op>('redirect', 'cp', 'mkdir', 'mkdir-p', 'rm', 'rm-r', 'tar');

function lineFor(op: Op, path: string): string {
  switch (op) {
    case 'redirect': return `pwd > ${path}`;
    case 'cp': return `cp ${LOG} ${path}`;
    case 'mkdir': return `mkdir ${path}`;
    case 'mkdir-p': return `mkdir -p ${path}`;
    case 'rm': return `rm ${path}`;
    case 'rm-r': return `rm -r ${path}`;
    case 'tar': return `tar czf ${path} ${LOG}`;
  }
}

const inWritable = (p: string): boolean => p === '/tmp' || p === '/evidence' || p.startsWith('/tmp/') || p.startsWith('/evidence/');

/** The whole tree as `path -> ls -l line`, plus the hashes of the logs, the database and every uploaded file. */
async function snapshot(f: Fixture): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    const r = await f.shell.run(`ls -l ${dir}`);
    for (const l of r.output.split('\n').filter((x) => x !== '')) {
      const name = l.trim().split(/\s+/).pop() as string;
      const child = `${dir === '/' ? '' : dir}/${name}`;
      out.set(child, l);
      if (l.startsWith('d')) await walk(child);
    }
  };
  await walk('/');
  const hashes = await f.shell.run(`sha256sum ${[LOG, APP, DB, ...PLANTED.map((p) => `${UP}/${p}`)].join(' ')}`);
  out.set('#hashes', hashes.output);
  return out;
}

const outsideWritable = (m: Map<string, string>): [string, string][] =>
  [...m].filter(([k]) => k.startsWith('#') || !inWritable(k)).sort(([a], [b]) => a.localeCompare(b));

describe('Property 8: write boundaries', () => {
  it('writes succeed only under /tmp and /evidence; every other target is refused and changes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(fc.tuple(arbOp, arbWritablePath), fc.tuple(arbOp, arbForbiddenPath)), { minLength: 1, maxLength: 3 }),
        async (steps) => {
          const f = makeFixture({
            baseline: false,
            plant: PLANTED.map((path) => ({ path, content: `data ${path}` })),
            advanceMs: 3000,
            evidence: ['ev1'],
          });
          const act = vi.spyOn(f.engine, 'act');
          for (const [op, path] of steps) {
            const line = lineFor(op, path);
            const before = await snapshot(f);
            const filesBefore = structuredClone(f.engine.files());
            const worldBefore = structuredClone(f.worldWithoutReads());
            const callsBefore = act.mock.calls.length;

            const r = await f.shell.run(line);
            const calls = act.mock.calls.slice(callsBefore).map(([a]) => a).filter((a) => !['DEF-01', 'DEF-02', 'DEF-03'].includes(a.type)); // reads are not writes
            const after = await snapshot(f);

            // Only DEF-15 (rm of an Uploaded_File) and DEF-05 (tar into /evidence) may reach the Engine.
            for (const a of calls) {
              if (a.type === 'DEF-15') expect(op === 'rm' || op === 'rm-r').toBe(true);
              else if (a.type === 'DEF-05') expect(op).toBe('tar');
              else throw new Error(`unexpected action ${a.type} for ${line}`);
            }
            // Logs, database and the uploads that survive are never changed.
            expect(after.get('#hashes') === before.get('#hashes') || calls.some((a) => a.type === 'DEF-15')).toBe(true);
            expect(after.get(LOG)).toBe(before.get(LOG));
            expect(after.get(DB)).toBe(before.get(DB));
            // Nothing outside the Writable_Area changes, bar the uploads an accepted DEF-15 removed.
            if (!calls.some((a) => a.type === 'DEF-15')) expect(outsideWritable(after)).toEqual(outsideWritable(before));

            if (!inWritable(path) || path === EV_FILE) {
              if (op === 'rm' || op === 'rm-r') {
                // A path in uploads/ goes to DEF-15; everything else is refused.
                if (path.startsWith(UP) && f.world !== undefined && calls.length > 0) {
                  expect(calls.every((a) => a.type === 'DEF-15')).toBe(true);
                  continue;
                }
              }
              expect(r.exitCode).not.toBe(0);
              expect(r.output).toMatch(REFUSAL);
              expect([...after]).toEqual([...before]);
              expect(f.engine.files()).toEqual(filesBefore);
              if (calls.length === 0) expect(f.worldWithoutReads()).toEqual(worldBefore);
              else expect(f.world.files).toEqual((worldBefore as { files: unknown }).files);
            } else if (r.exitCode === 0 && op !== 'rm' && op !== 'rm-r') {
              // A successful write lands inside the Writable_Area and nowhere else.
              expect(inWritable(path)).toBe(true);
              expect([...after.keys()].some((k) => k === path || k.startsWith(`${path}/`) || path === '/tmp')).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  }, TIMEOUT_MS);

  it('never writes over an Engine evidence file, and mkdir on an existing path prints File exists', async () => {
    const f = makeFixture({ baseline: false, advanceMs: 3000, evidence: ['ev1'] });
    const before = await f.shell.run(`ls -l /evidence`);
    for (const line of [`pwd > ${EV_FILE}`, `cp ${LOG} ${EV_FILE}`, `tar czf ${EV_FILE} ${LOG}`]) {
      const r = await f.shell.run(line);
      expect(r.exitCode).not.toBe(0);
    }
    expect((await f.shell.run(`ls -l /evidence`)).output).toBe(before.output);
    await f.shell.run('mkdir /tmp/dup');
    const again = await f.shell.run('mkdir /tmp/dup');
    expect(again.output).toContain('File exists');
  }, TIMEOUT_MS);
});

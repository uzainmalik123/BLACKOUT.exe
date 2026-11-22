// Feature: shell, Property 23: Evidence snapshots
// **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const NAME_CHARS = [...'abcxyzABCXYZ0189._-'];
const arbArchiveName = fc.string({ unit: fc.constantFrom(...NAME_CHARS), minLength: 1, maxLength: 64 });

// Names the shell must refuse: a character outside the set, too long, or empty.
const arbBadArchiveName = fc.oneof(
  fc
    .tuple(
      fc.string({ unit: fc.constantFrom(...NAME_CHARS), maxLength: 5 }),
      fc.constantFrom('@', '+', ',', '=', '%', '!', ':'),
      fc.string({ unit: fc.constantFrom(...NAME_CHARS), maxLength: 5 }),
    )
    .map(([a, c, b]) => `${a}${c}${b}`),
  fc.string({ unit: fc.constantFrom(...NAME_CHARS), minLength: 65, maxLength: 70 }),
  fc.constant(''),
);

// A pool with no source below another, so `tar tzf` lists each source followed by its own descendants.
const UP = '/srv/juice-shop/uploads';
const POOL: { src: string; lines: string[] }[] = [
  { src: '/var/log/nginx/access.log', lines: ['var/log/nginx/access.log'] },
  { src: '/var/log/juice-shop/app.log', lines: ['var/log/juice-shop/app.log'] },
  { src: '/srv/juice-shop/data/juiceshop.sqlite', lines: ['srv/juice-shop/data/juiceshop.sqlite'] },
  { src: `${UP}/a.txt`, lines: [`${UP.slice(1)}/a.txt`] },
  { src: `${UP}/b.txt`, lines: [`${UP.slice(1)}/b.txt`] },
  { src: `${UP}/sub`, lines: [`${UP.slice(1)}/sub/`, `${UP.slice(1)}/sub/c.txt`] },
];
const arbSources = fc.uniqueArray(fc.integer({ min: 0, max: POOL.length - 1 }), { minLength: 1, maxLength: POOL.length });

const PLANT = [
  { path: 'a.txt', content: 'alpha' },
  { path: 'b.txt', content: 'bravo' },
  { path: 'sub/c.txt', content: 'charlie' },
];

type Scenario =
  | { kind: 'good'; name: string; picks: number[]; tmp: boolean }
  | { kind: 'badName'; name: string; shape: 'plain' | 'nested' | 'ext' }
  | { kind: 'missing'; name: string; picks: number[]; where: number }
  | { kind: 'badFlags'; flags: string; name: string }
  | { kind: 'outside'; dir: string; name: string }
  | { kind: 'duplicate'; name: string };

const arbScenario: fc.Arbitrary<Scenario> = fc.oneof(
  fc.record({ kind: fc.constant('good' as const), name: arbArchiveName, picks: arbSources, tmp: fc.boolean() }),
  fc.record({
    kind: fc.constant('badName' as const),
    name: arbBadArchiveName,
    shape: fc.constantFrom('plain' as const, 'nested' as const, 'ext' as const),
  }),
  fc.record({
    kind: fc.constant('missing' as const),
    name: arbArchiveName,
    picks: arbSources,
    where: fc.nat(10),
  }),
  fc.record({
    kind: fc.constant('badFlags' as const),
    flags: fc.constantFrom('cf', 'zf', 'ctzf', 'xzf', 'cz', '-cxzf', '-czfq'),
    name: arbArchiveName,
  }),
  fc.record({
    kind: fc.constant('outside' as const),
    dir: fc.constantFrom('/srv', '/var/log', '/', '/srv/juice-shop/uploads'),
    name: arbArchiveName,
  }),
  fc.record({ kind: fc.constant('duplicate' as const), name: arbArchiveName }),
);

describe('Property 23: Evidence snapshots', () => {
  // Feature: shell, Property 23: Evidence snapshots
  it('sends one DEF-05 for a valid snapshot, lists it back, and creates nothing otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (sc) => {
        const fx = makeFixture({ baseline: true, plant: PLANT });
        const act = vi.spyOn(fx.engine, 'act');
        const def05 = (): number => act.mock.calls.filter(([a]) => a.type === 'DEF-05').length;
        const evidenceDir = async (): Promise<string> => (await fx.shell.run('ls /evidence')).output;
        const tmpDir = async (): Promise<string> => (await fx.shell.run('ls /tmp')).output;

        if (sc.kind === 'good') {
          const dest = sc.tmp ? `/tmp/${sc.name}.tgz` : `/evidence/${sc.name}.tgz`;
          const srcs = sc.picks.map((i) => (POOL[i] as (typeof POOL)[number]).src);
          const r = await fx.shell.run(`tar czf ${dest} ${srcs.join(' ')}`);
          expect(r.exitCode).toBe(0);
          expect(r.output).toBe('');
          expect(def05()).toBe(sc.tmp ? 0 : 1);
          if (!sc.tmp) expect(fx.actsOfType('DEF-05')).toEqual([{ type: 'DEF-05', name: sc.name }]);
          const t = await fx.shell.run(`tar tzf ${dest}`);
          expect(t.output).toBe(sc.picks.flatMap((i) => (POOL[i] as (typeof POOL)[number]).lines).join('\n'));
          // Same bytes give the same digest.
          const h1 = await fx.shell.run(`sha256sum ${dest}`);
          const h2 = await fx.shell.run(`sha256sum ${dest}`);
          expect(h1.exitCode).toBe(0);
          expect(h1.output).toBe(h2.output);
          // A different archived byte gives a different digest.
          const other = makeFixture({
            baseline: false,
            plant: [{ path: 'a.txt', content: 'alphb' }],
          });
          const mine = makeFixture({ baseline: false, plant: [{ path: 'a.txt', content: 'alpha' }] });
          await mine.shell.run(`tar czf /tmp/x.tgz ${UP}/a.txt`);
          await other.shell.run(`tar czf /tmp/x.tgz ${UP}/a.txt`);
          expect((await mine.shell.run('sha256sum /tmp/x.tgz')).output).not.toBe(
            (await other.shell.run('sha256sum /tmp/x.tgz')).output,
          );
          return;
        }

        if (sc.kind === 'duplicate') {
          const dest = `/evidence/${sc.name}.tgz`;
          expect((await fx.shell.run(`tar czf ${dest} ${UP}/a.txt`)).exitCode).toBe(0);
          const before = (await fx.shell.run(`sha256sum ${dest}`)).output;
          const r = await fx.shell.run(`tar czf ${dest} ${UP}/b.txt`);
          expect(r.exitCode).toBe(1);
          expect(r.output).not.toBe('');
          expect(def05()).toBe(2); // the refused one is sent
          expect((await fx.shell.run(`sha256sum ${dest}`)).output).toBe(before);
          expect((await fx.shell.run(`tar tzf ${dest}`)).output).toBe(`${UP.slice(1)}/a.txt`);
          return;
        }

        let line: string;
        let watch: () => Promise<string>;
        const sent = 0;
        switch (sc.kind) {
          case 'badName': {
            const dest =
              sc.shape === 'plain'
                ? `/evidence/${sc.name}.tgz`
                : sc.shape === 'nested'
                  ? `/evidence/sub/${sc.name || 'n'}.tgz`
                  : `/evidence/${sc.name || 'n'}.tar`;
            line = `tar czf ${dest} ${UP}/a.txt`;
            watch = evidenceDir;
            // `/evidence/<empty>.tgz`, a name with a bad char and too-long names are all refused.
            if (sc.shape === 'plain' && /^[A-Za-z0-9._-]{1,64}$/.test(sc.name)) throw new Error('generator bug');
            break;
          }
          case 'missing': {
            const srcs = sc.picks.map((i) => (POOL[i] as (typeof POOL)[number]).src);
            srcs.splice(sc.where % (srcs.length + 1), 0, `${UP}/nope`);
            line = `tar czf /evidence/${sc.name}.tgz ${srcs.join(' ')}`;
            watch = evidenceDir;
            break;
          }
          case 'badFlags':
            line = `tar ${sc.flags} /evidence/${sc.name}.tgz ${UP}/a.txt`;
            watch = evidenceDir;
            break;
          default:
            line = `tar czf ${sc.dir === '/' ? '' : sc.dir}/${sc.name}.tgz ${UP}/a.txt`;
            watch = async () => (await fx.shell.run(`ls ${sc.dir}`)).output;
        }
        const listingBefore = await watch();
        const r = await fx.shell.run(line);
        expect(r.exitCode).not.toBe(0);
        expect(r.output).not.toBe('');
        expect(def05()).toBe(sent);
        expect(await watch()).toBe(listingBefore);
        expect(fx.engine.evidence()).toEqual([]);
        expect(await tmpDir()).toBe('');
      }),
      { numRuns: 50 },
    );
  }, 30_000);
});

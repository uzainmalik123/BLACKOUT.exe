// Feature: shell, Property 18: One read action per kind per line
// **Validates: Requirements 7.2, 7.5, 7.16, 14.4, 14.5, 14.7**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeFixture } from './test-fixtures/fixture';

const UP = '/srv/juice-shop/uploads';
const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const LOG = '/var/log/nginx/access.log';

type Kind = 'log' | 'db' | 'uploads';
interface Stage {
  text: string;
  kind?: Kind;
  /** DEF-02 `sql` when this stage is the first database read. */
  sql?: string;
  /** DEF-03 `path` when this stage is the first uploads read. */
  path?: string;
}

const arbLogStage: fc.Arbitrary<Stage> = fc.constantFrom(
  `cat ${LOG}`,
  `head -n 3 ${LOG}`,
  `tail -n 2 ${LOG}`,
  `grep GET ${LOG}`,
  `wc -l ${LOG}`,
).map((text) => ({ text, kind: 'log' }));

const arbDbStage: fc.Arbitrary<Stage> = fc
  .constantFrom(
    { arg: '.tables', sql: '.tables' },
    { arg: '.schema', sql: '.schema' },
    { arg: '"SELECT id FROM Users LIMIT 2"', sql: 'SELECT id FROM Users LIMIT 2' },
    { arg: '"SELECT count(*) FROM Users"', sql: 'SELECT count(*) FROM Users' },
    { arg: '"SELECT 1"', sql: 'SELECT 1' },
  )
  .map(({ arg, sql }) => ({ text: `sqlite3 ${DB} ${arg}`, kind: 'db', sql }));

const arbUploadsStage: fc.Arbitrary<Stage> = fc
  .constantFrom(
    { text: `ls ${UP}`, path: UP },
    { text: `ls ${UP}/d`, path: `${UP}/d` },
    { text: `cat ${UP}/a.php`, path: `${UP}/a.php` },
    { text: `cat ${UP}/d/b.txt`, path: `${UP}/d/b.txt` },
    { text: `wc -l ${UP}/a.php`, path: `${UP}/a.php` },
  )
  .map((s) => ({ ...s, kind: 'uploads' }));

const arbReader = fc.oneof(arbLogStage, arbDbStage, arbUploadsStage);
const arbFilter: fc.Arbitrary<Stage> = fc
  .constantFrom('sort', 'uniq', 'wc -l', 'head -n 5')
  .map((text) => ({ text }));
const arbHead: fc.Arbitrary<Stage> = fc.oneof(arbReader, fc.constantFrom('pwd', 'date').map((text) => ({ text })));

/** A pipeline of readers of the three kinds mixed with stages that read nothing. */
const arbReadPlan: fc.Arbitrary<Stage[]> = fc
  .tuple(arbHead, fc.array(fc.oneof(arbReader, arbFilter), { maxLength: 5 }))
  .map(([first, rest]) => [first, ...rest]);

const join = (stages: Stage[]): string => stages.map((s) => s.text).join(' | ');

function expectedActions(stages: Stage[], line: string): { type: string; [k: string]: unknown }[] {
  const out: { type: string; [k: string]: unknown }[] = [];
  if (stages.some((s) => s.kind === 'log')) out.push({ type: 'DEF-01', query: line });
  const db = stages.find((s) => s.kind === 'db');
  if (db) out.push({ type: 'DEF-02', sql: db.sql });
  const up = stages.find((s) => s.kind === 'uploads');
  if (up) out.push({ type: 'DEF-03', path: up.path });
  return out;
}

const byType = (a: { type: string }, b: { type: string }): number => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0);

const arbBreak = fc.constantFrom('unknown', 'syntax', 'missing');

describe('Property 18: one read action per kind per line', () => {
  it('sends one DEF-01/02/03 per kind read, none for a line that fails before reading, DEF-05 only for tar czf', async () => {
    const f = makeFixture({
      plant: [
        { path: 'a.php', content: 'x\ny' },
        { path: 'd/b.txt', content: 'q' },
      ],
      advanceMs: 60_000,
    });
    let tarCount = 0;
    const sent = (): { type: string; [k: string]: unknown }[] => f.actions().map((e) => e.action as { type: string });
    const run = async (line: string): Promise<{ type: string; [k: string]: unknown }[]> => {
      const before = f.actions().length;
      await f.shell.run(line);
      return sent().slice(before);
    };

    await fc.assert(
      fc.asyncProperty(
        arbReadPlan,
        arbBreak,
        fc.integer({ min: 0, max: 5 }),
        fc.constantFrom(LOG, UP, `${UP}/a.php`, DB),
        async (plan, how, at, tarSrc) => {
          // 1. Every read succeeds: exactly one action per kind read, with the D-98 payloads.
          const line = join(plan);
          const got = (await run(line)).sort(byType);
          expect(got).toEqual(expectedActions(plan, line));

          // 2. A line that fails before reading sends nothing.
          let broken: string;
          if (how === 'unknown') {
            const i = at % (plan.length + 1);
            broken = join([...plan.slice(0, i), { text: 'nosuchcmd x' }, ...plan.slice(i)]);
          } else if (how === 'syntax') {
            broken = `${line} ; pwd`;
          } else {
            broken = join([{ text: `cat ${UP}/nope` }, ...plan.slice(1).filter((s) => !s.kind)]);
          }
          expect(await run(broken)).toEqual([]);

          // 3. tar czf sends DEF-05 only, whatever it reads.
          const name = `ev${tarCount++}`;
          const t = await run(`tar czf /evidence/${name}.tgz ${tarSrc}`);
          expect(t.map((a) => a.type)).toEqual(['DEF-05']);
        },
      ),
      { numRuns: 50 },
    );
  }, 30_000);
});

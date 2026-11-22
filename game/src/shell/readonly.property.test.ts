// Feature: shell, Property 17: Read-only lines leave the World as it was
// **Validates: Requirements 14.1, 14.2, 15.5**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeFixture } from './test-fixtures/fixture';

const UP = '/srv/juice-shop/uploads';
const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const ACCESS = '/var/log/nginx/access.log';
const APP = '/var/log/juice-shop/app.log';

const READ_TYPES = new Set(['DEF-01', 'DEF-02', 'DEF-03']);

const arbPath = fc.constantFrom(
  '/', '/srv', '/srv/juice-shop', '/var/log', '/var/log/nginx', '/evidence', '/tmp', '~', '..', '.',
  UP, `${UP}/a.php`, `${UP}/d`, `${UP}/d/b.txt`, `${UP}/nope`, DB, ACCESS, APP, '/etc/passwd', '/nowhere',
  '/srv/juice-shop/*', '/var/log/nginx/*', `${UP}/*`, '/evidence/*',
);

const arbSql = fc.constantFrom(
  '"SELECT id, email FROM Users LIMIT 3"',
  '"SELECT count(*) FROM Users"',
  '"SELECT * FROM Nope"',
  '"SELEC broken"',
  '.tables',
  '.schema',
  '".schema Users"',
  '"PRAGMA table_info(Users)"',
);

/** A single command that reads or prints and writes nothing the Shell turns into a world change. */
const arbCommand: fc.Arbitrary<string> = fc.oneof(
  arbPath.map((p) => `ls ${p}`),
  arbPath.map((p) => `ls -la ${p}`),
  arbPath.map((p) => `cd ${p}`),
  fc.constant('pwd'),
  arbPath.map((p) => `cat ${p}`),
  fc.tuple(fc.constantFrom('head', 'tail'), fc.integer({ min: 0, max: 20 }), arbPath).map(([c, n, p]) => `${c} -n ${n} ${p}`),
  fc.tuple(fc.constantFrom('GET', 'POST', '404', 'a', 'x.*y'), arbPath).map(([g, p]) => `grep ${g} ${p}`),
  arbPath.map((p) => `wc -l ${p}`),
  arbPath.map((p) => `file ${p}`),
  arbPath.map((p) => `sha256sum ${p}`),
  arbPath.map((p) => `tar tzf ${p}`),
  arbSql.map((s) => `sqlite3 ${DB} ${s}`),
  arbSql.map((s) => `sqlite3 -header ${DB} ${s}`),
  fc.constantFrom('iptables -L', 'systemctl status nginx', 'systemctl status other', 'date', 'history', 'clear', 'help'),
  fc.constantFrom('ls', 'cat', 'grep', 'sqlite3', 'iptables', 'tar', 'nope').map((c) => `man ${c}`),
  fc.constantFrom('nosuchcmd x', 'sudo ls', 'ls | | cat', "cat 'unterminated", 'ls ; pwd', 'ls $HOME'),
);

const arbFilter = fc.constantFrom('sort', 'uniq', 'wc -l', 'head -n 5', 'cut -d " " -f 1', "awk '{print $1}'", 'grep -v x');

const arbLine: fc.Arbitrary<string> = fc
  .tuple(arbCommand, fc.array(fc.oneof(arbCommand, arbFilter), { maxLength: 3 }))
  .map(([first, rest]) => [first, ...rest].join(' | '));

describe('Property 17: read-only lines leave the World as it was', () => {
  it('changes nothing but DEF-01/02/03 action events, at most one per kind per line', async () => {
    const f = makeFixture({
      plant: [
        { path: 'a.php', content: 'x\ny' },
        { path: 'd/b.txt', content: 'q' },
      ],
      advanceMs: 60_000,
      evidence: ['snap'],
    });

    await fc.assert(
      fc.asyncProperty(arbLine, async (line) => {
        const before = f.worldWithoutReads();
        const eventsBefore = f.world.events.length;
        const clockBefore = structuredClone(f.world.clock);

        await f.shell.run(line);

        expect(f.worldWithoutReads()).toEqual(before);
        expect(f.world.clock).toEqual(clockBefore);

        const added = f.world.events.slice(eventsBefore);
        const types = added.filter((e) => e.kind === 'action').map((e) => e.action.type);
        for (const t of types) expect(READ_TYPES.has(t)).toBe(true);
        for (const t of READ_TYPES) expect(types.filter((x) => x === t).length).toBeLessThanOrEqual(1);
        expect(f.internalErrors).toEqual([]);
      }),
      { numRuns: 50 },
    );
  }, 30_000);
});

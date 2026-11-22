// Feature: shell, Property 5: `run` always resolves with clean text (with-baseline variant, sqlite3-heavy lines)
// **Validates: Requirements 1.1, 1.4, 1.5, 1.9, 1.10, 15.1, 15.2**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMAND_LIST } from './index';
import { makeFixture } from './test-fixtures/fixture';

const TIMEOUT_MS = 30_000;
const DB = '/srv/juice-shop/data/juiceshop.sqlite';

const arbPath = fc.constantFrom(
  DB, `${DB}-journal`, '/srv/juice-shop/data/x.sqlite', '/tmp/x.db', '/tmp', '/nope.db', '/', '~', '', '*.sqlite', '/srv/juice-shop/data/*',
);
const arbSql = fc.constantFrom(
  'SELECT * FROM Users', 'SELECT id, email FROM Users LIMIT 3', 'SELECT count(*) FROM Users', 'SELECT 1', 'SELECT',
  'select * from Nope', 'SELECT * FROM Users WHERE', "SELECT * FROM Users WHERE email LIKE '%admin%'",
  "SELECT * FROM Users WHERE email = 'a'' OR 1=1 --'", 'SELECT * FROM sqlite_master', 'PRAGMA table_info(Users)',
  'PRAGMA foreign_keys=OFF', "UPDATE Users SET role='admin' WHERE id=1", "UPDATE Users SET email='x' WHERE id > 100",
  "UPDATE Users SET nope=1", 'UPDATE Users SET role = role', 'DELETE FROM Users WHERE id=2', 'DELETE FROM Users',
  "DELETE FROM Users WHERE email LIKE '%@%'", "INSERT INTO Users (email) VALUES ('z@z')", 'INSERT INTO Nope VALUES (1)',
  'CREATE TABLE t (a)', 'CREATE TABLE t (a); DROP TABLE t', 'DROP TABLE Users', 'DROP TABLE Nope', 'ALTER TABLE Users ADD COLUMN q',
  'VACUUM', 'ATTACH DATABASE \'/tmp/x\' AS x', 'BEGIN', 'COMMIT', 'ROLLBACK', ';', ';;', '--', '/* c */ SELECT 1',
  '.tables', '.schema', '.schema Users', '.headers on', '.mode csv', '.mode json', '.read /tmp/x', '.shell ls', '.quit', '.help',
  '.dump', '.open /tmp/y', '.bogus', '.', "SELECT '", 'SELECT "', "SELECT '\u00e9\u{1F47B}'", 'SELECT * FROM Users; SELECT 1',
);
const arbFlag = fc.constantFrom('-header', '-csv', '-json', '-line', '-column', '-list', '-readonly', '-version', '-bail', '-cmd', '-init', '-x', '--', '-');
const arbQuote = fc.constantFrom("'", '"');
const quote = (q: string, s: string): string => (s.includes(q) ? s.split(q).join('') : s).replace(/^/, q).concat(q);

const arbSqlite = fc
  .tuple(fc.array(arbFlag, { maxLength: 2 }), arbPath, fc.option(arbSql, { nil: undefined }), arbQuote, fc.boolean())
  .map(([flags, path, sql, q, raw]) => ['sqlite3', ...flags, path, ...(sql === undefined ? [] : [raw ? sql : quote(q, sql)])].filter((x) => x !== '').join(' '));

const arbTail = fc.constantFrom('', ' | head -n 2', ' | wc -l', ' | grep -i a', ' | sort | uniq', ' > /tmp/out.txt', ' > /nope/out', ' > /srv/juice-shop/data/x', " | cut -d '|' -f 1", ' | nosuchcmd');
const arbWord = fc.constantFrom('a', '-l', '-r', '/tmp', '/', DB, "'x y'", '"q', "'", '*', '~', '|', '>', '$HOME', ';', '', 'Users');
const arbListed = fc
  .tuple(fc.constantFrom(...COMMAND_LIST), fc.array(arbWord, { maxLength: 3 }))
  .map(([c, a]) => [c, ...a].join(' '));
const arbJunk = fc.string({ maxLength: 40 });

const arbLine = fc.oneof(
  { weight: 6, arbitrary: fc.tuple(arbSqlite, arbTail).map(([l, t]) => l + t) },
  { weight: 3, arbitrary: arbListed },
  { weight: 1, arbitrary: arbJunk },
);

describe('Property 5 (with baseline): run always resolves with clean text', () => {
  it('resolves { output: string, exitCode: number }, reports no internal error and leaks no stack trace', async () => {
    const fx = makeFixture({ baseline: true });
    await fc.assert(
      fc.asyncProperty(fc.array(arbLine, { minLength: 1, maxLength: 4 }), async (lines) => {
        for (const line of lines) {
          const r = await fx.shell.run(line);
          expect(typeof r.output).toBe('string');
          expect(typeof r.exitCode).toBe('number');
          expect(r.output).not.toMatch(/(^|\n)\s*at /);
          expect(r.output).not.toContain('[object');
          expect(fx.internalErrors).toEqual([]);
        }
      }),
      { numRuns: 50 },
    );
  }, TIMEOUT_MS);
});

// sqlite3 read tests (task 10.4; R7.1, R7.2, R7.7-R7.9, R7.12-R7.17, R7.21, R16.1, R16.2).
// Lock and delete tests (task 11.3) are at the end. Never print a locked account's deletedAt (KI-91): every query here picks columns.
import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const READONLY = 'Error: attempt to write a readonly database';

describe('sqlite3 SELECT output (R7.1, R7.12)', () => {
  it('joins columns with | and prints NULL as empty', async () => {
    const { shell } = makeFixture();
    const r = await shell.run(`sqlite3 ${DB} "SELECT 1, NULL, 'a'; SELECT 'x', NULL, NULL"`);
    expect(r).toEqual({ output: '1||a\nx||', exitCode: 0 });
  }, 30_000);

  it('reads real rows from the baseline', async () => {
    const { shell } = makeFixture();
    const r = await shell.run(`sqlite3 ${DB} "SELECT count(*) FROM Users"`);
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/^[1-9]\d*$/);
  }, 30_000);

  it('-header prints the column names first', async () => {
    const { shell } = makeFixture();
    const r = await shell.run(`sqlite3 -header ${DB} "SELECT id, email, NULL AS n FROM Users ORDER BY id LIMIT 2"`);
    const lines = r.output.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('id|email|n');
    expect(lines[1]).toMatch(/^\d+\|[^|]+\|$/);
  }, 30_000);

  it('-header with no rows prints nothing', async () => {
    const { shell } = makeFixture();
    expect(await shell.run(`sqlite3 -header ${DB} "SELECT id FROM Users WHERE 0"`)).toEqual({ output: '', exitCode: 0 });
  }, 30_000);
});

describe('sqlite3 .tables and .schema (R7.13, R7.14, R7.16)', () => {
  it('.tables lists table names ascending, two spaces apart, on one line', async () => {
    const { shell } = makeFixture();
    const r = await shell.run(`sqlite3 ${DB} .tables`);
    expect(r.exitCode).toBe(0);
    expect(r.output).not.toContain('\n');
    const names = r.output.split('  ');
    expect(names).toContain('Users');
    expect(names).toEqual([...names].sort());
  }, 30_000);

  it('.schema of a table prints its CREATE statement ending with ;', async () => {
    const { shell } = makeFixture();
    const r = await shell.run(`sqlite3 ${DB} ".schema Users"`);
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/^CREATE TABLE `?Users`?/i);
    expect(r.output.trimEnd().endsWith(';')).toBe(true);
    expect(r.output).not.toContain('CREATE TABLE `Wallets`');
  }, 30_000);

  it('.schema with no table prints every CREATE statement, each ending with ;', async () => {
    const { shell } = makeFixture();
    const r = await shell.run(`sqlite3 ${DB} .schema`);
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('Users');
    expect(r.output).toContain('Wallets');
    for (const line of r.output.split('\n').filter((l) => /^CREATE /i.test(l))) expect(line).toMatch(/[;(,]$|\)$/);
    expect(r.output.trimEnd().endsWith(';')).toBe(true);
  }, 30_000);

  it('.schema of an unknown table prints nothing and succeeds', async () => {
    const { shell } = makeFixture();
    expect(await shell.run(`sqlite3 ${DB} ".schema NoSuchTable"`)).toEqual({ output: '', exitCode: 0 });
  }, 30_000);
});

describe('sqlite3 DEF-02 once per line (R7.2, R7.16, R7.17)', () => {
  it('a SELECT sends one DEF-02 carrying the SQL', async () => {
    const f = makeFixture();
    await f.shell.run(`sqlite3 ${DB} "SELECT 1"`);
    // The logged event keeps the D-122 summary of `shown`, not the text.
    expect(f.actsOfType('DEF-02')).toMatchObject([{ type: 'DEF-02', sql: 'SELECT 1', shownCount: 1, shownTotal: 1 }]);
  }, 30_000);

  it('.tables and .schema each send one DEF-02', async () => {
    const f = makeFixture();
    await f.shell.run(`sqlite3 ${DB} .tables`);
    await f.shell.run(`sqlite3 ${DB} .schema`);
    expect(f.actsOfType('DEF-02')).toMatchObject([
      { type: 'DEF-02', sql: '.tables', shownCount: 1, shownTotal: 1 },
      { type: 'DEF-02', sql: '.schema', shownTotal: expect.any(Number) },
    ]);
  }, 30_000);

  it('a two-statement line sends one DEF-02 with the first SQL', async () => {
    const f = makeFixture();
    const r = await f.shell.run(`sqlite3 ${DB} "SELECT 1; SELECT 2"`);
    expect(r.output).toBe('1\n2');
    expect(f.actsOfType('DEF-02')).toMatchObject([{ type: 'DEF-02', sql: 'SELECT 1', shownCount: 2, shownTotal: 2 }]);
  }, 30_000);

  it('a pipeline of two sqlite3 stages sends one DEF-02', async () => {
    const f = makeFixture();
    await f.shell.run(`sqlite3 ${DB} "SELECT 1" | sqlite3 ${DB} "SELECT 2"`);
    expect(f.actsOfType('DEF-02')).toHaveLength(1);
  }, 30_000);
});

describe('sqlite3 errors send no action (R7.7, R7.8, R7.9, R7.15, R7.17, R7.21, R16.1)', () => {
  it('invalid SQL prints Error: <message>', async () => {
    const f = makeFixture();
    const r = await f.shell.run(`sqlite3 ${DB} "SELECT * FROM nope"`);
    expect(r).toEqual({ output: 'Error: no such table: nope', exitCode: 1 });
    expect(f.actions()).toHaveLength(0);
  }, 30_000);

  it('text that is not a statement prints the SQLite syntax error, not the read-only error', async () => {
    const f = makeFixture();
    const r = await f.shell.run(`sqlite3 ${DB} "selec 1"`);
    expect(r.output).toBe('Error: near "selec": syntax error');
    expect(r.exitCode).toBe(1);
    expect(f.actions()).toHaveLength(0);
  }, 30_000);

  it('a wrong path prints unable to open database file', async () => {
    const f = makeFixture();
    const r = await f.shell.run('sqlite3 /tmp/x.sqlite "SELECT 1"');
    expect(r).toEqual({ output: 'unable to open database file', exitCode: 1 });
    expect(f.actions()).toHaveLength(0);
  }, 30_000);

  it('a relative path to the database works from the data directory', async () => {
    const f = makeFixture();
    await f.shell.run('cd /srv/juice-shop/data');
    expect((await f.shell.run('sqlite3 juiceshop.sqlite "SELECT 7"')).output).toBe('7');
  }, 30_000);

  it('no SQL argument is an error', async () => {
    const f = makeFixture();
    const r = await f.shell.run(`sqlite3 ${DB}`);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('missing SQL argument');
    expect(f.actions()).toHaveLength(0);
  }, 30_000);

  it('an unsupported dot-command is an error', async () => {
    const f = makeFixture();
    const r = await f.shell.run(`sqlite3 ${DB} .dump`);
    expect(r).toEqual({ output: "sqlite3: unsupported command '.dump'", exitCode: 1 });
    expect(f.actions()).toHaveLength(0);
  }, 30_000);

  it('multiple statements stop at the first error and keep earlier output (stderr is shown first)', async () => {
    const f = makeFixture();
    const r = await f.shell.run(`sqlite3 ${DB} "SELECT 1; SELECT * FROM nope; SELECT 3"`);
    expect(r).toEqual({ output: 'Error: no such table: nope\n1', exitCode: 1 });
    // `shown` is the final stdout only; the stderr line is not counted.
    expect(f.actsOfType('DEF-02')).toMatchObject([{ type: 'DEF-02', sql: 'SELECT 1', shownCount: 1, shownTotal: 1 }]);
  }, 30_000);

  it('an Engine without a baseline prints Error: database is unavailable', async () => {
    const f = makeFixture({ baseline: false });
    for (const sql of ['"SELECT 1"', '.tables', '.schema']) {
      expect(await f.shell.run(`sqlite3 ${DB} ${sql}`)).toEqual({ output: 'Error: database is unavailable', exitCode: 1 });
    }
    expect(f.actions()).toHaveLength(0);
  }, 30_000);

  it('an unsupported flag prints the R5.19 text', async () => {
    const f = makeFixture();
    const r = await f.shell.run(`sqlite3 -z ${DB} "SELECT 1"`);
    expect(r.output).toBe(
      "sqlite3: unsupported flag '-z'\nsqlite3: usage: sqlite3 [-header] <db-path> <sql>",
    );
    expect(r.exitCode).toBe(1);
    expect(f.actions()).toHaveLength(0);
  }, 30_000);
});

describe('sqlite3 lock and delete (R7.3, R7.4, R7.5, R7.10, R7.11, R7.19, R7.20, R16.2)', () => {
  const lock = (where: string) => `sqlite3 ${DB} "UPDATE Users SET deletedAt = datetime('now') WHERE ${where}"`;
  const dbBytes = async (f: ReturnType<typeof makeFixture>) => Buffer.from((await f.engine.db()).db.export());
  const noDate = /\d{4}-\d{2}-\d{2}/; // KI-91: a locked account's deletedAt is never printed

  it('UPDATE sends DEF-08 for each matched row and locks it in the World', async () => {
    const f = makeFixture();
    const lockedBefore = f.world.accounts.filter((a) => a.lockedAt !== undefined).length; // chris.pike is locked in the baseline
    const r = await f.shell.run(lock("email = 'jim@juice-sh.op'"));
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(f.actsOfType('DEF-08')).toEqual([{ type: 'DEF-08', email: 'jim@juice-sh.op' }]);
    expect(f.world.accounts.find((a) => a.email === 'jim@juice-sh.op')?.lockedAt).toBeDefined();
    expect(f.world.accounts.filter((a) => a.lockedAt !== undefined)).toHaveLength(lockedBefore + 1);
    expect(f.actsOfType('DEF-02')).toEqual([]); // the probe sends no DEF-02 (R7.5)
    expect(r.output).not.toMatch(noDate);
  }, 30_000);

  it('DELETE sends DEF-14 for each matched row and removes it from the World', async () => {
    const f = makeFixture();
    const before = f.world.accounts.length;
    const r = await f.shell.run(`sqlite3 ${DB} "DELETE FROM Users WHERE email IN ('jim@juice-sh.op', 'amy@juice-sh.op')"`);
    expect(r).toEqual({ output: '', exitCode: 0 });
    // One DEF-14 per matched row, in the order SQLite returns them (no order is specified).
    expect(f.actsOfType('DEF-14').map((a) => a.email).sort()).toEqual(['amy@juice-sh.op', 'jim@juice-sh.op']);
    expect(f.world.accounts).toHaveLength(before - 2);
    expect(f.world.accounts.some((a) => a.email === 'jim@juice-sh.op' || a.email === 'amy@juice-sh.op')).toBe(false);
    expect(f.actsOfType('DEF-02')).toEqual([]);
  }, 30_000);

  it('UPDATE with no WHERE matches every row, skipping the one already locked in the baseline', async () => {
    const f = makeFixture();
    const open = Number((await f.shell.run(`sqlite3 ${DB} "SELECT count(*) FROM Users WHERE deletedAt IS NULL"`)).output);
    const total = Number((await f.shell.run(`sqlite3 ${DB} "SELECT count(*) FROM Users"`)).output);
    expect(open).toBeGreaterThan(1);
    expect(open).toBeLessThan(total); // chris.pike is locked in the baseline
    const r = await f.shell.run(`sqlite3 ${DB} "UPDATE Users SET deletedAt = datetime('now')"`);
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(f.actsOfType('DEF-08')).toHaveLength(open);
    expect(f.actsOfType('DEF-08').some((a) => a.email === 'chris.pike@juice-sh.op')).toBe(false);
  }, 30_000);

  it('DELETE with no WHERE matches every row', async () => {
    const f = makeFixture();
    const total = Number((await f.shell.run(`sqlite3 ${DB} "SELECT count(*) FROM Users"`)).output);
    const r = await f.shell.run(`sqlite3 ${DB} "DELETE FROM Users"`);
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(f.actsOfType('DEF-14')).toHaveLength(total);
    expect(f.world.accounts).toHaveLength(0);
  }, 30_000);

  it('locking twice acts once: the second statement sees the row as locked and skips it', async () => {
    const f = makeFixture();
    expect((await f.shell.run(lock("email = 'jim@juice-sh.op'"))).output).toBe('');
    const r = await f.shell.run(lock("email = 'jim@juice-sh.op'"));
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(f.actsOfType('DEF-08')).toHaveLength(1);
  }, 30_000);

  it('an already locked row in the baseline is skipped with no action', async () => {
    const f = makeFixture();
    const r = await f.shell.run(lock("email = 'chris.pike@juice-sh.op'"));
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(f.actions()).toHaveLength(0);
  }, 30_000);

  it('an ok: false answer prints its message and the loop goes on (lock)', async () => {
    const f = makeFixture();
    const real = f.engine.act.bind(f.engine);
    const act = vi.spyOn(f.engine, 'act').mockImplementation((a) =>
      a.type === 'DEF-08' && a.email !== 'amy@juice-sh.op' ? { ok: false, message: `No account ${a.email}` } : real(a),
    );
    const r = await f.shell.run(lock('id IN (2, 3, 11)'));
    expect(r).toEqual({ output: 'No account jim@juice-sh.op\nNo account bender@juice-sh.op', exitCode: 1 });
    expect(act.mock.calls.map(([a]) => a)).toEqual([
      { type: 'DEF-08', email: 'jim@juice-sh.op' },
      { type: 'DEF-08', email: 'bender@juice-sh.op' },
      { type: 'DEF-08', email: 'amy@juice-sh.op' },
    ]);
    expect(f.world.accounts.find((a) => a.email === 'amy@juice-sh.op')?.lockedAt).toBeDefined();
    expect(f.world.accounts.find((a) => a.email === 'jim@juice-sh.op')?.lockedAt).toBeUndefined();
  }, 30_000);

  it('an ok: false answer prints its message and the loop goes on (delete)', async () => {
    const f = makeFixture();
    const real = f.engine.act.bind(f.engine);
    const act = vi.spyOn(f.engine, 'act').mockImplementation((a) =>
      a.type === 'DEF-14' && a.email === 'jim@juice-sh.op' ? { ok: false, message: `No account ${a.email}` } : real(a),
    );
    const r = await f.shell.run(`sqlite3 ${DB} "DELETE FROM Users WHERE id IN (2, 11)"`);
    expect(r).toEqual({ output: 'No account jim@juice-sh.op', exitCode: 1 });
    expect(act).toHaveBeenCalledTimes(2);
    expect(f.world.accounts.some((a) => a.email === 'amy@juice-sh.op')).toBe(false);
    expect(f.world.accounts.some((a) => a.email === 'jim@juice-sh.op')).toBe(true);
  }, 30_000);

  it('zero matches prints nothing and sends no action', async () => {
    const f = makeFixture();
    expect(await f.shell.run(lock('0'))).toEqual({ output: '', exitCode: 0 });
    expect(await f.shell.run(`sqlite3 ${DB} "DELETE FROM Users WHERE id < 0"`)).toEqual({ output: '', exitCode: 0 });
    expect(f.actions()).toHaveLength(0);
  }, 30_000);

  it('a later statement on the same line reads the Engine state fresh (a locked row shows)', async () => {
    const f = makeFixture();
    const r = await f.shell.run(
      `sqlite3 ${DB} "UPDATE Users SET deletedAt = datetime('now') WHERE id = 2; SELECT deletedAt IS NOT NULL FROM Users WHERE id = 2"`,
    );
    expect(r).toEqual({ output: '1', exitCode: 0 });
  }, 30_000);

  const REFUSED = [
    "INSERT INTO Users (email) VALUES ('x')",
    'DROP TABLE Users',
    'ALTER TABLE Users ADD COLUMN x TEXT',
    'CREATE TABLE t (a INT)',
    "UPDATE Wallets SET deletedAt = 'x'",
    'DELETE FROM Wallets',
    "UPDATE Users SET email = 'x@y.z'",
    'UPDATE Users SET deletedAt = NULL',
    "UPDATE Users SET deletedAt = ''",
    "UPDATE Users SET deletedAt = '' WHERE id = 2",
    'UPDATE Users SET deletedAt = NULL WHERE id = 2',
    "UPDATE Users SET deletedAt = datetime('now') RETURNING id",
    "UPDATE Users SET deletedAt = datetime('now') WHERE id = 2 LIMIT 1",
    'DELETE FROM Users LIMIT 1',
    'DELETE FROM Users WHERE id = 2 RETURNING id',
    "UPDATE Users AS u SET deletedAt = datetime('now')",
    'DELETE FROM Users u WHERE u.id = 2',
    "UPDATE OR REPLACE Users SET deletedAt = datetime('now')",
  ];

  it.each(REFUSED)('%s is refused with no action and an unchanged Game_DB', async (sql) => {
    const f = makeFixture();
    const before = f.worldWithoutReads();
    const bytes = await dbBytes(f);
    const r = await f.shell.run(`sqlite3 ${DB} "${sql}"`);
    expect(r).toEqual({ output: READONLY, exitCode: 1 });
    expect(f.actions()).toHaveLength(0);
    expect(f.worldWithoutReads()).toEqual(before);
    expect((await dbBytes(f)).equals(bytes)).toBe(true);
  }, 30_000);

  it('after a lock the Game_DB shows deletedAt set, by the Engine mirroring DEF-08 (not by the Shell)', async () => {
    const f = makeFixture();
    await f.shell.run(lock("email = 'jim@juice-sh.op'"));
    const sql = "SELECT count(*) FROM Users WHERE deletedAt IS NOT NULL AND email = 'jim@juice-sh.op'";
    expect((await f.shell.run(`sqlite3 ${DB} "${sql}"`)).output).toBe('1'); // set by the Engine's DEF-08 mirror
    expect(f.actsOfType('DEF-08')).toHaveLength(1);
  }, 30_000);

  it('a refusal midway stops the line; earlier statements keep their effect', async () => {
    const f = makeFixture();
    const r = await f.shell.run(`sqlite3 ${DB} "DELETE FROM Users WHERE id = 2; DROP TABLE Users; DELETE FROM Users WHERE id = 3"`);
    expect(r).toEqual({ output: READONLY, exitCode: 1 });
    expect(f.actsOfType('DEF-14')).toEqual([{ type: 'DEF-14', email: 'jim@juice-sh.op' }]);
  }, 30_000);
});

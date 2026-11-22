// Feature: shell, Property 22: Refused and invalid SQL changes nothing
// **Validates: Requirements 7.6, 7.7, 7.8, 7.9, 7.15**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const READONLY = 'Error: attempt to write a readonly database';

const arbIdent = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);

// Writes the Shell must refuse (everything except a lock or delete on Users). No WHERE, so every Users row matches
// and a NULL or '' expression is always caught.
const arbRefusedWrite = fc.oneof(
  arbIdent.map((t) => `INSERT INTO ${t} VALUES (1)`),
  fc.constant("INSERT INTO Users (email) VALUES ('x@y.z')"),
  arbIdent.map((t) => `DROP TABLE ${t}`),
  fc.constant('DROP TABLE Users'),
  arbIdent.map((t) => `ALTER TABLE ${t} ADD COLUMN c TEXT`),
  fc.constant('ALTER TABLE Users ADD COLUMN c TEXT'),
  arbIdent.map((t) => `CREATE TABLE ${t} (a INTEGER)`),
  arbIdent.map((t) => `UPDATE t_${t} SET deletedAt = 1`),
  arbIdent.map((t) => `DELETE FROM t_${t}`),
  arbIdent.map((c) => `UPDATE Users SET c_${c} = 1`),
  fc.constantFrom("UPDATE Users SET email = 'x'", "UPDATE Users SET role = 'admin'", "UPDATE Users SET password = 'x'"),
  fc.constantFrom(
    'UPDATE Users SET deletedAt = NULL',
    "UPDATE Users SET deletedAt = ''",
    'UPDATE Users SET deletedAt = NULL WHERE id > 0',
    "UPDATE Users SET deletedAt = '' WHERE id > 0",
    'UPDATE Users SET deletedAt = NULL RETURNING id',
    "UPDATE Users SET deletedAt = datetime('now') LIMIT 1",
    "UPDATE Users SET deletedAt = datetime('now') RETURNING id",
    "UPDATE Users SET deletedAt = datetime('now') ORDER BY id",
    "UPDATE Users SET deletedAt = datetime('now'), email = 'x'",
    'DELETE FROM Users RETURNING id',
    'DELETE FROM Users LIMIT 1',
    'DELETE FROM Users AS u',
  ),
);

// Strings SQLite cannot compile: an unknown first word, or a malformed SELECT.
const arbInvalidSql = fc.oneof(
  arbIdent.map((w) => `selec ${w}`),
  arbIdent.map((w) => `zz${w} * FROM Users`),
  arbIdent.map((t) => `SELECT * FROM nope_${t}`),
  arbIdent.map((c) => `SELECT nocol_${c} FROM Users`),
  fc.constantFrom('SELECT FROM', 'SELECT * FROM', 'SELECT (1', "SELECT 'abc", 'SELECT 1 +', 'SELECT * FROM Users WHERE'),
);

const arbWrongPath = fc.oneof(
  fc.constantFrom('/tmp/x.sqlite', '/srv/juice-shop/data', '/srv/juice-shop/data/other.sqlite', 'nope.sqlite', '/'),
  arbIdent.map((n) => `/tmp/${n}.sqlite`),
);

const arbDotCommand = fc.oneof(
  fc.constantFrom('.dump', '.mode csv', '.headers on', '.quit', '.read x.sql', '.import a b', '.tables a b', '.schema a b'),
  arbIdent.map((n) => `.${n}x`),
);

type Case = { line: string; check: (r: { output: string; exitCode?: number }) => void };

const refused = arbRefusedWrite.map(
  (sql): Case => ({ line: `sqlite3 ${DB} "${sql}"`, check: (r) => expect(r).toEqual({ output: READONLY, exitCode: 1 }) }),
);
const invalid = arbInvalidSql.map(
  (sql): Case => ({
    line: `sqlite3 ${DB} "${sql}"`,
    check: (r) => {
      expect(r.output).toMatch(/^Error: /);
      expect(r.output).not.toBe(READONLY);
      expect(r.exitCode).toBe(1);
    },
  }),
);
const wrongPath = fc.tuple(arbWrongPath, fc.constantFrom('SELECT 1', "UPDATE Users SET deletedAt = 'x'", 'DROP TABLE Users')).map(
  ([p, sql]): Case => ({
    line: `sqlite3 ${p} "${sql}"`,
    check: (r) => expect(r).toEqual({ output: 'unable to open database file', exitCode: 1 }),
  }),
);
const missingSql = fc.constantFrom(`sqlite3 ${DB}`, `sqlite3 -header ${DB}`).map(
  (line): Case => ({
    line,
    check: (r) => {
      expect(r.exitCode).toBe(1);
      expect(r.output).not.toBe('');
    },
  }),
);
const dotCommand = arbDotCommand.map(
  (c): Case => ({
    line: `sqlite3 ${DB} '${c}'`,
    check: (r) => {
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatch(/^sqlite3: unsupported command/);
    },
  }),
);

describe('Property 22: refused and invalid SQL changes nothing', () => {
  it('prints the error, sends no action and leaves the World and the Game_DB unchanged', async () => {
    const { shell, engine, actions, worldWithoutReads } = makeFixture();
    const act = vi.spyOn(engine, 'act');
    const dbBytes = async (): Promise<Uint8Array> => (await engine.db()).db.export();
    const baseline = await dbBytes();
    await fc.assert(
      fc.asyncProperty(fc.oneof(refused, invalid, wrongPath, missingSql, dotCommand), async ({ line, check }) => {
        const world = structuredClone(worldWithoutReads());
        const before = await dbBytes();
        const r = await shell.run(line);
        check(r);
        expect(act).not.toHaveBeenCalled();
        expect(actions()).toHaveLength(0);
        expect(worldWithoutReads()).toEqual(world);
        expect(Buffer.from(await dbBytes()).equals(Buffer.from(before))).toBe(true);
      }),
      { numRuns: 50 },
    );
    expect(Buffer.from(await dbBytes()).equals(Buffer.from(baseline))).toBe(true);
  }, 30_000);

  it('an Engine without a baseline prints that the database is unavailable and does not throw', async () => {
    const { shell, actions } = makeFixture({ baseline: false });
    await fc.assert(
      fc.asyncProperty(arbRefusedWrite, arbInvalidSql, async (w, bad) => {
        for (const sql of [w, bad, 'SELECT 1']) {
          const r = await shell.run(`sqlite3 ${DB} "${sql}"`);
          expect(r).toEqual({ output: 'Error: database is unavailable', exitCode: 1 });
        }
        expect(actions()).toHaveLength(0);
      }),
      { numRuns: 50 },
    );
  }, 30_000);
});

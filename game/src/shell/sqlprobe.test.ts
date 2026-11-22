// Requirements 7.17, 7.18 (D-103). Task 11.3 appends the parseWrite tests.
import { describe, expect, it } from 'vitest';
import { buildProbe, classifyStatement, parseWrite, scanSql, splitStatements } from './sqlprobe';

describe('splitStatements', () => {
  it('cuts on semicolons and trims the pieces', () => {
    expect(splitStatements('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('keeps a semicolon inside each kind of quote', () => {
    expect(splitStatements("SELECT 'a;b'")).toEqual(["SELECT 'a;b'"]);
    expect(splitStatements('SELECT "a;b"')).toEqual(['SELECT "a;b"']);
    expect(splitStatements('SELECT `a;b`')).toEqual(['SELECT `a;b`']);
    expect(splitStatements('SELECT [a;b] FROM t')).toEqual(['SELECT [a;b] FROM t']);
  });

  it('keeps a semicolon inside comments', () => {
    expect(splitStatements('SELECT 1 -- a;b\n, 2')).toHaveLength(1);
    expect(splitStatements('SELECT 1 /* a;b */, 2')).toHaveLength(1);
  });

  it('keeps a semicolon inside parentheses', () => {
    expect(splitStatements('SELECT (1;2); SELECT 3')).toEqual(['SELECT (1;2)', 'SELECT 3']);
  });

  it('drops empty and comment-only pieces', () => {
    expect(splitStatements(';; SELECT 1;; ;')).toEqual(['SELECT 1']);
    expect(splitStatements('-- nothing\n; /* x */ ;')).toEqual([]);
    expect(splitStatements('')).toEqual([]);
  });
});

describe('scanSql', () => {
  it('flags an unterminated quote or block comment', () => {
    expect(scanSql("SELECT 'abc").unterminated).toBe(true);
    expect(scanSql('SELECT 1 /* abc').unterminated).toBe(true);
    expect(scanSql("SELECT 'abc'").unterminated).toBe(false);
  });

  it('records parenthesis depth and ignores comment text', () => {
    const { tokens } = scanSql('a (b -- c\n)');
    const words = tokens.filter((t) => t.kind === 'word').map((t) => [t.text, t.depth]);
    expect(words).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});

describe('classifyStatement', () => {
  it.each([
    'SELECT 1',
    'select * from Users',
    '  \n SELECT 1',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'VALUES (1), (2)',
    'PRAGMA table_info(Users)',
    'PRAGMA table_xinfo(Users)',
    'PRAGMA index_list(Users)',
    'PRAGMA foreign_key_list(Users)',
    'PRAGMA database_list',
    'pragma main.table_info(Users)',
  ])('reads %s', (sql) => {
    expect(classifyStatement(sql)).toBe('read');
  });

  it.each(['PRAGMA table_info = 1', 'PRAGMA foreign_keys = OFF', 'PRAGMA journal_mode', 'PRAGMA'])(
    'refuses %s',
    (sql) => {
      expect(classifyStatement(sql)).toBe('refused');
    },
  );

  it('keeps a write keyword in a string, comment or quoted name as a read', () => {
    expect(classifyStatement("SELECT 'DELETE FROM Users'")).toBe('read');
    expect(classifyStatement('SELECT 1 -- DROP TABLE Users')).toBe('read');
    expect(classifyStatement('SELECT 1 /* INSERT */')).toBe('read');
    expect(classifyStatement('SELECT "UPDATE" FROM t')).toBe('read');
    expect(classifyStatement("WITH x AS (SELECT 'DROP') SELECT * FROM x")).toBe('read');
  });

  it('refuses a WITH that contains a write, at any depth', () => {
    expect(classifyStatement('WITH x AS (SELECT 1) DELETE FROM Users')).toBe('refused');
    expect(classifyStatement('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x')).toBe('refused');
    expect(classifyStatement('WITH x AS (DELETE FROM Users RETURNING *) SELECT * FROM x')).toBe('refused');
  });

  it('refuses other writes, empty input and non-statements', () => {
    for (const sql of ['INSERT INTO t VALUES (1)', 'DROP TABLE Users', 'ALTER TABLE t ADD c', 'CREATE TABLE t(a)', '', '-- x', "'SELECT'", '(SELECT 1)']) {
      expect(classifyStatement(sql)).toBe('refused');
    }
  });

  it('recognises the lock and delete forms lightly', () => {
    expect(classifyStatement("UPDATE Users SET deletedAt = 'x' WHERE id = 1")).toBe('lock');
    expect(classifyStatement('update users set deletedat = 1')).toBe('lock');
    expect(classifyStatement('DELETE FROM Users WHERE id = 1')).toBe('delete');
    expect(classifyStatement('delete from users')).toBe('delete');
  });

  it('does not recognise a lock or delete on another table or column', () => {
    expect(classifyStatement('UPDATE Orders SET deletedAt = 1')).toBe('refused');
    expect(classifyStatement('UPDATE Users SET email = 1')).toBe('refused');
    expect(classifyStatement('DELETE FROM Orders')).toBe('refused');
    expect(classifyStatement('DELETE Users')).toBe('refused');
  });
});

// Task 11.3: parseWrite and buildProbe (R7.5, R7.6, R7.19; D-103).
describe('parseWrite', () => {
  it('recognizes a lock with and without WHERE, case-insensitively', () => {
    expect(parseWrite("UPDATE Users SET deletedAt = datetime('now') WHERE id = 3")).toEqual({
      kind: 'lock',
      expr: "datetime('now')",
      where: 'id = 3',
    });
    expect(parseWrite("update users set DELETEDAT = 'x'")).toEqual({ kind: 'lock', expr: "'x'" });
    expect(parseWrite('UPDATE `Users` SET "deletedAt" = 1')).toEqual({ kind: 'lock', expr: '1' });
    expect(parseWrite('UPDATE [Users] SET deletedAt = 1 WHERE (id) = (2)')).toEqual({
      kind: 'lock',
      expr: '1',
      where: '(id) = (2)',
    });
  });

  it('recognizes a delete with and without WHERE', () => {
    expect(parseWrite('DELETE FROM Users')).toEqual({ kind: 'delete' });
    expect(parseWrite('delete from "Users" where email like \'%x%\'')).toEqual({
      kind: 'delete',
      where: "email like '%x%'",
    });
  });

  it('keeps a WHERE keyword inside a string or parentheses in the expression', () => {
    expect(parseWrite("UPDATE Users SET deletedAt = 'a WHERE b' WHERE id = 1")).toEqual({
      kind: 'lock',
      expr: "'a WHERE b'",
      where: 'id = 1',
    });
    expect(parseWrite('UPDATE Users SET deletedAt = (SELECT 1 WHERE 1) WHERE id = 1')).toMatchObject({
      kind: 'lock',
      expr: '(SELECT 1 WHERE 1)',
    });
  });

  it.each([
    ["INSERT INTO Users (email) VALUES ('x')"],
    ['DROP TABLE Users'],
    ['UPDATE Wallets SET deletedAt = 1'],
    ["UPDATE Users SET email = 'x'"],
    ['UPDATE Users SET deletedAt = 1, email = 2'],
    ['UPDATE OR REPLACE Users SET deletedAt = 1'],
    ['UPDATE Users AS u SET deletedAt = 1'],
    ['UPDATE Users SET deletedAt = 1 RETURNING id'],
    ['UPDATE Users SET deletedAt = 1 LIMIT 1'],
    ['UPDATE Users SET deletedAt = 1 ORDER BY id'],
    ['UPDATE Users SET deletedAt = 1 FROM Other'],
    ['UPDATE Users SET deletedAt = 1 WHERE id = 1 RETURNING id'],
    ['UPDATE Users SET deletedAt = 1 WHERE id = 1 LIMIT 1'],
    ['UPDATE Users SET deletedAt ='],
    ['UPDATE Users SET deletedAt = 1 WHERE'],
    ['DELETE FROM Wallets'],
    ['DELETE FROM Users u'],
    ['DELETE FROM Users LIMIT 1'],
    ['DELETE FROM Users WHERE id = 1 RETURNING id'],
    ['DELETE Users'],
    ["UPDATE Users SET deletedAt = 'x"],
    ['UPDATE Users SET deletedAt = 1 /* WHERE id = 1'],
    ['UPDATE Users SET deletedAt = (1'],
    ['UPDATE Users SET deletedAt = 1)'],
    ['DELETE FROM Users WHERE (id = 1'],
    ['SELECT 1'],
    [''],
  ])('refuses %s', (sql) => {
    expect(parseWrite(sql).kind).toBe('refused');
  });
});

describe('buildProbe', () => {
  it('a lock probe adds the expression column and wraps WHERE', () => {
    const w = parseWrite("UPDATE Users SET deletedAt = datetime('now') WHERE id = 3 OR id = 4");
    if (w.kind !== 'lock') throw new Error('expected lock');
    expect(buildProbe(w)).toBe("SELECT id, email, deletedAt, (datetime('now')) FROM Users WHERE (id = 3 OR id = 4)");
  });

  it('a delete probe has no expression column; no WHERE selects every row', () => {
    const w = parseWrite('DELETE FROM Users');
    if (w.kind !== 'delete') throw new Error('expected delete');
    expect(buildProbe(w)).toBe('SELECT id, email, deletedAt FROM Users');
  });

  it('a -- comment cannot swallow the closing parenthesis', () => {
    const w = parseWrite('DELETE FROM Users WHERE id = 1 -- c\nOR id = 2');
    if (w.kind !== 'delete') throw new Error('expected delete');
    expect(buildProbe(w)).toBe('SELECT id, email, deletedAt FROM Users WHERE (\nid = 1 -- c\nOR id = 2\n)');
  });
});

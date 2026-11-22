// Database command: sqlite3 reads (PRD SYS-09, DEF-02; R7.1, R7.2, R7.7, R7.8, R7.9, R7.12-R7.17, R7.21; D-92, D-98, D-103).
// Lock (UPDATE ... deletedAt) and delete (DELETE FROM Users) run a read-only probe and send DEF-08 / DEF-14 per
// matched row; the write itself never runs on the Engine's database (R7.3-R7.6, R7.10, R7.11, R7.19, R7.20; D-92).

import type { GameDb } from '../../engine/sqldb';
import { parseArgs } from '../argparse';
import { MSG, fail, ok, unsupportedFlag, usage } from '../output';
import { resolvePath } from '../path';
import type { PlayerAction } from '../../engine/actions';
import { buildProbe, classifyStatement, parseWrite, splitStatements } from '../sqlprobe';
import type { CommandResult, Handler } from '../types';

const DB_PATH = '/srv/juice-shop/data/juiceshop.sqlite';

type Cell = string | number | Uint8Array | null;

/** First words that are real SQL statements; anything else is invalid SQL, not a write (R7.7, R7.21). */
const STATEMENT_KEYWORDS = new Set([
  'INSERT', 'REPLACE', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'PRAGMA', 'ATTACH', 'DETACH', 'VACUUM',
  'REINDEX', 'ANALYZE', 'BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'EXPLAIN',
]);

function isUnknownStatement(statement: string): boolean {
  const word = /^[A-Za-z_]+/.exec(statement.trimStart())?.[0];
  return word === undefined || !STATEMENT_KEYWORDS.has(word.toUpperCase());
}

const blobDecoder = new TextDecoder();

function cellText(v: Cell): string {
  if (v === null) return '';
  if (v instanceof Uint8Array) return blobDecoder.decode(v);
  return String(v);
}

/** Rows as `|`-joined lines; NULL is empty. `columns` adds a first row when given. */
function formatRows(columns: string[] | undefined, rows: Cell[][]): string {
  const lines = rows.map((r) => r.map(cellText).join('|'));
  if (columns !== undefined && rows.length > 0) lines.unshift(columns.join('|'));
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function runQuery(g: GameDb, sql: string, params: string[] = []): { columns: string[]; values: Cell[][] } {
  const stmt = g.db.prepare(sql);
  try {
    stmt.bind(params);
    const columns = stmt.getColumnNames();
    const values: Cell[][] = [];
    while (stmt.step()) values.push(stmt.get() as Cell[]);
    return { columns, values };
  } finally {
    stmt.free();
  }
}

export const sqlite3: Handler = async (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) {
    return parsed.kind === 'unsupported' ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);
  }
  const header = parsed.flags.has('-header');
  const [dbPath, sqlArg, ...extra] = parsed.operands;
  if (dbPath === undefined || extra.length > 0) return usage(ctx.spec);

  if (resolvePath(ctx.session.cwd, dbPath) !== DB_PATH) {
    return { stdout: '', stderr: `${MSG.sqlCannotOpen}\n`, code: 1 };
  }
  if (sqlArg === undefined) return fail('sqlite3', 'missing SQL argument');

  let stdout = '';
  const stop = (message: string): CommandResult => ({ stdout, stderr: `${message}\n`, code: 1 });

  // Dot-commands: only .tables and .schema (R7.13, R7.14, R7.15, R7.16).
  const trimmed = sqlArg.trim();
  if (trimmed.startsWith('.')) {
    const [command, ...rest] = trimmed.split(/\s+/);
    if ((command !== '.tables' || rest.length > 0) && (command !== '.schema' || rest.length > 1)) {
      return fail('sqlite3', `unsupported command '${trimmed}'`);
    }
    let g: GameDb;
    try {
      g = await ctx.engine.db();
    } catch {
      return stop(MSG.sqlUnavailable);
    }
    try {
      if (command === '.tables') {
        const { values } = runQuery(
          g,
          "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        ctx.reads.db(trimmed);
        return ok(values.length === 0 ? '' : `${values.map((r) => cellText(r[0] as Cell)).join('  ')}\n`);
      }
      const table = rest[0];
      const { values } =
        table === undefined
          ? runQuery(g, "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
          : runQuery(
              g,
              "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND tbl_name = ? COLLATE NOCASE ORDER BY rowid",
              [table],
            );
      ctx.reads.db(trimmed);
      return ok(values.map((r) => `${cellText(r[0] as Cell)};\n`).join(''));
    } catch (e) {
      return stop(`Error: ${errorMessage(e)}`);
    }
  }

  // SQL statements, in order; the first error stops the rest (R7.17, D-103).
  for (const statement of splitStatements(sqlArg)) {
    let g: GameDb;
    try {
      g = await ctx.engine.db();
    } catch {
      return stop(MSG.sqlUnavailable);
    }
    const cls = classifyStatement(statement);
    if (cls === 'lock' || cls === 'delete') {
      const write = parseWrite(statement);
      if (write.kind === 'refused') return stop(MSG.sqlReadonly);
      let rows: Cell[][];
      try {
        rows = runQuery(g, buildProbe(write)).values;
      } catch (e) {
        return stop(`Error: ${errorMessage(e)}`);
      }
      // A NULL or empty expression for any matched row is refused before anything acts (R7.19).
      if (write.kind === 'lock' && rows.some((r) => r[3] === null || r[3] === undefined || r[3] === '')) {
        return stop(MSG.sqlReadonly);
      }
      const errors: string[] = [];
      for (const row of rows) {
        const email = cellText(row[1] as Cell);
        let action: PlayerAction;
        if (write.kind === 'lock') {
          const deletedAt = row[2];
          if (deletedAt !== null && deletedAt !== undefined && deletedAt !== '') continue; // already locked (R7.4)
          action = { type: 'DEF-08', email };
        } else {
          action = { type: 'DEF-14', email };
        }
        const result = await ctx.engine.act(action);
        if (!result.ok) errors.push(result.message);
      }
      if (errors.length > 0) return stop(errors.join('\n'));
      continue;
    }
    if (cls !== 'read') {
      if (isUnknownStatement(statement)) {
        // Not a statement SQLite knows: compile only (nothing runs) to get its syntax error (R7.21).
        try {
          g.db.prepare(statement).free();
        } catch (e) {
          return stop(`Error: ${errorMessage(e)}`);
        }
      }
      return stop(MSG.sqlReadonly);
    }
    try {
      const { columns, values } = runQuery(g, statement);
      stdout += formatRows(header ? columns : undefined, values);
    } catch (e) {
      return stop(`Error: ${errorMessage(e)}`);
    }
    ctx.reads.db(statement);
  }
  return ok(stdout);
};

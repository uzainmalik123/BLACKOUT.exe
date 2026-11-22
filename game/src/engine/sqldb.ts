// The sql.js side of SYS-03: the shell's `sqlite3` reads a real SQLite copy of juiceshop.sqlite. The engine's
// world is the source of truth; syncDb() replays the recorded db events and mirrors the engine's own account
// changes (DEF-08 locks as deletedAt, DEF-14 deletes, DEF-17 restores) into it.
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import type { Row } from '../recordings/format';
import { gameTimeSql } from './clock';
import type { DbChange, World } from './state';

export interface GameDb {
  db: Database;
  applied: number; // how many of world.logs.dbChanges are in the DB
  seedUsers: Map<number, Record<string, SqlValue>>; // the baseline's Users rows, for restores
}

function cell(v: string | number | null): SqlValue {
  if (typeof v === 'string' && v.startsWith('base64:')) return Uint8Array.from(atob(v.slice(7)), (c) => c.charCodeAt(0));
  return v;
}

export async function openBaseline(bytes: Uint8Array): Promise<GameDb> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(bytes);
  const seedUsers = new Map<number, Record<string, SqlValue>>();
  const res = db.exec('SELECT * FROM Users')[0];
  if (res) for (const values of res.values) seedUsers.set(Number(values[res.columns.indexOf('id')]), Object.fromEntries(res.columns.map((c, i) => [c, values[i]!])));
  return { db, applied: 0, seedUsers };
}

const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** A real recording's insert carries the whole row (D-15); a made-up one may not, so NOT NULL columns get a filler (`at` for timestamps: game time, KI-91). */
function fillRequired(g: GameDb, table: string, row: Row, at: string): Row {
  const info = g.db.exec(`PRAGMA table_info(${q(table)})`)[0];
  if (!info) return row;
  const filled: Row = { ...row };
  const col = (name: string) => info.columns.indexOf(name);
  for (const v of info.values) {
    const name = String(v[col('name')]);
    if (filled[name] !== undefined || v[col('notnull')] !== 1 || v[col('dflt_value')] !== null || v[col('pk')] === 1) continue;
    filled[name] = /At$/.test(name) ? at : String(v[col('type')]).toUpperCase().includes('INT') ? 0 : '';
  }
  return filled;
}

/** Applies one change. `at` stamps the timestamp columns a made-up insert leaves out (syncDb passes the change's game time). */
export function applyDbChange(g: GameDb, c: DbChange, at = '1970-01-01 00:00:00.000 +00:00'): void {
  const [keyCol, keyVal] = Object.entries(c.key)[0]!;
  const where = `WHERE ${q(keyCol)} = ?`;
  if (c.op === 'insert') {
    const row = fillRequired(g, c.table, c.after ?? {}, at);
    const cols = Object.keys(row);
    g.db.run(`INSERT OR REPLACE INTO ${q(c.table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((k) => cell(row[k]!)));
  } else if (c.op === 'update') {
    const row: Row = c.after ?? {};
    const cols = Object.keys(row);
    if (cols.length === 0) return;
    g.db.run(`UPDATE ${q(c.table)} SET ${cols.map((k) => `${q(k)} = ?`).join(', ')} ${where}`, [...cols.map((k) => cell(row[k]!)), keyVal]);
  } else {
    g.db.run(`DELETE FROM ${q(c.table)} ${where}`, [keyVal]);
  }
}

function userIds(g: GameDb): Set<number> {
  const res = g.db.exec('SELECT id FROM Users')[0];
  return new Set(res ? res.values.map((v) => Number(v[0])) : []);
}

/** Brings the DB up to date with the world: replayed changes, then the engine's own account changes. Idempotent. */
export function syncDb(g: GameDb, world: World): void {
  for (; g.applied < world.logs.dbChanges.length; g.applied++) {
    const c = world.logs.dbChanges[g.applied]!;
    applyDbChange(g, c, gameTimeSql(world, c.t));
  }
  const inDb = userIds(g);
  const inWorld = new Map(world.accounts.map((a) => [a.id, a]));
  for (const id of inDb) if (!inWorld.has(id)) g.db.run('DELETE FROM Users WHERE id = ?', [id]);
  for (const [id, a] of inWorld) {
    if (!inDb.has(id)) {
      const seed = g.seedUsers.get(id);
      if (!seed) continue; // a non-seed account the DB never saw (a restore of Death's account before its insert replayed): nothing to copy
      const cols = Object.keys(seed);
      g.db.run(`INSERT INTO Users (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((k) => seed[k]!));
    }
    if (a.lockedAt !== undefined) g.db.run('UPDATE Users SET deletedAt = ? WHERE id = ? AND deletedAt IS NULL', [gameTimeSql(world, a.lockedAt), id]); // KI-91: game time, in the shop's own format
    else if (g.seedUsers.get(id)?.deletedAt === null) g.db.run('UPDATE Users SET deletedAt = NULL WHERE id = ?', [id]); // a restore undid the lock
  }
}

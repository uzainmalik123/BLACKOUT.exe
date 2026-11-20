/// <reference types="node" />
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { SEED_ACCOUNTS, SEED_PRODUCT_COUNT } from './seed';

const baseline = new URL('../recordings/juiceshop.sqlite', import.meta.url);

describe('the seed (juiceshop.sqlite as typed data)', () => {
  it('SEED_ACCOUNTS matches id, email, role and deletedAt of every Users row', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(baseline));
    const rows = db.exec('SELECT id, email, role, deletedAt FROM Users ORDER BY id')[0]!.values;
    const fromDb = rows.map(([id, email, role, deletedAt]) => ({ id, email, role, locked: deletedAt !== null }));
    const fromSeed = SEED_ACCOUNTS.map((a) => ({ id: a.id, email: a.email, role: a.role, locked: a.lockedAt !== undefined }));
    expect(fromSeed).toEqual(fromDb);
    expect(SEED_ACCOUNTS.every((a) => a.createdBy === 'seed')).toBe(true);
  });

  it('SEED_PRODUCT_COUNT matches the Products table', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(baseline));
    expect(db.exec('SELECT count(*) FROM Products')[0]!.values[0]![0]).toBe(SEED_PRODUCT_COUNT);
  });
});

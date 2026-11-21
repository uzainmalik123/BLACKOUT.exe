/// <reference types="node" />
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Recording } from '../recordings/format';
import { LEAKED_PASSWORD_REUSERS, SEED_ACCOUNTS, SEED_PRODUCT_COUNT } from './seed';

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

  it('LEAKED_PASSWORD_REUSERS are exactly the customers whose password is on the leaked list (D-26), and MIN-02.a broke into each', async () => {
    // recording/attacks/lib/customers.py LEAKED; Juice Shop stores MD5 hashes
    const leaked = ['Password1!', 'Summer2025!', 'iloveyou1', 'Qwerty123!', 'Welcome1!', 'Football7!', 'Sunshine1!', 'Dragon2024!', 'Monkey123!', 'Letmein99!'];
    const hashes = leaked.map((p) => createHash('md5').update(p).digest('hex'));
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(baseline));
    const rows = db.exec(`SELECT id, role FROM Users WHERE password IN (${hashes.map(() => '?').join(', ')}) ORDER BY id`, hashes)[0]!.values;
    expect(rows.map(([id]) => id)).toEqual([...LEAKED_PASSWORD_REUSERS]);
    expect(rows.every(([, role]) => role === 'customer')).toBe(true);
    const min02 = JSON.parse(readFileSync(new URL('../recordings/MIN-02.a.json', import.meta.url), 'utf8')) as Recording;
    const broken = min02.events.flatMap((e) => (e.kind === 'exfil' ? e.keys : [])).sort((a, b) => a - b);
    expect(broken).toEqual([...LEAKED_PASSWORD_REUSERS]);
  });

  it('SEED_PRODUCT_COUNT matches the Products table', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(baseline));
    expect(db.exec('SELECT count(*) FROM Products')[0]!.values[0]![0]).toBe(SEED_PRODUCT_COUNT);
  });
});

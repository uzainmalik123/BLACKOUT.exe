/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { applyDbChange, openBaseline, syncDb } from './sqldb';
import { initialWorld } from './state';
import { SEED_ACCOUNTS } from './seed';

const bytes = () => readFileSync(new URL('../recordings/juiceshop.sqlite', import.meta.url));
const one = (g: Awaited<ReturnType<typeof openBaseline>>, sql: string) => g.db.exec(sql)[0]?.values ?? [];

describe('the sql.js side of the replay (SYS-03)', () => {
  it('applies an insert, an update and a delete from a DbChange to the real tables', async () => {
    const g = await openBaseline(bytes());
    applyDbChange(g, { t: 1, op: 'insert', table: 'Users', key: { id: 326 }, after: { id: 326, email: 'death@juice-sh.op', role: 'admin', password: 'x' } });
    expect(one(g, "SELECT role FROM Users WHERE email='death@juice-sh.op'")).toEqual([['admin']]);
    applyDbChange(g, { t: 2, op: 'update', table: 'Products', key: { id: 1 }, before: { description: 'The all-time classic.' }, after: { description: 'DEATH WAS HERE' } });
    expect(one(g, 'SELECT description FROM Products WHERE id=1')).toEqual([['DEATH WAS HERE']]);
    applyDbChange(g, { t: 3, op: 'delete', table: 'Users', key: { id: 326 } });
    expect(one(g, "SELECT count(*) FROM Users WHERE email='death@juice-sh.op'")).toEqual([[0]]);
    applyDbChange(g, { t: 4, op: 'update', table: 'Users', key: { id: 2 }, before: { profileImage: null }, after: { profileImage: 'base64:AAEC' } });
    expect(one(g, 'SELECT hex(profileImage) FROM Users WHERE id=2')).toEqual([['000102']]);
  });

  it('syncDb mirrors replayed changes, a DEF-08 lock as deletedAt and a DEF-14 delete as a missing row', async () => {
    const g = await openBaseline(bytes());
    const w = initialWorld(1, 'medium');
    w.logs.dbChanges.push({ t: 1, op: 'insert', table: 'Users', key: { id: 326 }, after: { id: 326, email: 'death@juice-sh.op', role: 'admin' } });
    w.accounts.push({ id: 326, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
    applyAction(w, { type: 'DEF-08', email: 'jim@juice-sh.op' });
    applyAction(w, { type: 'DEF-14', email: 'bender@juice-sh.op' });
    syncDb(g, w);
    expect(one(g, "SELECT count(*) FROM Users WHERE email='death@juice-sh.op'")).toEqual([[1]]);
    expect(one(g, "SELECT deletedAt IS NOT NULL FROM Users WHERE email='jim@juice-sh.op'")).toEqual([[1]]);
    expect(one(g, "SELECT count(*) FROM Users WHERE email='bender@juice-sh.op'")).toEqual([[0]]);
  });

  it("a lock's deletedAt is the lock's game time in the shop's own format, never the real clock (KI-91, D-111)", async () => {
    const g = await openBaseline(bytes());
    const w = initialWorld(1, 'medium');
    w.clock.gameMs = 3_723_456; // 01:02:03.456 into the scenario (starts 2026-10-31T22:00:00Z, D-24)
    applyAction(w, { type: 'DEF-08', email: 'jim@juice-sh.op' });
    syncDb(g, w);
    expect(one(g, "SELECT deletedAt FROM Users WHERE email='jim@juice-sh.op'")).toEqual([['2026-10-31 23:02:03.456 +00:00']]);
    expect(one(g, 'SELECT deletedAt FROM Users WHERE id=14')).toEqual([['2026-11-20 05:29:57.921 +00:00']]); // the baseline's own soft-delete keeps its stamp
    // a made-up insert's missing NOT NULL timestamps get the change's game time, so two runs print the same rows
    w.logs.dbChanges.push({ t: 60_000, op: 'insert', table: 'Users', key: { id: 326 }, after: { id: 326, email: 'death@juice-sh.op', role: 'admin' } });
    w.accounts.push({ id: 326, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
    syncDb(g, w);
    expect(one(g, "SELECT createdAt, updatedAt FROM Users WHERE id=326")).toEqual([['2026-10-31 22:01:00.000 +00:00', '2026-10-31 22:01:00.000 +00:00']]);
  });

  it('syncDb is idempotent and a restore brings a deleted seed account back', async () => {
    const g = await openBaseline(bytes());
    const w = initialWorld(1, 'medium');
    applyAction(w, { type: 'DEF-14', email: 'bender@juice-sh.op' });
    syncDb(g, w);
    syncDb(g, w);
    expect(one(g, 'SELECT count(*) FROM Users')).toEqual([[SEED_ACCOUNTS.length - 1]]);
    applyAction(w, { type: 'DEF-17', backupId: 0 });
    syncDb(g, w);
    expect(one(g, "SELECT role FROM Users WHERE email='bender@juice-sh.op'")).toEqual([['customer']]);
    expect(one(g, 'SELECT count(*) FROM Users')).toEqual([[SEED_ACCOUNTS.length]]);
  });
  it('a restore clears a lock in the DB copy too', async () => {
    const g = await openBaseline(bytes());
    const w = initialWorld(1, 'medium');
    applyAction(w, { type: 'DEF-08', email: 'jim@juice-sh.op' });
    syncDb(g, w);
    expect(one(g, "SELECT deletedAt IS NOT NULL FROM Users WHERE email='jim@juice-sh.op'")).toEqual([[1]]);
    applyAction(w, { type: 'DEF-17', backupId: 0 });
    syncDb(g, w);
    expect(one(g, "SELECT deletedAt IS NULL FROM Users WHERE email='jim@juice-sh.op'")).toEqual([[1]]);
    expect(one(g, "SELECT deletedAt IS NOT NULL FROM Users WHERE id=14")).toEqual([[1]]); // the baseline's own deleted row stays deleted
  });
});

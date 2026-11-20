/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { applyDbChange, openBaseline, syncDb } from './sqldb';
import { initialWorld } from './state';

const bytes = () => readFileSync(new URL('../recordings/juiceshop.sqlite', import.meta.url));
const one = (g: Awaited<ReturnType<typeof openBaseline>>, sql: string) => g.db.exec(sql)[0]?.values ?? [];

describe('the sql.js side of the replay (SYS-03)', () => {
  it('applies an insert, an update and a delete from a DbChange to the real tables', async () => {
    const g = await openBaseline(bytes());
    applyDbChange(g, { t: 1, op: 'insert', table: 'Users', key: { id: 26 }, after: { id: 26, email: 'death@juice-sh.op', role: 'admin', password: 'x' } });
    expect(one(g, "SELECT role FROM Users WHERE email='death@juice-sh.op'")).toEqual([['admin']]);
    applyDbChange(g, { t: 2, op: 'update', table: 'Products', key: { id: 1 }, before: { description: 'The all-time classic.' }, after: { description: 'DEATH WAS HERE' } });
    expect(one(g, 'SELECT description FROM Products WHERE id=1')).toEqual([['DEATH WAS HERE']]);
    applyDbChange(g, { t: 3, op: 'delete', table: 'Users', key: { id: 26 } });
    expect(one(g, "SELECT count(*) FROM Users WHERE email='death@juice-sh.op'")).toEqual([[0]]);
    applyDbChange(g, { t: 4, op: 'update', table: 'Users', key: { id: 2 }, before: { profileImage: null }, after: { profileImage: 'base64:AAEC' } });
    expect(one(g, 'SELECT hex(profileImage) FROM Users WHERE id=2')).toEqual([['000102']]);
  });

  it('syncDb mirrors replayed changes, a DEF-08 lock as deletedAt and a DEF-14 delete as a missing row', async () => {
    const g = await openBaseline(bytes());
    const w = initialWorld(1, 'medium');
    w.logs.dbChanges.push({ t: 1, op: 'insert', table: 'Users', key: { id: 26 }, after: { id: 26, email: 'death@juice-sh.op', role: 'admin' } });
    w.accounts.push({ id: 26, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
    applyAction(w, { type: 'DEF-08', email: 'jim@juice-sh.op' });
    applyAction(w, { type: 'DEF-14', email: 'bender@juice-sh.op' });
    syncDb(g, w);
    expect(one(g, "SELECT count(*) FROM Users WHERE email='death@juice-sh.op'")).toEqual([[1]]);
    expect(one(g, "SELECT deletedAt IS NOT NULL FROM Users WHERE email='jim@juice-sh.op'")).toEqual([[1]]);
    expect(one(g, "SELECT count(*) FROM Users WHERE email='bender@juice-sh.op'")).toEqual([[0]]);
  });

  it('syncDb is idempotent and a restore brings a deleted seed account back', async () => {
    const g = await openBaseline(bytes());
    const w = initialWorld(1, 'medium');
    applyAction(w, { type: 'DEF-14', email: 'bender@juice-sh.op' });
    syncDb(g, w);
    syncDb(g, w);
    expect(one(g, 'SELECT count(*) FROM Users')).toEqual([[24]]);
    applyAction(w, { type: 'DEF-17', backupId: 0 });
    syncDb(g, w);
    expect(one(g, "SELECT role FROM Users WHERE email='bender@juice-sh.op'")).toEqual([['customer']]);
    expect(one(g, 'SELECT count(*) FROM Users')).toEqual([[25]]);
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

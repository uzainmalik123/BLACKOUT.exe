// Feature: shell, Property 21: SQL lock and delete act on the rows SQLite would change
// **Validates: Requirements 7.3, 7.4, 7.5, 7.10, 7.11**
// Never prints a locked account's deletedAt (KI-91): every query here selects id and email only.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const TIMEOUT_MS = 30_000;

/** A WHERE clause over the Users columns: comparisons, LIKE, IN, AND, OR, NOT and 1=1. */
const arbAtom: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(fc.constantFrom('=', '<>', '<', '<=', '>', '>='), fc.integer({ min: 0, max: 60 })).map(([op, n]) => `id ${op} ${n}`),
  fc.constantFrom('admin', 'customer', 'deluxe', 'accounting', 'nobody').map((r) => `role = '${r}'`),
  fc.constantFrom('admin', 'customer', 'deluxe').map((r) => `role <> '${r}'`),
  fc.constantFrom('%juice%', '%@example.%', 'a%', '%.org', '%x%', '_im@%').map((p) => `email LIKE '${p}'`),
  fc.constantFrom('%a%', 'b%', '').map((p) => `username LIKE '${p}'`),
  fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 6 }).map((ids) => `id IN (${ids.join(', ')})`),
  fc.uniqueArray(fc.constantFrom('admin', 'customer', 'deluxe', 'accounting'), { minLength: 1, maxLength: 3 }).map((rs) => `role IN (${rs.map((r) => `'${r}'`).join(', ')})`),
  fc.constantFrom(0, 1).map((v) => `isActive = ${v}`),
  fc.constantFrom('deletedAt IS NULL', 'deletedAt IS NOT NULL'),
  fc.constant('1=1'),
);
export const arbWhere: fc.Arbitrary<string> = fc.letrec<{ w: string }>((tie: (k: 'w') => fc.Arbitrary<string>) => ({
  w: fc.oneof(
    { maxDepth: 3, depthSize: 'small' },
    arbAtom,
    tie('w').map((x) => `NOT (${x})`),
    fc.tuple(tie('w'), tie('w')).map(([a, b]) => `(${a}) AND (${b})`),
    fc.tuple(tie('w'), tie('w')).map(([a, b]) => `(${a}) OR (${b})`),
  ),
})).w;

const arbCase = fc.record({
  where: fc.option(arbWhere, { nil: undefined }),
  preLock: fc.uniqueArray(fc.integer({ min: 1, max: 53 }), { maxLength: 5 }),
  failMod: fc.option(fc.integer({ min: 2, max: 4 }), { nil: undefined }),
});

type Fx = ReturnType<typeof makeFixture>;
async function rows(f: Fx, sql: string): Promise<Array<[number, string, string | null]>> {
  const res = (await f.engine.db()).db.exec(sql);
  return (res[0]?.values ?? []).map((r) => [Number(r[0]), String(r[1]), r[2] === null ? null : String(r[2])]);
}

async function setup(preLock: number[]): Promise<Fx> {
  const f = makeFixture();
  const emails = new Map((await rows(f, 'SELECT id, email, NULL FROM Users')).map(([id, e]) => [id, e]));
  for (const id of preLock) {
    const email = emails.get(id);
    if (email !== undefined) f.engine.act({ type: 'DEF-08', email }); // an already locked account answers ok: false; fine
  }
  return f;
}

/** Make the Engine refuse the action for every email whose id is a multiple of `mod`. */
function failSome(f: Fx, mod: number | undefined, ids: Map<string, number>) {
  const real = f.engine.act.bind(f.engine);
  return vi.spyOn(f.engine, 'act').mockImplementation((a) =>
    mod !== undefined && (a.type === 'DEF-08' || a.type === 'DEF-14') && ids.get(a.email)! % mod === 0
      ? { ok: false, message: `refused ${a.email}` }
      : real(a),
  );
}

describe('Property 21: SQL lock and delete act on the rows SQLite would change', () => {
  it(
    'UPDATE sends DEF-08 for each matched, unlocked row; DEF-14 for each row DELETE matches; no DEF-02; ok:false is printed and the loop goes on',
    async () => {
      await fc.assert(
        fc.asyncProperty(arbCase, fc.constantFrom<'lock' | 'delete'>('lock', 'delete'), async (c, kind) => {
          const f = await setup(c.preLock);
          const w = c.where === undefined ? '' : ` WHERE ${c.where}`;
          const all = await rows(f, 'SELECT id, email, deletedAt FROM Users');
          const ids = new Map(all.map(([id, e]) => [e, id]));
          const matched = await rows(f, `SELECT id, email, deletedAt FROM Users${w}`);
          const expected = (kind === 'lock' ? matched.filter(([, , d]) => d === null || d === '') : matched).map(([, e]) => e).sort();
          const lockedBefore = new Set(all.filter(([, , d]) => d !== null && d !== '').map(([, e]) => e));
          const worldBefore = f.world.accounts.length;
          const act = failSome(f, c.failMod, ids);

          const sql = kind === 'lock' ? `UPDATE Users SET deletedAt=datetime('now')${w}` : `DELETE FROM Users${w}`;
          const r = await f.shell.run(`sqlite3 ${DB} "${sql.replaceAll('"', '\\"')}"`);

          const type = kind === 'lock' ? 'DEF-08' : 'DEF-14';
          const acts = act.mock.calls.map(([a]) => a); // every attempted action, accepted or refused
          expect(acts.every((a) => a.type === type)).toBe(true); // no DEF-02 from the probe
          expect(acts.map((a) => (a as { email: string }).email).sort()).toEqual(expected);

          const refused = expected.filter((e) => c.failMod !== undefined && ids.get(e)! % c.failMod === 0);
          expect(r.output.split('\n').filter((l) => l !== '').sort()).toEqual(refused.map((e) => `refused ${e}`).sort());
          expect(r.exitCode).toBe(refused.length > 0 ? 1 : 0);

          // A new Engine.db() shows exactly those rows locked or removed.
          const done = new Set(expected.filter((e) => !refused.includes(e)));
          if (kind === 'lock') {
            const now = await rows(f, 'SELECT id, email, deletedAt FROM Users');
            expect(now).toHaveLength(all.length);
            const lockedNow = new Set(now.filter(([, , d]) => d !== null && d !== '').map(([, e]) => e));
            expect(lockedNow).toEqual(new Set([...lockedBefore, ...done]));
          } else {
            const now = (await rows(f, 'SELECT id, email, NULL FROM Users')).map(([, e]) => e).sort();
            expect(now).toEqual(all.map(([, e]) => e).filter((e) => !done.has(e)).sort());
            expect(f.world.accounts).toHaveLength(worldBefore - done.size);
          }
        }),
        { numRuns: 50 },
      );
    },
    TIMEOUT_MS,
  );
});

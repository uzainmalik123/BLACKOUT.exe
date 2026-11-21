// Souls (SYS-05, D-08): one per Users row of the seed (D-24); stolen rows never come back. Accounts Death made
// himself (ATK-06, ATK-11) are never souls, even when a dump takes them.
import { SOUL_TABLES, type MinionId, type MoveId } from '../rules/vocabulary';
import { emit } from './log';
import { pick } from './rng';
import { LEAKED_PASSWORD_REUSERS, SEED_ACCOUNTS } from './seed';
import type { Account, World } from './state';

const isSoulTable = (table: string) => (SOUL_TABLES as readonly string[]).includes(table);
const SEED_IDS: ReadonlySet<number> = new Set(SEED_ACCOUNTS.map((a) => a.id));
const REUSERS: ReadonlySet<number> = new Set(LEAKED_PASSWORD_REUSERS);

/** Records the rows an exfil took; returns how many were new souls. */
export function steal(world: World, by: MoveId | MinionId, table: string, keys: number[]): number {
  if (!isSoulTable(table)) return 0;
  let count = 0;
  for (const key of keys) {
    if (!SEED_IDS.has(key)) continue; // one of Death's own accounts, not a customer
    if (world.souls.stolen.some((s) => s.table === table && s.key === key)) continue;
    world.souls.stolen.push({ table, key });
    count++;
  }
  if (count > 0) emit(world, { kind: 'souls-stolen', by, count, stolen: soulsStolen(world), total: world.souls.total });
  return count;
}

export function soulsStolen(world: World): number {
  return world.souls.stolen.length;
}

export function soulsLeft(world: World): number {
  return world.souls.total - world.souls.stolen.length;
}

const isStolen = (world: World, a: Account) => world.souls.stolen.some((s) => s.table === 'Users' && s.key === a.id);

/**
 * MIN-02: one credential-stuffing success. Only a customer who reuses a leaked password (D-26) can fall to it, and
 * only while the account can still log in (not locked by DEF-08, no forced reset by DEF-16). Prefers one not yet
 * stolen (chosen with the seeded PRNG); an already stolen one still logs in (a session for Death, no new soul).
 */
export function stuffOneReuser(world: World, by: MinionId): Account | undefined {
  const open = world.accounts.filter((a) => a.createdBy === 'seed' && REUSERS.has(a.id) && a.lockedAt === undefined && a.passwordResetAt === undefined);
  if (open.length === 0) return undefined;
  const fresh = open.filter((a) => !isStolen(world, a));
  const victim = pick(world, fresh.length > 0 ? fresh : open);
  steal(world, by, 'Users', [victim.id]);
  return victim;
}

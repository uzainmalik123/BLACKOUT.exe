// Souls (SYS-05, D-08): one per Users row of the seed (D-24); stolen rows never come back. Accounts Death made
// himself (ATK-06, ATK-11) are never souls, even when a dump takes them.
import { SOUL_TABLES, type MinionId, type MoveId } from '../rules/vocabulary';
import { CONFIG } from './config';
import { emit } from './log';
import { pick } from './rng';
import { LEAKED_PASSWORD_REUSERS, SEED_ACCOUNTS } from './seed';
import type { Account, World } from './state';

const isSoulTable = (table: string) => (SOUL_TABLES as readonly string[]).includes(table);
const SEED_IDS: ReadonlySet<number> = new Set(SEED_ACCOUNTS.map((a) => a.id));
const REUSERS: ReadonlySet<number> = new Set(LEAKED_PASSWORD_REUSERS);

const isMinion = (by: MoveId | MinionId) => by.startsWith('MIN-');

/** D-41: how many souls minions may take over a whole run. */
export function minionSoulCap(world: World): number {
  return Math.floor(world.souls.total * CONFIG[world.difficulty].minions.soulCapFraction);
}

/** Records the rows an exfil took; returns how many were new souls. Minions stop taking souls at their cap (D-41). */
export function steal(world: World, by: MoveId | MinionId, table: string, keys: number[]): number {
  if (!isSoulTable(table)) return 0;
  let count = 0;
  for (const key of keys) {
    if (!SEED_IDS.has(key)) continue; // one of Death's own accounts, not a customer
    if (world.souls.stolen.some((s) => s.table === table && s.key === key)) continue;
    if (isMinion(by) && world.souls.byMinions >= minionSoulCap(world)) break;
    world.souls.stolen.push({ table, key });
    if (isMinion(by)) world.souls.byMinions++;
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
/** Only a customer who reuses a leaked password (D-26) can fall to MIN-02, and only while the account can still log in. */
const canBreakInto = (a: Account) => a.createdBy === 'seed' && REUSERS.has(a.id) && a.lockedAt === undefined && a.passwordResetAt === undefined;

/**
 * MIN-02, a wave with no recording (D-24): one credential-stuffing success on a reuser who can still log in (not
 * locked by DEF-08, no forced reset by DEF-16). Prefers one not yet stolen (chosen with the seeded PRNG); an already
 * stolen one still logs in (a session for Death, no new soul).
 */
export function stuffOneReuser(world: World, by: MinionId): Account | undefined {
  const open = world.accounts.filter(canBreakInto);
  if (open.length === 0) return undefined;
  const fresh = open.filter((a) => !isStolen(world, a));
  const victim = pick(world, fresh.length > 0 ? fresh : open);
  steal(world, by, 'Users', [victim.id]);
  return victim;
}

/**
 * MIN-02, a recorded success (an exfil in its recording, D-41): the break-in happens only if that account can still
 * log in (D-40). Returns the account Death now holds a session for, if any.
 */
export function breakInto(world: World, by: MinionId, id: number): Account | undefined {
  const victim = world.accounts.find((a) => a.id === id);
  if (!victim || !canBreakInto(victim)) return undefined;
  steal(world, by, 'Users', [victim.id]);
  return victim;
}

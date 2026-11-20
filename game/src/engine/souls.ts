// Souls (SYS-05, D-08): one per Users row (D-24); stolen rows never come back.
import { SOUL_TABLES, type MinionId, type MoveId } from '../rules/vocabulary';
import { emit } from './log';
import { pick } from './rng';
import type { Account, World } from './state';

const isSoulTable = (table: string) => (SOUL_TABLES as readonly string[]).includes(table);

/** Records the rows an exfil took; returns how many were new souls. */
export function steal(world: World, by: MoveId | MinionId, table: string, keys: number[]): number {
  if (!isSoulTable(table)) return 0;
  let count = 0;
  for (const key of keys) {
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

/** MIN-02: a credential-stuffing success takes one seed account not yet stolen, chosen with the seeded PRNG. */
export function stealOneUnstolenCustomer(world: World, by: MinionId): Account | undefined {
  const left = world.accounts.filter((a) => a.createdBy === 'seed' && !world.souls.stolen.some((s) => s.table === 'Users' && s.key === a.id));
  if (left.length === 0) return undefined;
  const victim = pick(world, left);
  steal(world, by, 'Users', [victim.id]);
  return victim;
}

// The big soul doors (D-42, D-44). A door is *shut* while one of its own stoppers holds for every half Death may
// play (judged for a fresh address: an IP block only pauses), and *open* otherwise. Nothing is "closed for good":
// a fix that lapses (search back on before the patch lands, a new session after a revoke) reopens the door, his
// again, with no new first entry needed. `refreshDoors` keeps world.death.shutDoors current and logs the changes.
import { MOVES, SOUL_DOORS, type Move } from '../rules/moves';
import { SOUL_TABLES, type MoveId, type Stopper } from '../rules/vocabulary';
import { CONFIG } from './config';
import { stopperHolds } from './facts';
import type { RecordingLibrary, Variant } from './library';
import { emit } from './log';
import { SEED_ACCOUNTS } from './seed';
import type { World } from './state';

export const isDoor = (move: Move): boolean => SOUL_DOORS.includes(move.id);

export const landed = (world: World, move: MoveId): boolean => world.death.played.some((p) => p.move === move && p.outcome === 'landed');

/** D-117: a soul door he has found: one he got into, landed or cut (a paused visit is his too). */
export const found = (world: World, move: MoveId): boolean => world.death.played.some((p) => p.move === move) || world.replays.some((r) => r.owner === 'death' && r.move === move) || world.death.resume[move] !== undefined;

const SEED_IDS: ReadonlySet<number> = new Set(SEED_ACCOUNTS.map((a) => a.id));
const soulKeysCache = new WeakMap<Variant['recording'], number[]>();

/** The seed `Users` rows a recording's exfil events take (D-42 picks a half by them). */
export function soulKeys(v: Variant): number[] {
  let keys = soulKeysCache.get(v.recording);
  if (!keys) {
    const set = new Set<number>();
    for (const e of v.recording.events) {
      if (e.kind === 'exfil' && (SOUL_TABLES as readonly string[]).includes(e.table)) for (const k of e.keys) if (SEED_IDS.has(k)) set.add(k);
    }
    keys = [...set];
    soulKeysCache.set(v.recording, keys);
  }
  return keys;
}

/** How many of a variant's soul rows are still unstolen. */
export function unstolen(world: World, v: Variant): number {
  const stolen = new Set(world.souls.stolen.filter((s) => s.table === 'Users').map((s) => s.key));
  return soulKeys(v).filter((k) => !stolen.has(k)).length;
}

/** SYS-08, D-31, D-42: the variants of a pinned move Death may play (ATK-08: the quiet halves, the loud ones on Hard or once tipped off). */
export function allowedVariants(world: World, move: Move): string[] | undefined {
  const pin = CONFIG[world.difficulty].pinnedVariants[move.id];
  return pin && (world.death.tippedOff ? pin.tippedOff : pin.normal);
}

/** The halves of a door Death may play on this level, stopped or not. */
export function doorHalves(world: World, library: RecordingLibrary, move: Move): Variant[] {
  const allowed = allowedVariants(world, move);
  return library.variantsOf(move.id).filter((v) => allowed === undefined || allowed.includes(v.variant));
}

/** The first of the door's own stoppers that holds for every half he may play: the fix that shuts it right now. */
export function closingStopper(world: World, library: RecordingLibrary, move: Move): Stopper | undefined {
  const halves = doorHalves(world, library, move);
  if (halves.length === 0) return undefined;
  return move.stoppedBy.find((s) => halves.every((v) => stopperHolds(world, s, { ...v.info, ip: 'fresh' })));
}

/**
 * D-45: the fixes that close a soul door for the win: its patch (DEF-13, never rolled back) or a WAF rule (DEF-12, never
 * removed). A flag (DEF-10), a revoke (DEF-09) and locking or deleting the account he uses (DEF-08, DEF-14) shut it
 * during play, but each lapses (a flag back on, a new session: D-44 ruling 1), so they are containment, not the fix.
 */
export const LASTING_FIXES: ReadonlySet<Stopper['action']> = new Set(['DEF-12', 'DEF-13']);

/**
 * SYS-07, D-45, D-117: a soul door still open for the win. A door he has found (got into, landed or cut) is open until a
 * lasting fix holds for every half he may play, even once it has nothing left to take (D-117, closes KI-135): containment
 * that shuts it, a revoke, or an empty door don't count. A door he has never entered is open while its Needs hold and a
 * half he may play is not stopped by a lasting fix.
 */
export function doorOpenForWin(world: World, library: RecordingLibrary, move: Move, needsHold: boolean): boolean {
  const his = found(world, move.id);
  if (!his && !needsHold) return false;
  const lasting = move.stoppedBy.filter((s) => LASTING_FIXES.has(s.action));
  return doorHalves(world, library, move).some((v) => !lasting.some((s) => stopperHolds(world, s, { ...v.info, ip: 'fresh' })));
}

/** D-44: brings world.death.shutDoors up to date with the fixes that hold now, logging each door that shuts or reopens. */
export function refreshDoors(world: World, library: RecordingLibrary): void {
  for (const move of MOVES) {
    if (!isDoor(move)) continue;
    const closing = closingStopper(world, library, move);
    const shut = world.death.shutDoors.includes(move.id);
    if (closing && !shut) {
      world.death.shutDoors.push(move.id);
      emit(world, { kind: 'door-shut', move: move.id, by: closing.action });
    } else if (!closing && shut) {
      world.death.shutDoors = world.death.shutDoors.filter((m) => m !== move.id);
      emit(world, { kind: 'door-reopened', move: move.id });
    }
  }
}

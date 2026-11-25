// RESULT, the end of each ATTACK → SPOT → ACT → DEFEND → RESULT loop (D-225): what an action of the player's really
// did, read from the engine after it. A threat is "contained" only when the engine cuts or shuts an attack by that
// very action, or freezes one that was running when it was taken (D-45: a fix that holds stops the move at once and
// cuts it after a grace); "customers disrupted" only when the meters fell; reads show no banner (they cost nothing). The same
// for a button, a key or a typed command: they all end as one engine action.

import type { GameEvent } from '../../engine/log';
import type { World } from '../../engine/state';
import type { PlayerAction } from '../../rules/vocabulary';

export type Outcome = 'contained' | 'disrupted' | 'evidence' | 'restored' | 'deploying' | 'shutdown' | 'still-active' | 'applied' | 'failed';

export interface Pending {
  type: PlayerAction['type'];
  ok: boolean;
  message: string;
  /** Index into `world.events` just after the action. */
  from: number;
  heartbeat: number;
  max: number;
  /** Real seconds when it was taken. */
  at: number;
  /** Death's attacks running, and not frozen, when it was taken (their replay ids). */
  live: number[];
}

/** Death's attacks running right now and not held by a fix (D-45 freezes a stopped move before it cuts it). */
export const liveAttacks = (world: World): number[] => world.replays.filter((r) => r.owner === 'death' && r.frozenSince === undefined).map((r) => r.id);

export const OUTCOME_WORDS: Record<Outcome, string> = {
  contained: 'THREAT CONTAINED',
  disrupted: 'CUSTOMERS DISRUPTED',
  evidence: 'EVIDENCE PRESERVED',
  restored: 'SERVICE RESTORED',
  deploying: 'PATCH DEPLOYING',
  shutdown: 'SHOP SHUT DOWN',
  'still-active': 'ATTACKER STILL ACTIVE',
  applied: 'DONE',
  failed: "DIDN'T WORK",
};

/** Kiro's short reaction to an outcome (D-225): about what happened, never what to do next. */
export const OUTCOME_KIRO: Partial<Record<Outcome, string>> = {
  contained: 'Good. He felt that.',
  disrupted: 'Careful. Real customers felt that too.',
  shutdown: "Don't shut down the whole shop just to stop one attacker.",
  'still-active': "He's still in there. Look again.",
  evidence: 'Good. Now we can prove it.',
  restored: 'The lights are coming back.',
};

/** Reads cost nothing and settle nothing: no banner for them. */
export const READS: ReadonlySet<PlayerAction['type']> = new Set(['DEF-01', 'DEF-02', 'DEF-03']);

/** How long to watch the engine after an action before judging it (real seconds). */
export const WATCH_SECONDS = 2.5;

const cutBy = (e: GameEvent, type: string): boolean =>
  (e.kind === 'move-cut' && e.by === type) || (e.kind === 'door-shut' && e.by === type) || (e.kind === 'tap-closed' && e.by === type) || (e.kind === 'wave-ended' && e.closedBy === type);

/** The outcome of `p` now, or null while it is still too early to say (or for a read). */
export function outcomeOf(p: Pending, world: World, now: number): Outcome | null {
  if (READS.has(p.type) || (p.type === 'DEF-04' && p.ok)) return null;
  if (!p.ok) return 'failed';
  const after = world.events.slice(p.from);
  // the plug stops everything, him and every customer: that is a shut-down shop, not a containment
  if (p.type === 'DEF-11') return now - p.at < WATCH_SECONDS ? null : 'shutdown';
  if (after.some((e) => cutBy(e, p.type))) return 'contained';
  const frozenNow = world.replays.filter((r) => r.frozenSince !== undefined).map((r) => r.id);
  if (p.live.some((id) => frozenNow.includes(id))) return 'contained';
  if (now - p.at < WATCH_SECONDS) return null;
  if (Math.round(world.heartbeat) < Math.round(p.heartbeat) - 1 || world.heartbeatMax < p.max) return 'disrupted';
  if (p.type === 'DEF-05') return 'evidence';
  if (p.type === 'DEF-13') return 'deploying';
  if (p.type === 'DEF-17' || p.type === 'DEF-18') return 'restored';
  if (liveAttacks(world).length > 0) return 'still-active';
  return 'applied';
}

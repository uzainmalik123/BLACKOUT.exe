// The event log (SYS-10): every Death move, minion wave, player action and Kiro call, in game time.
// The report (SYS-11) and the sims (SYS-16) read only from world.events.
import type { ActionId, Ending, Foothold, MinionId, MoveId, Patch, PlayerAction, Stage } from '../rules/vocabulary';
import type { World } from './state';

export type GameEventBody =
  | { kind: 'move-started'; move: MoveId; variant: string; stage: Stage; ip: string }
  | { kind: 'move-landed'; move: MoveId; variant: string }
  | { kind: 'move-cut'; move: MoveId; variant: string; by: ActionId }
  | { kind: 'wave-started'; minion: MinionId; wave: number; ips: string[] }
  | { kind: 'wave-ended'; minion: MinionId; wave: number; closedBy?: ActionId }
  | { kind: 'action'; action: PlayerAction; ok: boolean; note?: string }
  | { kind: 'kiro'; call: 'chat' | 'draft' | 'hint' | 'explain' | 'debrief'; credits?: number }
  | { kind: 'souls-stolen'; by: MoveId | MinionId; count: number; stolen: number; total: number }
  | { kind: 'tip-off'; by: ActionId }
  | { kind: 'alert-opened'; alert: number; about: MoveId | MinionId }
  | { kind: 'alert-closed'; alert: number; about: MoveId | MinionId }
  | { kind: 'patch-applied'; patch: Patch }
  | { kind: 'banished' }
  | { kind: 'return'; through: Foothold }
  | { kind: 'ending'; ending: Ending; souls: number; heartbeat: number };

export type GameEvent = { t: number; id: number } & GameEventBody;

/** Appends an event stamped with the current game time and a running id. */
export function emit(world: World, body: GameEventBody): GameEvent {
  const e: GameEvent = { id: world.events.length + 1, t: world.clock.gameMs, ...body };
  world.events.push(e);
  return e;
}

export function eventsOfKind<K extends GameEvent['kind']>(world: World, kind: K): Extract<GameEvent, { kind: K }>[] {
  return world.events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
}

/** Ends the run (SYS-05/06/07): sets world.ending and logs the final meters. Idempotent. */
export function endRun(world: World, ending: Ending): void {
  if (world.ending) return;
  world.ending = ending;
  emit(world, { kind: 'ending', ending, souls: world.souls.stolen.length, heartbeat: world.heartbeat });
}

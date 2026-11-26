// The event log (SYS-10): every Death move, minion wave, player action and Kiro call, in game time.
// The report (SYS-11) and the sims (SYS-16) read only from world.events.
import type { ActionId, Actor, Ending, Foothold, MinionId, MoveId, Patch, PlayerAction, RequestClass, Stage, TapId, WafRule } from '../rules/vocabulary';
import type { GapType } from './assess';
import type { World } from './state';

export type KiroCall = 'chat' | 'draft' | 'hint' | 'explain' | 'debrief';

export type GameEventBody =
  | { kind: 'move-started'; move: MoveId; variant: string; stage: Stage; ip: string }
  | { kind: 'move-landed'; move: MoveId; variant: string }
  | { kind: 'move-cut'; move: MoveId; variant: string; by: ActionId }
  | { kind: 'wave-started'; minion: MinionId; wave: number; ips: string[] }
  | { kind: 'wave-ended'; minion: MinionId; wave: number; closedBy?: ActionId }
  | { kind: 'action'; action: PlayerAction; ok: boolean; note?: string }
  | { kind: 'kiro'; call: KiroCall; credits?: number } // D-191 (KI-190): logged by the Kiro client through engine.noteKiro, credits as the server reported them
  | { kind: 'souls-stolen'; by: Actor; count: number; stolen: number; total: number }
  | { kind: 'tip-off'; by: ActionId }
  | { kind: 'alert-opened'; alert: number; about: Actor; route: string; symptom: string } // D-232: opened by a per-route detector; `about` is the spoiler, `route` and `symptom` are what to show
  | { kind: 'alert-closed'; alert: number; about: Actor }
  | { kind: 'shift-begun' } // D-230: engine.beginShift(): the desk is in view; Death's first move waits its seeded delay from here
  | { kind: 'incident-declared'; by: 'alert' | 'escalation' | 'flag' } // D-230: the change freeze lifts
  | { kind: 'flag-confirmed'; ip: string; about: Actor } // D-233: a hostile request from a flagged address, after the flag (`about` is the spoiler: don't show it)
  | { kind: 'rule-evaded'; move: MoveId; rule: WafRule } // D-231: the bandage failed: that move's quiet variants slip the rule from now on
  | { kind: 'tap-opened'; tap: TapId }
  | { kind: 'tap-closed'; tap: TapId; by?: ActionId } // no `by`: it ran dry
  | { kind: 'door-shut'; move: MoveId; by: ActionId } // D-44: one of its own stoppers holds for every half he may play
  | { kind: 'door-reopened'; move: MoveId } // D-44: that fix lapsed; the door is his again
  | { kind: 'proxies' } // D-46 (KI-78): after three IP blocks in a row he plays from rotating proxies for the rest of the run
  | { kind: 'ticket'; ticket: number; about: RequestClass; status: 403 | 429 | 503 | 'blocked' } // D-65: a customer's first failure this loop: a support ticket
  | { kind: 'customer-lost'; about: RequestClass; max: number } // D-65: a customer gave up (a second failure): the heartbeat's maximum dropped to `max`
  | { kind: 'suggestion'; n: number; reason: 'idle' | 'souls' | 'gap'; gap?: GapType } // SYS-13 (D-113, D-114): the player is struggling; one suggestion unlocked (Medium/Hard), aimed at the biggest gap standing (a type, never a text)
  | { kind: 'breach-confirmed'; by: ActionId } // SYS-14 (D-116): the notification clock starts: DEF-19, or a relevant action on a harvest move or on Users
  | { kind: 'notification-overdue' } // SYS-14: the window passed with legal not notified
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

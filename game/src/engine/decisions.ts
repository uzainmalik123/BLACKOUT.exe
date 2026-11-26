// Timed decisions (SYS-25, D-261): every alert gives the player a few seconds to act. An accepted action that is not
// a read answers every alert waiting inside its window; an alert still open and unanswered when its window ends is
// missed: the heartbeat dips once and the engine logs `decision-missed`. An alert that closes first (his move landed
// or was cut, a wave ended) needed no decision. The engine's clock runs it, so a pause holds it.
import type { ActionId } from '../rules/vocabulary';
import { CONFIG } from './config';
import { dip } from './heartbeat';
import { emit } from './log';
import type { Alert, World } from './state';

/** The reads: they show, they never decide (DEF-01, DEF-02, DEF-03). */
const READS: ReadonlySet<ActionId> = new Set<ActionId>(['DEF-01', 'DEF-02', 'DEF-03']);

/** An alert waiting for a decision: open, neither answered nor missed. */
export const waiting = (a: Alert): boolean => a.closedAt === undefined && a.answeredAt === undefined && a.missedAt === undefined;

/** When the alert's window ends, in game ms. */
export const decideBy = (world: World, a: Alert): number => a.openedAt + CONFIG[world.difficulty].decision.windowGameMs;

/** An accepted action answers every alert waiting inside its window (applyAction calls this). */
export function answerAlerts(world: World, by: ActionId): void {
  if (READS.has(by)) return;
  const now = world.clock.gameMs;
  for (const a of world.alerts) if (waiting(a) && now < decideBy(world, a)) a.answeredAt = now;
}

/** One tick, after the detectors: the alerts whose window ended unanswered are missed. */
export function stepDecisions(world: World): void {
  if (world.shift.noDecisions) return;
  const now = world.clock.gameMs;
  for (const a of world.alerts) {
    if (!waiting(a) || now < decideBy(world, a)) continue;
    a.missedAt = now;
    dip(world, CONFIG[world.difficulty].decision.dip);
    emit(world, { kind: 'decision-missed', alert: a.id, about: a.about });
  }
}

/** For the lab sims that measure one drain or cost (SYS-06, D-65): no decision windows, so no dips but theirs. The game never does. */
export function noDecisions(world: World): void {
  world.shift.noDecisions = true;
}

/** The report's count: the alerts answered in time, of those that waited for a decision. */
export function decisionsTally(world: World): { inTime: number; of: number } {
  const inTime = world.alerts.filter((a) => a.answeredAt !== undefined).length;
  return { inTime, of: inTime + world.alerts.filter((a) => a.missedAt !== undefined).length };
}

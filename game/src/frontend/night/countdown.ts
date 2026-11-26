// The countdown on the choices (UI-15, D-261): how long the alert the play screen shows still waits for a decision
// (SYS-25), and the short "In time" / "Too late" that follows one. Read from the engine only: its clock, so a pause or
// the tutorial's hold holds it. Pure, so it is tested.

import { CONFIG } from '../../engine/config';
import { decideBy, waiting } from '../../engine/decisions';
import type { World } from '../../engine/state';

export type CountdownState = 'deciding' | 'in-time' | 'too-late';

export interface Countdown {
  state: CountdownState;
  /** Real seconds left to decide (0 once it is over). */
  left: number;
  /** 0..1: the share of the window left, for the bar. */
  share: number;
}

/** How long the outcome words stay up, in real seconds. */
export const SHOW = { 'in-time': 1.5, 'too-late': 2 } as const;
/** The last seconds of the window are urgent (red). */
export const URGENT_S = 3;

/**
 * The countdown now: "Too late" for 2 s after an alert's window ran out, "In time" for 1.5 s after one was answered,
 * else the window of the alert the screen shows (the newest open one, as the situation) while it waits; null when
 * there is nothing to decide. Under reduced motion the share moves in whole seconds.
 */
export function countdownOf(world: World, reduce = false): Countdown | null {
  const { gameMsPerRealMs, decision } = CONFIG[world.difficulty];
  const now = world.clock.gameMs;
  const realS = (gameMs: number) => gameMs / gameMsPerRealMs / 1000;
  const missed = Math.max(-Infinity, ...world.alerts.map((a) => a.missedAt ?? -Infinity));
  if (realS(now - missed) < SHOW['too-late']) return { state: 'too-late', left: 0, share: 0 };
  const answered = Math.max(-Infinity, ...world.alerts.map((a) => a.answeredAt ?? -Infinity));
  if (realS(now - answered) < SHOW['in-time']) return { state: 'in-time', left: 0, share: 1 };
  const open = world.alerts.filter((a) => a.closedAt === undefined);
  const shown = open[open.length - 1];
  if (!shown || !waiting(shown)) return null;
  const leftGameMs = decideBy(world, shown) - now;
  if (leftGameMs <= 0) return null;
  const left = realS(leftGameMs);
  const whole = Math.ceil(left);
  const window = realS(decision.windowGameMs);
  return { state: 'deciding', left, share: Math.min(1, (reduce ? whole : left) / window) };
}

/** The words on the bar. */
export function countdownWords(c: Countdown): string {
  if (c.state === 'in-time') return 'In time';
  if (c.state === 'too-late') return 'Too late: he gains ground';
  return `Decide: ${Math.ceil(c.left)} s`;
}

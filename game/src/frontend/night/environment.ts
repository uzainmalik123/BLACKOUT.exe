// How the night answers the fight (D-255): the room reacts to what the engine reports, and to nothing else. A breach
// (one of his moves landing, a large theft) makes the lights flicker; the player's fix that stops an attack steadies
// them and lifts the room a little; his return brings a moment of silence before he speaks; heavy theft quickens the
// heartbeat as much as a failing business does. Pure, so it is tested; the flicker never exceeds three flashes a
// second, and under reduced motion it is one slow dip.

import type { GameEvent } from '../../engine/log';

export interface Env {
  /** Seconds (the caller's clock) of the last breach, the last relief, the last return; -99 for never. */
  breachAt: number;
  reliefAt: number;
  silenceAt: number;
}

export const startEnv = (): Env => ({ breachAt: -99, reliefAt: -99, silenceAt: -99 });

/** How long each reaction lasts (seconds). */
export const LASTS = { flicker: 1.2, relief: 2.4, silence: 2.6 } as const;

/** The events since the last step: which reactions they start. `stopped` counts his attacks the player's fixes froze. */
export function envStep(env: Env, t: number, events: readonly GameEvent[], stopped = 0): Env {
  let e = env;
  for (const ev of events) {
    if (ev.kind === 'move-landed' || (ev.kind === 'souls-stolen' && ev.count >= 3)) e = { ...e, breachAt: t };
    else if ((ev.kind === 'move-cut' || ev.kind === 'door-shut' || ev.kind === 'tap-closed') && ev.by) e = { ...e, reliefAt: t };
    else if (ev.kind === 'return') e = { ...e, silenceAt: t };
  }
  if (stopped > 0) e = { ...e, reliefAt: t };
  return e;
}

/** The flicker's light level, `e` seconds into it: two quick dips, then the lights come back. */
function flicker(e: number): number {
  if (e < 0.1) return 0.45;
  if (e < 0.2) return 0.95;
  if (e < 0.3) return 0.55;
  return Math.min(1, 0.85 + (0.15 * (e - 0.3)) / (LASTS.flicker - 0.3));
}

/**
 * The room's light at `t` as a multiplier (1 is as it was): below 1 in a breach's flicker, a little above after
 * relief. Under reduced motion the flicker is one slow, shallow dip.
 */
export function lightAt(env: Env, t: number, reduce = false): number {
  let light = 1;
  const b = t - env.breachAt;
  if (b >= 0 && b < LASTS.flicker) light *= reduce ? 1 - 0.3 * Math.sin((Math.PI * b) / LASTS.flicker) : flicker(b);
  const r = t - env.reliefAt;
  if (r >= 0 && r < LASTS.relief) light *= 1 + 0.12 * Math.sin((Math.PI * r) / LASTS.relief);
  return light;
}

/** 0..1 how silent the night is at `t` (1: nothing but the silence), after his return. */
export function hushAt(env: Env, t: number): number {
  const e = t - env.silenceAt;
  if (e < 0 || e > LASTS.silence) return 0;
  if (e < 0.15) return e / 0.15;
  if (e > LASTS.silence - 0.5) return (LASTS.silence - e) / 0.5;
  return 1;
}

/** The heartbeat's reading of the night (0 failing .. 1 well): the business's health, or the records left, whichever is worse. */
export function urgencyOf(heartbeat: number, stolen: number, total: number): number {
  const health = Math.max(0, Math.min(1, heartbeat / 100));
  const kept = total > 0 ? 1 - 0.8 * (stolen / total) : 1;
  return Math.min(health, kept);
}

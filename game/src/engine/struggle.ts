// The struggle detector (SYS-13, D-113). "Struggling" = no useful action for a while, or souls falling fast. Each
// time it finds the player struggling and the last suggestion is older than that condition's own window, it unlocks
// one suggestion (a `suggestion` event): on Medium and Hard the way Kiro's hints (KIRO-03) are gated; on Easy Kiro
// helps anyway, so nothing is unlocked there. The detector only reads the clock, the souls and the event log.
import { CONFIG } from './config';
import { emit } from './log';
import type { World } from './state';

/** How many souls had been stolen `windowGameMs` ago, from the log (the last souls-stolen event at or before then). */
function stolenBefore(world: World, t: number): number {
  for (let i = world.events.length - 1; i >= 0; i--) {
    const e = world.events[i]!;
    if (e.t > t) continue;
    if (e.kind === 'souls-stolen') return e.stolen;
  }
  return 0;
}

/** Why the player is struggling right now, if they are: idle for the idle window, or souls down by the fraction within the souls window. */
export function struggling(world: World): 'idle' | 'souls' | undefined {
  const { idleGameMs, soulsWindowGameMs, soulsFraction } = CONFIG[world.difficulty].struggle;
  const now = world.clock.gameMs;
  if (now - world.struggle.lastUsefulActionAt >= idleGameMs) return 'idle';
  const fell = world.souls.stolen.length - stolenBefore(world, now - soulsWindowGameMs);
  if (fell > world.souls.total * soulsFraction) return 'souls';
  return undefined;
}

/** One tick: unlock a suggestion when struggling and the last one is older than the condition's window. */
export function stepStruggle(world: World): void {
  if (world.ending) return;
  const reason = struggling(world);
  if (reason === undefined) return;
  const cfg = CONFIG[world.difficulty].struggle;
  const window = reason === 'idle' ? cfg.idleGameMs : cfg.soulsWindowGameMs;
  const last = world.struggle.lastSuggestionAt;
  if (last !== undefined && world.clock.gameMs - last < window) return;
  world.struggle.lastSuggestionAt = world.clock.gameMs;
  if (!cfg.unlocks) return; // Easy: struggling is tracked, nothing is unlocked
  world.struggle.suggestions += 1;
  emit(world, { kind: 'suggestion', n: world.struggle.suggestions, reason });
}

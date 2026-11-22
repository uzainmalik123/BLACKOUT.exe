// The struggle detector (SYS-13, D-113, D-114). "Struggling" = no RELEVANT action for a while (the judging engine's
// verdict, SYS-21), souls falling fast, or the same biggest gap standing for a while. Each time it finds the player
// struggling and the last suggestion is older than that condition's own window, it unlocks one suggestion (a
// `suggestion` event carrying the gap's type, so a hint can target it): on Medium and Hard, where the terminal shows
// it (Hard too, D-114); on Easy Kiro helps anyway, so nothing is unlocked there.
import { CONFIG } from './config';
import { emit } from './log';
import type { World } from './state';

/** How many souls had been stolen at `t`, from the log (the last souls-stolen event at or before then). */
function stolenBefore(world: World, t: number): number {
  for (let i = world.events.length - 1; i >= 0; i--) {
    const e = world.events[i]!;
    if (e.t > t) continue;
    if (e.kind === 'souls-stolen') return e.stolen;
  }
  return 0;
}

export type StruggleReason = 'idle' | 'souls' | 'gap';

/** Why the player is struggling right now, if they are. */
export function struggling(world: World): StruggleReason | undefined {
  const { idleGameMs, soulsWindowGameMs, soulsFraction, gapGameMs } = CONFIG[world.difficulty].struggle;
  const now = world.clock.gameMs;
  if (now - world.assess.lastRelevantActionAt >= idleGameMs) return 'idle';
  const fell = world.souls.stolen.length - stolenBefore(world, now - soulsWindowGameMs);
  if (fell > world.souls.total * soulsFraction) return 'souls';
  const gap = world.assess.gap;
  if (gap !== undefined && now - gap.since >= gapGameMs) return 'gap';
  return undefined;
}

/** One tick: unlock a suggestion when struggling and the last one is older than the condition's window. */
export function stepStruggle(world: World): void {
  if (world.ending) return;
  const reason = struggling(world);
  if (reason === undefined) return;
  const cfg = CONFIG[world.difficulty].struggle;
  const window = reason === 'idle' ? cfg.idleGameMs : reason === 'souls' ? cfg.soulsWindowGameMs : cfg.gapGameMs;
  const last = world.struggle.lastSuggestionAt;
  if (last !== undefined && world.clock.gameMs - last < window) return;
  world.struggle.lastSuggestionAt = world.clock.gameMs;
  if (!cfg.unlocks) return; // Easy: struggling is tracked, nothing is unlocked
  world.struggle.suggestions += 1;
  const gap = world.assess.gap?.type;
  emit(world, { kind: 'suggestion', n: world.struggle.suggestions, reason, ...(gap !== undefined && { gap }) });
}

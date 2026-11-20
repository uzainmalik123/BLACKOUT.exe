// The Director (SYS-02) and banishment / the return (SYS-07). Every 3 real s it looks at the world and picks
// the next move whose Needs hold, preferring later stages and keeping stage order (D-19); deterministic for a seed.
import { MOVES, type Move } from '../rules/moves';
import { FOOTHOLDS, RETURN_GRANTS, type Foothold, type Gain, type Stage } from '../rules/vocabulary';
import { CONFIG } from './config';
import { anyStopperHolds, footholds, needsHold } from './facts';
import type { RecordingLibrary, Variant } from './library';
import { emit, endRun } from './log';
import { activeDeathReplay, startReplay } from './replay';
import { nextRandom, pick } from './rng';
import type { World } from './state';

const landed = (world: World, move: Move) => world.death.played.some((p) => p.move === move.id && p.outcome === 'landed');

/**
 * The variants of a move Death could start now: Needs hold and no stopper holds for that variant. A variant whose
 * recorded IP is blocked is still playable from a fresh address (D-24): blocking IPs alone is whack-a-mole.
 */
export function playableVariants(world: World, library: RecordingLibrary, move: Move): Variant[] {
  if (landed(world, move) || !needsHold(world, move)) return [];
  return library.variantsOf(move.id).filter((v) => !anyStopperHolds(world, move, { ...v.info, ip: 'fresh' }));
}

/** A new address in TEST-NET-3 for a variant whose recorded IP is blocked. */
function freshIp(world: World): string {
  let ip: string;
  do ip = `203.0.113.${1 + Math.floor(nextRandom(world) * 254)}`;
  while (world.firewall.blocked.includes(ip));
  return ip;
}

export function playableMoves(world: World, library: RecordingLibrary): Move[] {
  return MOVES.filter((m) => playableVariants(world, library, m).length > 0);
}

export function highestStagePlayed(world: World): number {
  return Math.max(0, ...world.death.played.filter((p) => p.outcome === 'landed').map((p) => MOVES.find((m) => m.id === p.move)!.stage));
}

/** D-19: a stage-N move only after a stage-(N-1) move; a tip-off skips one stage; the return ignores the order. */
export function stageAllowed(world: World, stage: Stage): boolean {
  return world.death.returnedThrough !== undefined || stage <= highestStagePlayed(world) + 1 + world.death.stageSkips;
}

/** Playable and allowed by stage order: what the Director can actually pick. */
export function candidateMoves(world: World, library: RecordingLibrary): Move[] {
  return playableMoves(world, library).filter((m) => stageAllowed(world, m.stage));
}

export function openAlerts(world: World): number {
  return world.alerts.filter((a) => a.closedAt === undefined).length;
}

export function returnGrants(foothold: Foothold): Gain {
  return RETURN_GRANTS[foothold];
}

/**
 * SYS-07. With nothing left to pick: no foothold → banished (win). A foothold → he goes quiet, and after the
 * return delay comes back through it (the return, an ending: D-24). Reopening a route ends the quiet.
 */
export function checkBanishment(world: World, library: RecordingLibrary): void {
  if (world.ending) return;
  if (candidateMoves(world, library).length > 0) {
    delete world.death.quietSince;
    return;
  }
  const left = footholds(world);
  if (left.size === 0) {
    emit(world, { kind: 'banished' });
    endRun(world, 'banished');
    return;
  }
  const now = world.clock.gameMs;
  if (world.death.quietSince === undefined) {
    world.death.quietSince = now;
    emit(world, { kind: 'banished' });
    return;
  }
  if (now - world.death.quietSince < CONFIG[world.difficulty].returnDelayGameMs) return;
  const through = FOOTHOLDS.find((f) => left.has(f))!;
  world.death.returnedThrough = through;
  emit(world, { kind: 'return', through });
  endRun(world, 'return');
}

function pace(world: World): void {
  const { pacing, moveGapGameMs } = CONFIG[world.difficulty];
  const now = world.clock.gameMs;
  const open = openAlerts(world);
  if (open > pacing.delayAboveOpenAlerts) {
    if (!world.death.pacingDelayed) {
      world.death.pacingDelayed = true;
      world.death.nextMoveAt = Math.max(world.death.nextMoveAt, now) + moveGapGameMs;
    }
  } else world.death.pacingDelayed = false;
  if (open > 0) world.quietAlertsSince = now;
  else if (now - world.quietAlertsSince >= pacing.bringForwardAfterQuietGameMs) world.death.nextMoveAt = Math.min(world.death.nextMoveAt, now);
}

export function directorTick(world: World, library: RecordingLibrary): void {
  if (world.ending || activeDeathReplay(world)) return;
  pace(world);
  const candidates = candidateMoves(world, library);
  if (candidates.length === 0) {
    checkBanishment(world, library);
    return;
  }
  delete world.death.quietSince;
  if (world.clock.gameMs < world.death.nextMoveAt) return;
  const top = Math.max(...candidates.map((m) => m.stage));
  const move = pick(world, candidates.filter((m) => m.stage === top));
  const variants = playableVariants(world, library, move);
  const untried = variants.filter((v) => !world.death.played.some((p) => p.move === move.id && p.variant === v.variant));
  const open = untried.filter((v) => !world.firewall.blocked.includes(v.info.ip));
  const resumable = variants.find((v) => world.death.resume[move.id]?.variant === v.variant);
  const chosen = (resumable ?? open[0] ?? untried[0] ?? variants[0])!;
  const variant = world.firewall.blocked.includes(chosen.info.ip) ? { ...chosen, info: { ...chosen.info, ip: freshIp(world) } } : chosen;
  if (move.stage > highestStagePlayed(world) + 1) world.death.stageSkips -= 1;
  startReplay(world, variant, 'death');
}

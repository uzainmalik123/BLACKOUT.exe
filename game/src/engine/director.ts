// The Director (SYS-02) and banishment / the return (SYS-07). Every 3 real s it looks at the world and picks
// the next move whose Needs hold, preferring later stages and keeping stage order (D-19); deterministic for a seed.
import { MOVES, type Move } from '../rules/moves';
import { FOOTHOLDS, RETURN_GRANTS, STAGES, type Foothold, type Gain, type MoveId, type Stage } from '../rules/vocabulary';
import { CONFIG } from './config';
import { doorHalves, doorOpenForWin, isDoor, landed, soulKeys, unstolen } from './doors';
import { anyStopperHolds, footholds, needsHold } from './facts';
import type { RecordingLibrary, Variant } from './library';
import { emit, endRun } from './log';
import { activeDeathReplay, startReplay } from './replay';
import { nextRandom, pick } from './rng';
import type { World } from './state';

/** D-42: a big soul door that has landed is his door; he comes back to it whenever it is open (D-44). */
export function isHisDoor(world: World, move: Move): boolean {
  return isDoor(move) && landed(world, move.id);
}

/**
 * The variants of a move Death could start now: Needs hold and no stopper holds for that variant. A variant whose
 * recorded IP is blocked is still playable from a fresh address (D-24): blocking IPs alone is whack-a-mole. A move
 * that has landed is done, except his soul doors, which stay playable while a half still has unstolen rows and no
 * fix holds for it (D-42, D-44).
 */
export function playableVariants(world: World, library: RecordingLibrary, move: Move): Variant[] {
  if (!needsHold(world, move)) return [];
  const his = isHisDoor(world, move);
  if (landed(world, move.id) && !his) return [];
  return doorHalves(world, library, move)
    .filter((v) => !anyStopperHolds(world, move, { ...v.info, ip: 'fresh' }))
    .filter((v) => !his || unstolen(world, v) > 0);
}

/** D-42: the half a visit plays: the first whose soul rows are still more than half unstolen, else the one with the most unstolen. */
export function pickHalf(world: World, variants: Variant[]): Variant | undefined {
  const fresh = variants.find((v) => unstolen(world, v) * 2 > soulKeys(v).length);
  if (fresh) return fresh;
  let best: Variant | undefined;
  for (const v of variants) if (!best || unstolen(world, v) > unstolen(world, best)) best = v;
  return best;
}

/** The address ranges Death's fresh addresses come from: TEST-NET-3 (D-15), then TEST-NET-2 once it is all blocked (D-45). */
const RANGES = ['203.0.113', '198.51.100'] as const;

/** A new address for a variant whose recorded IP is blocked: blocking addresses alone never stops him (D-24). */
function freshIp(world: World): string {
  const blocked = new Set(world.firewall.blocked);
  const range = RANGES.find((r) => Array.from({ length: 254 }, (_, i) => `${r}.${i + 1}`).some((ip) => !blocked.has(ip))) ?? RANGES[0];
  let ip: string;
  do ip = `${range}.${1 + Math.floor(nextRandom(world) * 254)}`;
  while (blocked.has(ip) && range !== RANGES[0]); // both ranges blocked: any address; the block cuts him again at once
  return ip;
}

/** Every move whose route is open: Needs hold, a variant he may play isn't stopped, a door has rows left. */
export function playableMoves(world: World, library: RecordingLibrary): Move[] {
  return MOVES.filter((m) => playableVariants(world, library, m).length > 0);
}

/**
 * SYS-07, D-45: the routes the win check counts. Stage order aside: a stage he can't enter yet is still a door left
 * open. And a soul door counts until a lasting fix closes it (its patch or a WAF rule): a flag or a revoke holds it
 * shut during play, but the win needs the real fix.
 */
export function openRoutes(world: World, library: RecordingLibrary): Move[] {
  return MOVES.filter((m) => (isDoor(m) ? doorOpenForWin(world, library, m, needsHold(world, m)) : playableVariants(world, library, m).length > 0));
}

export function highestStagePlayed(world: World): number {
  return Math.max(0, ...world.death.played.filter((p) => p.outcome === 'landed').map((p) => MOVES.find((m) => m.id === p.move)!.stage));
}

/** The next stage Death may enter: the lowest recorded stage above the highest he has landed (a stage with no recording is skipped). */
export function nextStage(world: World, library: RecordingLibrary): number {
  const highest = highestStagePlayed(world);
  const recorded = STAGES.filter((st) => st > highest && MOVES.some((m) => m.stage === st && library.variantsOf(m.id).length > 0));
  return recorded[0] ?? highest + 1;
}

/** D-19: a stage-N move only after a stage-(N-1) move; a tip-off skips one stage; the return ignores the order. */
export function stageAllowed(world: World, library: RecordingLibrary, stage: Stage): boolean {
  return world.death.returnedThrough !== undefined || stage <= nextStage(world, library) + world.death.stageSkips;
}

/** Playable and allowed by stage order: what the Director can actually pick. */
export function candidateMoves(world: World, library: RecordingLibrary): Move[] {
  return playableMoves(world, library).filter((m) => stageAllowed(world, library, m.stage));
}

export function openAlerts(world: World): number {
  return world.alerts.filter((a) => a.closedAt === undefined).length;
}

export function returnGrants(foothold: Foothold): Gain {
  return RETURN_GRANTS[foothold];
}

/**
 * SYS-07. With every route closed (whatever its stage, D-45): no foothold and no open tap → banished (win); a tap
 * still dripping → not yet (D-44). A foothold → he goes quiet, and after the return delay comes back through it
 * (the return, an ending: D-24). Reopening a route ends the quiet.
 */
export function checkBanishment(world: World, library: RecordingLibrary): void {
  if (world.ending) return;
  if (openRoutes(world, library).length > 0) {
    delete world.death.quietSince;
    return;
  }
  const left = footholds(world);
  if (left.size === 0) {
    if (world.taps.open.length > 0) return; // D-44: every door closed, open taps included
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

/** D-41: once the ransom (ATK-17, the finale) has landed he starts nothing new; SYS-07 still counts his open routes. */
export function finaleLanded(world: World): boolean {
  return world.death.played.some((p) => p.move === 'ATK-17' && p.outcome === 'landed');
}

function pace(world: World): void {
  const { pacing, breatherGameMs } = CONFIG[world.difficulty];
  const now = world.clock.gameMs;
  const open = openAlerts(world);
  // D-43: 2 or more open alerts as he is about to pick add the level's longest breather, at most once between two moves
  // (startReplay clears the flag when he starts one).
  if (open >= pacing.delayAtOpenAlerts && !world.death.pacingDelayed) {
    world.death.pacingDelayed = true;
    world.death.nextMoveAt = Math.max(world.death.nextMoveAt, now) + breatherGameMs.max;
  }
  if (open > 0) world.quietAlertsSince = now;
  else if (now - world.quietAlertsSince >= pacing.bringForwardAfterQuietGameMs) world.death.nextMoveAt = Math.min(world.death.nextMoveAt, now);
}

/** D-42: the open door a visit goes to: the one whose playable halves hold the most unstolen souls (the lower id on a tie). */
function doorToVisit(world: World, library: RecordingLibrary, doors: Move[]): Move {
  const loot = (m: Move) => Math.max(0, ...playableVariants(world, library, m).map((v) => unstolen(world, v)));
  return doors.reduce((best, m) => (loot(m) > loot(best) ? m : best));
}

export function directorTick(world: World, library: RecordingLibrary): void {
  if (world.ending || world.nginx === 'stopped' || activeDeathReplay(world)) return; // nothing reaches a stopped server
  pace(world);
  const candidates = candidateMoves(world, library);
  if (candidates.length === 0) {
    checkBanishment(world, library);
    return;
  }
  delete world.death.quietSince;
  if (world.clock.gameMs < world.death.nextMoveAt) return;
  if (!CONFIG[world.difficulty].minions.alongsideDeath && world.waves.length > 0) return; // D-41: Easy never overlaps a wave
  // D-42, D-45: a paused visit to one of his doors carries on first; it is the same visit, not a new move.
  const resumed = candidates.find((m) => isHisDoor(world, m) && world.death.resume[m.id] !== undefined);
  if (resumed) {
    startDoor(world, library, resumed);
    return;
  }
  // D-42: every second move he starts is a visit to one of his open doors; with no story move left (or after the
  // finale, D-41), every move is.
  const doors = candidates.filter((m) => isHisDoor(world, m));
  const story = finaleLanded(world) ? [] : candidates.filter((m) => !isHisDoor(world, m));
  if (doors.length > 0 && (story.length === 0 || world.death.lastPick === 'story')) {
    world.death.lastPick = 'visit';
    startDoor(world, library, doorToVisit(world, library, doors));
    return;
  }
  if (story.length === 0) return;
  world.death.lastPick = 'story';
  // D-41: not the move just cut by a stopper, unless it is the only one he could pick (KI-56, D-43).
  const fresh = story.filter((m) => m.id !== world.death.noRepeat);
  const pool = fresh.length > 0 ? fresh : story;
  const top = Math.max(...pool.map((m) => m.stage));
  const move = pick(world, pool.filter((m) => m.stage === top));
  if (isDoor(move)) {
    if (move.stage > nextStage(world, library)) world.death.stageSkips -= 1;
    startDoor(world, library, move); // a door's first entry plays a half too (D-42)
    return;
  }
  const variants = playableVariants(world, library, move);
  const untried = variants.filter((v) => !world.death.played.some((p) => p.move === move.id && p.variant === v.variant));
  const open = untried.filter((v) => !world.firewall.blocked.includes(v.info.ip));
  const resumable = variants.find((v) => world.death.resume[move.id]?.variant === v.variant);
  const chosen = (resumable ?? open[0] ?? untried[0] ?? variants[0])!;
  const variant = world.firewall.blocked.includes(chosen.info.ip) ? { ...chosen, info: { ...chosen.info, ip: freshIp(world) } } : chosen;
  if (move.stage > nextStage(world, library)) world.death.stageSkips -= 1;
  startReplay(world, variant, 'death');
}

/** D-42: starts a big soul door, a first entry or a visit: the paused half if there is one, else the half pickHalf chooses. */
function startDoor(world: World, library: RecordingLibrary, move: Move): void {
  const variants = playableVariants(world, library, move);
  const saved = world.death.resume[move.id as MoveId];
  const chosen = variants.find((v) => saved?.variant === v.variant) ?? pickHalf(world, variants);
  if (!chosen) return;
  const variant = world.firewall.blocked.includes(chosen.info.ip) ? { ...chosen, info: { ...chosen.info, ip: freshIp(world) } } : chosen;
  startReplay(world, variant, 'death');
}

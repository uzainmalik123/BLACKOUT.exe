// The headless driver for the playthrough sims (SYS-16) and anything else that wants to run a whole incident
// without a UI: a scripted player is asked for actions every 100 real ms until an ending or the time limit.
import type { Difficulty, PlayerAction } from '../rules/vocabulary';
import { applyAction } from './actions';
import { advance } from './advance';
import { COMMITTED_LIBRARY } from './engine';
import type { RecordingLibrary } from './library';
import type { GameEvent } from './log';
import { initialWorld, type World } from './state';

export type ScriptedPlayer = (world: World, realElapsedMs: number) => PlayerAction[];

export interface SimResult {
  world: World;
  events: GameEvent[];
  realMs: number;
}

const STEP_REAL_MS = 100;

export function runSim(opts: { seed: number; difficulty?: Difficulty; library?: RecordingLibrary; player: ScriptedPlayer; maxRealMs?: number }): SimResult {
  const world = initialWorld(opts.seed, opts.difficulty ?? 'medium');
  const library = opts.library ?? COMMITTED_LIBRARY;
  const max = opts.maxRealMs ?? 12 * 60_000;
  let realMs = 0;
  while (realMs < max && !world.ending) {
    for (const a of opts.player(world, realMs)) applyAction(world, a);
    advance(world, library, STEP_REAL_MS);
    realMs += STEP_REAL_MS;
  }
  return { world, events: world.events, realMs };
}

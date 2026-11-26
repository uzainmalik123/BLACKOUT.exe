// The headless driver for the playthrough sims (SYS-16) and anything else that wants to run a whole incident
// without a UI: a scripted player is asked for actions every 100 real ms until an ending or the time limit.
import type { Difficulty, PlayerAction } from '../rules/vocabulary';
import { applyAction } from './actions';
import { advance } from './advance';
import { COMMITTED_LIBRARY } from './engine';
import type { RecordingLibrary } from './library';
import type { GameEvent } from './log';
import { beginShift } from './shift';
import { initialWorld, type World } from './state';
import { lab } from './test-fixtures/lab';

export type ScriptedPlayer = (world: World, realElapsedMs: number) => PlayerAction[];

export interface SimResult {
  world: World;
  events: GameEvent[];
  realMs: number;
}

const STEP_REAL_MS = 100;

export function runSim(opts: {
  seed: number; difficulty?: Difficulty; library?: RecordingLibrary; player: ScriptedPlayer; maxRealMs?: number;
  setup?: (world: World) => void; // start from a given state (a shop already defaced, ...)
  lab?: boolean; // D-230: skip the shift's start: Death from 0, no freeze (a lab that measures a drain, not the opening)
}): SimResult {
  const world = initialWorld(opts.seed, opts.difficulty ?? 'medium');
  opts.setup?.(world);
  if (opts.lab) lab(world);
  else beginShift(world); // D-230: a sim plays the desk: the calm, then the freeze until the incident is declared
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

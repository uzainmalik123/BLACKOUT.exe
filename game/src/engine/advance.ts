// The one time step: real milliseconds in, the world moved forward in fixed game-time sub-steps (D-24),
// so the order of effects never depends on the frame rate. Everything the engine does over time happens here.
import { applyPendingPatches, takeBackupIfDue } from './actions';
import { stepAssess } from './assess';
import { realToGameMs } from './clock';
import { CONFIG } from './config';
import { stepCustomers } from './customers';
import { refreshDoors } from './doors';
import { integrateHeartbeat } from './heartbeat';
import type { RecordingLibrary } from './library';
import { directorTick } from './director';
import { endRun } from './log';
import { stepWaves } from './minions';
import { stepReplays } from './replay';
import { soulsLeft } from './souls';
import { stepTaps } from './taps';
import type { World } from './state';

/** Souls all taken or heartbeat at 0 end the run (SYS-05, SYS-06). Banishment and the return are the Director's. */
export function checkEndings(world: World): void {
  if (world.ending) return;
  if (soulsLeft(world) === 0) endRun(world, 'souls-lost');
  else if (world.heartbeat <= 0) endRun(world, 'flatline');
}

function step(world: World, library: RecordingLibrary, dt: number): void {
  world.clock.gameMs += dt;
  applyPendingPatches(world);
  takeBackupIfDue(world);
  stepReplays(world, library);
  stepWaves(world, library);
  stepTaps(world);
  stepCustomers(world, library); // SYS-19: after Death and the minions, so their addresses are known (D-65)
  refreshDoors(world, library); // D-44: a door is shut only while its fix holds
  integrateHeartbeat(world, dt);
  const config = CONFIG[world.difficulty];
  if (world.clock.gameMs - world.clock.lastDirectorTick >= config.directorPeriodGameMs) {
    world.clock.lastDirectorTick = world.clock.gameMs;
    directorTick(world, library);
  }
  checkEndings(world);
  stepAssess(world); // SYS-21: last, so the snapshot sees everything this step did, the ending included
}

export function advance(world: World, library: RecordingLibrary, realMs: number): void {
  if (world.clock.paused || world.ending) return;
  const tick = CONFIG[world.difficulty].tickGameMs;
  let left = realToGameMs(world, realMs);
  while (left > 0 && !world.ending) {
    const dt = Math.min(tick, left);
    step(world, library, dt);
    left -= dt;
  }
}

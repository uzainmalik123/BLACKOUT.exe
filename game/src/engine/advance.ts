// The one time step: real milliseconds in, the world moved forward in fixed game-time sub-steps (D-24),
// so the order of effects never depends on the frame rate. Everything the engine does over time happens here.
import { applyPendingPatches, takeBackupIfDue } from './actions';
import { stepAlerts } from './alerts';
import { stepDecisions } from './decisions';
import { stepAssess } from './assess';
import { stepBandages } from './bandages';
import { stepFlags } from './flags';
import { stepPlaybook } from './playbook';
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
import { shiftOver, shiftVerdict } from './shift';
import { soulsLeft } from './souls';
import { stepStruggle } from './struggle';
import { stepNotificationClock } from './notification';
import { stepTaps } from './taps';
import { stepTraining } from './training';
import type { World } from './state';

/** Souls all taken, heartbeat at 0, or the shift over end the run (SYS-05, SYS-06, D-118). Banishment and the return are the Director's. */
export function checkEndings(world: World, library: RecordingLibrary): void {
  if (world.ending) return;
  if (soulsLeft(world) === 0) endRun(world, 'souls-lost');
  else if (world.heartbeat <= 0) endRun(world, 'flatline');
  else if (shiftOver(world)) endRun(world, shiftVerdict(world, library));
}

function step(world: World, library: RecordingLibrary, dt: number): void {
  const drill = world.training !== undefined; // SYS-24 (D-236): the training shift: a script, no pests, no endings, no judge
  world.clock.gameMs += dt;
  applyPendingPatches(world);
  takeBackupIfDue(world);
  stepReplays(world, library);
  if (!drill) {
    stepWaves(world, library);
    stepTaps(world);
  }
  stepCustomers(world, library); // SYS-19: after Death and the minions, so their addresses are known (D-65)
  stepAlerts(world); // SYS-20, D-232: the detectors over this tick's lines, changes and uploads
  if (!drill) stepDecisions(world); // SYS-25, D-261: an alert left past its window costs a heartbeat dip (the drill waits for the trainee)
  stepFlags(world); // DEF-21, D-233: a hostile line from a flagged address confirms it
  if (!drill) stepBandages(world, library); // SYS-23, D-231: a bandage whose breathers are over has failed
  refreshDoors(world, library); // D-44: a door is shut only while its fix holds
  integrateHeartbeat(world, dt);
  stepNotificationClock(world); // SYS-14
  if (drill) {
    stepTraining(world, library); // D-236: the script in place of the Director and the endings
    stepPlaybook(world);
    return;
  }
  const config = CONFIG[world.difficulty];
  if (world.clock.gameMs - world.clock.lastDirectorTick >= config.directorPeriodGameMs) {
    world.clock.lastDirectorTick = world.clock.gameMs;
    directorTick(world, library);
  }
  checkEndings(world, library);
  stepPlaybook(world); // D-233: the "Now:" strip's phase, from visible events and the player's own acts
  stepAssess(world); // SYS-21: last, so the snapshot sees everything this step did, the ending included
  stepStruggle(world); // SYS-13: reads the assessor's verdicts and its biggest gap
}

/** The run is over: an ending, or the drill complete (D-236). */
const over = (world: World): boolean => world.ending !== undefined || world.training?.completeAt !== undefined;

export function advance(world: World, library: RecordingLibrary, realMs: number): void {
  if (world.clock.paused || over(world)) return;
  const tick = CONFIG[world.difficulty].tickGameMs;
  let left = realToGameMs(world, realMs);
  while (left > 0 && !over(world)) {
    const dt = Math.min(tick, left);
    step(world, library, dt);
    left -= dt;
  }
}

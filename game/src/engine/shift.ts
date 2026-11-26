// The end of the shift (D-118): the clock runs out at config.shiftGameMs and the judge picks a verdict. Clean handover:
// every soul door he found really fixed (its patch or a WAF rule, D-117), souls lost under a quarter, the shop alive.
// Rough handover: the shop alive, souls lost under half, a found door without its real fix. Walked away (a loss): souls
// lost at half or more, or a found door open with no real fix. The report shows the verdict first.
import { MOVE_BY_ID, SOUL_DOORS } from '../rules/moves';
import type { Ending, MoveId } from '../rules/vocabulary';
import { CONFIG } from './config';
import { doorHalves, found, LASTING_FIXES } from './doors';
import { stopperHolds } from './facts';
import type { RecordingLibrary } from './library';
import { emit } from './log';
import { mulberry, type World } from './state';

/**
 * SYS-22 (D-230): the shift begins when the desk shows. Nothing of Death's happens before this; his first move waits
 * a seeded `firstMoveDelayRealMs` from here (drawn from the shift's own stream, so his own draws don't move), the
 * minion waves and the leaky taps wait for that first move, and the change freeze holds until the incident is
 * declared. Idempotent. A lab world that never calls it runs as before (no freeze, no wait).
 */
export function beginShift(world: World, opts: { firstMoveDelayGameMs?: number } = {}): void {
  if (world.shift.beganAt !== undefined) return;
  const now = world.clock.gameMs;
  const config = CONFIG[world.difficulty];
  const { min, max } = config.firstMoveDelayRealMs;
  const draw = mulberry(world.shift.rng);
  world.shift.rng = draw.state;
  const delay = opts.firstMoveDelayGameMs ?? Math.round((min + draw.value * (max - min)) * config.gameMsPerRealMs);
  world.shift.beganAt = now;
  world.death.nextMoveAt = Math.max(world.death.nextMoveAt, now + delay);
  world.quietAlertsSince = now; // D-43's bring-forward counts quiet from the desk, never into the calm
  emit(world, { kind: 'shift-begun' });
}

/** D-230: the freeze holds from the shift's start until the incident is declared; a lab world (no beginShift) is never frozen. */
export function changeFrozen(world: World): boolean {
  return world.shift.beganAt !== undefined && world.incident.declaredAt === undefined;
}

/** D-230, D-233: the first alert, an escalation or a confirmed flag declares the incident and lifts the freeze, once. */
export function declareIncident(world: World, by: 'alert' | 'escalation' | 'flag'): void {
  if (world.incident.declaredAt !== undefined) return;
  world.incident = { declaredAt: world.clock.gameMs, by };
  emit(world, { kind: 'incident-declared', by });
}

/** D-230: Death's first move started: the minions' and the taps' schedules count from now. Once. */
export function noteFirstMove(world: World): void {
  if (world.shift.firstMoveAt !== undefined || world.shift.beganAt === undefined) return;
  const now = world.clock.gameMs;
  world.shift.firstMoveAt = now;
  for (const id of Object.keys(world.nextWaveAt) as Array<keyof World['nextWaveAt']>) world.nextWaveAt[id] += now;
  world.taps.nextAt += now;
}

/** D-230: are the minions and the taps allowed to start yet? In a begun shift, only after his first move; in the lab, always. */
export function pestsMayStart(world: World): boolean {
  return world.shift.beganAt === undefined || world.shift.firstMoveAt !== undefined;
}

export const VERDICTS = { clean: 0.25, rough: 0.5 } as const; // D-118 (tune): shares of the souls lost

/** The soul doors he has found (got into, D-117) that still lack their real fix on every half, and the ones among them nothing shuts right now. */
export function unfixedDoors(world: World, library: RecordingLibrary): { unfixed: MoveId[]; open: MoveId[] } {
  const unfixed = SOUL_DOORS.filter((d) => {
    if (!found(world, d)) return false;
    const move = MOVE_BY_ID[d];
    const lasting = move.stoppedBy.filter((s) => LASTING_FIXES.has(s.action));
    return doorHalves(world, library, move).some((v) => !lasting.some((s) => stopperHolds(world, s, { ...v.info, ip: 'fresh' })));
  });
  return { unfixed, open: unfixed.filter((d) => !world.death.shutDoors.includes(d)) };
}

/** The verdict the judge gives when the shift ends with the shop still alive. */
export function shiftVerdict(world: World, library: RecordingLibrary): Extract<Ending, 'clean-handover' | 'rough-handover' | 'walked-away'> {
  const lost = world.souls.total > 0 ? world.souls.stolen.length / world.souls.total : 0;
  const doors = unfixedDoors(world, library);
  // D-260: a 3-minute night ends on the shop's state as well: handed over down (the plug left pulled) is walking away,
  // and a defacement still live is no clean handover (on a long night both flatlined the shop first)
  if (lost >= VERDICTS.rough || doors.open.length > 0 || world.nginx === 'stopped') return 'walked-away';
  if (doors.unfixed.length === 0 && lost < VERDICTS.clean && world.defacements.length === 0) return 'clean-handover';
  return 'rough-handover';
}

export function shiftOver(world: World): boolean {
  return world.clock.gameMs >= world.clock.shiftEndsAt;
}

/** For the lab sims that measure a harvest or a drain over longer than a shift (SYS-16): the shift never ends. */
export function noShift(world: World): void {
  world.clock.shiftEndsAt = Number.MAX_SAFE_INTEGER;
}

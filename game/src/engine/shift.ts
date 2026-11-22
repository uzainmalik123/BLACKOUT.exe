// The end of the shift (D-118): the clock runs out at config.shiftGameMs and the judge picks a verdict. Clean handover:
// every soul door he found really fixed (its patch or a WAF rule, D-117), souls lost under a quarter, the shop alive.
// Rough handover: the shop alive, souls lost under half, a found door without its real fix. Walked away (a loss): souls
// lost at half or more, or a found door open with no real fix. The report shows the verdict first.
import { MOVE_BY_ID, SOUL_DOORS } from '../rules/moves';
import type { Ending, MoveId } from '../rules/vocabulary';
import { doorHalves, found, LASTING_FIXES } from './doors';
import { stopperHolds } from './facts';
import type { RecordingLibrary } from './library';
import type { World } from './state';

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
  if (lost >= VERDICTS.rough || doors.open.length > 0) return 'walked-away';
  if (doors.unfixed.length === 0 && lost < VERDICTS.clean) return 'clean-handover';
  return 'rough-handover';
}

export function shiftOver(world: World): boolean {
  return world.clock.gameMs >= world.clock.shiftEndsAt;
}

/** For the lab sims that measure a harvest or a drain over longer than a shift (SYS-16): the shift never ends. */
export function noShift(world: World): void {
  world.clock.shiftEndsAt = Number.MAX_SAFE_INTEGER;
}

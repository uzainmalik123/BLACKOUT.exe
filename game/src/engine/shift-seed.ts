// D-230: the shift's own PRNG state, derived from the run's seed (the first-move delay draws from it, so Death's own
// draws and the move sequence of a seed stay where they were). Its own module: state.ts and shift.ts both need it.
export function shiftSeed(seed: number): number {
  return (seed ^ 0x5be11a7e) >>> 0;
}

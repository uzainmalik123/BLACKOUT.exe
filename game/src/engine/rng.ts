// A seeded PRNG (mulberry32) whose state lives in world.rng, so a run is deterministic for its seed (SYS-02).
import type { World } from './state';

/** The next number in [0, 1), advancing world.rng. */
export function nextRandom(world: World): number {
  world.rng = (world.rng + 0x6d2b79f5) >>> 0;
  let t = world.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pick<T>(world: World, items: readonly T[]): T {
  return items[Math.floor(nextRandom(world) * items.length)]!;
}

// The game clock (SYS-01): 1 real s = 30 game s; pausable only on Easy. Times are game ms since the scenario start.
import { CONFIG } from './config';
import type { World } from './state';

export function realToGameMs(world: World, realMs: number): number {
  return realMs * CONFIG[world.difficulty].gameMsPerRealMs;
}

/** True when the pause took; on Medium and Hard the pause key does nothing. */
export function pause(world: World): boolean {
  if (!CONFIG[world.difficulty].pausable) return false;
  world.clock.paused = true;
  return true;
}

export function resume(world: World): void {
  world.clock.paused = false;
}

export function gameTimeMs(world: World, gameMs = world.clock.gameMs): number {
  return Date.parse(CONFIG[world.difficulty].scenarioStartIso) + gameMs;
}

export function gameTimeIso(world: World, gameMs = world.clock.gameMs): string {
  return new Date(gameTimeMs(world, gameMs)).toISOString();
}

/** "HH:MM" of game time, for the dashboard's clock. */
export function gameClockLabel(world: World): string {
  return gameTimeIso(world).slice(11, 16);
}

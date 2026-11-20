// Heartbeat (SYS-06, D-08): the business staying alive. Drains per REAL minute while a cause is present (D-33),
// recovers once every cause is gone, never leaves 0..100.
import { FEATURE_DEFAULTS, FEATURES } from '../rules/vocabulary';
import { CONFIG } from './config';
import type { World } from './state';

const clamp = (x: number) => Math.min(100, Math.max(0, x));

/** The SYS-06 drain for the world as it stands, per real minute. 0 means it is recovering. */
export function drainPerRealMinute(world: World): number {
  const { drainPerRealMin: d, featureWeight } = CONFIG[world.difficulty].heartbeat;
  let drain = 0;
  if (world.replays.some((r) => r.owner === 'death')) drain += d.openDoor;
  drain += d.minion * world.waves.length;
  for (const f of FEATURES) if (world.features[f] !== FEATURE_DEFAULTS[f]) drain += featureWeight[f];
  if (world.nginx === 'stopped') drain += d.plug;
  if (world.defacements.length > 0) drain += d.defaced;
  return drain;
}

export function integrateHeartbeat(world: World, dtGameMs: number): void {
  const config = CONFIG[world.difficulty];
  const minutes = dtGameMs / config.gameMsPerRealMs / 60_000;
  const drain = drainPerRealMinute(world);
  const delta = drain > 0 ? -drain : config.heartbeat.drainPerRealMin.recover;
  world.heartbeat = clamp(world.heartbeat + delta * minutes);
}

/** A one-off cost (DEF-07, DEF-09, DEF-13, DEF-14, DEF-16). */
export function dip(world: World, amount: number): void {
  world.heartbeat = clamp(world.heartbeat - Math.max(0, amount));
}

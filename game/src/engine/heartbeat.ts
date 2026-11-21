// Heartbeat (SYS-06, D-08): the business staying alive. Drains per REAL minute while a cause is present (D-33),
// recovers once every cause is gone, never leaves 0..heartbeatMax. What the player does to the customers (a flag,
// a rate limit, a WAF rule, an IP block) has no weight of its own: each customer request it fails costs its class's
// price at once, and a customer who gives up lowers the maximum for good (the backlash, SYS-19, D-65).
import type { RequestClass } from '../rules/vocabulary';
import { CONFIG } from './config';
import { emit } from './log';
import type { World } from './state';

const clamp = (world: World, x: number) => Math.min(world.heartbeatMax, Math.max(0, x));

/** The SYS-06 drain for the world as it stands, per real minute. 0 means it is recovering. */
export function drainPerRealMinute(world: World): number {
  const { drainPerRealMin: d } = CONFIG[world.difficulty].heartbeat;
  let drain = 0;
  if (world.replays.some((r) => r.owner === 'death' && r.frozenSince === undefined)) drain += d.openDoor; // a frozen visit isn't using the door (D-45)
  drain += d.minion * world.waves.length;
  if (world.nginx === 'stopped') drain += d.plug;
  if (world.defacements.length > 0) drain += d.defaced;
  return drain;
}

/** D-65: a customer failed within the last real minute, so the shop is still bleeding: no recovery yet. */
export function customersFailing(world: World): boolean {
  const last = world.customers.lastFailureAt;
  return last !== undefined && world.clock.gameMs - last < CONFIG[world.difficulty].customers.recoverAfterGameMs;
}

export function integrateHeartbeat(world: World, dtGameMs: number): void {
  const config = CONFIG[world.difficulty];
  const minutes = dtGameMs / config.gameMsPerRealMs / 60_000;
  const drain = drainPerRealMinute(world);
  const delta = drain > 0 ? -drain : customersFailing(world) ? 0 : config.heartbeat.drainPerRealMin.recover;
  world.heartbeat = clamp(world, world.heartbeat + delta * minutes);
}

/** A one-off cost (DEF-07, DEF-09, DEF-13, DEF-14, DEF-16). */
export function dip(world: World, amount: number): void {
  world.heartbeat = clamp(world, world.heartbeat - Math.max(0, amount));
}

/** D-65: one customer request the player's actions failed: its class's price, at once. */
export function backlash(world: World, about: RequestClass): void {
  dip(world, CONFIG[world.difficulty].customers.cost[about]);
  world.customers.lastFailureAt = world.clock.gameMs;
  world.customers.failed += 1;
}

/** D-65: a customer gave up: the heartbeat's maximum drops for good (never below 0), and the heartbeat with it. */
export function churn(world: World, about: RequestClass): void {
  world.heartbeatMax = Math.max(0, world.heartbeatMax - CONFIG[world.difficulty].customers.churn);
  world.heartbeat = clamp(world, world.heartbeat);
  world.customers.lost += 1;
  emit(world, { kind: 'customer-lost', about, max: world.heartbeatMax });
}

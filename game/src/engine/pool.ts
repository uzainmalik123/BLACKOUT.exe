// The shared address pool (SYS-19, D-60, D-65): customers, Death's fresh addresses, the minions' waves, the proxy
// pools and the taps' scrapers all draw from the three documentation ranges, and nobody takes an address someone
// else holds at that moment, so a range never gives anyone away. Recordings keep D-15's 203.0.113.0/24; the engine
// remaps at replay.
import { MOVES } from '../rules/moves';
import { MINION_IDS } from '../rules/vocabulary';
import type { RecordingLibrary } from './library';
import type { World } from './state';

/** TEST-NET-1, TEST-NET-2, TEST-NET-3 (RFC 5737). */
export const POOL_RANGES = ['192.0.2', '198.51.100', '203.0.113'] as const;

/** The addresses the customers hold right now (this loop's shoppers, D-65). */
export function customerAddresses(world: World): Set<string> {
  return new Set(Object.values(world.customers.addresses));
}

/**
 * D-111 (KI-90): every address Death or his proxies use or have used this run: the address of each move he started
 * (a recorded start, a fresh one after an IP block: D-24), every address one of his access lines came from (the
 * proxies he rotated through, D-46) and the pool his move holds right now. A minion's, a customer's or the shop's own
 * address is never his, so an active lookup of it (DEF-04) tips nobody off.
 */
export function deathAddresses(world: World): Set<string> {
  const used = new Set<string>();
  for (const r of world.replays) if (r.owner === 'death') for (const ip of r.ips ?? [r.ip]) used.add(ip);
  for (const e of world.events) if (e.kind === 'move-started') used.add(e.ip);
  for (const l of world.logs.access) if (l.by.startsWith('ATK-')) used.add(l.ip);
  return used;
}

/** The addresses Death's replays and the minions' waves hold right now. */
export function attackerAddresses(world: World): Set<string> {
  const held = new Set<string>();
  for (const r of world.replays) for (const ip of r.ips ?? [r.ip]) held.add(ip);
  for (const w of world.waves) for (const ip of w.ips) held.add(ip);
  return held;
}

const recordedCache = new WeakMap<RecordingLibrary, Set<string>>();

/**
 * Every address a move or minion recording in the library writes a line from (the attacker's, and a wave's many, D-27):
 * a customer never takes one, so Death's recorded starts stay his.
 */
export function recordedAttackerAddresses(library: RecordingLibrary): Set<string> {
  let set = recordedCache.get(library);
  if (!set) {
    set = new Set<string>();
    for (const id of [...MOVES.map((m) => m.id), ...MINION_IDS]) {
      for (const v of library.variantsOf(id)) {
        set.add(v.info.ip);
        for (const e of v.recording.events) if (e.kind === 'access') set.add(e.ip);
      }
    }
    recordedCache.set(library, set);
  }
  return set;
}

/**
 * The next address after `ip` (wrapping inside `lo`..`hi` of its last octet) that nobody in `avoid` holds. Used where a
 * seeded stream already drew `ip`: stepping instead of redrawing keeps every later draw of that stream where it was.
 */
export function bump(ip: string, avoid: ReadonlySet<string>, lo = 1, hi = 254): string {
  const prefix = ip.slice(0, ip.lastIndexOf('.'));
  const last = Number(ip.slice(ip.lastIndexOf('.') + 1));
  const size = hi - lo + 1;
  for (let k = 0; k < size; k++) {
    const candidate = `${prefix}.${lo + ((last - lo + k) % size)}`;
    if (!avoid.has(candidate)) return candidate;
  }
  return ip;
}

/** One address from the three ranges that nobody in `avoid` holds; `random` is the caller's own seeded stream. */
export function drawAddress(random: () => number, avoid: ReadonlySet<string>): string {
  for (let tries = 0; tries < 10_000; tries++) {
    const ip = `${POOL_RANGES[Math.floor(random() * POOL_RANGES.length)]}.${1 + Math.floor(random() * 254)}`;
    if (!avoid.has(ip)) return ip;
  }
  throw new Error('the address pool is exhausted'); // 762 addresses; nothing holds that many
}

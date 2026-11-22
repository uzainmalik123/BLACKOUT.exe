// Detection data (SYS-20, D-110): what the dashboard's three tools read (UI-09). Read-only selectors over the
// access log, per real minute: the busiest addresses in the last real minute, the 4xx/5xx rate as a series, and a
// status class per line for colouring. Nothing is invented: every number is counted from the real lines, and nothing
// here says who an address belongs to (an access line's `by` never leaves this module).
import { CONFIG } from './config';
import type { AccessLine, World } from './state';

export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

/** The class of an HTTP status, for colouring a log line (SYS-20 c). */
export function statusClass(status: number): StatusClass {
  const h = Math.min(5, Math.max(1, Math.floor(status / 100)));
  return `${h}xx` as StatusClass;
}

const isError = (status: number) => status >= 400;

/** One real minute in game ms on this level (SYS-01). */
export function realMinuteGameMs(world: World): number {
  return 60_000 * CONFIG[world.difficulty].gameMsPerRealMs;
}

export interface Talker {
  ip: string;
  requests: number; // lines from this address in the window
  errors: number; // of them, 4xx and 5xx
}

/**
 * SYS-20 a: the busiest addresses in the last real minute (lines stamped within `windowGameMs` of now, the current
 * tick included), busiest first, ties by errors then by address. At most `n` of them.
 */
export function topTalkers(world: World, opts: { n?: number; windowGameMs?: number } = {}): Talker[] {
  const n = opts.n ?? 10;
  const since = world.clock.gameMs - (opts.windowGameMs ?? realMinuteGameMs(world));
  const counts = new Map<string, Talker>();
  for (let i = world.logs.access.length - 1; i >= 0; i--) {
    const l = world.logs.access[i]!;
    if (l.t < since) continue; // lines land in time order per source, not across sources: scan every line
    const t = counts.get(l.ip) ?? { ip: l.ip, requests: 0, errors: 0 };
    t.requests += 1;
    if (isError(l.status)) t.errors += 1;
    counts.set(l.ip, t);
  }
  return [...counts.values()]
    .sort((a, b) => b.requests - a.requests || b.errors - a.errors || (a.ip < b.ip ? -1 : a.ip > b.ip ? 1 : 0))
    .slice(0, n);
}

export interface ErrorRatePoint {
  minute: number; // real minutes since the start of the run
  from: number; // game ms, inclusive
  to: number; // game ms, exclusive
  requests: number;
  clientErrors: number; // 4xx
  serverErrors: number; // 5xx
}

interface RateCache { lines: number; points: ErrorRatePoint[] }
const rateCache = new WeakMap<AccessLine[], RateCache>();

/**
 * SYS-20 b: the error rate as a series, one point per real minute from the start of the run to now (the last point is
 * the current, partial minute; quiet minutes are zeros). The log only grows, so the count is kept up incrementally
 * per log and the call is cheap enough for every frame.
 */
export function errorRate(world: World): ErrorRatePoint[] {
  const minute = realMinuteGameMs(world);
  const log = world.logs.access;
  let cache = rateCache.get(log);
  if (!cache) {
    cache = { lines: 0, points: [] };
    rateCache.set(log, cache);
  }
  const point = (k: number): ErrorRatePoint => ({ minute: k, from: k * minute, to: (k + 1) * minute, requests: 0, clientErrors: 0, serverErrors: 0 });
  const upTo = (k: number) => { while (cache!.points.length <= k) cache!.points.push(point(cache!.points.length)); };
  for (; cache.lines < log.length; cache.lines++) {
    const l = log[cache.lines]!;
    const k = Math.max(0, Math.floor(l.t / minute));
    upTo(k);
    const p = cache.points[k]!;
    p.requests += 1;
    if (l.status >= 500) p.serverErrors += 1;
    else if (l.status >= 400) p.clientErrors += 1;
  }
  upTo(Math.floor(world.clock.gameMs / minute));
  return cache.points.map((p) => ({ ...p }));
}

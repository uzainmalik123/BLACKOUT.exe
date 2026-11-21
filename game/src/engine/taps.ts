// Leaky taps (PRD §4.1, D-42): small obvious exposures that open over time and drip about 1 % of the souls a real
// minute until the player closes each with one WAF path block. They draw from their own seeded stream (world.taps.rng)
// so Death's and the minions' draws don't move. No recording yet (KI-59): each opening and drip writes one access line
// built from the request the real exposure answers.
import { TAP_BY_ID, TAPS } from '../rules/taps';
import type { TapId } from '../rules/vocabulary';
import { gameTimeIso } from './clock';
import { CONFIG } from './config';
import { stopperHolds } from './facts';
import { emit } from './log';
import { closeAlert, openAlert } from './replay';
import { SEED_ACCOUNTS } from './seed';
import { steal } from './souls';
import { mulberry, type World } from './state';

const SCRAPER_AGENT = 'python-requests/2.32.3';

function nextTapRandom(world: World): number {
  const { value, state } = mulberry(world.taps.rng);
  world.taps.rng = state;
  return value;
}

/** True once the tap's WAF path block is in place. */
export function tapClosed(world: World, id: TapId): boolean {
  return stopperHolds(world, TAP_BY_ID[id].closedBy);
}

function line(world: World, id: TapId, target: string, bytes: number): void {
  const ip = `203.0.113.${100 + Math.floor(nextTapRandom(world) * 150)}`;
  world.logs.access.push({ t: world.clock.gameMs, ip, method: 'GET', target, protocol: 'HTTP/1.1', status: 200, bytes, referer: '', userAgent: SCRAPER_AGENT, by: id });
}

/** The seed rows a tap leaks that are still unstolen. */
function leakable(world: World, id: TapId): number[] {
  const tap = TAP_BY_ID[id];
  const stolen = new Set(world.souls.stolen.filter((s) => s.table === 'Users').map((s) => s.key));
  return (tap.leaks === 'every-customer' ? SEED_ACCOUNTS.map((a) => a.id) : [...tap.leaks]).filter((k) => !stolen.has(k));
}

function open(world: World): void {
  // A tap with nothing left to leak (its rows already stolen another way) never opens.
  const pool = TAPS.filter((t) => !world.taps.opened.includes(t.id) && !tapClosed(world, t.id) && leakable(world, t.id).length > 0);
  if (pool.length === 0) return;
  const tap = pool[Math.floor(nextTapRandom(world) * pool.length)]!;
  const now = world.clock.gameMs;
  world.taps.opened.push(tap.id);
  world.taps.open.push({ id: tap.id, openedAt: now, nextDripAt: now + CONFIG[world.difficulty].taps.dripEveryGameMs, drips: 0 });
  openAlert(world, tap.id);
  emit(world, { kind: 'tap-opened', tap: tap.id });
  const first = tap.line(0, gameTimeIso(world, now).slice(0, 10));
  line(world, tap.id, first.target.replace(/\/access\.log\.[\d-]+$/, '/'), 1_120); // a scraper finds it: the listing or the first page
}

/** One drip: about 1 % of the total souls from the rows the tap really leaks, chosen from the taps' stream. */
function drip(world: World, id: TapId, n: number): void {
  const tap = TAP_BY_ID[id];
  const rows = leakable(world, id);
  const size = Math.max(1, Math.round(world.souls.total * CONFIG[world.difficulty].taps.dripFraction));
  const taken: number[] = [];
  while (taken.length < size && rows.length > 0) taken.push(rows.splice(Math.floor(nextTapRandom(world) * rows.length), 1)[0]!);
  const req = tap.line(n, gameTimeIso(world, world.clock.gameMs).slice(0, 10));
  line(world, id, req.target, req.bytes);
  if (taken.length > 0) steal(world, id, 'Users', taken);
}

export function stepTaps(world: World): void {
  const now = world.clock.gameMs;
  const cfg = CONFIG[world.difficulty].taps;
  for (const t of [...world.taps.open]) {
    const closed = tapClosed(world, t.id);
    // Closed by its path block, or dry: every row it leaks is gone ("until there is no data to be stolen").
    if (closed || leakable(world, t.id).length === 0) {
      world.taps.open = world.taps.open.filter((x) => x !== t);
      closeAlert(world, t.id);
      emit(world, { kind: 'tap-closed', tap: t.id, ...(closed && { by: 'DEF-12' as const }) });
    }
  }
  if (world.nginx === 'stopped') { // nothing reaches a stopped server: no drip, no new tap
    for (const t of world.taps.open) while (t.nextDripAt <= now) t.nextDripAt += cfg.dripEveryGameMs;
    return;
  }
  for (const t of world.taps.open) {
    while (t.nextDripAt <= now) {
      drip(world, t.id, ++t.drips);
      t.nextDripAt += cfg.dripEveryGameMs;
    }
  }
  if (now >= world.taps.nextAt && world.taps.open.length < cfg.maxOpen && world.taps.opened.length < TAPS.length) {
    open(world);
    world.taps.nextAt = now + cfg.everyGameMs.min + Math.round(nextTapRandom(world) * (cfg.everyGameMs.max - cfg.everyGameMs.min));
  }
}

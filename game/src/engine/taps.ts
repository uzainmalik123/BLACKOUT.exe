// Leaky taps (PRD §4.1, D-42): small obvious exposures that open over time and drip about 1 % of the souls a real
// minute until the player closes each with one WAF path block. They draw from their own seeded stream (world.taps.rng)
// so Death's and the minions' draws don't move. Each tap plays its recording (src/recordings/taps/, KI-59, D-130): the
// opening is the scraper's first recorded request, each drip the next one, round again when they run out.
import type { AccessEvent, Recording } from '../recordings/format';
import { validateRecording } from '../recordings/format';
import { TAP_BY_ID, TAPS } from '../rules/taps';
import type { TapId } from '../rules/vocabulary';
import { gameTimeIso } from './clock';
import { CONFIG } from './config';
import { stopperHolds } from './facts';
import { emit } from './log';
import { closeAlert, openTapAlert } from './alerts';
import { bump, customerAddresses } from './pool';
import { SEED_ACCOUNTS } from './seed';
import { pestsMayStart } from './shift';
import { steal } from './souls';
import { mulberry, type World } from './state';

const RECORDED = import.meta.glob<Recording>('../recordings/taps/*.json', { eager: true, import: 'default' });

/** Each tap's recorded requests, in order (the `.a` variant: one scrape per tap). */
const REQUESTS: Readonly<Record<TapId, AccessEvent[]>> = Object.fromEntries(TAPS.map((t) => {
  const rec = Object.values(RECORDED).find((r) => r.move === t.id && r.variant === 'a');
  if (!rec) throw new Error(`${t.id}: no recording in src/recordings/taps/ (D-130)`);
  const errors = validateRecording(rec);
  if (errors.length > 0) throw new Error(`${t.id}.a: ${errors.join('; ')}`);
  const access = rec.events.filter((e): e is AccessEvent => e.kind === 'access');
  if (access.length === 0) throw new Error(`${t.id}.a: no access line`);
  return [t.id, access];
})) as Record<TapId, AccessEvent[]>;

function nextTapRandom(world: World): number {
  const { value, state } = mulberry(world.taps.rng);
  world.taps.rng = state;
  return value;
}

/** True once the tap's WAF path block is in place. */
export function tapClosed(world: World, id: TapId): boolean {
  return stopperHolds(world, TAP_BY_ID[id].closedBy);
}

/** Plays one recorded request from a fresh scraper address; a dated log file is served under the game's date. */
function line(world: World, id: TapId, e: AccessEvent): void {
  const ip = bump(`203.0.113.${100 + Math.floor(nextTapRandom(world) * 150)}`, customerAddresses(world), 100, 249); // D-65: never a customer's address
  const target = e.target.replace(/(access\.log\.)\d{4}-\d\d-\d\d$/, `$1${gameTimeIso(world, world.clock.gameMs).slice(0, 10)}`);
  world.logs.access.push({ t: world.clock.gameMs, ip, method: e.method, target, protocol: e.protocol, status: e.status, bytes: e.bytes, referer: e.referer, userAgent: e.userAgent, by: id });
}

/** The recorded request for drip `n` (from 1): the scraper's requests after its first, round again when they run out. */
function dripRequest(id: TapId, n: number): AccessEvent {
  const all = REQUESTS[id];
  const drips = all.length > 1 ? all.slice(1) : all;
  return drips[(n - 1) % drips.length]!;
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
  emit(world, { kind: 'tap-opened', tap: tap.id });
  line(world, tap.id, REQUESTS[tap.id][0]!); // a scraper finds it: the listing or the first page
  openTapAlert(world, tap.id, REQUESTS[tap.id][0]!.target); // D-232: a tap's alert opens with the tap, from that first line
}

/** One drip: about 1 % of the total souls from the rows the tap really leaks, chosen from the taps' stream. */
function drip(world: World, id: TapId, n: number): void {
  const rows = leakable(world, id);
  const size = Math.max(1, Math.round(world.souls.total * CONFIG[world.difficulty].taps.dripFraction));
  const taken: number[] = [];
  while (taken.length < size && rows.length > 0) taken.push(rows.splice(Math.floor(nextTapRandom(world) * rows.length), 1)[0]!);
  line(world, id, dripRequest(id, n));
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
  if (pestsMayStart(world) && now >= world.taps.nextAt && world.taps.open.length < cfg.maxOpen && world.taps.opened.length < TAPS.length) { // D-230: taps wait for his first move
    open(world);
    world.taps.nextAt = now + cfg.everyGameMs.min + Math.round(nextTapRandom(world) * (cfg.everyGameMs.max - cfg.everyGameMs.min));
  }
}

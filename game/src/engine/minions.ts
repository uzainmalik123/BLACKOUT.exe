// Minion waves (PRD §4, D-09): real background attackers that come back on a timer, do damage while they run,
// and are closed by one correct action. With a recording in the library a wave replays it; without one it is
// silent (meters and alerts only) until REC-05 lands. D-41: pests, not bosses: one wave at a time, at most
// `successesPerWave` successes a wave (a recorded exfil each), and the recording replays only up to the last one.
import { MINION_BY_ID } from '../rules/minions';
import { MINION_IDS, type ActionId, type MinionId } from '../rules/vocabulary';
import { CONFIG } from './config';
import { stopperHolds } from './facts';
import type { RecordingLibrary } from './library';
import { emit } from './log';
import { bump, customerAddresses } from './pool';
import { closeAlert } from './alerts';
import { activeDeathReplay, grantMinionSession, startReplay } from './replay';
import { nextRandom } from './rng';
import { pestsMayStart } from './shift';
import { stuffOneReuser } from './souls';
import type { Wave, World } from './state';

export function activeWaves(world: World): Wave[] {
  return world.waves;
}

/** The action that closes this minion right now, if any (MIN-01's DEF-06 means every IP of its wave is blocked). */
export function closedBy(world: World, id: MinionId): ActionId | undefined {
  const wave = world.waves.find((w) => w.minion === id);
  for (const s of MINION_BY_ID[id].closedBy) {
    if (s.action === 'DEF-06') {
      if (wave && wave.ips.every((ip) => world.firewall.blocked.includes(ip))) return 'DEF-06';
      continue;
    }
    if (stopperHolds(world, s)) return s.action;
  }
  return undefined;
}

export function minionClosed(world: World, id: MinionId): boolean {
  return closedBy(world, id) !== undefined;
}

/** A wave's address, never one a customer holds (D-65). */
function freshIp(world: World): string {
  return bump(`203.0.113.${100 + Math.floor(nextRandom(world) * 150)}`, customerAddresses(world), 100, 249);
}

function startWave(world: World, library: RecordingLibrary, id: MinionId): void {
  const { waveDurationGameMs } = CONFIG[world.difficulty].minions;
  const now = world.clock.gameMs;
  const n = world.events.filter((e) => e.kind === 'wave-started' && e.minion === id).length + 1;
  const ips = [freshIp(world), freshIp(world), freshIp(world)];
  const wave: Wave = { id: world.death.nextId++, minion: id, n, ips, startedAt: now, endsAt: now + waveDurationGameMs, successesDone: 0 };
  world.waves.push(wave);
  emit(world, { kind: 'wave-started', minion: id, wave: n, ips }); // its alert opens when a detector sees it (D-232)
  const variants = library.variantsOf(id);
  if (variants.length > 0) {
    const v = variants[(n - 1) % variants.length]!;
    startReplay(world, { ...v, info: { ...v.info, ip: ips[0]! } }, id, ips, sliceFor(world, id, v.recording.events.map((e) => e.kind)));
  }
}

/**
 * D-41: the part of a minion recording one wave replays. With successes (exfils) in it, the slice runs from just after
 * the previous wave's last success up to and including this wave's last one, wrapping at the end (KI-57); a recording
 * with none (MIN-01) plays whole every wave.
 */
function sliceFor(world: World, id: MinionId, kinds: string[]): { from: number; to: number } | undefined {
  const successes = kinds.flatMap((k, i) => (k === 'exfil' ? [i] : []));
  if (successes.length === 0) return undefined;
  let from = world.minionCursor[id] ?? 0;
  if (!successes.some((i) => i >= from)) from = 0;
  const mine = successes.filter((i) => i >= from).slice(0, CONFIG[world.difficulty].minions.successesPerWave);
  const to = mine[mine.length - 1]! + 1;
  world.minionCursor[id] = to;
  return { from, to };
}

function endWave(world: World, wave: Wave, by?: ActionId): void {
  world.waves = world.waves.filter((w) => w !== wave);
  world.replays = world.replays.filter((r) => r.owner !== wave.minion);
  closeAlert(world, wave.minion);
  emit(world, { kind: 'wave-ended', minion: wave.minion, wave: wave.n, ...(by && { closedBy: by }) });
}

/** MIN-02's damage in a wave with no recording (D-24): its successes spread evenly through the wave (halfway for one). */
function stuff(world: World, wave: Wave): void {
  const { waveDurationGameMs, successesPerWave } = CONFIG[world.difficulty].minions;
  const due = Math.min(successesPerWave, Math.floor(((world.clock.gameMs - wave.startedAt) * (successesPerWave + 1)) / waveDurationGameMs));
  while (wave.successesDone < due) {
    wave.successesDone++;
    grantMinionSession(world, 'MIN-02', stuffOneReuser(world, 'MIN-02'));
  }
}

export function stepWaves(world: World, library: RecordingLibrary): void {
  const now = world.clock.gameMs;
  for (const wave of [...world.waves]) {
    const by = world.nginx === 'stopped' ? 'DEF-11' : closedBy(world, wave.minion);
    if (by) {
      endWave(world, wave, by);
      continue;
    }
    if (wave.minion === 'MIN-02' && library.variantsOf('MIN-02').length === 0) stuff(world, wave); // recorded waves succeed by their exfils
    if (now >= wave.endsAt) endWave(world, wave);
  }
  if (world.nginx === 'stopped' || !pestsMayStart(world)) return; // D-230: the pests wait for Death's first move
  const { periodGameMs, alongsideDeath } = CONFIG[world.difficulty].minions;
  for (const id of MINION_IDS) {
    if (now < world.nextWaveAt[id]) continue;
    if (minionClosed(world, id)) {
      world.nextWaveAt[id] += periodGameMs[id];
      continue;
    }
    // D-41: one wave at a time, and on Easy never alongside a Death move: a wave that falls due waits.
    if (world.waves.length > 0 || (!alongsideDeath && activeDeathReplay(world))) continue;
    world.nextWaveAt[id] = now + periodGameMs[id];
    startWave(world, library, id);
  }
}

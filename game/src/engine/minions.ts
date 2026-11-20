// Minion waves (PRD §4, D-09): real background attackers that come back on a timer, do damage while they run,
// and are closed by one correct action. With a recording in the library a wave replays it; without one it is
// silent (meters and alerts only) until REC-05 lands.
import { MINION_BY_ID } from '../rules/minions';
import { MINION_IDS, type ActionId, type MinionId } from '../rules/vocabulary';
import { CONFIG } from './config';
import { stopperHolds } from './facts';
import type { RecordingLibrary } from './library';
import { emit } from './log';
import { closeAlert, startReplay } from './replay';
import { nextRandom } from './rng';
import { stealOneUnstolenCustomer } from './souls';
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

function freshIp(world: World): string {
  return `203.0.113.${100 + Math.floor(nextRandom(world) * 150)}`;
}

function startWave(world: World, library: RecordingLibrary, id: MinionId): void {
  const { waveDurationGameMs } = CONFIG[world.difficulty].minions;
  const now = world.clock.gameMs;
  const n = world.events.filter((e) => e.kind === 'wave-started' && e.minion === id).length + 1;
  const ips = [freshIp(world), freshIp(world), freshIp(world)];
  const wave: Wave = { id: world.death.nextId++, minion: id, n, ips, startedAt: now, endsAt: now + waveDurationGameMs, successesDone: 0 };
  world.waves.push(wave);
  world.alerts.push({ id: world.death.nextId++, about: id, openedAt: now });
  emit(world, { kind: 'alert-opened', alert: world.alerts[world.alerts.length - 1]!.id, about: id });
  emit(world, { kind: 'wave-started', minion: id, wave: n, ips });
  const variants = library.variantsOf(id);
  if (variants.length > 0) {
    const v = variants[(n - 1) % variants.length]!;
    startReplay(world, { ...v, info: { ...v.info, ip: ips[0]! } }, id);
  }
}

function endWave(world: World, wave: Wave, by?: ActionId): void {
  world.waves = world.waves.filter((w) => w !== wave);
  world.replays = world.replays.filter((r) => r.owner !== wave.minion);
  closeAlert(world, wave.minion);
  emit(world, { kind: 'wave-ended', minion: wave.minion, wave: wave.n, ...(by && { closedBy: by }) });
}

/** MIN-02's damage: halfway through a wave, one credential-stuffing success per configured success. */
function stuff(world: World, wave: Wave): void {
  const { waveDurationGameMs, min02SuccessesPerWave } = CONFIG[world.difficulty].minions;
  const due = Math.min(min02SuccessesPerWave, Math.floor(((world.clock.gameMs - wave.startedAt) * 2) / waveDurationGameMs));
  while (wave.successesDone < due) {
    wave.successesDone++;
    const victim = stealOneUnstolenCustomer(world, 'MIN-02');
    if (victim) world.sessions.push({ id: world.death.nextId++, email: victim.email, kind: 'user', issuedBy: 'MIN-02', keyVersion: world.signingKey.version });
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
    if (wave.minion === 'MIN-02') stuff(world, wave);
    if (now >= wave.endsAt) endWave(world, wave);
  }
  if (world.nginx === 'stopped') return;
  for (const id of MINION_IDS) {
    if (now < world.nextWaveAt[id]) continue;
    world.nextWaveAt[id] += CONFIG[world.difficulty].minions.periodGameMs[id];
    if (minionClosed(world, id) || world.waves.some((w) => w.minion === id)) continue;
    startWave(world, library, id);
  }
}

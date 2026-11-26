// Flags (DEF-21, D-233): a flagged address is a suspicion until the engine sees a hostile request from it after the
// flag: a line of one of Death's moves, a minion wave or a tap's scraper. A customer's line never confirms. The world
// never records whether a flag was right: only the confirmation shows, so nothing on screen can become an oracle.
import { SOUL_DOORS } from '../rules/moves';
import type { MoveId } from '../rules/vocabulary';
import { emit } from './log';
import { confirmBreach } from './notification';
import { declareIncident } from './shift';
import type { World } from './state';

/** One tick: confirm the flags whose address wrote a hostile line since the last look. */
export function stepFlags(world: World): void {
  const d = world.detect;
  const pending = world.flags.filter((f) => f.confirmedAt === undefined);
  if (pending.length === 0) {
    d.flagCursor = world.logs.access.length;
    return;
  }
  for (; d.flagCursor < world.logs.access.length; d.flagCursor++) {
    const l = world.logs.access[d.flagCursor]!;
    if (l.by === 'CUST') continue;
    const flag = pending.find((f) => f.confirmedAt === undefined && f.ip === l.ip && l.t >= f.at);
    if (!flag) continue;
    flag.confirmedAt = l.t;
    emit(world, { kind: 'flag-confirmed', ip: flag.ip, about: l.by });
    declareIncident(world, 'flag'); // D-230: a sharp player who spots the scan declares the incident themselves
    if ((SOUL_DOORS as readonly string[]).includes(l.by)) confirmBreach(world, 'DEF-21', l.t); // D-116 gains the flag: a harvest address confirmed after souls were taken
  }
}

/** Every address that was ever an attacker's this run: a move's start, a replay, a wave, or a hostile line. For the judge. */
export function attackerAddressesEver(world: World): Set<string> {
  const set = new Set<string>();
  for (const e of world.events) {
    if (e.kind === 'move-started') set.add(e.ip);
    else if (e.kind === 'wave-started') for (const ip of e.ips) set.add(ip);
    else if (e.kind === 'flag-confirmed') set.add(e.ip);
  }
  for (const r of world.replays) for (const ip of r.ips ?? [r.ip]) set.add(ip);
  for (const w of world.waves) for (const ip of w.ips) set.add(ip);
  for (const l of world.logs.access) if (l.by !== 'CUST') set.add(l.ip);
  return set;
}

/** The flags whose address was never an attacker's: the false leads the report counts (D-233). */
export function falseLeads(world: World): number {
  const attackers = attackerAddressesEver(world);
  return world.flags.filter((f) => !attackers.has(f.ip)).length;
}

/** The move a confirmed flag discovered, if its confirmation was one of Death's. */
export function flaggedMove(world: World, ip: string): MoveId | undefined {
  for (const e of world.events) if (e.kind === 'flag-confirmed' && e.ip === ip && e.about.startsWith('ATK-')) return e.about as MoveId;
  return undefined;
}

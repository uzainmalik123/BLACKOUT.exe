// The words the desk shows for the engine's state (UI-04, D-223): alerts, incident events and the clocks, worded the
// way the player can see them. Like Kiro's snapshot (D-190), nothing here names a move, minion or tap, or says who an
// address belongs to: an alert is a kind and a time, an event is what the player could have noticed.

import { CONFIG } from '../../engine/config';
import type { GameEvent } from '../../engine/log';
import type { World } from '../../engine/state';
import { describeAction } from '../../kiro/snapshot';

/** An alert's kind, as the snapshot gives it to Kiro (D-190). */
export function alertWords(about: string): string {
  if (about.startsWith('ATK-')) return 'Suspicious activity';
  if (about.startsWith('TAP-')) return 'Data leaving the shop';
  if (about.startsWith('MIN-')) return 'Automated traffic';
  return 'Unusual traffic';
}

/** One line for the incident feed, or null for events the player could not have seen. */
export function eventWords(e: GameEvent): { text: string; tone: 'bad' | 'good' | 'info' } | null {
  switch (e.kind) {
    case 'move-started':
      return { text: 'Something has started moving in the traffic', tone: 'bad' };
    case 'move-landed':
      return { text: 'An intrusion went through', tone: 'bad' };
    case 'move-cut':
      return { text: 'An intrusion was cut off', tone: 'good' };
    case 'souls-stolen':
      return { text: `${e.count} customer record${e.count === 1 ? '' : 's'} taken (${e.stolen} of ${e.total} gone)`, tone: 'bad' };
    case 'alert-opened':
      return { text: `Alert #${e.alert}: ${alertWords(e.about).toLowerCase()}`, tone: 'bad' };
    case 'alert-closed':
      return { text: `Alert #${e.alert} closed`, tone: 'good' };
    case 'tap-opened':
      return { text: 'Records are leaking somewhere', tone: 'bad' };
    case 'tap-closed':
      return { text: e.by ? 'A leak was stopped' : 'A leak ran dry', tone: e.by ? 'good' : 'info' };
    case 'door-shut':
      return { text: 'A way in is shut for now', tone: 'good' };
    case 'door-reopened':
      return { text: 'A way in is open again', tone: 'bad' };
    case 'proxies':
      return { text: 'The attack now comes from address after address', tone: 'bad' };
    case 'ticket':
      return { text: `Support ticket: a customer's ${e.about} failed (${e.status})`, tone: 'info' };
    case 'customer-lost':
      return { text: `A customer gave up (${e.about}); the heartbeat can reach ${Math.round(e.max)} at most now`, tone: 'bad' };
    case 'breach-confirmed':
      return { text: 'Breach confirmed: the notification clock is running', tone: 'info' };
    case 'notification-overdue':
      return { text: 'The notification deadline passed', tone: 'bad' };
    case 'patch-applied':
      return { text: `Patch live: ${e.patch}`, tone: 'good' };
    case 'tip-off':
      return { text: 'He noticed you looking', tone: 'bad' };
    case 'banished':
      return { text: 'Every way in is closed', tone: 'good' };
    case 'return':
      return { text: 'He came back in', tone: 'bad' };
    case 'action':
      return { text: `${e.ok ? '✓' : '✗'} ${describeAction(e.action)}${e.note ? ` (${e.note})` : ''}`, tone: e.ok ? 'info' : 'bad' };
    default:
      return null;
  }
}

/** Real time left in the shift, "m:ss". */
export function shiftLeft(world: World): string {
  const ms = Math.max(0, world.clock.shiftEndsAt - world.clock.gameMs) / CONFIG[world.difficulty].gameMsPerRealMs;
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A game time as the log stamps it, "HH:MM:SS". */
export function clockAt(world: World, gameMs: number): string {
  return new Date(Date.parse(CONFIG[world.difficulty].scenarioStartIso) + gameMs).toISOString().slice(11, 19);
}

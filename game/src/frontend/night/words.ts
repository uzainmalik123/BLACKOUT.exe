// The words the desk shows for the engine's state (UI-04, D-223): alerts, incident events and the clocks, worded the
// way the player can see them. Like Kiro's snapshot (D-190), nothing here names a move, minion or tap, or says who an
// address belongs to: an alert is its route and symptom (D-232), an event is what the player could have noticed.

import { FREEZE_MESSAGE } from '../../engine/actions';
import { CONFIG } from '../../engine/config';
import type { GameEvent } from '../../engine/log';
import { changeFrozen } from '../../engine/shift';
import type { PlaybookPhase, World } from '../../engine/state';
import { describeAction } from '../../kiro/snapshot';
import type { GateId } from './battle';
import type { ToolId } from './windows';

/** The "Now:" strip's words for the playbook phase (UI-11, D-233): never a move, a gate or the assessor's state. */
export const NOW_WORDS: Readonly<Record<PlaybookPhase, string>> = {
  watch: 'Look around',
  identify: 'Identify: find out who and how',
  contain: 'Contain',
  eradicate: 'Eradicate',
  recover: 'Recover',
};

/** Easy's extra sentence (D-235): the gate the alert's route belongs to, from the engine's `alert.gate`. */
export function gateSentence(gate: string): string {
  return `This looks like an attack on the ${gate}${/door$/.test(gate) ? '' : ' gate'}.`;
}

/** The console the dock lights for an alert's gate on Easy (D-235, D-242): where that gate's first defence lives. */
export function gateConsole(gate: string): ToolId {
  switch (gate) {
    case 'front door':
      return 'firewall';
    case 'login':
    case 'passwords':
    case 'search':
      return 'waf';
    case 'sign-up':
      return 'accounts';
    case 'admin API':
      return 'sessions';
    case 'products':
      return 'backups';
    case 'uploads':
      return 'uploads';
    case 'feedback':
      return 'features';
    default:
      return 'waf'; // a leaky tap's name: a WAF path rule closes it (D-42)
  }
}

/** The battlefield's entrance (D-225's seven) for an alert's gate, focused on Easy only (D-235). */
export function battleGate(gate: string): GateId {
  switch (gate) {
    case 'login':
      return 'login';
    case 'passwords':
      return 'passwords';
    case 'sign-up':
      return 'signup';
    case 'search':
      return 'search';
    case 'admin API':
    case 'products':
      return 'admin';
    case 'uploads':
      return 'uploads';
    default:
      return 'front';
  }
}

/** Why a change control is locked right now (SYS-22): the engine's own refusal, or null when changes are allowed. */
export function freezeReason(world: World): string | null {
  return changeFrozen(world) ? FREEZE_MESSAGE : null;
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
      return { text: `Alert #${e.alert}: ${e.symptom}`, tone: 'bad' };
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

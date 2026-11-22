// The notification clock (SYS-14, D-112, D-116): starts when the player confirms a breach (an escalation, or a relevant
// action on a harvest move or on Users, after souls were taken), runs for config.notification.windowGameMs (GDPR's 72 hours compressed to the run
// length), and shows as a 72-hour countdown. Legal notified (DEF-20) stops it; the window passing logs it overdue.
import type { ActionId } from '../rules/vocabulary';
import { CONFIG } from './config';
import { emit } from './log';
import type { World } from './state';

/**
 * SYS-14, D-116: the breach is confirmed, and the 72 h clock starts, when after souls were taken the player escalates
 * (DEF-19) or makes a relevant action on a harvest move or on Users (the assessor calls this, D-115). A snapshot never
 * confirms it. Once.
 */
export function confirmBreach(world: World, by: ActionId, at = world.clock.gameMs): void {
  if (world.souls.stolen.length === 0 || world.comms.breachConfirmedAt !== undefined) return;
  world.comms.breachConfirmedAt = at; // the action's own time: the assessor judges it on the next tick
  emit(world, { kind: 'breach-confirmed', by });
}

export interface NotificationClock {
  state: 'idle' | 'running' | 'notified' | 'overdue'; // idle: no breach confirmed yet
  confirmedAt?: number; // game ms
  deadline?: number; // game ms: confirmedAt + the window
  notifiedAt?: number; // game ms, legal
  remainingGameMs?: number; // 0 once overdue; frozen at the notification once notified
  label: string; // the clock face: HH:MM:SS of the 72 "hours", counting down ('--:--:--' while idle)
}

const FACE_HOURS = 72; // GDPR Art. 33

/** The clock as the comms console shows it. */
export function notificationClock(world: World): NotificationClock {
  const confirmedAt = world.comms.breachConfirmedAt;
  if (confirmedAt === undefined) return { state: 'idle', label: '--:--:--' };
  const window = CONFIG[world.difficulty].notification.windowGameMs;
  const deadline = confirmedAt + window;
  const notifiedAt = world.comms.notifiedAt.legal;
  const at = notifiedAt !== undefined ? Math.min(notifiedAt, world.clock.gameMs) : world.clock.gameMs;
  const remaining = Math.max(0, deadline - at);
  const faceSeconds = Math.ceil((remaining / window) * FACE_HOURS * 3600);
  const hh = Math.floor(faceSeconds / 3600), mm = Math.floor((faceSeconds % 3600) / 60), ss = faceSeconds % 60;
  const label = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const state = notifiedAt !== undefined ? 'notified' : remaining === 0 ? 'overdue' : 'running';
  return { state, confirmedAt, deadline, ...(notifiedAt !== undefined && { notifiedAt }), remainingGameMs: remaining, label };
}

/** One tick: the window passed with legal not notified → one `notification-overdue` event. */
export function stepNotificationClock(world: World): void {
  if (world.ending || world.comms.notificationOverdue) return;
  if (notificationClock(world).state !== 'overdue') return;
  world.comms.notificationOverdue = true;
  emit(world, { kind: 'notification-overdue' });
}

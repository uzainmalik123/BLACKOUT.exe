// The judging engine's gap types (SYS-21, engine/assess.ts GAP_TYPES) in the defender's own words (D-190).
// The Kiro server puts the sentence in the hint prompt so Kiro knows what to nudge at; the client shows it as the
// offline nudge when no alert text fits (KIRO-09). A gap about one of Death's moves names no closing action
// (KIRO-03, D-151's vocabulary rule: rails.ts `STRICT_GAPS`); gaps about taps, notification, the plug, a
// defacement or a feature left off may name the remedy, as CON-03's tap hints do.
import type { GapType } from '../engine/assess';

export const GAP_WORDS: Readonly<Record<GapType, string>> = {
  'door-uninvestigated': 'Something got in through a route nobody has looked at yet. Which address and which path do the newest lines point at, and what did that address do before?',
  'stage-unseen': 'The attacker has moved on and nothing run so far has shown their newest lines. What is new at the tail of the access and app logs?',
  'foothold-unqueried': 'Accounts have changed since this began and the Users table has not been queried since. Compare its special roles and newest rows with the briefing.',
  'planted-file-unchecked': 'Something was written to the uploads folder and nobody has listed it since. What is in there that was not there before?',
  'eradicated-without-evidence': 'Changes have been made to the system and nothing has been snapshotted. Once something is gone, so is the proof of what happened.',
  'door-unpatched': 'The hole a route uses is still in the code: whatever holds it today is a bandage over the weakness, not a fix of it.',
  'breach-unconfirmed': 'Customer data has left. Has the incident lead heard, and has anything been kept as evidence of what left and when?',
  'notification-due': 'The breach is confirmed and the notification clock is running: legal has not been told yet, and that duty has a deadline.',
  'defacement-live': 'Customers are reading the attacker\'s words on a product page right now. A backup from before the change can put it back.',
  'tap-open': 'Something is still dripping customer data through a public path. A WAF path block closes a leak like that.',
  'plug-pulled': 'The shop is down by your own hand and every minute costs. What still has to be true before it is safe to bring back?',
  'feature-off-after-patch': 'A feature is still off although its fix is deployed: customers are paying for a hole that is already closed.',
  'move-uncontained': 'One of the attacker\'s moves is running right now. What do its lines look like, where do they go, and what does that part of the shop trust?',
};

export function gapWords(gap: string | undefined): string | undefined {
  return gap !== undefined && gap in GAP_WORDS ? GAP_WORDS[gap as GapType] : undefined;
}

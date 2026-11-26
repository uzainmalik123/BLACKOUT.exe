// PRD §5: the player's actions, one entry per DEF row. Effects live in game/src/engine/actions.ts; this is the data.
import { CONFIG } from '../engine/config';
import type { ActionId, Foothold } from './vocabulary';

export interface ActionRow {
  id: ActionId;
  phase: 'investigate' | 'preserve' | 'contain' | 'eradicate' | 'recover' | 'communicate';
  name: string;
  where: 'terminal' | 'console' | 'both';
  tipsOff: boolean; // DEF-04 active lookups, DEF-08
  dip: number; // one-off heartbeat cost (D-24)
  durationGameMs: number; // DEF-13's deploy
  removes: Foothold[];
  pri: 'M' | 'S';
}

const dip = CONFIG.medium.heartbeat.dip;
const row = (
  id: ActionId, phase: ActionRow['phase'], name: string, where: ActionRow['where'], pri: 'M' | 'S',
  extra: Partial<Pick<ActionRow, 'tipsOff' | 'durationGameMs' | 'removes'>> = {},
): ActionRow => ({ id, phase, name, where, pri, tipsOff: false, dip: dip[id] ?? 0, durationGameMs: 0, removes: [], ...extra });

export const ACTIONS: readonly ActionRow[] = [
  row('DEF-01', 'investigate', 'Search logs', 'terminal', 'M'),
  row('DEF-02', 'investigate', 'Inspect accounts', 'terminal', 'M'),
  row('DEF-03', 'investigate', 'Inspect files', 'terminal', 'M'),
  row('DEF-04', 'investigate', 'Look up an IP', 'terminal', 'S', { tipsOff: true }),
  row('DEF-05', 'preserve', 'Snapshot evidence', 'terminal', 'M'),
  row('DEF-06', 'contain', 'Block an IP', 'terminal', 'M'),
  row('DEF-07', 'contain', 'Rate-limit login', 'console', 'M'),
  row('DEF-08', 'contain', 'Lock an account', 'both', 'M', { tipsOff: true }),
  row('DEF-09', 'contain', 'Revoke all sessions + rotate the signing key', 'console', 'M'),
  row('DEF-10', 'contain', 'Turn a feature off', 'console', 'M'),
  row('DEF-11', 'contain', 'Pull the plug', 'terminal', 'M'),
  row('DEF-12', 'eradicate', 'WAF rule (virtual patch)', 'console', 'M'),
  row('DEF-13', 'eradicate', 'Deploy a code patch', 'console', 'M', { durationGameMs: CONFIG.medium.patchDurationGameMs, removes: ['forged-token'] }),
  row('DEF-14', 'eradicate', 'Delete a rogue account', 'terminal', 'M', { removes: ['hidden-admin'] }),
  row('DEF-15', 'eradicate', 'Delete a planted file', 'terminal', 'M', { removes: ['planted-file'] }),
  row('DEF-16', 'eradicate', 'Force a password reset', 'console', 'M', { removes: ['hijacked-user'] }),
  row('DEF-17', 'recover', 'Restore from backup', 'console', 'M', { removes: ['hidden-admin', 'planted-file'] }),
  row('DEF-18', 'recover', 'Bring things back', 'terminal', 'M'),
  row('DEF-19', 'communicate', 'Escalate to the incident lead', 'console', 'S'),
  row('DEF-20', 'communicate', 'Notify (legal / customers)', 'console', 'S'),
  row('DEF-21', 'investigate', 'Flag an address', 'both', 'M'), // D-233
];

export const ACTION_BY_ID: Readonly<Record<ActionId, ActionRow>> = Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<ActionId, ActionRow>;

// PRD §4: the minions (D-09), one entry per MIN row. Wave timing is in game/src/engine/config.ts.
import type { MinionId, Stopper } from './vocabulary';

export interface MinionRow {
  id: MinionId;
  name: string;
  look: string;
  behaviour: string;
  closedBy: Stopper[];
  damage: { heartbeat: boolean; soulsPerSuccess: number; givesDeath?: 'user-session' };
  pri: 'M' | 'S';
}

export const MINIONS: readonly MinionRow[] = [
  { id: 'MIN-01', name: 'Crawlers', look: 'skittering rats', behaviour: 'WordPress/PHP exploit scanners: /wp-admin, /.env, /phpmyadmin',
    closedBy: [{ action: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'scanner' } }, { action: 'DEF-06' }],
    damage: { heartbeat: true, soulsPerSuccess: 0 }, pri: 'M' },
  { id: 'MIN-02', name: 'Wraith swarm', look: 'wisps', behaviour: 'Credential stuffing against /rest/user/login from many IPs',
    closedBy: [{ action: 'DEF-07' }],
    damage: { heartbeat: false, soulsPerSuccess: 1, givesDeath: 'user-session' }, pri: 'M' },
  { id: 'MIN-03', name: 'Gnawer', look: 'a fat grub', behaviour: 'A scraper hammering /api/Products',
    closedBy: [{ action: 'DEF-12', rule: { kind: 'rate-limit', path: '/api/*' } }],
    damage: { heartbeat: true, soulsPerSuccess: 0 }, pri: 'S' },
  { id: 'MIN-04', name: 'Poltergeist', look: 'a flicker', behaviour: 'Spam bot posting to /api/Feedbacks',
    closedBy: [{ action: 'DEF-10', feature: 'feedback-captcha' }],
    damage: { heartbeat: true, soulsPerSuccess: 0 }, pri: 'S' },
];

export const MINION_BY_ID: Readonly<Record<MinionId, MinionRow>> = Object.fromEntries(MINIONS.map((m) => [m.id, m])) as Record<MinionId, MinionRow>;

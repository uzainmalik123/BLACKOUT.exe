// PRD §3: Death's moves, one entry per ATK row, with D-18 (ATK-12/15/16 Needs) and D-19 (DEF-12 stops ATK-16).
// Needs are what must hold for the Director to pick the move; the Director adds stage order on top (SYS-02).
import type { Foothold, Gain, MoveId, Need, Stage, Stopper } from './vocabulary';

export interface Move {
  id: MoveId;
  stage: Stage;
  name: string;
  attack: string; // MITRE ATT&CK ids, informational
  needs: Need[];
  gains: Gain[];
  foothold?: Foothold;
  stoppedBy: Stopper[];
  pri: 'M' | 'S';
}

const MAP: Need = { gain: 'map' };
const ADMIN_OR_OWN: Need = { anyOf: [{ gain: 'admin-session' }, { gain: 'own-admin' }] };
const SQLI: Stopper = { action: 'DEF-12', rule: { kind: 'sqli' } };
const PUT_PRODUCTS: Stopper = { action: 'DEF-12', rule: { kind: 'block-path', method: 'PUT', path: '/api/Products' } };

export const MOVES: readonly Move[] = [
  { id: 'ATK-01', stage: 1, name: 'Directory scan', attack: 'T1595.003', needs: [], gains: ['map'],
    stoppedBy: [{ action: 'DEF-06' }, { action: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } }], pri: 'M' },
  { id: 'ATK-02', stage: 1, name: 'Loot the exposed /ftp folder', attack: 'T1213', needs: [MAP, { featureOn: 'ftp' }], gains: ['secrets-leaked'],
    stoppedBy: [{ action: 'DEF-10', feature: 'ftp' }], pri: 'S' },
  { id: 'ATK-03', stage: 2, name: 'SQL injection on login', attack: 'T1190', needs: [MAP], gains: ['admin-session'],
    stoppedBy: [SQLI, { action: 'DEF-13', patch: 'login' }], pri: 'M' },
  { id: 'ATK-04', stage: 2, name: 'Guess the admin password', attack: 'T1110.001', needs: [MAP, { loginNotRateLimited: true }], gains: ['admin-session', 'admin-password'],
    stoppedBy: [{ action: 'DEF-07' }, { action: 'DEF-16', account: 'admin' }], pri: 'M' },
  { id: 'ATK-05', stage: 2, name: "Reset a user's password via the security question", attack: 'T1110', needs: [MAP, { featureOn: 'password-reset' }], gains: ['user-session'],
    stoppedBy: [{ action: 'DEF-10', feature: 'password-reset' }, { action: 'DEF-08', account: 'target' }], pri: 'S' },
  { id: 'ATK-06', stage: 3, name: 'Register his own admin', attack: 'T1136', needs: [{ anyOf: [{ anyFoothold: true }, MAP] }], gains: ['own-admin'],
    stoppedBy: [{ action: 'DEF-10', feature: 'registration' }, { action: 'DEF-13', patch: 'registration' }, { action: 'DEF-14', account: 'used' }], pri: 'M' },
  { id: 'ATK-07', stage: 3, name: 'Reuse a stolen admin token', attack: 'T1550.001', needs: [{ gain: 'admin-session' }], gains: [],
    stoppedBy: [{ action: 'DEF-09' }], pri: 'S' },
  { id: 'ATK-08', stage: 4, name: 'Dump customers through search', attack: 'T1190, T1041', needs: [MAP], gains: ['souls'],
    stoppedBy: [{ action: 'DEF-10', feature: 'search' }, SQLI, { action: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'sqlmap' } }, { action: 'DEF-13', patch: 'search' }], pri: 'M' }, // which WAF rule stops which variant: D-34
  { id: 'ATK-09', stage: 4, name: 'Scrape users through the admin API', attack: 'T1213', needs: [ADMIN_OR_OWN], gains: ['souls'],
    stoppedBy: [{ action: 'DEF-08', account: 'used' }, { action: 'DEF-14', account: 'used' }, { action: 'DEF-09' }], pri: 'M' },
  { id: 'ATK-10', stage: 4, name: "Walk other customers' baskets", attack: 'T1190', needs: [{ anyOf: [{ gain: 'user-session' }, { anySession: true }] }], gains: ['souls'],
    stoppedBy: [{ action: 'DEF-13', patch: 'basket-ownership' }, { action: 'DEF-08', account: 'used' }], pri: 'S' },
  { id: 'ATK-11', stage: 5, name: 'Plant a hidden second admin', attack: 'T1136', needs: [ADMIN_OR_OWN], gains: [], foothold: 'hidden-admin',
    stoppedBy: [{ action: 'DEF-14', account: 'used' }], pri: 'M' },
  { id: 'ATK-12', stage: 5, name: 'Take over a real customer', attack: 'T1098', needs: [{ gain: 'user-session' }], gains: [], foothold: 'hijacked-user',
    stoppedBy: [{ action: 'DEF-16', account: 'target' }, { action: 'DEF-13', patch: 'change-password' }], pri: 'S' },
  { id: 'ATK-13', stage: 5, name: 'Plant a file', attack: 'T1105', needs: [{ anySession: true }], gains: [], foothold: 'planted-file',
    stoppedBy: [{ action: 'DEF-15', undo: true }, { action: 'DEF-10', feature: 'uploads' }], pri: 'M' },
  { id: 'ATK-14', stage: 5, name: 'Forge his own login token', attack: 'T1606', needs: [MAP, { anyOf: [{ gain: 'secrets-leaked' }, { stageGain: 3 }] }], gains: [], foothold: 'forged-token',
    stoppedBy: [{ action: 'DEF-13', patch: 'token-verify' }], pri: 'S' },
  { id: 'ATK-15', stage: 6, name: 'Deface products', attack: 'T1491.002', needs: [MAP], gains: ['defaced'],
    stoppedBy: [{ action: 'DEF-17', undo: true }, PUT_PRODUCTS, { action: 'DEF-13', patch: 'product-update' }], pri: 'M' },
  { id: 'ATK-16', stage: 6, name: 'Booby-trap a product page', attack: 'T1189', needs: [MAP], gains: ['xss-live'],
    stoppedBy: [{ action: 'DEF-17', undo: true }, PUT_PRODUCTS, { action: 'DEF-13', patch: 'product-update' }], pri: 'S' },
  { id: 'ATK-17', stage: 6, name: 'Ransom note', attack: 'T1491.002', needs: [{ anyAdmin: true }], gains: ['ransom'],
    stoppedBy: [{ action: 'DEF-17', undo: true }, { action: 'DEF-15', undo: true }, { action: 'DEF-20', undo: true }], pri: 'M' },
];

export const MOVE_BY_ID: Readonly<Record<MoveId, Move>> = Object.fromEntries(MOVES.map((m) => [m.id, m])) as Record<MoveId, Move>;

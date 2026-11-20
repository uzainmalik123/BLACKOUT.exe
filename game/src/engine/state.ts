// The world state (PRD SYS-04): one typed, JSON-plain model every DEF and ATK reads and writes through.
// Times are game milliseconds since the scenario start (SYS-01). Derived facts (gains, footholds) live in facts.ts.
import type { Row } from '../recordings/format';
import type { GameEvent } from './log';
import type { Difficulty, Ending, Feature, Foothold, MinionId, MoveId, Patch, WafRule } from '../rules/vocabulary';
import { FEATURE_DEFAULTS } from '../rules/vocabulary';
import { CONFIG } from './config';
import { SEED_ACCOUNTS } from './seed';

export interface Account {
  id: number;
  email: string;
  role: 'admin' | 'customer' | 'deluxe' | 'accounting';
  lockedAt?: number; // DEF-08 (Juice Shop's deletedAt)
  createdBy: 'seed' | MoveId; // ATK-06 (his own admin) or ATK-11 (the hidden one)
  hijackedBy?: MoveId; // ATK-12
  passwordResetAt?: number; // DEF-16
}

export interface Session {
  id: number;
  email: string;
  kind: 'admin' | 'user';
  issuedBy: MoveId | MinionId;
  keyVersion: number; // DEF-09 rotates signingKey.version; a session signed with an old key is dead
}

export interface VFile {
  path: string; // relative to uploads/
  size: number;
  sha256: string;
  contentBase64?: string;
  plantedBy?: MoveId;
}

export interface Defacement {
  productId: number;
  kind: 'deface' | 'xss';
  by: MoveId;
}

export interface DbChange {
  t: number;
  op: 'insert' | 'update' | 'delete';
  table: string;
  key: Record<string, string | number>;
  before?: Row;
  after?: Row;
}

export interface AccessLine {
  t: number;
  ip: string;
  method: string;
  target: string;
  protocol: string;
  status: number;
  bytes: number;
  referer: string;
  userAgent: string;
  by: MoveId | MinionId;
}

export interface AppLine {
  t: number;
  text: string;
  by: MoveId | MinionId;
}

export interface Replay {
  id: number;
  owner: 'death' | MinionId;
  move: MoveId | MinionId;
  variant: string;
  ip: string; // the address this replay plays from (a fresh one when the recorded IP is blocked, D-24)
  recordedIp: string; // the recording's attackerIp, rewritten to `ip` in every access line
  ips?: string[]; // a minion wave's addresses: its access lines rotate through them
  startedAt: number;
  cursor: number; // next recording event to apply
}

export interface Wave {
  id: number;
  minion: MinionId;
  n: number;
  ips: string[];
  startedAt: number;
  endsAt: number;
  successesDone: number;
}

export interface Alert {
  id: number;
  about: MoveId | MinionId;
  openedAt: number;
  closedAt?: number;
}

export interface Backup {
  id: number;
  takenAt: number;
  accounts: Account[];
  files: VFile[];
  defacements: Defacement[];
}

export interface Evidence {
  name: string;
  takenAt: number;
  accessLines: number;
  appLines: number;
}

export type { Ending } from '../rules/vocabulary';

export interface World {
  seed: number;
  rng: number;
  difficulty: Difficulty;
  clock: { gameMs: number; paused: boolean; lastDirectorTick: number; lastBackupAt: number };
  souls: { total: number; stolen: Array<{ table: string; key: number }> };
  heartbeat: number;
  accounts: Account[];
  sessions: Session[];
  signingKey: { version: number; rotatedAt?: number };
  files: VFile[];
  defacements: Defacement[]; // ATK-15/16, and ATK-17's renamed first product (no route writes the banner: KI-03)
  features: Record<Feature, boolean>;
  firewall: { blocked: string[] };
  waf: WafRule[];
  nginx: 'running' | 'stopped';
  patches: { applied: Patch[]; pending: Array<{ patch: Patch; readyAt: number }> };
  backups: Backup[];
  evidence: Evidence[];
  comms: { escalatedAt?: number; notifiedAt: { legal?: number; customers?: number }; breachConfirmedAt?: number };
  death: {
    knowledge: Array<'map' | 'secrets-leaked' | 'admin-password'>;
    forgedToken: boolean;
    played: Array<{ move: MoveId; variant: string; outcome: 'landed' | 'cut' }>;
    nextMoveAt: number;
    stageSkips: number; // tip-offs not yet spent (D-19)
    pacingDelayed: boolean; // SYS-02: the one-off delay for > 3 open alerts has been applied
    skipWait: boolean; // a tip-off during an active move: the next wait is skipped when it ends
    tippedOff: boolean; // he has been tipped off at least once this run (D-31: the quiet harvest)
    quietSince?: number; // SYS-07: routes closed with a foothold left
    returnedThrough?: Foothold;
    resume: Partial<Record<MoveId, { variant: string; cursor: number }>>; // where an IP-cut move continues from a fresh address (D-24)
    nextId: number; // ids for replays, waves, alerts, sessions, backups
  };
  replays: Replay[];
  waves: Wave[];
  nextWaveAt: Record<MinionId, number>;
  alerts: Alert[];
  quietAlertsSince: number;
  logs: { access: AccessLine[]; app: AppLine[]; dbChanges: DbChange[] };
  events: GameEvent[]; // SYS-10
  ending?: Ending;
}

export function initialWorld(seed: number, difficulty: Difficulty): World {
  const config = CONFIG[difficulty];
  const accounts = SEED_ACCOUNTS.map((a) => ({ ...a }));
  return {
    seed,
    rng: seed >>> 0,
    difficulty,
    clock: { gameMs: 0, paused: false, lastDirectorTick: 0, lastBackupAt: 0 },
    souls: { total: SEED_ACCOUNTS.length, stolen: [] },
    heartbeat: 100,
    accounts,
    sessions: [],
    signingKey: { version: 1 },
    files: [],
    defacements: [],
    features: { ...FEATURE_DEFAULTS },
    firewall: { blocked: [] },
    waf: [],
    nginx: 'running',
    patches: { applied: [], pending: [] },
    backups: [{ id: 0, takenAt: 0, accounts: accounts.map((a) => ({ ...a })), files: [], defacements: [] }],
    evidence: [],
    comms: { notifiedAt: {} },
    death: { knowledge: [], forgedToken: false, played: [], nextMoveAt: 0, stageSkips: 0, pacingDelayed: false, skipWait: false, tippedOff: false, resume: {}, nextId: 1 },
    replays: [],
    waves: [],
    nextWaveAt: { ...config.minions.firstWaveGameMs },
    alerts: [],
    quietAlertsSince: 0,
    logs: { access: [], app: [], dbChanges: [] },
    events: [],
  };
}

// The world state (PRD SYS-04): one typed, JSON-plain model every DEF and ATK reads and writes through.
// Times are game milliseconds since the scenario start (SYS-01). Derived facts (gains, footholds) live in facts.ts.
import type { Row } from '../recordings/format';
import type { GameEvent } from './log';
import type { Actor, Difficulty, Ending, Feature, Foothold, MinionId, MoveId, Patch, TapId, WafRule } from '../rules/vocabulary';
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
  by: Actor;
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
  endCursor?: number; // D-41: a minion wave's slice stops before this event (after its last success)
  soulCap?: number; // D-42: a big soul door's visit lands once it has taken this many souls (half of those left when it started)
  soulsTaken?: number; // D-42: souls this visit has taken so far
  userIds?: Record<string, number>; // recorded Users id → the id it got here, when another account already had it (ATK-06.a and ATK-11.a both insert 326)
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
  about: Actor;
  openedAt: number;
  closedAt?: number;
}

/** An open leaky tap (D-42, PRD §4.1). */
export interface OpenTap {
  id: TapId;
  openedAt: number;
  nextDripAt: number;
  drips: number;
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
  souls: { total: number; stolen: Array<{ table: string; key: number }>; byMinions: number }; // byMinions: D-41's 5 % cap
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
    pacingDelayed: boolean; // SYS-02, D-43: the delay for 2+ open alerts has been applied since his last move started
    skipWait: boolean; // a tip-off during an active move: the next wait is skipped when it ends
    tippedOff: boolean; // he has been tipped off at least once this run (D-31: the quiet harvest)
    quietSince?: number; // SYS-07: routes closed with a foothold left
    returnedThrough?: Foothold;
    resume: Partial<Record<MoveId, { variant: string; cursor: number; soulCap?: number; soulsTaken?: number }>>; // where an IP-cut move continues from a fresh address (D-24), with a visit's cap (D-42)
    noRepeat?: MoveId; // D-41: cut by a stopper; not picked again until he has started a different move
    shutDoors: MoveId[]; // D-42: big soul doors closed for good; he never tries them again
    lastPick?: 'story' | 'visit'; // D-42: every second move he starts is a visit to one of his open doors
    nextId: number; // ids for replays, waves, alerts, sessions, backups
  };
  replays: Replay[];
  waves: Wave[];
  nextWaveAt: Record<MinionId, number>;
  minionCursor: Partial<Record<MinionId, number>>; // D-41: where the next wave's slice of its recording starts
  taps: { open: OpenTap[]; opened: TapId[]; nextAt: number; rng: number }; // D-42: leaky taps; their own seeded stream, so Death's draws don't move
  alerts: Alert[];
  quietAlertsSince: number;
  logs: { access: AccessLine[]; app: AppLine[]; dbChanges: DbChange[] };
  events: GameEvent[]; // SYS-10
  ending?: Ending;
}

/** D-42: the taps' own PRNG state, derived from the run's seed. */
export function tapSeed(seed: number): number {
  return (seed ^ 0x7a9c3e15) >>> 0;
}

/** mulberry32, the same generator as rng.ts, on an explicit state: returns the value and the next state. */
export function mulberry(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
}

export function initialWorld(seed: number, difficulty: Difficulty): World {
  const config = CONFIG[difficulty];
  const accounts = SEED_ACCOUNTS.map((a) => ({ ...a }));
  const firstTap = mulberry(tapSeed(seed)); // D-42: the first tap opens one seeded interval in
  return {
    seed,
    rng: seed >>> 0,
    difficulty,
    clock: { gameMs: 0, paused: false, lastDirectorTick: 0, lastBackupAt: 0 },
    souls: { total: SEED_ACCOUNTS.length, stolen: [], byMinions: 0 },
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
    death: { knowledge: [], forgedToken: false, played: [], nextMoveAt: 0, stageSkips: 0, pacingDelayed: false, skipWait: false, tippedOff: false, resume: {}, shutDoors: [], nextId: 1 },
    replays: [],
    waves: [],
    nextWaveAt: { ...config.minions.firstWaveGameMs },
    minionCursor: {},
    taps: { open: [], opened: [], nextAt: config.taps.everyGameMs.min + Math.round(firstTap.value * (config.taps.everyGameMs.max - config.taps.everyGameMs.min)), rng: firstTap.state },
    alerts: [],
    quietAlertsSince: 0,
    logs: { access: [], app: [], dbChanges: [] },
    events: [],
  };
}

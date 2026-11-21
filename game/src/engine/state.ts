// The world state (PRD SYS-04): one typed, JSON-plain model every DEF and ATK reads and writes through.
// Times are game milliseconds since the scenario start (SYS-01). Derived facts (gains, footholds) live in facts.ts.
import type { Row } from '../recordings/format';
import type { GameEvent } from './log';
import type { Actor, Difficulty, Ending, Feature, Foothold, MinionId, MoveId, Patch, RequestClass, TapId, WafRule } from '../rules/vocabulary';
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
  takesAll?: boolean; // D-44: started with fewer than 10 % of the souls left: it takes the rest when it lands
  frozenSince?: number; // D-45: a visit stopped by a fix or the plug waits here, in place, for up to doors.pauseGraceGameMs
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

/** A customer's complaint to support (D-65): one per shopper per loop, at their first failure. For the comms console. */
export interface Ticket {
  id: number;
  t: number;
  ip: string; // the shopper's pool address, as the log shows it
  userAgent: string;
  about: RequestClass;
  status: 403 | 429 | 503 | 'blocked'; // what the shop answered; 'blocked' = the firewall dropped them
  text: string;
}

/** The customers (SYS-19, D-65): where the traffic loop stands, this loop's shoppers and what the player did to them. */
export interface CustomerState {
  loop: number; // 0 until the first loop starts
  loopStartedAt: number; // game ms
  cursor: number; // next recording event
  addresses: Record<string, string>; // this loop's shoppers: recorded address → pool address
  failures: Record<string, number>; // failed requests per shopper (recorded address) this loop
  gone: string[]; // shoppers who gave up this loop (recorded addresses): the rest of their visit never comes
  hits: Record<string, number[]>; // rate limits: `<recorded address> <rule path>` → recorded times of recent hits
  rng: number; // the customers' own seeded stream, so Death's draws don't move
  lastFailureAt?: number; // SYS-06 recovery waits a real minute after this
  served: number; // requests that reached the shop and were answered as recorded
  failed: number; // requests the player's actions failed
  lost: number; // shoppers who gave up (churn), over the run
}

export type { Ending } from '../rules/vocabulary';

export interface World {
  seed: number;
  rng: number;
  difficulty: Difficulty;
  clock: { gameMs: number; paused: boolean; lastDirectorTick: number; lastBackupAt: number };
  souls: { total: number; stolen: Array<{ table: string; key: number }>; byMinions: number }; // byMinions: D-41's 5 % cap
  heartbeat: number;
  heartbeatMax: number; // D-65: churn lowers it for good; the heartbeat never rises above it
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
    resume: Partial<Record<MoveId, { variant: string; cursor: number; soulCap?: number; soulsTaken?: number; takesAll?: boolean }>>; // where an IP-cut move continues from a fresh address (D-24), and where a paused visit carries on with its cap (D-42, D-45)
    noRepeat?: MoveId; // D-41: cut by a stopper; not picked again until he has started a different move
    shutDoors: MoveId[]; // D-44: big soul doors shut right now (a stopper holds for every half he may play); refreshed every tick, see doors.ts
    lastPick?: 'story' | 'visit'; // D-42: every second move he starts is a visit to one of his open doors
    ipCutsInRow: number; // D-46: IP-block cuts on his moves since one last landed or was cut by anything else
    proxies: boolean; // D-46 (KI-78): he switched to rotating proxies (after config.proxies.afterIpCuts IP cuts in a row)
    stuckSince?: number; // D-46 (KI-80): since when he has had nothing he could play
    nextId: number; // ids for replays, waves, alerts, sessions, backups
  };
  replays: Replay[];
  waves: Wave[];
  nextWaveAt: Record<MinionId, number>;
  minionCursor: Partial<Record<MinionId, number>>; // D-41: where the next wave's slice of its recording starts
  taps: { open: OpenTap[]; opened: TapId[]; nextAt: number; rng: number }; // D-42: leaky taps; their own seeded stream, so Death's draws don't move
  customers: CustomerState; // SYS-19, D-65
  tickets: Ticket[]; // D-65: support tickets, for the comms console
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

/** D-65: the customers' own PRNG state, derived from the run's seed. */
export function customerSeed(seed: number): number {
  return (seed ^ 0x3c6ef372) >>> 0;
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
    heartbeatMax: 100,
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
    death: { knowledge: [], forgedToken: false, played: [], nextMoveAt: 0, stageSkips: 0, pacingDelayed: false, skipWait: false, tippedOff: false, resume: {}, shutDoors: [], ipCutsInRow: 0, proxies: false, nextId: 1 },
    replays: [],
    waves: [],
    nextWaveAt: { ...config.minions.firstWaveGameMs },
    minionCursor: {},
    taps: { open: [], opened: [], nextAt: config.taps.everyGameMs.min + Math.round(firstTap.value * (config.taps.everyGameMs.max - config.taps.everyGameMs.min)), rng: firstTap.state },
    customers: { loop: 0, loopStartedAt: 0, cursor: 0, addresses: {}, failures: {}, gone: [], hits: {}, rng: customerSeed(seed), served: 0, failed: 0, lost: 0 },
    tickets: [],
    alerts: [],
    quietAlertsSince: 0,
    logs: { access: [], app: [], dbChanges: [] },
    events: [],
  };
}

// The judging engine (SYS-21, D-114): one rule-based assessor, updated inside advance(), reading only the world and
// its event log. It holds the last RELEVANT action, a status with evidence per playbook phase, the mistakes so far
// (SYS-11's rules), and the biggest gap standing now with how long it has stood. SYS-11's report is its final
// snapshot; SYS-13's struggle detector reads it. Nothing here is meant to be shown as a live score: it is for the
// hint/Kiro layer (ENGINE_API §2.2).
import { ACTION_BY_ID } from '../rules/actions';
import { MOVE_BY_ID, MOVES, SOUL_DOORS } from '../rules/moves';
import { TAP_BY_ID } from '../rules/taps';
import { FOOTHOLDS, type ActionId, type Feature, type Foothold, type MoveId, type Patch, type PlayerAction, type Stage, type TapId } from '../rules/vocabulary';
import { CONFIG } from './config';
import { footholds } from './facts';
import type { GameEvent } from './log';
import type { World } from './state';

export type Phase = 'detect' | 'contain' | 'eradicate' | 'recover';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export const PHASES: readonly Phase[] = ['detect', 'contain', 'eradicate', 'recover'];

export interface Mistake {
  title: string;
  why: string; // the real-world reason, with its source
  phase: Phase;
}

/** The gaps the assessor knows, biggest first (D-114, tune): what a hint should point at. A type, never a text. */
export const GAP_TYPES = [
  'door-uninvestigated', // a soul door he opened and no look at its address or path since
  'stage-unseen', // a stage of his started and no relevant action since
  'foothold-unqueried', // an account foothold planted and Users never queried since
  'planted-file-unchecked', // a file planted and uploads never listed since
  'eradicated-without-evidence', // changes made with no evidence snapshot at all
  'door-unpatched', // a soul door he opened, patch neither deployed nor deploying
  'breach-unconfirmed', // souls taken, no snapshot or escalation since
  'notification-due', // breach confirmed, legal not told
  'defacement-live', // customers see his message
  'tap-open', // a leaky tap dripping
  'plug-pulled', // self-inflicted downtime
  'feature-off-after-patch', // containment kept past its fix
  'move-uncontained', // one of his moves running right now
] as const;
export type GapType = (typeof GAP_TYPES)[number];

export interface Gap {
  type: GapType;
  since: number; // game ms: when it began standing
}

export interface PhaseStatus {
  status: 'quiet' | 'behind' | 'current' | 'open' | 'holding' | 'pending' | 'clean' | 'degraded' | 'ok';
  evidence: string[];
}

/** What the assessor computes; `world.assess` holds the latest, plus what it has learnt about his work. */
export interface Assessment {
  facts: Array<{ label: string; value: string }>;
  grades: Record<Phase, Grade>;
  mistakes: Mistake[];
  missed: string[];
  phases: Record<Phase, PhaseStatus>;
  gaps: Gap[]; // every gap standing now, biggest first
  gap?: Gap; // the biggest
  lastRelevantActionAt: number;
  relevant: number[]; // ids of the action events that were relevant
}

export interface AssessState extends Assessment {
  assessedAt: number; // game ms of the last snapshot
  cursor: number; // events seen so far (for the urgent refresh)
  judgedUpTo: number; // the highest event id already judged for relevance (an action's verdict is in `relevant`)
  judge: { startedMoves: MoveId[]; landedMoves: MoveId[]; running: boolean; tapsOpened: TapId[] }; // what the player could know of his work, as of judgedUpTo
  logCursor: number; // access lines learnt from so far
  hisAddresses: string[]; // every address he has used (his moves' starts and lines)
  hisPaths: string[]; // every path his moves requested
  hisAccounts: string[]; // emails of accounts he created, hijacked or held a session for, ever
  hisFiles: string[]; // paths of files he planted, ever
}

/** What the assessor knows of his work: what it remembered plus what the world shows now (the log from its cursor on). */
interface Knowledge { addresses: Set<string>; paths: Set<string>; hisAccounts: Set<string>; hisFiles: Set<string>; logCursor: number }

const knowledgeCache = new WeakMap<AssessState, { sizes: string; sets: Knowledge }>();

function learn(world: World): Knowledge {
  const a = world.assess;
  // The remembered arrays become Sets once per change, not once per tick (the scan's paths run to thousands).
  const sizes = `${a.hisAddresses.length} ${a.hisPaths.length} ${a.hisAccounts.length} ${a.hisFiles.length}`;
  let cached = knowledgeCache.get(a);
  if (!cached || cached.sizes !== sizes) {
    cached = { sizes, sets: { addresses: new Set(a.hisAddresses), paths: new Set(a.hisPaths), hisAccounts: new Set(a.hisAccounts), hisFiles: new Set(a.hisFiles), logCursor: a.logCursor } };
    knowledgeCache.set(a, cached);
  }
  const base = cached.sets;
  const k: Knowledge = { addresses: new Set(base.addresses), paths: new Set(base.paths), hisAccounts: new Set(base.hisAccounts), hisFiles: new Set(base.hisFiles), logCursor: world.logs.access.length };
  for (let i = a.logCursor; i < world.logs.access.length; i++) {
    const l = world.logs.access[i]!;
    if (!l.by.startsWith('ATK-')) continue;
    k.addresses.add(l.ip);
    k.paths.add(l.target.split('?')[0]!);
  }
  for (const r of world.replays) if (r.owner === 'death') for (const ip of r.ips ?? [r.ip]) k.addresses.add(ip);
  for (const acc of world.accounts) if (acc.createdBy !== 'seed' || acc.hijackedBy !== undefined) k.hisAccounts.add(acc.email);
  for (const s of world.sessions) k.hisAccounts.add(s.email);
  for (const f of world.files) if (f.plantedBy !== undefined) k.hisFiles.add(f.path);
  return k;
}

const REAL_S = 30_000; // game ms (SYS-01)
const REAL_MIN = 60 * REAL_S;
const GAME_MIN = 60_000;

/** Thresholds, in game ms (D-112, D-114, all "tune"). */
export const GRADING = {
  notice: { A: 1 * REAL_MIN, B: 2 * REAL_MIN, C: 4 * REAL_MIN, D: 8 * REAL_MIN }, // the mean time a stage went unnoticed
  slowNotice: 2 * REAL_MIN, // a stage unnoticed this long is a mistake of its own
  contain: { A: 2 * REAL_MIN, B: 4 * REAL_MIN, C: 8 * REAL_MIN, D: 12 * REAL_MIN }, // from his first move to the first fix that held
  soulsLost: { some: 0.25, most: 0.75 }, // shares of the souls that cost a grade and two
  whackAMole: 3, // IP blocks on his addresses (PRD SYS-11)
  downtime: { some: 1 * REAL_MIN, long: 3 * REAL_MIN }, // the plug pulled, in total
  churn: 10, // customers who gave up
} as const;

type Action = Extract<GameEvent, { kind: 'action' }>;
type Kinds = { [K in GameEvent['kind']]: Extract<GameEvent, { kind: K }>[] };

/** One pass over the log, bucketed by kind. */
function index(events: GameEvent[]): Kinds {
  const k = {} as Kinds;
  for (const e of events) ((k[e.kind] as GameEvent[] | undefined) ??= []).push(e);
  for (const kind of KINDS) (k[kind] as GameEvent[] | undefined) ??= [];
  return k;
}
const KINDS: readonly GameEvent['kind'][] = ['move-started', 'move-landed', 'move-cut', 'wave-started', 'wave-ended', 'action', 'kiro', 'souls-stolen', 'tip-off', 'alert-opened', 'alert-closed', 'tap-opened', 'tap-closed', 'door-shut', 'door-reopened', 'proxies', 'ticket', 'customer-lost', 'patch-applied', 'banished', 'return', 'ending'];

/** Game time as the player saw it on the clock: minutes, or hours and minutes. */
export function fmtGameMs(ms: number): string {
  const minutes = Math.round(ms / GAME_MIN);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

const letter = (points: number): Grade => (['A', 'B', 'C', 'D'][points] as Grade | undefined) ?? 'F';
const worse = (a: Grade, b: Grade): Grade => ('ABCDF'.indexOf(a) >= 'ABCDF'.indexOf(b) ? a : b);
const bandOf = (ms: number | undefined, bands: { A: number; B: number; C: number; D: number }): Grade =>
  ms === undefined ? 'F' : ms <= bands.A ? 'A' : ms <= bands.B ? 'B' : ms <= bands.C ? 'C' : ms <= bands.D ? 'D' : 'F';

const ERADICATING: ReadonlySet<ActionId> = new Set((Object.keys(ACTION_BY_ID) as ActionId[]).filter((id) => ACTION_BY_ID[id].phase === 'eradicate'));
const SESSION_MOVES: ReadonlySet<MoveId> = new Set(MOVES.filter((m) => m.gains.includes('admin-session') || m.gains.includes('user-session')).map((m) => m.id));
const FEATURE_PATCH: Partial<Record<Feature, Patch>> = { search: 'search', registration: 'registration' }; // the flags with a patch to bring them back after
const DOOR_PATCH: Record<string, Patch> = { 'ATK-08': 'search', 'ATK-09': 'users-access' };
const DOOR_PATH: Record<string, string> = { 'ATK-08': '/rest/products/search', 'ATK-09': '/api/Users' };
const FOOTHOLD_NAME: Record<Foothold, string> = {
  'hidden-admin': 'a hidden admin account', 'hijacked-user': 'a hijacked customer account', 'planted-file': 'a planted file in uploads/', 'forged-token': 'a forged login token (token verification never patched)',
};
const USERS_SQL = /\busers\b/i;
const ENDING_FAILS: Record<string, Phase | undefined> = { 'souls-lost': 'contain', flatline: 'recover', return: 'eradicate' };

/** Does a stopper row of this move match the action with these parameters? */
function stopperMatches(move: MoveId, a: PlayerAction): boolean {
  return MOVE_BY_ID[move].stoppedBy.some((s) => {
    if (s.action !== a.type) return false;
    if ('undo' in s) return true;
    switch (s.action) {
      case 'DEF-10': return a.type === 'DEF-10' && a.feature === s.feature && a.enabled === (s.feature === 'feedback-captcha');
      case 'DEF-12': return a.type === 'DEF-12' && JSON.stringify(a.rule).toLowerCase() === JSON.stringify(s.rule).toLowerCase();
      case 'DEF-13': return a.type === 'DEF-13' && a.patch === s.patch;
      default: return true; // DEF-06/07/08/09/14/16 on a move he has started act on his work
    }
  });
}

/** What the player could know of his work when an action happened. */
export interface RelevanceContext {
  started: Set<MoveId>; // moves he had started
  landed: Set<MoveId>; // moves that had landed
  active: boolean; // one of his moves was running
  addresses: Set<string>; // addresses he had used
  paths: Set<string>; // paths his moves had requested
  tapsOpened: Set<TapId>;
  hisAccounts: Set<string>; // accounts he created, hijacked or held a session for
  hisFiles: Set<string>; // files he planted
}

const DEFACING: ReadonlySet<MoveId> = new Set(MOVES.filter((m) => m.gains.includes('defaced') || m.gains.includes('xss-live') || m.id === 'ATK-17').map((m) => m.id));
const PLANTING: ReadonlySet<MoveId> = new Set(MOVES.filter((m) => m.foothold !== undefined).map((m) => m.id));

/**
 * D-114 rule 2: a RELEVANT action, judged against his work as it stood. A look that names one of his addresses or a
 * path his moves requested, a Users query, a block on his address, anything that stops or interrupts a move he has
 * started or closes a door or a tap, and DEF-05/13/14/15/17 when they act on his work. Unfocused reads are not.
 */
export function isRelevant(a: PlayerAction, ctx: RelevanceContext): boolean {
  switch (a.type) {
    case 'DEF-01': {
      const q = a.query;
      return [...ctx.addresses].some((ip) => q.includes(ip)) || [...ctx.paths].some((p) => p.length > 1 && q.includes(p));
    }
    case 'DEF-02': return USERS_SQL.test(a.sql);
    case 'DEF-03': return /uploads/.test(a.path) && ([...ctx.landed].some((m) => MOVE_BY_ID[m].foothold === 'planted-file') || ctx.landed.has('ATK-17')); // a look at uploads once something is there
    case 'DEF-04': return ctx.addresses.has(a.ip);
    case 'DEF-05': return ctx.started.size > 0; // evidence of his work
    case 'DEF-06': return a.op === 'add' && ctx.addresses.has(a.ip);
    case 'DEF-11': return ctx.active; // the plug interrupts the move he is playing
    case 'DEF-12':
      if ([...ctx.tapsOpened].some((t) => JSON.stringify(TAP_BY_ID[t].closedBy.rule) === JSON.stringify(a.rule))) return true;
      return [...ctx.started].some((m) => stopperMatches(m, a));
    case 'DEF-13': return [...ctx.started].some((m) => stopperMatches(m, a));
    case 'DEF-14': return ctx.hisAccounts.has(a.email);
    case 'DEF-15': return ctx.hisFiles.has(a.path);
    case 'DEF-16': return ctx.hisAccounts.has(a.email) || (a.email === 'admin@juice-sh.op' && ctx.started.has('ATK-04'));
    case 'DEF-17': return [...ctx.landed].some((m) => DEFACING.has(m) || PLANTING.has(m));
    case 'DEF-07': case 'DEF-08': case 'DEF-09': case 'DEF-10': return [...ctx.started].some((m) => stopperMatches(m, a));
    case 'DEF-18': case 'DEF-19': case 'DEF-20': return false;
  }
}

/** Walks the events after `judgedUpTo`, keeping `ctx` current, and judges each accepted action; returns the relevant ones. */
function judgeFrom(world: World, know: Knowledge, judge: AssessState['judge'], from: number): Action[] {
  const ctx: RelevanceContext = { started: new Set(judge.startedMoves), landed: new Set(judge.landedMoves), active: judge.running, addresses: know.addresses, paths: know.paths, tapsOpened: new Set(judge.tapsOpened), hisAccounts: know.hisAccounts, hisFiles: know.hisFiles };
  const out: Action[] = [];
  for (let i = from; i < world.events.length; i++) { // ids are 1-based positions (log.ts), so the events after `from` start at index `from`
    const e = world.events[i]!;
    if (e.kind === 'move-started') { ctx.started.add(e.move); ctx.addresses.add(e.ip); ctx.active = true; if (DOOR_PATH[e.move]) ctx.paths.add(DOOR_PATH[e.move]!); }
    else if (e.kind === 'move-landed') { ctx.landed.add(e.move); ctx.active = false; }
    else if (e.kind === 'move-cut') ctx.active = false;
    else if (e.kind === 'tap-opened') ctx.tapsOpened.add(e.tap);
    else if (e.kind === 'action' && e.ok && isRelevant(e.action, ctx)) out.push(e);
  }
  judge.startedMoves = [...ctx.started]; judge.landedMoves = [...ctx.landed]; judge.running = ctx.active; judge.tapsOpened = [...ctx.tapsOpened];
  return out;
}

/**
 * The relevant action events, in order: the verdicts stepAssess made as they happened (judged against what he had done
 * by then, never revised), plus a judgement now of any action it hasn't seen yet (inside one tick, the same thing).
 */
function relevantActions(world: World, know: Knowledge): Action[] {
  const a = world.assess;
  const judged = new Set(a.relevant);
  const last = world.events.at(-1)?.id ?? 0;
  const fresh = last > a.judgedUpTo ? new Set(judgeFrom(world, know, structuredClone(a.judge), a.judgedUpTo).map((e) => e.id)) : new Set<number>();
  return world.events.filter((e): e is Action => e.kind === 'action' && e.ok && (judged.has(e.id) || fresh.has(e.id)));
}

/** SYS-21: the assessment of the world as it stands. Pure: the same world gives the same answer. */
export function evaluate(world: World): Assessment {
  const events = world.events;
  const k = index(events);
  const now = world.clock.gameMs;
  const end = world.ending ? (k.ending[0]?.t ?? now) : now;
  const ending = k.ending[0];
  const facts: Assessment['facts'] = [];
  const mistakes: Mistake[] = [];
  const gaps: Gap[] = [];
  const points: Record<Phase, number> = { detect: 0, contain: 0, eradicate: 0, recover: 0 };
  const actions = k.action.filter((a) => a.ok);
  const relevant = relevantActions(world, learn(world));
  const starts = k['move-started'];
  const landed = k['move-landed'];
  const firstStart = starts[0]?.t;
  const stolen = k['souls-stolen'];
  const total = world.souls.total;
  const lost = world.souls.stolen.length;
  const phases: Record<Phase, PhaseStatus> = { detect: { status: 'quiet', evidence: [] }, contain: { status: 'quiet', evidence: [] }, eradicate: { status: 'clean', evidence: [] }, recover: { status: 'ok', evidence: [] } };

  facts.push({ label: 'Outcome', value: ending ? { banished: 'Banished', 'souls-lost': 'Every soul lost', flatline: 'Flatline', return: 'The return' }[ending.ending] : 'Unfinished' });
  facts.push({ label: 'Incident length', value: fmtGameMs(end) });

  // --- Detect: time to notice each stage: the first RELEVANT action after the stage's first move.
  const stagesPlayed = [...new Set(starts.map((e) => e.stage))].sort((a, b) => a - b) as Stage[];
  const notices: number[] = [];
  for (const stage of stagesPlayed) {
    const first = starts.find((e) => e.stage === stage)!;
    const noticed = relevant.find((a) => a.id > first.id);
    const took = noticed ? noticed.t - first.t : undefined;
    notices.push(took ?? end - first.t);
    facts.push({ label: `Time to notice stage ${stage}`, value: took === undefined ? 'never' : fmtGameMs(took) });
    phases.detect.evidence.push(took === undefined ? `stage ${stage}: unnoticed for ${fmtGameMs(end - first.t)}` : `stage ${stage}: noticed ${fmtGameMs(took)} after it started`);
    if (took === undefined) {
      gaps.push({ type: 'stage-unseen', since: first.t });
      if (ending) mistakes.push({ phase: 'detect', title: `Stage ${stage} (${MOVE_BY_ID[first.move].name.toLowerCase()}) was never noticed`, why: 'An attacker who is never seen is never stopped: the logs and the alerts are where every incident starts (NIST SP 800-61, detection and analysis).' });
      else if (end - first.t > GRADING.slowNotice) mistakes.push({ phase: 'detect', title: `Stage ${stage} has gone unnoticed for ${fmtGameMs(end - first.t)}`, why: 'Every minute the attacker works unseen is a minute of theft or damage: watch the busiest addresses, the error rate and the alerts (NIST SP 800-61, detection and analysis).' });
    } else if (took > GRADING.slowNotice) mistakes.push({ phase: 'detect', title: `Stage ${stage} went unnoticed for ${fmtGameMs(took)}`, why: 'Every minute the attacker works unseen is a minute of theft or damage: watch the busiest addresses, the error rate and the alerts (NIST SP 800-61, detection and analysis).' });
  }
  if (starts.length > 0) phases.detect.status = gaps.some((g) => g.type === 'stage-unseen') ? 'behind' : 'current';
  const meanNotice = notices.length > 0 ? notices.reduce((a, b) => a + b, 0) / notices.length : undefined;
  const detectBase: Grade = starts.length === 0 ? 'A' : bandOf(meanNotice, GRADING.notice);

  // --- Contain: from his first move to the first fix that held (a cut by anything but an IP block, a door shut, or banishment).
  const held = events.find((e) => (e.kind === 'move-cut' && e.by !== 'DEF-06') || e.kind === 'door-shut' || e.kind === 'banished');
  const contained = firstStart !== undefined && held !== undefined && held.t >= firstStart ? held.t - firstStart : undefined;
  facts.push({ label: 'Time to contain', value: contained === undefined ? 'never' : fmtGameMs(contained) });
  const containBase: Grade = starts.length === 0 ? 'A' : bandOf(contained, GRADING.contain);
  if (starts.length > 0) {
    phases.contain.status = held ? 'holding' : 'open';
    phases.contain.evidence.push(held ? `first fix held ${fmtGameMs(contained!)} after his first move (${held.kind}${'by' in held ? ` by ${held.by}` : ''})` : 'no fix has held yet');
    for (const d of world.death.shutDoors) phases.contain.evidence.push(`${MOVE_BY_ID[d].name.toLowerCase()}: shut for now`);
  }
  const active = world.replays.find((r) => r.owner === 'death' && r.frozenSince === undefined);
  if (active) {
    const start = [...starts].reverse().find((e) => e.move === active.move);
    gaps.push({ type: 'move-uncontained', since: start?.t ?? active.startedAt });
    phases.contain.evidence.push(`${MOVE_BY_ID[active.move as MoveId].name.toLowerCase()} is running now`);
  }

  // Souls lost.
  facts.push({ label: 'Souls lost', value: total ? `${lost} of ${total} (${Math.round((100 * lost) / total)} %)` : `${lost}` });
  if (total && lost / total > GRADING.soulsLost.most) points.contain += 2;
  else if (total && lost / total > GRADING.soulsLost.some) points.contain += 1;

  // IP whack-a-mole: 3 or more IP blocks on his addresses.
  const hisIps = new Set(starts.map((e) => e.ip));
  const blocksOnHim = actions.filter((a) => a.action.type === 'DEF-06' && a.action.op === 'add' && hisIps.has(a.action.ip));
  facts.push({ label: "IP blocks on the attacker's addresses", value: `${blocksOnHim.length}` });
  if (blocksOnHim.length >= GRADING.whackAMole) {
    points.contain += 1;
    mistakes.push({ phase: 'contain', title: `IP whack-a-mole: ${blocksOnHim.length} of his addresses blocked one by one`, why: 'Blocking addresses one at a time is whack-a-mole: the attacker just moves to the next one, and you lose his thread in the logs. Close the route he is using instead (CISA AA20-245A).' });
    phases.contain.evidence.push(`${blocksOnHim.length} IP blocks on his addresses`);
  }

  // Early full logout: a revoke before he held any session (nothing to kill, every customer logged out).
  const revokes = actions.filter((a) => a.action.type === 'DEF-09');
  for (const revoke of revokes) {
    const since = revokes.filter((a) => a.id < revoke.id).at(-1)?.id ?? 0;
    const hadSession = landed.some((e) => e.id > since && e.id < revoke.id && SESSION_MOVES.has(e.move)) || stolen.some((e) => e.id > since && e.id < revoke.id && e.by === 'MIN-02');
    if (!hadSession) {
      points.contain += 1;
      mistakes.push({ phase: 'contain', title: `Every session revoked at ${fmtGameMs(revoke.t)} before he held one`, why: 'Revoking every session and rotating the key logs every customer out. Done before the attacker holds a session, it kills nothing of his and costs the business for nothing; done without knowing his footholds, he walks back in (NIST SP 800-61r2, containment criteria).' });
    }
  }

  // The plug without escalation first.
  const plug = actions.find((a) => a.action.type === 'DEF-11');
  const escalated = actions.find((a) => a.action.type === 'DEF-19');
  if (plug && !(escalated && escalated.id < plug.id)) {
    points.contain += 1;
    mistakes.push({ phase: 'contain', title: `The plug was pulled at ${fmtGameMs(plug.t)} without escalating first`, why: 'Taking the shop offline is a business decision, not a technical one: the incident lead decides and owns the cost (the company playbook; NIST SP 800-61r2, containment criteria).' });
  }

  // --- Eradicate: evidence before the first eradication.
  const firstEradication = actions.find((a) => ERADICATING.has(a.action.type));
  const evidence = actions.find((a) => a.action.type === 'DEF-05');
  facts.push({ label: 'Evidence preserved', value: evidence ? `at ${fmtGameMs(evidence.t)}${firstEradication && evidence.id > firstEradication.id ? ' (after changes had begun)' : ''}` : 'never' });
  if (firstEradication && !(evidence && evidence.id < firstEradication.id)) {
    points.eradicate += 1;
    mistakes.push({ phase: 'eradicate', title: evidence ? 'Evidence was snapshotted only after eradication had begun' : 'No evidence was preserved before eradication', why: 'Deleting files and accounts before preserving the logs and the database destroys what the investigation, legal and the insurer will need (NIST SP 800-61, CISA AA20-245A: preserve evidence before changing things).' });
    phases.eradicate.evidence.push(evidence ? 'evidence snapshotted after eradication had begun' : 'no evidence snapshot before eradication');
    if (!evidence) gaps.push({ type: 'eradicated-without-evidence', since: firstEradication.t });
  } else if (evidence) phases.eradicate.evidence.push(`evidence preserved at ${fmtGameMs(evidence.t)}`);

  // Soul doors he opened: investigated? patched?
  for (const door of SOUL_DOORS) {
    const first = starts.find((e) => e.move === door);
    if (!first) continue;
    const patch = DOOR_PATCH[door]!;
    const applied = world.patches.applied.includes(patch);
    const pending = world.patches.pending.some((p) => p.patch === patch);
    const doorIps = new Set(starts.filter((e) => e.move === door).map((e) => e.ip));
    const looked = relevant.some((a) => a.id > first.id && a.action.type === 'DEF-01' && ([...doorIps].some((ip) => a.action.type === 'DEF-01' && a.action.query.includes(ip)) || a.action.query.includes(DOOR_PATH[door]!)));
    if (!applied && !looked) gaps.push({ type: 'door-uninvestigated', since: first.t });
    if (!applied) {
      if (!pending) gaps.push({ type: 'door-unpatched', since: first.t });
      phases.eradicate.evidence.push(`${MOVE_BY_ID[door].name.toLowerCase()}: ${pending ? 'patch deploying' : 'not patched'}`);
      if (ending) {
        points.eradicate += 1;
        mistakes.push({ phase: 'eradicate', title: `The hole behind "${MOVE_BY_ID[door].name.toLowerCase()}" was never patched`, why: 'A WAF rule, a feature flag or a revoke is containment: it holds only while it holds, and a quiet variant slips past a pattern rule. The hole is closed only when the code is fixed (fix the hole, not the symptom).' });
      }
    } else phases.eradicate.evidence.push(`${MOVE_BY_ID[door].name.toLowerCase()}: patched`);
  }

  // Footholds: what is left in the world right now (exact, D-114); the return names its own.
  const left = footholds(world);
  const returned = k.return[0];
  const missed: string[] = [];
  for (const f of FOOTHOLDS) {
    const planted = landed.find((e) => MOVE_BY_ID[e.move].foothold === f);
    if (returned?.through === f) missed.push(`${FOOTHOLD_NAME[f]}${planted ? ` (${MOVE_BY_ID[planted.move].name.toLowerCase()})` : ''}: he came back through it`);
    else if (left.has(f) && world.ending !== 'banished') missed.push(`${FOOTHOLD_NAME[f]}${planted ? ` (${MOVE_BY_ID[planted.move].name.toLowerCase()})` : ''}`);
    if (!left.has(f) || !planted) continue;
    const queried = f === 'planted-file' ? relevant.some((a) => a.id > planted.id && a.action.type === 'DEF-03') : relevant.some((a) => a.id > planted.id && a.action.type === 'DEF-02');
    if (!queried && f !== 'forged-token') gaps.push({ type: f === 'planted-file' ? 'planted-file-unchecked' : 'foothold-unqueried', since: planted.t });
  }
  if (left.size > 0) phases.eradicate.evidence.push(`footholds left: ${[...left].join(', ')}`);
  if (ending) {
    points.eradicate += missed.length;
    for (const m of missed) mistakes.push({ phase: 'eradicate', title: `Foothold left behind: ${m}`, why: 'Declaring victory before every foothold is found hands the attacker his way back in. Hunt for new accounts, changed passwords, planted files and forged tokens before you stand down (find every foothold before declaring victory).' });
  }
  if (phases.eradicate.evidence.some((e) => /not patched|deploying|left:|no evidence|after eradication/.test(e))) phases.eradicate.status = 'pending';

  // --- Recover: downtime caused by the plug.
  let downtime = 0;
  let down: number | undefined;
  for (const a of actions) {
    if (a.action.type === 'DEF-11') down ??= a.t;
    else if (a.action.type === 'DEF-18' && a.action.what === 'nginx' && down !== undefined) { downtime += a.t - down; down = undefined; }
  }
  if (down !== undefined) downtime += end - down;
  facts.push({ label: 'Downtime caused (plug pulled)', value: fmtGameMs(downtime) });
  if (downtime > GRADING.downtime.long) points.recover += 2;
  else if (downtime > GRADING.downtime.some) points.recover += 1;
  if (downtime > GRADING.downtime.some) mistakes.push({ phase: 'recover', title: `The shop was offline for ${fmtGameMs(downtime)} by your own hand`, why: 'Self-inflicted downtime costs the business as surely as the attack does: pull the plug only when the alternative is worse, and bring it back as soon as the route is closed (NIST SP 800-61r2, containment criteria).' });
  if (world.nginx === 'stopped') {
    gaps.push({ type: 'plug-pulled', since: down ?? now });
    phases.recover.evidence.push(`the plug is pulled (${fmtGameMs(downtime)} so far)`);
  }

  // Features left off after their patch landed (the world now).
  const leftOff = (Object.keys(FEATURE_PATCH) as Feature[]).filter((f) => !world.features[f] && world.patches.applied.includes(FEATURE_PATCH[f]!));
  for (const f of leftOff) {
    const patched = k['patch-applied'].find((e) => e.patch === FEATURE_PATCH[f])!;
    gaps.push({ type: 'feature-off-after-patch', since: patched.t });
    phases.recover.evidence.push(`${f} is still off though its patch is live`);
  }
  if (leftOff.length > 0 && ending) {
    points.recover += 1;
    mistakes.push({ phase: 'recover', title: `${leftOff.join(', ')} left off after the patch was live`, why: 'Containment has a business cost: every customer who needed the feature failed while it was off. Once the patch is deployed the route is closed; bring the feature back (NIST SP 800-61r2, recovery).' });
  }

  // A defacement still live (the world now).
  if (world.defacements.length > 0) {
    const since = landed.filter((e) => world.defacements.some((d) => d.by === e.move)).at(-1)?.t ?? firstStart ?? 0;
    gaps.push({ type: 'defacement-live', since });
    phases.recover.evidence.push('the shop is defaced');
    if (ending) {
      points.recover += 1;
      mistakes.push({ phase: 'recover', title: 'The defaced shop was never restored', why: 'Customers kept seeing his message (or running his script) until the end. Restore from the last backup taken before the move, then check what else that backup brings back (restoring the wrong backup restores the attacker).' });
    }
  }

  // Open taps (the world now).
  const openTaps = world.taps.open.map((t) => t.id);
  facts.push({ label: 'Leaky taps still open at the end', value: openTaps.length === 0 ? 'none' : openTaps.map((t) => TAP_BY_ID[t].name.toLowerCase()).join(', ') });
  if (openTaps.length > 0) {
    gaps.push({ type: 'tap-open', since: Math.min(...world.taps.open.map((t) => t.openedAt)) });
    phases.recover.evidence.push(`leaking: ${openTaps.map((t) => TAP_BY_ID[t].name.toLowerCase()).join(', ')}`);
    if (ending) {
      points.recover += 1;
      mistakes.push({ phase: 'recover', title: `Still leaking at the end: ${openTaps.map((t) => TAP_BY_ID[t].name.toLowerCase()).join(', ')}`, why: 'Small exposures leak customer data too, drip by drip, and anyone scrapes them: find and close every one, not just the attacker\'s doors (OWASP Top 10 2021 A01 broken access control, A05 security misconfiguration).' });
    }
  }

  // Notification (SYS-14): the clock starts when the breach is confirmed (the first DEF-05 or DEF-19 after souls were taken).
  const firstTheft = stolen[0];
  const confirmedAt = world.comms.breachConfirmedAt;
  const confirmed = confirmedAt !== undefined ? actions.find((a) => a.t >= confirmedAt && (a.action.type === 'DEF-05' || a.action.type === 'DEF-19')) : undefined;
  const window = CONFIG[world.difficulty].notification.windowGameMs;
  const notifiedAt = world.comms.notifiedAt.legal;
  const earlyNotice = actions.find((a) => a.action.type === 'DEF-20' && (confirmedAt === undefined || a.t < confirmedAt || (confirmed !== undefined && a.id < confirmed.id)));
  if (!firstTheft) facts.push({ label: 'Breach notification', value: 'not needed: no data was taken' });
  else if (notifiedAt === undefined) {
    facts.push({ label: 'Breach notification', value: confirmedAt !== undefined ? `missing (breach confirmed at ${fmtGameMs(confirmedAt)})` : 'missing (the breach was never confirmed)' });
    if (confirmedAt === undefined) gaps.push({ type: 'breach-unconfirmed', since: firstTheft.t });
    else gaps.push({ type: 'notification-due', since: confirmedAt });
    phases.recover.evidence.push(confirmedAt === undefined ? 'breach not confirmed' : 'legal not notified');
    if (ending) {
      points.recover += 1;
      mistakes.push({ phase: 'recover', title: 'The breach was never notified', why: 'Personal data left the building: the supervisory authority must hear within 72 hours of awareness, and affected customers without undue delay (GDPR Art. 33 and 34).' });
    }
  } else {
    const late = confirmedAt !== undefined && notifiedAt - confirmedAt > window;
    facts.push({ label: 'Breach notification', value: late ? `late: ${fmtGameMs(notifiedAt - confirmedAt)} after confirmation (window ${fmtGameMs(window)})` : `on time, at ${fmtGameMs(notifiedAt)}` });
    if (late) {
      points.recover += 1;
      mistakes.push({ phase: 'recover', title: `Legal was notified ${fmtGameMs(notifiedAt - confirmedAt)} after the breach was confirmed`, why: 'The notification clock starts when you become aware of the breach, not when you finish cleaning up: 72 hours, and every hour counts (GDPR Art. 33).' });
    }
  }
  if (earlyNotice && earlyNotice.action.type === 'DEF-20') {
    points.recover += 1;
    mistakes.push({ phase: 'recover', title: `Notified ${earlyNotice.action.to} before the breach was confirmed`, why: 'A notification before the breach is confirmed is a rumour the company may have to retract: confirm first (preserve evidence, escalate), then notify (GDPR Art. 33 counts from awareness of an actual breach).' });
  }

  // Customers lost (churn).
  const churned = world.customers.lost;
  facts.push({ label: 'Customers lost for good', value: `${churned}` });
  if (churned > GRADING.churn) {
    points.recover += 1;
    mistakes.push({ phase: 'recover', title: `${churned} customers gave up and left`, why: 'A customer whose errand fails twice leaves for good: a feature left off, a rule that matches shoppers or a blocked address is a bill the business keeps paying (containment has a business cost: NIST SP 800-61r2).' });
  }
  facts.push({ label: ending ? 'Heartbeat at the end' : 'Heartbeat', value: `${Math.round(ending?.heartbeat ?? world.heartbeat)}` });
  if (phases.recover.evidence.length > 0) phases.recover.status = 'degraded';

  // --- Grades: the base from timing, minus a letter per point; the ending fails the phase that lost it.
  const grades: Record<Phase, Grade> = {
    detect: worse(detectBase, letter(points.detect)),
    contain: worse(containBase, letter(points.contain)),
    eradicate: letter(points.eradicate),
    recover: letter(points.recover),
  };
  const failed = ending ? ENDING_FAILS[ending.ending] : undefined;
  if (failed) grades[failed] = 'F';
  mistakes.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
  gaps.sort((a, b) => GAP_TYPES.indexOf(a.type) - GAP_TYPES.indexOf(b.type) || a.since - b.since);
  const lastRelevantActionAt = relevant.at(-1)?.t ?? 0;
  return { facts, grades, mistakes, missed, phases, gaps, ...(gaps[0] && { gap: gaps[0] }), lastRelevantActionAt, relevant: relevant.map((a) => a.id) };
}

/** The assessor's starting state (initialWorld). */
export function initialAssess(): AssessState {
  return {
    facts: [], grades: { detect: 'A', contain: 'A', eradicate: 'A', recover: 'A' }, mistakes: [], missed: [],
    phases: { detect: { status: 'quiet', evidence: [] }, contain: { status: 'quiet', evidence: [] }, eradicate: { status: 'clean', evidence: [] }, recover: { status: 'ok', evidence: [] } },
    gaps: [], lastRelevantActionAt: 0, relevant: [], assessedAt: -1, cursor: 0, judgedUpTo: 0, judge: { startedMoves: [], landedMoves: [], running: false, tapsOpened: [] }, logCursor: 0, hisAddresses: [], hisPaths: [], hisAccounts: [], hisFiles: [],
  };
}

/**
 * One tick (advance.ts): learn his work while it is in the world; judge the actions that arrived at once, against what
 * he had done by then (a verdict never changes); refresh the snapshot once per config.assess.everyGameMs and at the
 * ending. The last relevant action is kept current on every tick, so the struggle detector (SYS-13) never waits.
 */
export function stepAssess(world: World): void {
  const a = world.assess;
  const know = learn(world);
  const last = world.events.at(-1)?.id ?? 0;
  if (last > a.judgedUpTo) {
    for (const e of judgeFrom(world, know, a.judge, a.judgedUpTo)) { // also learns the addresses and door paths the new events carry
      a.relevant.push(e.id);
      a.lastRelevantActionAt = e.t;
    }
    a.judgedUpTo = last;
  }
  if (know.addresses.size !== a.hisAddresses.length) a.hisAddresses = [...know.addresses];
  if (know.paths.size !== a.hisPaths.length) a.hisPaths = [...know.paths];
  if (know.hisAccounts.size !== a.hisAccounts.length) a.hisAccounts = [...know.hisAccounts];
  if (know.hisFiles.size !== a.hisFiles.length) a.hisFiles = [...know.hisFiles];
  a.logCursor = know.logCursor;
  const ended = world.ending !== undefined && a.cursor < world.events.length;
  a.cursor = world.events.length;
  if (!ended && a.assessedAt >= 0 && world.clock.gameMs - a.assessedAt < CONFIG[world.difficulty].assess.everyGameMs) return;
  const snapshot = evaluate(world);
  Object.assign(a, snapshot);
  if (!snapshot.gap) delete a.gap;
  a.assessedAt = world.clock.gameMs;
}

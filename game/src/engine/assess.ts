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
import { eventsOfKind, type GameEvent } from './log';
import { confirmBreach } from './notification';
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
  judge: { startedMoves: MoveId[]; frozen: number[]; footholds: Foothold[]; defacements: number; accounts: string[] }; // what the player could know of his work, and what stood, as of judgedUpTo (accounts: the ones he made or took that were in the world)
  logCursor: number; // access lines learnt from so far
  appCursor: number; // app lines learnt from so far
  hisAddresses: string[]; // every address he has used (his moves' starts and lines)
  hisMoves: Record<string, MoveId>; // which move used each address (the first that did)
  hisAppTexts: string[]; // every app-log line one of his moves wrote
  hisAccounts: string[]; // emails of accounts he created, hijacked or held a session for, ever
  hisFiles: string[]; // paths of files he planted, ever
}

/** What the assessor knows of his work: what it remembered plus what the world shows now (the logs from their cursors on). */
interface Knowledge { addresses: Set<string>; moves: Map<string, MoveId>; appTexts: Set<string>; hisAccounts: Set<string>; hisFiles: Set<string>; logCursor: number; appCursor: number }

const knowledgeCache = new WeakMap<AssessState, { sizes: string; sets: Knowledge }>();

function learn(world: World): Knowledge {
  const a = world.assess;
  // The remembered arrays become Sets once per change, not once per tick (the scan's lines run to thousands).
  const sizes = `${a.hisAddresses.length} ${a.hisAppTexts.length} ${a.hisAccounts.length} ${a.hisFiles.length}`;
  let cached = knowledgeCache.get(a);
  if (!cached || cached.sizes !== sizes) {
    cached = { sizes, sets: { addresses: new Set(a.hisAddresses), moves: new Map(Object.entries(a.hisMoves) as Array<[string, MoveId]>), appTexts: new Set(a.hisAppTexts), hisAccounts: new Set(a.hisAccounts), hisFiles: new Set(a.hisFiles), logCursor: a.logCursor, appCursor: a.appCursor } };
    knowledgeCache.set(a, cached);
  }
  const base = cached.sets;
  const k: Knowledge = { addresses: new Set(base.addresses), moves: new Map(base.moves), appTexts: new Set(base.appTexts), hisAccounts: new Set(base.hisAccounts), hisFiles: new Set(base.hisFiles), logCursor: world.logs.access.length, appCursor: world.logs.app.length };
  for (let i = a.logCursor; i < world.logs.access.length; i++) {
    const l = world.logs.access[i]!;
    if (!l.by.startsWith('ATK-')) continue;
    k.addresses.add(l.ip);
    if (!k.moves.has(l.ip)) k.moves.set(l.ip, l.by as MoveId);
  }
  for (let i = a.appCursor; i < world.logs.app.length; i++) {
    const l = world.logs.app[i]!;
    if (l.by.startsWith('ATK-')) k.appTexts.add(l.text.trim());
  }
  for (const r of world.replays) if (r.owner === 'death') for (const ip of r.ips ?? [r.ip]) { k.addresses.add(ip); if (!k.moves.has(ip)) k.moves.set(ip, r.move as MoveId); }
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
const OUTCOME: Record<string, string> = { banished: 'Banished', 'souls-lost': 'Every soul lost', flatline: 'Flatline', return: 'The return', 'clean-handover': 'Clean handover', 'rough-handover': 'Rough handover', 'walked-away': 'Walked away (a loss)' };
const FOCUS = { max: 200, share: 0.2 } as const; // D-115: a read is focused when it showed at most 200 lines, or his lines are a fifth of what it showed
const HARVEST: ReadonlySet<MoveId> = new Set(SOUL_DOORS);

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

/** What the player could know of his work when an action happened, and what the tick's actions did to him. */
export interface RelevanceContext {
  started: Set<MoveId>; // moves he had started
  addresses: Set<string>; // addresses he had used
  moves: Map<string, MoveId>; // which move used each address
  appTexts: Set<string>; // app-log lines his moves wrote
  hisAccounts: Set<string>; // accounts he created, hijacked or held a session for
  hisFiles: Set<string>; // files he planted
  effects: Effects; // D-115 rule (b): what the tick's actions did to him
}
export interface Effects {
  cut: Array<{ move: MoveId; by: ActionId }>; // moves cut (an IP block, the plug, a stopper held past the grace)
  frozen: MoveId[]; // moves frozen in place this tick (a stopper or the plug holds)
  shut: Array<{ move: MoveId; by: ActionId }>; // doors shut
  tapsClosed: TapId[]; // taps closed by a rule
  footholdsRemoved: Foothold[]; // footholds gone from the world this tick
  accountsRemoved: string[]; // accounts he made or took (ATK-06's admin, a hijacked customer) gone from the world this tick
  defacementRemoved: boolean;
}
export const NO_EFFECTS: Effects = { cut: [], frozen: [], shut: [], tapsClosed: [], footholdsRemoved: [], accountsRemoved: [], defacementRemoved: false };

export type HisThing = MoveId | 'account' | 'file' | 'app';
export type Hurt = MoveId | Foothold | 'tap' | 'defacement' | 'account';

/** D-115 rule (a): a shown line of a Death move, his planted account or his planted file; which, when known. */
export function hisLine(line: string, ctx: Pick<RelevanceContext, 'addresses' | 'moves' | 'appTexts' | 'hisAccounts' | 'hisFiles'>): HisThing | undefined {
  for (const ip of ctx.addresses) if (line.includes(ip)) return ctx.moves.get(ip) ?? 'app';
  for (const email of ctx.hisAccounts) if (line.includes(email)) return 'account';
  for (const path of ctx.hisFiles) if (line.includes(path)) return 'file';
  if (ctx.appTexts.has(line.trim())) return 'app';
  return undefined;
}

/** D-122: what the judge keeps of a read's lines: how many were passed, how many were his, what they were about; never the text. */
export interface ShownSummary { shownCount: number; shownHis: number; shownAbout: HisThing[] }

/** Classifies shown lines against his work as known (`ctx`): the summary the action event stores (D-122). */
export function summariseLines(lines: readonly string[], ctx: Pick<RelevanceContext, 'addresses' | 'moves' | 'appTexts' | 'hisAccounts' | 'hisFiles'>): ShownSummary {
  const about = new Set<HisThing>();
  let his = 0;
  for (const line of lines) {
    const what = hisLine(line, ctx);
    if (what === undefined) continue;
    his += 1;
    about.add(what);
    for (const door of SOUL_DOORS) if (line.includes(DOOR_PATH[door]!)) about.add(door);
  }
  return { shownCount: lines.length, shownHis: his, shownAbout: [...about] };
}

/** The same, against what the world knows of him right now (actions.ts, before the action is logged). */
export function summariseShown(world: World, lines: readonly string[]): ShownSummary {
  const know = learn(world);
  for (const e of world.events) if (e.kind === 'move-started') { know.addresses.add(e.ip); if (!know.moves.has(e.ip)) know.moves.set(e.ip, e.move); }
  return summariseLines(lines, know);
}

/** What a read showed of his (the moves and things its lines belong to) and whether it was focused; undefined when nothing of his. */
export function showedOfHis(a: PlayerAction, ctx: RelevanceContext): { about: Set<HisThing>; focused: boolean } | undefined {
  if (a.type !== 'DEF-01' && a.type !== 'DEF-02' && a.type !== 'DEF-03') return undefined;
  // the lines themselves (a crafted test, or a read judged before it was logged), else the summary the event kept (D-122)
  const sum: ShownSummary | undefined = a.shown && a.shown.length > 0 ? summariseLines(a.shown, ctx) : a.shownCount !== undefined ? { shownCount: a.shownCount, shownHis: a.shownHis ?? 0, shownAbout: (a.shownAbout ?? []) as HisThing[] } : undefined;
  if (!sum || sum.shownCount === 0 || sum.shownHis === 0) return undefined; // a read with no shown lines can't be judged (the shell sends them when the line finishes, D-160)
  const total = a.shownTotal ?? sum.shownCount;
  return { about: new Set(sum.shownAbout), focused: total <= FOCUS.max || sum.shownHis / sum.shownCount >= FOCUS.share };
}

/** D-115 rule (b): what this action, on purpose or not, cut, interrupted, stopped or closed of his this tick. */
export function hurtHim(a: PlayerAction, ctx: RelevanceContext): Set<Hurt> {
  const hit = new Set<Hurt>();
  const fx = ctx.effects;
  const stops = (m: MoveId) => (a.type === 'DEF-11' ? true : a.type === 'DEF-06' ? false : stopperMatches(m, a));
  for (const c of fx.cut) if (c.by === a.type && (a.type === 'DEF-06' ? a.op === 'add' && ctx.addresses.has(a.ip) : stops(c.move))) hit.add(c.move);
  for (const m of fx.frozen) if (stops(m)) hit.add(m);
  for (const d of fx.shut) if (d.by === a.type && stops(d.move)) hit.add(d.move);
  if (a.type === 'DEF-12') for (const t of fx.tapsClosed) if (JSON.stringify(TAP_BY_ID[t].closedBy.rule) === JSON.stringify(a.rule)) hit.add('tap');
  const removes: readonly Foothold[] = ACTION_BY_ID[a.type]?.removes ?? [];
  for (const f of fx.footholdsRemoved) if (removes.includes(f) && (f !== 'forged-token' || (a.type === 'DEF-13' && a.patch === 'token-verify'))) hit.add(f);
  if (a.type === 'DEF-14' && fx.accountsRemoved.includes(a.email)) hit.add('account'); // his registered admin (ATK-06) gone: own-admin lost
  if (a.type === 'DEF-17' && fx.defacementRemoved) hit.add('defacement');
  return hit;
}

/** A relevance verdict: what the action showed or hurt, for the report, the gaps and the breach confirmation. */
export interface Verdict { relevant: boolean; showed?: Set<HisThing>; hurt?: Set<Hurt>; users?: boolean }

/**
 * D-115: an action is relevant if (a) it showed the player something of Death's and the output was focused, or (b) it
 * actually hurt him this tick. Everything else (`ls`, `pwd`, an unfocused `cat` of the whole log, a snapshot, comms, a
 * block on an address he no longer uses) is not.
 */
export function judgeAction(a: PlayerAction, ctx: RelevanceContext): Verdict {
  const showed = showedOfHis(a, ctx);
  const hurt = hurtHim(a, ctx);
  const relevant = (showed !== undefined && showed.focused) || hurt.size > 0;
  return { relevant, ...(showed?.focused && { showed: showed.about }), ...(hurt.size > 0 && { hurt }), ...(a.type === 'DEF-02' && showed?.focused && USERS_SQL.test(a.sql) && { users: true }) };
}

/** D-116: does a relevant action confirm the breach? On a harvest move (shown or hurt) or on Users. */
function confirms(v: Verdict): boolean {
  if (v.users) return true;
  for (const m of v.showed ?? []) if (HARVEST.has(m as MoveId)) return true;
  for (const m of v.hurt ?? []) if (HARVEST.has(m as MoveId)) return true;
  return false;
}

/** The effects of the events after `from`, and of the world's change since the judge last looked. */
function effectsSince(world: World, judge: AssessState['judge'], from: number): Effects {
  const fx: Effects = { cut: [], frozen: [], shut: [], tapsClosed: [], footholdsRemoved: [], accountsRemoved: [], defacementRemoved: false };
  for (let i = from; i < world.events.length; i++) {
    const e = world.events[i]!;
    if (e.kind === 'move-cut') fx.cut.push({ move: e.move, by: e.by });
    else if (e.kind === 'door-shut') fx.shut.push({ move: e.move, by: e.by });
    else if (e.kind === 'tap-closed' && e.by !== undefined) fx.tapsClosed.push(e.tap);
  }
  const wasFrozen = new Set(judge.frozen);
  for (const r of world.replays) if (r.owner === 'death' && r.frozenSince !== undefined && !wasFrozen.has(r.id)) fx.frozen.push(r.move as MoveId);
  const now = footholds(world);
  for (const f of judge.footholds) if (!now.has(f)) fx.footholdsRemoved.push(f);
  fx.defacementRemoved = world.defacements.length < judge.defacements;
  const emails = new Set(world.accounts.map((acc) => acc.email));
  for (const e of judge.accounts) if (!emails.has(e)) fx.accountsRemoved.push(e);
  return fx;
}

/**
 * Walks the events after `from`, keeping the judge's view current, and judges each accepted action against what he had
 * done by then and what the tick did to him. A patch that lands makes its deploy relevant now. With `commit` it may start
 * the notification clock (D-116); evaluate() judges without side effects.
 */
function judgeFrom(world: World, know: Knowledge, judge: AssessState['judge'], from: number, commit: boolean): Array<{ e: Action; at: number; verdict: Verdict }> {
  const ctx: RelevanceContext = { started: new Set(judge.startedMoves), addresses: know.addresses, moves: know.moves, appTexts: know.appTexts, hisAccounts: know.hisAccounts, hisFiles: know.hisFiles, effects: effectsSince(world, judge, from) };
  const out: Array<{ e: Action; at: number; verdict: Verdict }> = [];
  let stolen = false;
  for (let i = 0; i < from; i++) if (world.events[i]!.kind === 'souls-stolen') { stolen = true; break; }
  for (let i = from; i < world.events.length; i++) {
    const e = world.events[i]!;
    if (e.kind === 'move-started') { ctx.started.add(e.move); ctx.addresses.add(e.ip); if (!ctx.moves.has(e.ip)) ctx.moves.set(e.ip, e.move); }
    else if (e.kind === 'souls-stolen') stolen = true;
    else if (e.kind === 'patch-applied') {
      // the deploy that started it hurt him now: the patch stops a move he started, or removes the forged token
      let deploy: Action | undefined;
      for (let j = i - 1; j >= 0 && !deploy; j--) { const x = world.events[j]!; if (x.kind === 'action' && x.ok && x.action.type === 'DEF-13' && x.action.patch === e.patch) deploy = x; }
      if (!deploy) continue;
      const stopped = [...ctx.started].filter((m) => stopperMatches(m, deploy!.action));
      const token = e.patch === 'token-verify' && ctx.effects.footholdsRemoved.includes('forged-token');
      if (stopped.length === 0 && !token) continue;
      const verdict: Verdict = { relevant: true, hurt: new Set<Hurt>([...stopped, ...(token ? ['forged-token' as const] : [])]) };
      out.push({ e: deploy, at: e.t, verdict });
      if (commit && stolen && confirms(verdict)) confirmBreach(world, 'DEF-13', e.t);
    } else if (e.kind === 'action' && e.ok) {
      const verdict = judgeAction(e.action, ctx);
      if (!verdict.relevant) continue;
      out.push({ e, at: e.t, verdict });
      if (commit && stolen && confirms(verdict)) confirmBreach(world, e.action.type, e.t);
    }
  }
  judge.startedMoves = [...ctx.started];
  judge.frozen = world.replays.filter((r) => r.owner === 'death' && r.frozenSince !== undefined).map((r) => r.id);
  judge.footholds = [...footholds(world)];
  judge.defacements = world.defacements.length;
  judge.accounts = world.accounts.filter((acc) => acc.createdBy !== 'seed' || acc.hijackedBy !== undefined).map((acc) => acc.email);
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
  const fresh = last > a.judgedUpTo ? new Set(judgeFrom(world, know, structuredClone(a.judge), a.judgedUpTo, false).map((x) => x.e.id)) : new Set<number>();
  return world.events.filter((e): e is Action => e.kind === 'action' && e.ok && (judged.has(e.id) || fresh.has(e.id)));
}

/** Did a relevant read show this soul door: its lines were about it (its addresses, or its route), by the summary the event kept or the lines themselves. */
function lookShowedDoor(a: Action, door: MoveId, know: Knowledge, doorIps: Set<string>): boolean {
  const act = a.action;
  if (act.type !== 'DEF-01' && act.type !== 'DEF-02' && act.type !== 'DEF-03') return false;
  if (act.shown) return act.shown.some((line) => line.includes(DOOR_PATH[door]!) || [...doorIps].some((ip) => line.includes(ip)) || [...know.addresses].some((ip) => line.includes(ip) && know.moves.get(ip) === door));
  return (act.shownAbout ?? []).includes(door);
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
  const know = learn(world);
  const relevant = relevantActions(world, know);
  const starts = k['move-started'];
  const landed = k['move-landed'];
  const firstStart = starts[0]?.t;
  const stolen = k['souls-stolen'];
  const total = world.souls.total;
  const lost = world.souls.stolen.length;
  const phases: Record<Phase, PhaseStatus> = { detect: { status: 'quiet', evidence: [] }, contain: { status: 'quiet', evidence: [] }, eradicate: { status: 'clean', evidence: [] }, recover: { status: 'ok', evidence: [] } };

  facts.push({ label: 'Outcome', value: ending ? OUTCOME[ending.ending]! : 'Unfinished' });
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
    const looked = relevant.some((a) => a.id > first.id && lookShowedDoor(a, door, know, doorIps));
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
  // D-191 (KI-190): how often Kiro was used, from the `kiro` events the client logs (engine.noteKiro), with the credits it reported.
  const kiroCalls = eventsOfKind(world, 'kiro');
  const credits = kiroCalls.reduce((sum, e) => sum + (e.credits ?? 0), 0);
  facts.push({ label: 'Kiro calls', value: kiroCalls.length === 0 ? 'none' : `${kiroCalls.length}${credits > 0 ? ` (${Math.round(credits * 100) / 100} credits)` : ''}` });
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
  const lastRelevantActionAt = Math.max(world.assess.lastRelevantActionAt, relevant.at(-1)?.t ?? 0); // a deploy counts from the moment its patch landed (stepAssess keeps that time)
  return { facts, grades, mistakes, missed, phases, gaps, ...(gaps[0] && { gap: gaps[0] }), lastRelevantActionAt, relevant: relevant.map((a) => a.id) };
}

/** The assessor's starting state (initialWorld). */
export function initialAssess(): AssessState {
  return {
    facts: [], grades: { detect: 'A', contain: 'A', eradicate: 'A', recover: 'A' }, mistakes: [], missed: [],
    phases: { detect: { status: 'quiet', evidence: [] }, contain: { status: 'quiet', evidence: [] }, eradicate: { status: 'clean', evidence: [] }, recover: { status: 'ok', evidence: [] } },
    gaps: [], lastRelevantActionAt: 0, relevant: [], assessedAt: -1, cursor: 0, judgedUpTo: 0, judge: { startedMoves: [], frozen: [], footholds: [], defacements: 0, accounts: [] },
    logCursor: 0, appCursor: 0, hisAddresses: [], hisMoves: {}, hisAppTexts: [], hisAccounts: [], hisFiles: [],
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
  if (last > a.judgedUpTo || a.judge.frozen.length > 0 || world.replays.some((r) => r.owner === 'death' && r.frozenSince !== undefined)) {
    for (const { e, at } of judgeFrom(world, know, a.judge, a.judgedUpTo, true)) { // also learns the addresses the new events carry; may confirm the breach (D-116)
      if (!a.relevant.includes(e.id)) a.relevant.push(e.id);
      a.lastRelevantActionAt = Math.max(a.lastRelevantActionAt, at);
    }
    a.judgedUpTo = last;
  }
  if (know.addresses.size !== a.hisAddresses.length) { a.hisAddresses = [...know.addresses]; a.hisMoves = Object.fromEntries(know.moves); }
  if (know.appTexts.size !== a.hisAppTexts.length) a.hisAppTexts = [...know.appTexts];
  if (know.hisAccounts.size !== a.hisAccounts.length) a.hisAccounts = [...know.hisAccounts];
  if (know.hisFiles.size !== a.hisFiles.length) a.hisFiles = [...know.hisFiles];
  a.logCursor = know.logCursor;
  a.appCursor = know.appCursor;
  const ended = world.ending !== undefined && a.cursor < world.events.length;
  a.cursor = world.events.length;
  if (!ended && a.assessedAt >= 0 && world.clock.gameMs - a.assessedAt < CONFIG[world.difficulty].assess.everyGameMs) return;
  const snapshot = evaluate(world);
  Object.assign(a, snapshot);
  if (!snapshot.gap) delete a.gap;
  a.assessedAt = world.clock.gameMs;
}

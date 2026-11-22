// Report grading (SYS-11, D-06, D-112): rules over the event log (SYS-10) and nothing else. Every fact, grade,
// mistake and missed foothold is computed here; Kiro only writes the debrief around them (KIRO-06) and can't change
// them. The shape is ENGINE_API §5's Report.
import { ACTION_BY_ID } from '../rules/actions';
import { MOVE_BY_ID, MOVES, SOUL_DOORS } from '../rules/moves';
import { TAP_BY_ID } from '../rules/taps';
import { FOOTHOLDS, type ActionId, type Difficulty, type Feature, type Foothold, type MoveId, type Patch, type Stage, type TapId } from '../rules/vocabulary';
import { CONFIG } from './config';
import type { GameEvent } from './log';
import type { World } from './state';

export type Phase = 'detect' | 'contain' | 'eradicate' | 'recover';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface Mistake {
  title: string;
  why: string; // the real-world reason, with its source
  phase: Phase;
}

export interface Report {
  facts: Array<{ label: string; value: string }>;
  grades: Record<Phase, Grade>;
  mistakes: Array<{ title: string; why: string }>;
  missed: string[]; // footholds left behind
  debrief: { text: string; offline: boolean };
  markdown: string;
}

/** The grading without the debrief: what a test checks rule by rule, and what Kiro gets to write around. */
export interface Grading {
  facts: Report['facts'];
  grades: Report['grades'];
  mistakes: Mistake[];
  missed: string[];
}

const REAL_S = 30_000; // game ms (SYS-01)
const REAL_MIN = 60 * REAL_S;
const GAME_MIN = 60_000;

/** Thresholds, in game ms (D-112, all "tune"). */
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
const isOk = (e: GameEvent): e is Action => e.kind === 'action' && e.ok;
const of = <K extends GameEvent['kind']>(events: GameEvent[], kind: K) => events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);

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

/** The actions that count as noticing a move: looking, preserving, containing, eradicating; not bringing back or comms. */
const NOTICING: ReadonlySet<ActionId> = new Set(Object.keys(ACTION_BY_ID).filter((id) => !['DEF-18', 'DEF-19', 'DEF-20'].includes(id)) as ActionId[]);
const ERADICATING: ReadonlySet<ActionId> = new Set((Object.keys(ACTION_BY_ID) as ActionId[]).filter((id) => ACTION_BY_ID[id].phase === 'eradicate'));
const SESSION_MOVES: ReadonlySet<MoveId> = new Set(MOVES.filter((m) => m.gains.includes('admin-session') || m.gains.includes('user-session')).map((m) => m.id));
const FEATURE_PATCH: Partial<Record<Feature, Patch>> = { search: 'search', registration: 'registration' }; // the flags with a patch to bring them back after
const DOOR_PATCH: Record<string, Patch> = { 'ATK-08': 'search', 'ATK-09': 'users-access' };
const FOOTHOLD_NAME: Record<Foothold, string> = {
  'hidden-admin': 'a hidden admin account', 'hijacked-user': 'a hijacked customer account', 'planted-file': 'a planted file in uploads/', 'forged-token': 'a forged login token (token verification never patched)',
};

/** What the ending means for the phase that lost it. */
const ENDING_FAILS: Record<string, Phase | undefined> = { 'souls-lost': 'contain', flatline: 'recover', return: 'eradicate' };

/** SYS-11: every rule, over the event log only. */
export function gradeEvents(events: GameEvent[], difficulty: Difficulty = 'medium'): Grading {
  const end = events.at(-1)?.t ?? 0;
  const ending = of(events, 'ending')[0];
  const facts: Grading['facts'] = [];
  const mistakes: Mistake[] = [];
  const points: Record<Phase, number> = { detect: 0, contain: 0, eradicate: 0, recover: 0 };
  const actions = events.filter(isOk);
  const starts = of(events, 'move-started');
  const landed = of(events, 'move-landed');
  const firstStart = starts[0]?.t;
  const stolen = of(events, 'souls-stolen');
  const total = stolen.at(-1)?.total ?? ending?.souls;
  const lost = ending?.souls ?? stolen.at(-1)?.stolen ?? 0;

  facts.push({ label: 'Outcome', value: ending ? { banished: 'Banished', 'souls-lost': 'Every soul lost', flatline: 'Flatline', return: 'The return' }[ending.ending] : 'Unfinished' });
  facts.push({ label: 'Incident length', value: fmtGameMs(end) });

  // --- Detect: time to notice each stage: the first noticing action after the stage's first move started.
  const stagesPlayed = [...new Set(starts.map((e) => e.stage))].sort((a, b) => a - b) as Stage[];
  const notices: number[] = [];
  for (const stage of stagesPlayed) {
    const first = starts.find((e) => e.stage === stage)!;
    const noticed = actions.find((a) => a.id > first.id && NOTICING.has(a.action.type));
    const took = noticed ? noticed.t - first.t : undefined;
    notices.push(took ?? end - first.t);
    facts.push({ label: `Time to notice stage ${stage}`, value: took === undefined ? 'never' : fmtGameMs(took) });
    if (took === undefined) mistakes.push({ phase: 'detect', title: `Stage ${stage} (${MOVE_BY_ID[first.move].name.toLowerCase()}) was never noticed`, why: 'An attacker who is never seen is never stopped: the logs and the alerts are where every incident starts (NIST SP 800-61, detection and analysis).' });
    else if (took > GRADING.slowNotice) mistakes.push({ phase: 'detect', title: `Stage ${stage} went unnoticed for ${fmtGameMs(took)}`, why: 'Every minute the attacker works unseen is a minute of theft or damage: watch the busiest addresses, the error rate and the alerts (NIST SP 800-61, detection and analysis).' });
  }
  const meanNotice = notices.length > 0 ? notices.reduce((a, b) => a + b, 0) / notices.length : undefined;
  let detect: Grade = starts.length === 0 ? 'A' : bandOf(meanNotice, GRADING.notice);

  // --- Contain: from his first move to the first fix that held (a cut by anything but an IP block, a door shut, or banishment).
  const held = events.find((e) => (e.kind === 'move-cut' && e.by !== 'DEF-06') || e.kind === 'door-shut' || e.kind === 'banished');
  const contained = firstStart !== undefined && held !== undefined && held.t >= firstStart ? held.t - firstStart : undefined;
  facts.push({ label: 'Time to contain', value: contained === undefined ? 'never' : fmtGameMs(contained) });
  let contain: Grade = starts.length === 0 ? 'A' : bandOf(contained, GRADING.contain);

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
  }

  // Early full logout: a revoke before he held any session (nothing to kill, every customer logged out).
  for (const revoke of actions.filter((a) => a.action.type === 'DEF-09')) {
    const lastRevoke = actions.filter((a) => a.action.type === 'DEF-09' && a.id < revoke.id).at(-1);
    const since = lastRevoke?.id ?? 0;
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
  }

  // Symptom-only fixes: a soul door he opened whose patch never landed.
  for (const door of SOUL_DOORS) {
    if (!starts.some((e) => e.move === door)) continue;
    const patch = DOOR_PATCH[door]!;
    if (of(events, 'patch-applied').some((e) => e.patch === patch)) continue;
    points.eradicate += 1;
    mistakes.push({ phase: 'eradicate', title: `The hole behind "${MOVE_BY_ID[door].name.toLowerCase()}" was never patched`, why: 'A WAF rule, a feature flag or a revoke is containment: it holds only while it holds, and a quiet variant slips past a pattern rule. The hole is closed only when the code is fixed (fix the hole, not the symptom).' });
  }

  // Missed footholds: a foothold move landed with no removal after it; the return proves one.
  const missed: string[] = [];
  const returned = of(events, 'return')[0];
  const removers = (f: Foothold) => (Object.keys(ACTION_BY_ID) as ActionId[]).filter((id) => ACTION_BY_ID[id].removes.includes(f));
  for (const f of FOOTHOLDS) {
    const planted = landed.find((e) => MOVE_BY_ID[e.move].foothold === f);
    if (!planted) continue;
    const removed = actions.some((a) => a.id > planted.id && removers(f).includes(a.action.type) && (f !== 'forged-token' || (a.action.type === 'DEF-13' && a.action.patch === 'token-verify')));
    const left = returned?.through === f || (ending?.ending !== 'banished' && !removed);
    if (left) missed.push(`${FOOTHOLD_NAME[f]} (${MOVE_BY_ID[planted.move].name.toLowerCase()})${returned?.through === f ? ': he came back through it' : ''}`);
  }
  points.eradicate += missed.length;
  for (const m of missed) mistakes.push({ phase: 'eradicate', title: `Foothold left behind: ${m}`, why: 'Declaring victory before every foothold is found hands the attacker his way back in. Hunt for new accounts, changed passwords, planted files and forged tokens before you stand down (find every foothold before declaring victory).' });

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

  // Features left off after their patch landed.
  const off: Partial<Record<Feature, number>> = {};
  for (const a of actions) {
    if (a.action.type === 'DEF-10') { if (!a.action.enabled) off[a.action.feature] ??= a.t; else delete off[a.action.feature]; }
    if (a.action.type === 'DEF-18' && a.action.what !== 'nginx') delete off[a.action.what];
  }
  const leftOff = (Object.keys(off) as Feature[]).filter((f) => FEATURE_PATCH[f] !== undefined && of(events, 'patch-applied').some((e) => e.patch === FEATURE_PATCH[f]));
  if (leftOff.length > 0) {
    points.recover += 1;
    mistakes.push({ phase: 'recover', title: `${leftOff.join(', ')} left off after the patch was live`, why: 'Containment has a business cost: every customer who needed the feature failed while it was off. Once the patch is deployed the route is closed; bring the feature back (NIST SP 800-61r2, recovery).' });
  }

  // A defacement never restored.
  const defaced = landed.filter((e) => MOVE_BY_ID[e.move].gains.includes('defaced') || MOVE_BY_ID[e.move].gains.includes('xss-live') || e.move === 'ATK-17');
  const lastDefaced = defaced.at(-1);
  if (lastDefaced && !actions.some((a) => a.id > lastDefaced.id && a.action.type === 'DEF-17')) {
    points.recover += 1;
    mistakes.push({ phase: 'recover', title: 'The defaced shop was never restored', why: 'Customers kept seeing his message (or running his script) until the end. Restore from the last backup taken before the move, then check what else that backup brings back (restoring the wrong backup restores the attacker).' });
  }

  // Open taps at the end.
  const openTaps = of(events, 'tap-opened').map((e) => e.tap).filter((tap) => !of(events, 'tap-closed').some((e) => e.tap === tap));
  facts.push({ label: 'Leaky taps still open at the end', value: openTaps.length === 0 ? 'none' : openTaps.map((t: TapId) => TAP_BY_ID[t].name.toLowerCase()).join(', ') });
  if (openTaps.length > 0) {
    points.recover += 1;
    mistakes.push({ phase: 'recover', title: `Still leaking at the end: ${openTaps.map((t: TapId) => TAP_BY_ID[t].name.toLowerCase()).join(', ')}`, why: 'Small exposures leak customer data too, drip by drip, and anyone scrapes them: find and close every one, not just the attacker\'s doors (OWASP Top 10 2021 A01 broken access control, A05 security misconfiguration).' });
  }

  // Notification on time (SYS-14): the clock starts when the breach is confirmed (the first DEF-05 or DEF-19 after souls were taken).
  const firstTheft = stolen[0];
  const confirmed = firstTheft ? actions.find((a) => a.id > firstTheft.id && (a.action.type === 'DEF-05' || a.action.type === 'DEF-19')) : undefined;
  const window = CONFIG[difficulty].notification.windowGameMs;
  const notified = actions.find((a) => a.action.type === 'DEF-20' && a.action.to === 'legal');
  const early = actions.find((a) => a.action.type === 'DEF-20' && (!confirmed || a.id < confirmed.id));
  if (!firstTheft) facts.push({ label: 'Breach notification', value: 'not needed: no data was taken' });
  else if (!notified) {
    facts.push({ label: 'Breach notification', value: confirmed ? `missing (breach confirmed at ${fmtGameMs(confirmed.t)})` : 'missing (the breach was never confirmed)' });
    points.recover += 1;
    mistakes.push({ phase: 'recover', title: 'The breach was never notified', why: 'Personal data left the building: the supervisory authority must hear within 72 hours of awareness, and affected customers without undue delay (GDPR Art. 33 and 34).' });
  } else {
    const late = confirmed !== undefined && notified.t - confirmed.t > window;
    facts.push({ label: 'Breach notification', value: late ? `late: ${fmtGameMs(notified.t - confirmed.t)} after confirmation (window ${fmtGameMs(window)})` : `on time, at ${fmtGameMs(notified.t)}` });
    if (late) {
      points.recover += 1;
      mistakes.push({ phase: 'recover', title: `Legal was notified ${fmtGameMs(notified.t - confirmed.t)} after the breach was confirmed`, why: 'The notification clock starts when you become aware of the breach, not when you finish cleaning up: 72 hours, and every hour counts (GDPR Art. 33).' });
    }
  }
  if (early) {
    points.recover += 1;
    mistakes.push({ phase: 'recover', title: `Notified ${early.action.type === 'DEF-20' ? early.action.to : ''} before the breach was confirmed`, why: 'A notification before the breach is confirmed is a rumour the company may have to retract: confirm first (preserve evidence, escalate), then notify (GDPR Art. 33 counts from awareness of an actual breach).' });
  }

  // Customers lost (churn).
  const churned = of(events, 'customer-lost').length;
  facts.push({ label: 'Customers lost for good', value: `${churned}` });
  if (churned > GRADING.churn) {
    points.recover += 1;
    mistakes.push({ phase: 'recover', title: `${churned} customers gave up and left`, why: 'A customer whose errand fails twice leaves for good: a feature left off, a rule that matches shoppers or a blocked address is a bill the business keeps paying (containment has a business cost: NIST SP 800-61r2).' });
  }
  if (ending) facts.push({ label: 'Heartbeat at the end', value: `${Math.round(ending.heartbeat)}` });

  // --- Grades: the base from timing, minus a letter per point; the ending fails the phase that lost it.
  const grades: Record<Phase, Grade> = {
    detect: worse(detect, letter(points.detect)),
    contain: worse(contain, letter(points.contain)),
    eradicate: letter(points.eradicate),
    recover: letter(points.recover),
  };
  detect = grades.detect; contain = grades.contain;
  const failed = ending ? ENDING_FAILS[ending.ending] : undefined;
  if (failed) grades[failed] = 'F';
  const order: Phase[] = ['detect', 'contain', 'eradicate', 'recover'];
  mistakes.sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));
  return { facts, grades, mistakes, missed };
}

/** KIRO-09: what the report says while Kiro is offline or not built yet. */
export const OFFLINE_DEBRIEF = 'Kiro (offline). The facts and grades above were computed by the rules; the debrief will be written around them when Kiro is reachable.';

export function renderMarkdown(g: Grading, debrief: Report['debrief']): string {
  const lines: string[] = ['# Post-incident report', ''];
  lines.push('## Facts', '', ...g.facts.map((f) => `- **${f.label}:** ${f.value}`), '');
  lines.push('## Grades', '', '| Phase | Grade |', '|---|---|', ...(['detect', 'contain', 'eradicate', 'recover'] as Phase[]).map((p) => `| ${p[0]!.toUpperCase()}${p.slice(1)} | ${g.grades[p]} |`), '');
  lines.push('## Mistakes', '', ...(g.mistakes.length === 0 ? ['None.'] : g.mistakes.map((m) => `- **${m.title}.** ${m.why}`)), '');
  lines.push('## Missed', '', ...(g.missed.length === 0 ? ['Nothing left behind.'] : g.missed.map((m) => `- ${m}`)), '');
  lines.push(`## Debrief${debrief.offline ? ' (Kiro offline)' : ''}`, '', debrief.text, '');
  return lines.join('\n');
}

/** ENGINE_API §5: the report for a finished (or unfinished) run. Kiro's debrief comes later (KIRO-06); until then a fixed placeholder, offline. */
export async function buildReport(world: World): Promise<Report> {
  const g = gradeEvents(world.events, world.difficulty);
  const debrief = { text: OFFLINE_DEBRIEF, offline: true };
  return { ...g, mistakes: g.mistakes.map(({ title, why }) => ({ title, why })), debrief, markdown: renderMarkdown(g, debrief) };
}

// The play screen's one problem at a time (UI-04, D-224): what the engine is showing right now, put in plain words
// for a first-time player, with one way to look into it and, on Easy and Medium, one thing to try. Looking is a real
// shell command, typed into the terminal so the player sees it; acting is a real shell command or console action,
// and when it needs a target (an address, an account, a file) the player has to pick it out of the evidence first.
// The engine still decides what every step does: a suggestion can be the wrong tool, and the meters will say so.
// The alert is its `symptom` (D-232); the steps are picked from its `gate`, the route family, never from who raised it
// (`about` is a spoiler and never read here, D-241).

import type { World } from '../../engine/state';
import type { PlayerAction, Stage } from '../../rules/vocabulary';

export type TargetKind = 'ip' | 'email' | 'file';

/** A step the player can take: a command typed into the terminal, or a console action, maybe needing a target. */
export interface Step {
  label: string;
  /** One short line on what it does, in plain words. */
  what: string;
  needs?: TargetKind;
  /** A shell command (the target is filled in where `{target}` stands). */
  cmd?: string;
  /** Or an engine action through a console. */
  action?: (target: string, world: World) => PlayerAction;
}

export interface Situation {
  key: string;
  /** The alert's gate (the engine's `alert.gate`): shown on Easy only (D-235). */
  gate?: string;
  /** The alert's route (the path family), shown on every level. */
  route?: string;
  /** The alert's symptom, as the engine words it (D-232). */
  alert: string;
  kiro: string;
  look: Step;
  act: Step | null;
}

export const STAGE_NAMES: Record<Stage, string> = { 1: 'Scout', 2: 'Break in', 3: 'Admin', 4: 'Harvest', 5: 'Dig in', 6: 'Strike' };

const ACCESS = '/var/log/nginx/access.log';
const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const UPLOADS = '/srv/juice-shop/uploads';

const WHO: Step = { label: "Who's knocking?", what: 'Counts the requests per address', cmd: `awk '{print $1}' ${ACCESS} | sort | uniq -c | sort -rn | head -n 5` };
const BLOCK: Step = { label: 'Block an address', what: 'Stops one address reaching the shop', needs: 'ip', cmd: 'iptables -A INPUT -s {target} -j DROP' };
const ADMINS: Step = { label: 'List the admins', what: 'Shows every account with admin power', cmd: `sqlite3 ${DB} "SELECT id, email, createdAt FROM Users WHERE role = 'admin';"` };
const grepLog = (label: string, what: string, pattern: string, n = 6): Step => ({ label, what, cmd: `grep "${pattern}" ${ACCESS} | tail -n ${n}` });
const LOCK: Step = { label: 'Lock an account', what: "That account can't log in again", needs: 'email', action: (email) => ({ type: 'DEF-08', email }) };
const SHIELD: Step = { label: 'Turn on the injection shield', what: 'Blocks code hidden in what people type', action: () => ({ type: 'DEF-12', rule: { kind: 'sqli' } }) };
const RESTORE: Step = { label: 'Restore the last backup', what: 'Puts the shop back as it was at the last backup', action: (_t, w) => ({ type: 'DEF-17', backupId: w.backups[w.backups.length - 1]?.id ?? 0 }) };
const LOGINS = grepLog('Check the logins', 'Shows the latest login attempts', '/rest/user/login', 8);
const SLOW_LOGINS: Step = { label: 'Slow down logins', what: 'Limits how often anyone can try a password', action: () => ({ type: 'DEF-07' }) };
const TAIL: Step = { label: 'Check the latest traffic', what: 'Shows the last requests to the shop', cmd: `tail -n 10 ${ACCESS}` };

type Row = Omit<Situation, 'key' | 'gate' | 'route' | 'alert'>;

/** One row per gate an alert can name (the engine's `alert.gate`, D-232): what to look at, what to try, Kiro's clue. */
const BY_GATE: Record<string, Row> = {
  'front door': { kiro: 'That many requests is not a shopper. Find out who is knocking.', look: WHO, act: BLOCK },
  login: { kiro: 'A login from something that is not a browser. Look at how it got in.', look: LOGINS, act: SHIELD },
  passwords: { kiro: 'Wrong password after wrong password. Nobody types that fast.', look: LOGINS, act: SLOW_LOGINS },
  search: { kiro: 'Search should never throw server errors. Someone is feeding it something strange.', look: grepLog('Check the searches', 'Shows the latest searches', '/rest/products/search'), act: SHIELD },
  'sign-up': { kiro: 'An admin nobody hired. Who made it?', look: ADMINS, act: LOCK },
  'admin API': { kiro: 'Someone is reading the customer list, page by page.', look: grepLog('Check the user list', 'Shows who asked for the customer list', '/api/Users'), act: BLOCK },
  products: { kiro: 'Product pages are being touched. Customers will see it.', look: grepLog('Check product changes', 'Shows who changed the products', '/api/Products', 8), act: RESTORE },
  uploads: { kiro: 'Nobody uploads files at this hour.', look: { label: 'List the uploads', what: 'Shows every uploaded file', cmd: `ls -la ${UPLOADS}` }, act: { label: 'Delete a file', what: 'Removes it from the server', needs: 'file', cmd: `rm ${UPLOADS}/{target}` } },
  feedback: { kiro: 'The feedback form is filling up with noise.', look: grepLog('Check the feedback', 'Shows the latest feedback posts', '/api/Feedbacks', 8), act: { label: 'Turn on the feedback CAPTCHA', what: 'Only humans can post feedback', action: () => ({ type: 'DEF-10', feature: 'feedback-captcha', enabled: true }) } },
};
/** A leaky tap's gate (its own name): something left open, talking too much. */
const LEAK: Row = { kiro: 'Something we left open is talking too much.', look: TAIL, act: null };

const QUIET: Omit<Situation, 'key'> = {
  alert: 'All quiet. For now.',
  kiro: "Watch the traffic. He'll come.",
  look: WHO,
  act: { label: 'Watch the log', what: 'Shows the last requests to the shop', cmd: `tail -n 8 ${ACCESS}` },
};

/** The problem to show now: the newest open alert, its symptom and its gate's steps; or the quiet. */
export function situationOf(world: World): Situation {
  const open = world.alerts.filter((a) => a.closedAt === undefined);
  const alert = open[open.length - 1];
  if (!alert) return { key: 'quiet', ...QUIET };
  const row = BY_GATE[alert.gate] ?? LEAK;
  return { key: `alert-${alert.id}`, gate: alert.gate, route: alert.route, alert: alert.symptom, ...row };
}

/** On Hard the screen suggests no action and Kiro gives no clue: the player reads and decides alone (D-224). */
export function forLevel(s: Situation, difficulty: World['difficulty']): Situation {
  if (difficulty !== 'hard' || s.key === 'quiet') return s;
  return { ...s, kiro: 'Something is wrong. Find it.', act: null };
}

/** A step's shell command with its target filled in. */
export function commandFor(step: Step, target: string | null): string | null {
  if (!step.cmd) return null;
  if (step.cmd.includes('{target}')) return target ? step.cmd.replace('{target}', target) : null;
  return step.cmd;
}

const IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;

/** A line of output cut into plain text and pickable targets (addresses, accounts, the upload files it names). */
export function tokens(line: string, files: readonly string[]): Array<{ text: string; kind?: TargetKind }> {
  const marks: Array<{ at: number; end: number; kind: TargetKind }> = [];
  for (const [re, kind] of [
    [IP, 'ip'],
    [EMAIL, 'email'],
  ] as const) {
    for (const m of line.matchAll(re)) marks.push({ at: m.index, end: m.index + m[0].length, kind });
  }
  for (const f of files) {
    const at = line.indexOf(f);
    if (f && at >= 0 && /(^|\s|\/)$/.test(line.slice(0, at)) && (at + f.length === line.length || /\s/.test(line[at + f.length]!))) marks.push({ at, end: at + f.length, kind: 'file' });
  }
  marks.sort((a, b) => a.at - b.at);
  const out: Array<{ text: string; kind?: TargetKind }> = [];
  let i = 0;
  for (const m of marks) {
    if (m.at < i) continue; // an address inside an email, say
    if (m.at > i) out.push({ text: line.slice(i, m.at) });
    out.push({ text: line.slice(m.at, m.end), kind: m.kind });
    i = m.end;
  }
  if (i < line.length) out.push({ text: line.slice(i) });
  return out;
}

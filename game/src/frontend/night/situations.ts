// The play screen's one problem at a time (UI-04, D-224): what the engine is showing right now, put in plain words
// for a first-time player, with one way to look into it and, on Easy and Medium, one thing to try. Looking is a real
// shell command, typed into the terminal so the player sees it; acting is a real shell command or console action,
// and when it needs a target (an address, an account, a file) the player has to pick it out of the evidence first.
// The engine still decides what every step does: a suggestion can be the wrong tool, and the meters will say so.

import type { World } from '../../engine/state';
import type { Actor, PlayerAction, Stage } from '../../rules/vocabulary';

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
  /** What raised the alert (a move, minion or tap id: never shown, it picks the gate). */
  actor?: string;
  stage: Stage | null;
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
const REVOKE: Step = { label: 'Cancel every login', what: 'Logs everyone out, customers too', action: () => ({ type: 'DEF-09' }) };
const RESTORE: Step = { label: 'Restore the last backup', what: 'Puts the shop back as it was at the last backup', action: (_t, w) => ({ type: 'DEF-17', backupId: w.backups[w.backups.length - 1]?.id ?? 0 }) };

/** One row per thing that can raise an alert. */
const BY_ACTOR: Record<string, Omit<Situation, 'key'>> = {
  'ATK-01': { stage: 1, alert: 'Someone is knocking on every door of the shop.', kiro: "Thousands of requests from one visitor. That's not a shopper.", look: WHO, act: BLOCK },
  'ATK-02': { stage: 1, alert: "Someone is reading the files in the shop's /ftp folder.", kiro: 'Those files were never meant to be public.', look: grepLog('Check /ftp visits', 'Shows who opened the /ftp folder', '/ftp'), act: { label: 'Close the /ftp folder', what: 'Hides it from everyone, customers too', action: () => ({ type: 'DEF-10', feature: 'ftp', enabled: false }) } },
  'ATK-03': { stage: 2, alert: 'Someone is typing code into the login box.', kiro: "That isn't a password. It's a trick to skip the password.", look: grepLog('Check the logins', 'Shows the latest login attempts', '/rest/user/login', 8), act: SHIELD },
  'ATK-04': { stage: 2, alert: "Someone is guessing the admin's password. Fast.", kiro: 'Hundreds of wrong passwords. Nobody types that fast.', look: grepLog('Check the logins', 'Shows the latest login attempts', '/rest/user/login', 8), act: { label: 'Slow down logins', what: 'Limits how often anyone can try a password', action: () => ({ type: 'DEF-07' }) } },
  'ATK-05': { stage: 2, alert: "Someone is resetting a customer's password.", kiro: "They're answering a security question that isn't theirs.", look: grepLog('Check password resets', 'Shows the latest password resets', 'reset-password'), act: { label: 'Turn off password reset', what: 'Nobody can reset a password while it is off', action: () => ({ type: 'DEF-10', feature: 'password-reset', enabled: false }) } },
  'ATK-06': { stage: 3, alert: 'A new admin account just appeared.', kiro: 'Someone just gave our guest a key.', look: ADMINS, act: LOCK },
  'ATK-07': { stage: 3, alert: "Someone is using an admin's login without the password.", kiro: "They stole a pass that still works. Passes can be cancelled.", look: grepLog('Check admin activity', 'Shows the latest admin requests', '/api/', 8), act: REVOKE },
  'ATK-08': { stage: 4, alert: 'Someone is sending strange commands through the search box.', kiro: "That isn't a normal customer. Let's find out what they're trying.", look: grepLog('Check the searches', 'Shows the latest searches', '/rest/products/search'), act: SHIELD },
  'ATK-09': { stage: 4, alert: 'Someone is copying the customer list.', kiro: "Every customer, page by page. That's our people walking out the door.", look: grepLog('Check the user list', 'Shows who asked for the customer list', '/api/Users'), act: BLOCK },
  'ATK-10': { stage: 4, alert: "Someone is opening other customers' baskets.", kiro: 'Those baskets belong to real people.', look: grepLog('Check the baskets', 'Shows who opened which basket', '/rest/basket'), act: BLOCK },
  'ATK-11': { stage: 5, alert: 'Things have gone quiet. Too quiet.', kiro: "Don't trust silence. That's when he hides.", look: ADMINS, act: { label: 'Delete an account', what: 'Removes it for good', needs: 'email', action: (email) => ({ type: 'DEF-14', email }) } },
  'ATK-12': { stage: 5, alert: "A customer's account is acting strangely.", kiro: "Someone else is wearing that customer's face.", look: { label: 'Check recent changes', what: 'Shows the accounts changed last', cmd: `sqlite3 ${DB} "SELECT id, email, role, updatedAt FROM Users ORDER BY updatedAt DESC LIMIT 5;"` }, act: { label: 'Force a password reset', what: 'Whoever has that password loses it', needs: 'email', action: (email) => ({ type: 'DEF-16', email }) } },
  'ATK-13': { stage: 5, alert: "A new file appeared in the shop's uploads.", kiro: 'Nobody uploads files at this hour.', look: { label: 'List the uploads', what: 'Shows every uploaded file', cmd: `ls -la ${UPLOADS}` }, act: { label: 'Delete a file', what: 'Removes it from the server', needs: 'file', cmd: `rm ${UPLOADS}/{target}` } },
  'ATK-14': { stage: 5, alert: 'Someone made their own admin pass.', kiro: 'If he can forge passes, change the lock.', look: grepLog('Check admin activity', 'Shows the latest admin requests', '/api/', 8), act: REVOKE },
  'ATK-15': { stage: 6, alert: 'Product pages are being changed.', kiro: 'He wants the customers to see him.', look: grepLog('Check product changes', 'Shows who changed the products', '/api/Products', 8), act: RESTORE },
  'ATK-16': { stage: 6, alert: 'A product page now hides a trap for customers.', kiro: 'Anyone who opens that page is in danger.', look: grepLog('Check product changes', 'Shows who changed the products', '/api/Products', 8), act: RESTORE },
  'ATK-17': { stage: 6, alert: 'A ransom note just went up.', kiro: "This is it. Whatever you're going to do, do it now.", look: { label: 'Check the latest traffic', what: 'Shows the last requests to the shop', cmd: `tail -n 8 ${ACCESS}` }, act: RESTORE },
  'MIN-01': { stage: null, alert: 'A swarm of bots is poking at the shop.', kiro: "Cheap tools, looking for doors we don't even have.", look: WHO, act: BLOCK },
  'MIN-02': { stage: null, alert: 'Bots are trying stolen passwords on the login.', kiro: 'Many addresses, one goal: get in.', look: grepLog('Check the logins', 'Shows the latest login attempts', '/rest/user/login', 8), act: { label: 'Slow down logins', what: 'Limits how often anyone can try a password', action: () => ({ type: 'DEF-07' }) } },
  'MIN-03': { stage: null, alert: 'Something is copying the whole product list.', kiro: "Greedy. It wants everything we sell.", look: grepLog('Check product requests', 'Shows the latest product requests', '/api/Products', 8), act: BLOCK },
  'MIN-04': { stage: null, alert: 'A bot is spamming the feedback form.', kiro: 'Noise, to hide something else.', look: grepLog('Check the feedback', 'Shows the latest feedback posts', '/api/Feedbacks', 8), act: { label: 'Turn on the feedback CAPTCHA', what: 'Only humans can post feedback', action: () => ({ type: 'DEF-10', feature: 'feedback-captcha', enabled: true }) } },
  'TAP-01': { stage: null, alert: 'Customer records are leaking from somewhere.', kiro: 'Something we left open is talking too much.', look: { label: 'Check the latest traffic', what: 'Shows the last requests to the shop', cmd: `tail -n 10 ${ACCESS}` }, act: null },
};
BY_ACTOR['TAP-02'] = BY_ACTOR['TAP-01']!;
BY_ACTOR['TAP-03'] = BY_ACTOR['TAP-01']!;

const QUIET: Omit<Situation, 'key'> = {
  stage: null,
  alert: 'All quiet. For now.',
  kiro: "Watch the traffic. He'll come.",
  look: WHO,
  act: { label: 'Watch the log', what: 'Shows the last requests to the shop', cmd: `tail -n 8 ${ACCESS}` },
};

/** The problem to show now: the newest open alert, worded for its source; or the quiet. */
export function situationOf(world: World): Situation {
  const open = world.alerts.filter((a) => a.closedAt === undefined);
  const alert = open[open.length - 1];
  if (!alert) return { key: 'quiet', ...QUIET };
  const row = BY_ACTOR[alert.about as Actor] ?? { ...QUIET, alert: 'Something unusual is happening.' };
  return { key: `alert-${alert.id}`, actor: alert.about, ...row };
}

/** On Hard the screen names no stage and suggests no action: the player reads and decides alone (D-224). */
export function forLevel(s: Situation, difficulty: World['difficulty']): Situation {
  if (difficulty !== 'hard' || s.key === 'quiet') return s;
  return { ...s, stage: null, alert: 'Suspicious activity detected.', kiro: 'Something is wrong. Find it.', act: null };
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

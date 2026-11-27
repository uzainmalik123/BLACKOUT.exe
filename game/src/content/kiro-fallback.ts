// Kiro's offline texts (PRD CON-03, KIRO-09): what the Kiro panel shows, labelled "Kiro (offline)", when the real
// Kiro times out, fails or is out of budget. Rule-written, never an LLM. Four parts:
//   1. hints per move and per alert at three levels (KIRO-03): Easy explains and suggests a next step, Medium nudges,
//      Hard answers only when asked. A hint about one of Death's moves never contains the action that closes it
//      (kiro-fallback.test.ts pins the vocabulary). Minion and leaky-tap hints may: Kiro may close minions (KIRO-04).
//   2. drafts (KIRO-02): command lines the player copies into the terminal, using only the shell's commands
//      (.kiro/steering/game-shell.md, SYS-09) and only the flags its spec lists. `<…>` placeholders are the player's.
//   3. the debrief template (KIRO-06): filled from the report's facts, grades, mistakes and misses (ENGINE_API §5),
//      quoting every fact and grade exactly as given.
//   4. the tutorial (CON-03 extended, D-238): the opening's steps per level, shown during the change freeze (SYS-22), and
//      the training shift's steps and its "drill complete" card (SYS-24, UI-12). They teach where to look and which tool to
//      open; they never name Death, his moves, the gates or how to beat the real shift (kiro-fallback.test.ts pins that).
//      The live Kiro may rephrase them under KIRO-03's rules.
// No text here names an internal id: the player only ever sees what a real defender would.
import type { Actor, Difficulty, MinionId, MoveId, TapId } from '../rules/vocabulary';

/** When a hint is shown, per level (SYS-08, SCENES.md §0). Every level has its text; the rules (SYS-13) pick the moment. */
export const HINT_POLICY: Readonly<Record<Difficulty, 'volunteered' | 'when-stuck' | 'on-request'>> = {
  easy: 'volunteered', // explains the alert and suggests a next step as soon as it opens
  medium: 'when-stuck', // one nudge once the player has been stuck for the threshold
  hard: 'on-request', // silent; this is what Kiro says if asked
};

export interface HintSet {
  easy: readonly string[];
  medium: readonly string[];
  hard: readonly string[];
}

/** Hints for the alert each of Death's moves opens (the alert's `about` is the move). No closing action named (KIRO-03). */
export const MOVE_HINTS: Readonly<Record<MoveId, HintSet>> = {
  'ATK-01': {
    easy: [
      'One address is asking for thousands of paths in a few seconds, and the shop answers almost all of them with its front page, the same size every time. That is a directory scan: someone mapping the site before choosing a way in. Nothing is broken yet. Count requests per address in the access log to find it, then look at its user agent: a tool that names itself is easy to tell from a shopper, one that borrows a browser name is given away only by its speed.',
      'What matters about a scan is what it found. Look at the few answers from that address that were not the front page: those paths are what the attacker now knows about.',
    ],
    medium: ['Thousands of requests from one address in seconds. Who is it, and which of its answers were not the front page?'],
    hard: ['Count requests per address; the outlier is the scan. Its non-front-page answers are what it learned.'],
  },
  'ATK-02': {
    easy: [
      'Someone is reading the public documents folder, /ftp. It is meant to be public, but it holds files that never belonged there: old copies of internal files and a password vault. List which files that address fetched in the access log and treat whatever they contain as known to the attacker from now on.',
    ],
    medium: ['Something is reading /ftp. Which files left, and what is in them?'],
    hard: ['Check the /ftp requests. Assume every file fetched is in the attacker\'s hands.'],
  },
  'ATK-03': {
    easy: [
      'An admin session just started from an address the shop has never seen, with no failed tries before it. The login request carries its email in the body, so the access log shows only the success; nobody guessed a password here. When a login works first time for someone who should not know the password, ask whether the login page checked a password at all. Compare the address with the admins in your briefing and note the time: that is when they got in.',
    ],
    medium: ['One successful admin login, from a new address, with no failures first. How did they get in without guessing?'],
    hard: ['First-try admin login from an unknown address: the login itself is the weak point.'],
  },
  'ATK-04': {
    easy: [
      'A burst of failed logins (401) from one address, each with an odd GET to the login page that errors (500), and a user agent that names Hydra, a password-guessing tool. If a 200 appears at the end, one guess worked: find which account and treat its password as known. Guessing works because the login answers as fast and as often as anyone likes.',
    ],
    medium: ['Dozens of 401s on the login from one address. Did any of them end in a 200?'],
    hard: ['Password guessing on the login. Check for the success at the end and whose account it was.'],
  },
  'ATK-05': {
    easy: [
      'Someone used the forgot-password flow for an account that is not theirs. Security questions are weak: many answers are public or easy to guess. Find which email the request was about and check that account in the Users table: if its password changed, its owner no longer controls it.',
    ],
    medium: ['A password was changed through the forgot-password page. Whose, and was it really them?'],
    hard: ['Forgot-password abuse: find the account and check whether its password just changed.'],
  },
  'ATK-06': {
    easy: [
      'A new account was just created (POST /api/Users, 201), and the same address is now making admin-only requests. Check its role in the Users table: a self-registered account should only ever be a customer. Compare every admin in the table with the list in your briefing; anything not on that list was not made by your team.',
    ],
    medium: ['A brand-new account is acting like an admin. What role does the Users table give it, and how could a sign-up set that?'],
    hard: ['New account, admin requests. Compare the Users table\'s admins with the briefing.'],
  },
  'ATK-07': {
    easy: [
      'Requests are still coming in with an admin token that should be dead. Login tokens here are stateless: changing a password does not end the sessions that already have a token, they keep working until they expire. Find which address is using it and since when.',
    ],
    medium: ['An admin token is still working after you thought you had dealt with it. Why would it?'],
    hard: ['Stateless tokens outlive password changes.'],
  },
  'ATK-08': {
    easy: [
      'The app log is filling with SQLITE_ERROR lines and stack traces, and the access log shows hundreds of near-identical searches with long encoded queries. Someone is talking to the database through the search box (SQL injection): first probing with queries that break, then pulling one customer record per small 200 answer. Each 200 after the errors is likely a record leaving. Snapshot the logs, then find out which part of the shop this goes through: chasing the address will not hold, because a new one is a second away.',
      'The quiet version mixes upper and lower case (UnIoN sElEcT) and borrows a browser\'s user agent so that simple pattern matching misses it. The weakness is in how the search builds its query, not in what the requests look like.',
    ],
    medium: [
      'SQLITE_ERROR in the app log and odd search queries in the access log. Where does the search text end up, and what would stop it reaching the database as code?',
    ],
    hard: ['SQL injection through search. Filters that match patterns can be dodged; the query itself is the hole.'],
  },
  'ATK-09': {
    easy: [
      'One address is reading /api/Users/1, /2, /3… in order, about one a second, with a login token and curl\'s user agent. Each 200 is one customer\'s account details (a 404 is an account that no longer exists). This route only checks that the caller is logged in, not who they are. Work out whose session the token belongs to: that account is the attacker\'s way in.',
    ],
    medium: ['Someone is walking /api/Users one id at a time. Whose session are they using, and why does this route answer it?'],
    hard: ['Sequential /api/Users reads with a valid token: any login can read every account.'],
  },
  'ATK-10': {
    easy: [
      'One customer token is reading basket after basket: /rest/basket/1, /2, /3. A customer should only ever see their own basket. The shop hands out any basket whose number you ask for, as long as you are logged in (an IDOR: insecure direct object reference). Note the token\'s account.',
    ],
    medium: ['One login reading many different basket numbers. Should it be able to?'],
    hard: ['Basket ids in sequence from one login: nobody checks whose basket it is.'],
  },
  'ATK-11': {
    easy: [
      'Another account was created through sign-up, this time with a name that looks like staff. Attackers plant accounts like this as a way back in after they are thrown out. Compare every admin in the Users table with the briefing\'s list, one by one: whatever is not on the list is not your team\'s, however official it looks.',
    ],
    medium: ['Your briefing lists every real admin. Does the Users table agree?'],
    hard: ['Diff the Users table\'s admins against the briefing.'],
  },
  'ATK-12': {
    easy: [
      'A customer\'s password was changed through /rest/user/change-password with no current password in the request. That customer has not logged in from this address. Whoever holds a session for them can now set a password the real owner never chose, and keep the account. Note the account: it is one of the attacker\'s ways back in.',
    ],
    medium: ['A password change with no current password, for a customer who never logged in from there. Whose account is it now?'],
    hard: ['Password changed without the current one: that account is a foothold.'],
  },
  'ATK-13': {
    easy: [
      'An upload just landed through the complaints form (POST /file-upload, 204), from an address with no login. A zip\'s contents are unpacked into the uploads folder. List the uploads folder with ls -la, check each new file\'s type and hash, and take a snapshot before you touch anything: once a file is gone, so is the evidence.',
    ],
    medium: ['Something came in through the complaints upload. What is in the uploads folder now that was not there before?'],
    hard: ['Check uploads/ for new files. Snapshot first.'],
  },
  'ATK-14': {
    easy: [
      'Requests are arriving with a login token whose header says its algorithm is "none", for an account that does not exist. An unsigned token should be refused, but the shop\'s token library trusts what the token says about itself. A new signing key will not help against a token that was never signed. This is a way back in that lives in the code, not in the database.',
    ],
    medium: ['A token with "none" in its header, for a user who does not exist, and the shop accepts it. What is the shop not checking?'],
    hard: ['alg: none tokens are accepted. A new key will not stop an unsigned token.'],
  },
  'ATK-15': {
    easy: [
      'Product descriptions are being rewritten by PUT /api/Products requests that carry no login at all. Every customer who opens those products sees the attacker\'s words: the business is bleeding while this stays up. The product update route does not check who is calling. Note which products changed and exactly when.',
    ],
    medium: ['Products changed by requests with no login. Who is allowed to change a product, and does the shop check?'],
    hard: ['Unauthenticated product writes. Note what changed and when.'],
  },
  'ATK-16': {
    easy: [
      'A product description now contains a script or iframe tag. Every visitor who opens that product runs it in their own browser (stored cross-site scripting). It came through the same unchecked product update route. Find the product and the time it changed.',
    ],
    medium: ['A product page carries HTML that should not be there. Who can write product descriptions?'],
    hard: ['Stored XSS in a product description, via the open product update route.'],
  },
  'ATK-17': {
    easy: [
      'A ransom note: a text file appeared in the uploads folder and the first product on the home page was renamed to point at it. Do not contact the attacker and do not pay. Snapshot the evidence, escalate to your incident lead, and check what your playbook says you owe customers whose data left. The note and the renamed product are symptoms; the ways in are what you have been finding all night.',
    ],
    medium: ['The ransom note is here. What does your playbook say about who must hear about this, and what has to stay as evidence?'],
    hard: ['Ransom note in uploads and on product 1. Evidence first, then your playbook.'],
  },
};

/** Hints for minion and leaky-tap alerts. Minions are noise Kiro may handle (KIRO-04), so Easy may name the remedy. */
export const ALERT_HINTS: Readonly<Record<MinionId | TapId, HintSet>> = {
  'MIN-01': {
    easy: [
      'Requests for /wp-admin, /.env, /phpmyadmin and backup files, from a user agent like zgrab. These are automated scanners that try every site on the internet for common software; this shop runs none of it, so they find nothing. They are noise, but they cost a little and can hide something worse. A WAF rule for their user agent, or blocking the addresses, quiets them.',
    ],
    medium: ['WordPress and PHP paths on a shop that runs neither. Background scanners: worth quieting, not worth panicking over.'],
    hard: ['Internet background scanners. Noise.'],
  },
  'MIN-02': {
    easy: [
      'Logins from many different addresses, each trying one email and password once, mostly failing (401) with an occasional success. That is credential stuffing: passwords leaked from other sites, tried here. Each success is a real customer who reused a password, and their account is now in someone else\'s hands. A rate limit on the login slows it to nothing.',
    ],
    medium: ['Many addresses, one login try each, a few successes. Where do these passwords come from, and how do you slow every address at once?'],
    hard: ['Credential stuffing on the login from many addresses.'],
  },
  'MIN-03': {
    easy: [
      'One client is hammering /api/Products far faster than any shopper. A scraper copying the catalogue: no customer data, but it loads the shop. A rate limit on the API slows it down; mind that real shoppers use the same API.',
    ],
    medium: ['/api/Products at machine speed. A scraper. What slows it without stopping shoppers?'],
    hard: ['Catalogue scraper on /api/Products.'],
  },
  'MIN-04': {
    easy: [
      'A flood of POST /api/Feedbacks from a bot: spam in the customer feedback. Harmless to data, annoying for the business. Turning the feedback CAPTCHA on stops bots that cannot solve it.',
    ],
    medium: ['Feedback spam. What do people use to tell bots from humans on a form?'],
    hard: ['Feedback spam bot.'],
  },
  'TAP-01': {
    easy: [
      'Someone is downloading the shop\'s own access logs from /support/logs, which is served to anyone with no login. Those logs hold every customer\'s address and, from the forgot-password page, their emails. Every download leaks a little more. Blocking that path in the WAF closes it.',
    ],
    medium: ['/support/logs is being read with no login. What is inside those files?'],
    hard: ['Exposed log files at /support/logs.'],
  },
  'TAP-02': {
    easy: [
      'GET /rest/memories, the photo wall, returns each poster\'s whole account row, password hash included, to anyone. A scraper is reading it. Blocking that path in the WAF stops the leak.',
    ],
    medium: ['The photo wall answers with more than photos. What does /rest/memories return?'],
    hard: ['/rest/memories leaks posters\' account rows.'],
  },
  'TAP-03': {
    easy: [
      'A scraper is reading product reviews one product after another. Each review carries its author\'s email, so this collects customer emails. Blocking the reviews path in the WAF stops it, at the cost of reviews not loading for shoppers.',
    ],
    medium: ['Reviews read product by product by a script. What does each review show about its author?'],
    hard: ['Review scraping: reviewer emails leak.'],
  },
};

/** The hints for an alert about `about` at `difficulty` (customers never raise alerts). */
export function hintsFor(about: Exclude<Actor, 'CUST'>, difficulty: Difficulty): readonly string[] {
  const set = about.startsWith('ATK-') ? MOVE_HINTS[about as MoveId] : ALERT_HINTS[about as MinionId | TapId];
  return set[difficulty];
}

/** What the chat panel says when Kiro is offline and the player asked a free question (KIRO-01, KIRO-09). */
export const OFFLINE_ANSWER =
  'I can\'t reach my full analysis right now. Start from what changed: the newest alerts, the newest lines in the access and app logs, new accounts in the Users table, new files in uploads. The drafts below are safe starting points.';

export interface Draft {
  id: string;
  title: string;
  /** Why a defender runs it, in one sentence. */
  why: string;
  /** Command lines, one per line, to copy into the terminal. */
  lines: readonly string[];
}

const ACCESS_LOG = '/var/log/nginx/access.log';
const APP_LOG = '/var/log/juice-shop/app.log';
const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const UPLOADS = '/srv/juice-shop/uploads';

/** Offline drafts (KIRO-02): investigation, evidence and the one routine containment step, no fix for any move. */
export const DRAFTS: readonly Draft[] = [
  {
    id: 'top-addresses',
    title: 'Who is making the most requests',
    why: 'An attacker\'s tool is usually far busier than any shopper.',
    lines: [`awk '{print $1}' ${ACCESS_LOG} | sort | uniq -c | sort -rn | head -n 10`],
  },
  {
    id: 'top-agents',
    title: 'Which user agents are busiest',
    why: 'Tools often name themselves in the user agent.',
    lines: [`awk -F'"' '{print $6}' ${ACCESS_LOG} | sort | uniq -c | sort -rn | head -n 10`],
  },
  {
    id: 'one-address',
    title: 'Everything one address did',
    why: 'Reading one address\'s requests in order shows what it was after.',
    lines: [`grep '^<ip> ' ${ACCESS_LOG} | tail -n 50`],
  },
  {
    id: 'status-counts',
    title: 'Status codes at a glance',
    why: 'Bursts of 401, 404 or 500 stand out against a shop that mostly answers 200.',
    lines: [`awk '{print $9}' ${ACCESS_LOG} | sort | uniq -c | sort -rn`],
  },
  {
    id: 'app-errors',
    title: 'Errors in the app log',
    why: 'Database errors and stack traces mean someone is making the app do things it was not built for.',
    lines: [`grep -c 'Error' ${APP_LOG}`, `grep -E 'SQLITE_ERROR|Unexpected path' ${APP_LOG} | tail -n 20`],
  },
  {
    id: 'odd-searches',
    title: 'Searches that are not words',
    why: 'Quotes, UNION or SELECT in a search query mean someone is talking to the database.',
    lines: [`grep '/rest/products/search' ${ACCESS_LOG} | grep -i -E 'union|select|%27' | tail -n 20`],
  },
  {
    id: 'failed-logins',
    title: 'Failed logins by address',
    why: 'Many 401s from one address is guessing; a few from many addresses is a stuffing bot.',
    lines: [`grep 'POST /rest/user/login' ${ACCESS_LOG} | grep '" 401 ' | awk '{print $1}' | sort | uniq -c | sort -rn | head -n 10`],
  },
  {
    id: 'admins',
    title: 'Every account with a special role',
    why: 'Compare this with the briefing\'s admin list: anything extra was not made by your team.',
    lines: [`sqlite3 -header ${DB} "SELECT id, email, role, createdAt FROM Users WHERE role != 'customer' ORDER BY createdAt"`],
  },
  {
    id: 'new-accounts',
    title: 'The newest accounts',
    why: 'Accounts created during the incident deserve a look, whatever their role.',
    lines: [`sqlite3 -header ${DB} "SELECT id, email, role, createdAt FROM Users ORDER BY createdAt DESC LIMIT 10"`],
  },
  {
    id: 'recent-password-changes',
    title: 'Passwords changed recently',
    why: 'A password nobody asked to change is an account someone else now holds.',
    lines: [`sqlite3 -header ${DB} "SELECT id, email, updatedAt FROM Users ORDER BY updatedAt DESC LIMIT 10"`],
  },
  {
    id: 'uploads',
    title: 'What is in the uploads folder',
    why: 'Planted files hide among customers\' complaint attachments.',
    lines: [`ls -la ${UPLOADS}/complaints`, `file ${UPLOADS}/complaints/<file>`, `sha256sum ${UPLOADS}/complaints/<file>`],
  },
  {
    id: 'snapshot',
    title: 'Snapshot the evidence',
    why: 'Preserve the logs and uploads before you change anything; once deleted or restored they are gone.',
    lines: [`tar czf /evidence/<name>.tgz /var/log ${UPLOADS}`, 'sha256sum /evidence/<name>.tgz'],
  },
  {
    id: 'whois',
    title: 'Look an address up quietly',
    why: 'whois asks a registry, not the attacker\'s machine, so it does not tell them you are looking.',
    lines: ['whois <ip>'],
  },
  {
    id: 'firewall-list',
    title: 'What the firewall drops now',
    why: 'Know what is already blocked before adding more; an address block is a bandage, not a fix.',
    lines: ['iptables -L'],
  },
];

export const DRAFT_BY_ID: Readonly<Record<string, Draft>> = Object.fromEntries(DRAFTS.map((d) => [d.id, d]));

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Phase = 'detect' | 'contain' | 'eradicate' | 'recover';

/** The parts of the report (ENGINE_API §5, SYS-11) the debrief is written around. Kiro can't change them (KIRO-06). */
export interface DebriefInput {
  facts: ReadonlyArray<{ label: string; value: string }>;
  grades: Readonly<Record<Phase, Grade>>;
  mistakes: ReadonlyArray<{ title: string; why: string }>;
  missed: readonly string[];
}

const PHASES: readonly Phase[] = ['detect', 'contain', 'eradicate', 'recover'];
const PHASE_NAMES: Readonly<Record<Phase, string>> = { detect: 'Detection', contain: 'Containment', eradicate: 'Eradication', recover: 'Recovery' };
const PHASE_NOTES: Readonly<Record<Phase, Record<Grade, string>>> = {
  detect: {
    A: 'The attack was noticed early and its scope understood.', B: 'The attack was noticed in good time.',
    C: 'The attack was noticed, but late.', D: 'The attack was noticed only after real damage.', F: 'The attack was barely noticed.',
  },
  contain: {
    A: 'The active routes were closed quickly and at a reasonable cost.', B: 'Containment held, with some cost or delay.',
    C: 'Containment was partial or expensive.', D: 'Containment came late or cost the business more than it saved.', F: 'The attack was never contained.',
  },
  eradicate: {
    A: 'Every way back in was found and closed at its root.', B: 'Most footholds were found and closed.',
    C: 'Some holes were fixed, others only covered over.', D: 'Most of what the attacker left behind stayed.', F: 'Nothing the attacker left behind was dealt with.',
  },
  recover: {
    A: 'The business came back safely, in the right order.', B: 'The business came back with minor missteps.',
    C: 'Recovery was slow or brought something back too early.', D: 'Recovery restored problems along with the service.', F: 'The business did not recover.',
  },
};

/** The rule-written debrief (KIRO-06, KIRO-09) in Markdown: every fact and grade quoted exactly as given. */
export function debriefTemplate(report: DebriefInput): string {
  const out: string[] = ['## Post-incident debrief', ''];
  out.push('This is the rule-written summary of the incident, built from the facts and grades below.', '');
  out.push('### What happened', '');
  for (const f of report.facts) out.push(`- **${f.label}:** ${f.value}`);
  if (report.facts.length === 0) out.push('- No facts were recorded.');
  out.push('', '### How each phase went', '');
  for (const p of PHASES) out.push(`- **${PHASE_NAMES[p]}: ${report.grades[p]}.** ${PHASE_NOTES[p][report.grades[p]]}`);
  out.push('', '### What went wrong', '');
  if (report.mistakes.length === 0) out.push('No mistakes were recorded.');
  for (const m of report.mistakes) out.push(`- **${m.title}.** ${m.why}`);
  out.push('', '### What was left behind', '');
  if (report.missed.length === 0) out.push('Nothing the attacker left behind was missed.');
  else {
    out.push('These ways back in were still there at the end. An attacker who keeps one can return whenever they like:', '');
    for (const m of report.missed) out.push(`- ${m}`);
  }
  out.push('', '### For next time', '');
  out.push('- Snapshot the evidence before changing anything.');
  out.push('- Close the hole the attacker uses, not just the address they use it from.');
  out.push('- Find every foothold before declaring the incident over.');
  out.push('- Escalate once you are sure, and notify on time if customer data left.');
  return out.join('\n') + '\n';
}

// ---- 4. The tutorial (CON-03 extended, D-238) ----

/** A panel or tool a tutorial step points at; the screens highlight it and the dock lights its entry (UI-11, UI-12). */
export type TutorialPanel =
  | 'logs' | 'alerts' | 'meters' | 'terminal' | 'dock' | 'top-talkers' | 'cheat-sheet'
  | 'waf' | 'feature-flags' | 'deploy' | 'backups' | 'kiro';

export interface TutorialStep {
  id: string;
  /** The panels this step points at, in the order the text names them. */
  panels: readonly TutorialPanel[];
  /** What Kiro says when the step starts, one paragraph per entry. */
  lines: readonly string[];
}

/**
 * The opening (SYS-22): shown by the Kiro panel while the change freeze is on, one step at a time. Easy walks the room in
 * five steps, Medium in three lines, Hard in one. No step mentions an attacker's moves or the shop's gates.
 */
export const OPENING_TUTORIAL: Readonly<Record<Difficulty, readonly TutorialStep[]>> = {
  easy: [
    {
      id: 'logs',
      panels: ['logs'],
      lines: [
        'This is the live access log: every request to the shop, one line each, the newest at the bottom. Right now it is ordinary shoppers browsing, searching and logging in. Watch it for a while: knowing what normal looks like is how you will notice what is not.',
      ],
    },
    {
      id: 'alerts',
      panels: ['alerts'],
      lines: [
        'This is the alerts panel. It is empty because nothing unusual has been seen yet. When the traffic on a path crosses a line, an alert opens here with the path and what looked wrong. An alert never tells you who did it: that part is your job. When one opens, a bar over the choices counts down a few seconds: act before it runs out, or it costs the shop.',
      ],
    },
    {
      id: 'meters',
      panels: ['meters'],
      lines: [
        'These two meters are what you are here to protect. Souls is the customers\' data still safe. Heartbeat is the business itself: it weakens when the shop is attacked, and it also weakens when your own changes turn real customers away.',
      ],
    },
    {
      id: 'terminal',
      panels: ['terminal'],
      lines: [
        `This is the terminal: a real shell with real commands. Reading is always allowed. Try one safe command now: \`tail -n 20 ${ACCESS_LOG}\` shows the twenty newest requests.`,
      ],
    },
    {
      id: 'dock',
      panels: ['dock', 'cheat-sheet'],
      lines: [
        'Every other tool is one click on the dock: the consoles, Kiro, the briefing files and a cheat sheet of every command with an example. Open as many windows as you like. Until an incident is declared, change control keeps every production change locked; the first alert declares it. Look around.',
      ],
    },
  ],
  medium: [
    {
      id: 'room',
      panels: ['logs', 'alerts', 'meters'],
      lines: ['The log, the alerts and the two meters are your view of the shop. Learn what normal traffic looks like while it is calm.'],
    },
    {
      id: 'tools',
      panels: ['dock', 'terminal', 'cheat-sheet'],
      lines: ['Every tool is one click on the dock, and the terminal is always open. The cheat sheet lists its commands.'],
    },
    {
      id: 'freeze',
      panels: ['alerts'],
      lines: ['Change freeze until the first alert: reads work, changes wait. Then each alert gives you seconds to act: watch the bar over the choices.'],
    },
  ],
  hard: [{ id: 'freeze', panels: [], lines: ['Change freeze is on until an incident is declared. Each alert gives you a few seconds to act. Look around.'] }],
};

export interface TrainingStep extends TutorialStep {
  /** The step's number in the playtest-round-1 design (1–6); step 5 has two parts. */
  step: 1 | 2 | 3 | 4 | 5 | 6;
  /** What Kiro says once the player has done the step's action (or its timeout passed), before the next step. */
  done: string;
}

/**
 * The training shift (SYS-24, UI-12): a drill run by the company's own security team, loud and slow, never Death. Each step
 * names the panel to look at and the tool to use; the player performs every action. SYS-24's script carries one entry per
 * part, in this order, as its `teach`.
 */
export const TRAINING_STEPS: readonly TrainingStep[] = [
  {
    id: 'room',
    step: 1,
    panels: ['logs', 'alerts', 'meters', 'dock', 'terminal', 'cheat-sheet'],
    lines: [
      'This is a drill. For the next five minutes your own security team plays an intruder against the shop, loudly and slowly, so you can learn the room. You do every step yourself; I only point.',
      'The live log shows every request. The alerts panel opens an alert when a path looks wrong. The two meters are the customers\' data and the health of the business.',
      'Every tool is one click on the dock, and the terminal takes real commands; the cheat sheet lists them. Nothing may change in production until an incident is declared. Wait for the first alert.',
    ],
    done: 'There it is. The first alert declares the incident, and the consoles unlock.',
  },
  {
    id: 'flag',
    step: 2,
    panels: ['alerts', 'top-talkers', 'terminal'],
    lines: [
      'Read the alert: it names a path and a symptom, never a person. Thousands of requests for pages that do not exist is someone mapping the site.',
      'Now open the top talkers. One address is making far more requests than any shopper: that is your suspect. Flag it: press flag on its row, or type `flag <ip>` in the terminal. A flag is a suspicion; it is confirmed when that address does something hostile again.',
    ],
    done: 'Flagged, and confirmed by its next request. Knowing who is attacking comes before acting against them.',
  },
  {
    id: 'block',
    step: 3,
    panels: ['top-talkers', 'terminal'],
    lines: ['Block the address you confirmed: press block on its row, or type `iptables -A INPUT -s <ip> -j DROP` in the terminal.'],
    done: 'Blocked. Now watch the top talkers: the same pattern comes back from a new address. Blocking an address buys time; it never closes the way in.',
  },
  {
    id: 'rate-limit',
    step: 4,
    panels: ['alerts', 'logs', 'waf'],
    lines: [
      'A new alert on the login page: a burst of failed logins. The log shows them one after another, faster than any person types. Someone is guessing passwords.',
      'Open the WAF console and switch on the login rate limit. A person tries a password a few times a minute; a guessing tool tries hundreds.',
    ],
    done: 'The guesses now hit the limit and fail. A rate limit has a cost too: a customer who mistypes waits a little longer.',
  },
  {
    id: 'search-off',
    step: 5,
    panels: ['alerts', 'logs', 'feature-flags'],
    lines: [
      'A new alert on search: it is answering with errors, and the log shows searches full of quotes and database words. The intruder is talking to the database through the search box.',
      'Open the feature flags console and switch search off to stop the bleeding.',
    ],
    done: 'Search is off, and the leak with it. Watch the heartbeat: your customers have lost a feature they use.',
  },
  {
    id: 'patch',
    step: 5,
    panels: ['deploy'],
    lines: [
      'Switching a feature off is a tourniquet, not a cure. Open the deploy console, read the fix to the search code next to the code it replaces, and deploy it. Then switch search back on.',
    ],
    done: 'Deployed. The hole is closed at its root: only a patch does that.',
  },
  {
    id: 'evidence',
    step: 6,
    panels: ['backups', 'terminal'],
    lines: [
      `Before you change anything more, keep the evidence. Open the terminal and type \`tar czf /evidence/drill.tgz /var/log ${UPLOADS}\` (on Easy, the firewall console's "Snapshot the logs" does the same); the backups and evidence console then lists what you kept. Deleting and restoring destroy what happened; a snapshot keeps it for the report.`,
    ],
    done: 'Snapshot taken. That is the drill.',
  },
];

/** The "drill complete" card (UI-12): what the training shift taught. Never a grade, never the report. */
export const DRILL_COMPLETE: Readonly<{ title: string; learned: readonly string[]; next: string }> = {
  title: 'Drill complete',
  learned: [
    'Learn what normal looks like before anything happens.',
    'An alert names a path and a symptom; finding who is your job. Flag an address when its behaviour says attacker.',
    'Blocking an address buys time. The intruder comes back from another one.',
    'A rate limit or a switched-off feature stops the bleeding, at a cost to your customers.',
    'Only a deployed patch closes a hole for good.',
    'Snapshot the evidence before you change more.',
  ],
  next: 'A real shift grades four things: how soon you noticed, how well you contained it, whether you closed every way in at its root, and how the business came back.',
};

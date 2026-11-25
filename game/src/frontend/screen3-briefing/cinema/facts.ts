// Every fact the cinematic briefing says or shows (D-189), read from CON-01 through views.ts so the film can never
// disagree with the files: the shop's parts, its doors, the empty defences, the backups, the logs and what in them is
// worth a look, the admins, the playbook's six steps and legal's deadline, and the three quiz questions.

import { plain, type Inline } from '../markdown';
import { adminsView, part, playbookView, systemView, trafficView, type LogPiece } from '../views';

const S = systemView();
const A = adminsView();
const T = trafficView();
const P = playbookView();
const txt = (xs: Inline[] | undefined) => (xs ? plain(xs) : '');
const trimDot = (s: string) => s.replace(/[.\s]+$/, '');
const codesOf = (xs: Inline[] | undefined) => (xs ?? []).filter((x) => x.kind === 'code').map((x) => x.text);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** A small count in words, as it is said. */
export const say = (n: number): string => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const web = part(S, 'Web server');
const shop = part(S, 'The shop');
const db = part(S, 'Database');
const fw = part(S, 'Firewall');
const waf = part(S, 'Web application firewall');
const dbNotes = txt(db?.notes);
const count = (re: RegExp) => Number(re.exec(dbNotes)?.[1] ?? NaN);

export interface Door {
  feature: string;
  address: string;
  /** Can it be switched off from the feature flags? */
  closable: boolean;
  /** Where it is switched off, as the file says. */
  off: string;
}

export const DOORS: readonly Door[] = S.doors.map((d) => ({ feature: d.feature, address: d.address, closable: !/always/i.test(d.off), off: d.off }));
const alwaysOpen = DOORS.filter((d) => !d.closable);

export const FACTS = {
  customers: count(/(\d+)\s+customers/i),
  products: count(/(\d+)\s+products/i),
  dbWhat: trimDot(dbNotes),
  doors: DOORS.length,
  closable: DOORS.filter((d) => d.closable).length,
  alwaysOpen: alwaysOpen.map((d) => d.feature),
  parts: [
    { id: 'customers', name: 'Customers', sub: 'the internet' },
    { id: 'web', name: web?.name ?? 'Web server', sub: txt(web?.where), note: trimDot(txt(web?.notes)) },
    { id: 'app', name: shop?.name ?? 'The shop', sub: txt(shop?.where), note: trimDot(txt(shop?.notes)) },
    { id: 'db', name: db?.name ?? 'Database', sub: txt(db?.where), note: trimDot(dbNotes) },
  ],
  firewall: { where: txt(fw?.where), state: trimDot(txt(fw?.notes)) },
  waf: { where: txt(waf?.where), state: trimDot(txt(waf?.notes)) },
  backups: txt(S.backups),
  logs: S.logs.map((l) => ({ name: l.name, path: l.path, what: txt(l.what) })),
  normalLine: T.line,
  normalPieces: T.pieces as LogPiece[],
  admins: A.admins.map((a) => ({ email: a.email, who: a.who })),
  others: A.others.length,
  rule: txt(A.rule).replace(/^These are all[^.]*\.\s*/, ''),
  steps: P.steps.map((s) => s.title.replace(/\s*\(.*\)\s*$/, '').replace(/:.*$/, '')),
  legal: txt(P.legal),
  hours: P.hours,
} as const;

/** The signals worth a look in the logs, with the file's own tokens for each (the crimson evidence). */
export const EVIDENCE = T.signals
  .filter((s) => ['Status codes', 'Search queries', 'User agents', 'App log'].includes(s.signal))
  .map((s) => ({ signal: s.signal, normal: plain(s.normal), watch: plain(s.watch), tokens: codesOf(s.watch) }));

const search = DOORS.find((d) => /search/i.test(d.feature));
const login = DOORS.find((d) => /login/i.test(d.feature));
const tok = (signal: string) => EVIDENCE.find((e) => e.signal === signal)?.tokens ?? [];

/**
 * Short crimson fragments for the log tunnel, built only from the files' own words: the search address with the
 * search tokens worth a look, the login address with the status that means password guessing, the tools that name
 * themselves, the app log's error.
 */
export const SUSPICIOUS: readonly { text: string; signal: string }[] = [
  { signal: 'Search queries', text: `GET ${(search?.address ?? '/search?q=…').replace('…', '')}' ${tok('Search queries').filter((t) => /^[A-Z]+$/.test(t)).join(' ')} ${tok('Search queries').find((t) => t === '--') ?? ''}`.trim() },
  { signal: 'Status codes', text: `POST ${login?.address ?? '/login'} → ${tok('Status codes').find((t) => t === '401') ?? '401'}` },
  { signal: 'User agents', text: `User-Agent: ${tok('User agents').filter((t) => !/Mozilla/.test(t)).slice(0, 2).join(' · ')}` },
  { signal: 'App log', text: `${FACTS.logs[1]?.path ?? 'app.log'}: ${tok('App log')[0] ?? 'error'}` },
];

/** The three questions of the optional quick check (the video's old quizzes), answered by the files. */
const identify = P.steps.find((s) => /identification/i.test(s.title));
const accounts = identify?.points.map(plain).find((p) => /admins/i.test(p)) ?? '';
const contain = P.steps.find((s) => /containment/i.test(s.title));
const snapshot = contain?.points.map(plain).find((p) => /snapshot/i.test(p)) ?? '';
const hours = P.hours ?? 72;
const hourOptions = [24, hours, 168].filter((h, i, xs) => xs.indexOf(h) === i).sort((x, y) => x - y);

export interface Question {
  id: string;
  ask: string;
  options: string[];
  answer: number;
  /** The fact from the files, shown after the answer. */
  reveal: string;
}

export const QUIZ: readonly Question[] = [
  {
    id: 'admin',
    ask: "It's two in the morning, and an account you've never seen just became an admin. What is it?",
    options: ['A new hire. Nothing to worry about.', "Him. He's already inside."],
    answer: 1,
    reveal: `${FACTS.rule} ${accounts}`,
  },
  {
    id: 'first',
    ask: "You've found him. What's the very first thing you do?",
    options: ['Delete his account', 'Snapshot the evidence', 'Restart the server'],
    answer: 1,
    reveal: snapshot,
  },
  {
    id: 'legal',
    ask: 'Customer data just walked out the door. How long do you have to tell legal?',
    options: hourOptions.map((h) => (h === 168 ? 'A week' : `${h} hours`)),
    answer: hourOptions.indexOf(hours),
    reveal: FACTS.legal,
  },
];

/** How many answers are right. */
export function quizScore(answers: Readonly<Record<string, number>>): { right: number; of: number } {
  return { right: QUIZ.filter((q) => answers[q.id] === q.answer).length, of: QUIZ.length };
}

export { cap };

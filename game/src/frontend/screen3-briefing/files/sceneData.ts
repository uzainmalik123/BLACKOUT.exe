// What the four briefing places show (D-222), read from CON-01 through views.ts, free of the DOM so it can be tested:
// the Chart Room's places, the Identity Archive's dossiers, the Evidence Observatory's lanes and its Spot the
// Intruder events, and the Six Gates' steps and legal plinth. Kiro's lines and remarks are hers; every fact is the
// files'.

import { plain } from '../markdown';
import { adminsView, playbookView, systemView, trafficView, cutLogLine, type LogPiece } from '../views';

const S = systemView();
const A = adminsView();
const T = trafficView();
const P = playbookView();

export type SceneId = 'system-map' | 'admins' | 'normal-traffic' | 'playbook';

/** Each place's name, and Kiro's line on arriving. */
export const PLACES: Record<SceneId, { name: string; caption: string }> = {
  'system-map': { name: 'The Chart Room', caption: 'Seven doors. Six can close. Login never does.' },
  admins: { name: 'The Identity Archive', caption: "Know who belongs. Fear whoever doesn't." },
  'normal-traffic': { name: 'The Evidence Observatory', caption: "Every visitor leaves footprints. Find the ones that don't belong." },
  playbook: { name: 'The Six Gates', caption: 'Evidence first. Panic later. One missed backdoor brings him back.' },
};

// ------------------------------------------------------------------ the Identity Archive

export interface Dossier {
  email: string;
  /** Who it is (admins) or its role (other special roles). */
  role: string;
  kind: 'admin' | 'special';
  /** Two letters for its sigil. */
  initials: string;
  /** A number from the email, to draw a sigil unique to it. */
  seed: number;
}

/** Two letters from an email's name: the first letters of its parts, or its first two. */
export function initials(email: string): string {
  const name = email.split('@')[0] ?? email;
  const parts = name.split(/[._-]+/).filter(Boolean);
  const two = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : name.slice(0, 2);
  return two.toUpperCase();
}

/** A steady number from a string, for its sigil. */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export const ADMINS: readonly Dossier[] = A.admins.map((a) => ({ email: a.email, role: a.who, kind: 'admin' as const, initials: initials(a.email), seed: seedOf(a.email) }));
export const SPECIAL: readonly Dossier[] = A.others.map((o) => ({ email: o.email, role: o.role, kind: 'special' as const, initials: initials(o.email), seed: seedOf(o.email) }));
export const ARCHIVE = {
  rule: plain(A.rule),
  customers: A.customers,
  everyoneElse: plain(A.everyoneElse),
  weaknesses: A.weaknesses.map(plain),
};

// ------------------------------------------------------------------ the Evidence Observatory

export interface Lane {
  signal: string;
  normal: string;
  watch: string;
}

export const LANES: readonly Lane[] = T.signals.map((s) => ({ signal: s.signal, normal: plain(s.normal), watch: plain(s.watch) }));
export const SAMPLE = { line: T.line, pieces: T.pieces.length ? T.pieces : cutLogLine(T.line), noise: plain(T.noise) };

/** The file's own tokens for a signal's "worth a look" (code spans). */
function tokens(signal: string): string[] {
  const s = T.signals.find((x) => x.signal === signal);
  return (s?.watch ?? []).filter((x) => x.kind === 'code').map((x) => x.text);
}
function normalWords(): string[] {
  const s = T.signals.find((x) => x.signal === 'Search queries');
  return (s?.normal ?? []).filter((x) => x.kind === 'code').map((x) => x.text);
}

export interface Suspect {
  line: string;
  /** This one deserves a look. */
  intruder: boolean;
  /** Why, in the file's words. */
  why: string;
}

/**
 * Spot the intruder: three events built only from the file's sample line and its own words. Two are ordinary
 * searches with the normal words; one asks the search box in the database's language. Illustrative, not scored.
 */
export function suspects(): Suspect[] {
  const words = normalWords();
  const sql = tokens('Search queries');
  const search = (q: string) => SAMPLE.line.replace(/search\?q=[^ ]*/, `search?q=${q}`);
  const bad = `'))${sql.filter((t) => /^[A-Z]+$/.test(t)).map((t) => `+${t}`).join('')}+…${sql.includes('--') ? '--' : ''}`;
  const lane = LANES.find((l) => l.signal === 'Search queries');
  return [
    { line: search(words[1] ?? 'juice'), intruder: false, why: `Normal: ${lane?.normal ?? 'words'}` },
    { line: search(bad), intruder: true, why: `Worth a look: ${lane?.watch ?? 'database words in the search box'}` },
    { line: search(words[2] ?? 'banana'), intruder: false, why: `Normal: ${lane?.normal ?? 'words'}` },
  ];
}

/** The sample line's fields, each with the label the file gives it. */
export const FIELDS: readonly LogPiece[] = SAMPLE.pieces;

// ------------------------------------------------------------------ the Six Gates

export interface GateStep {
  n: number;
  title: string;
  aim: string;
  points: string[];
  /** Kiro's remark at this gate. */
  remark: string;
}

const REMARKS: Record<number, string> = {
  1: "You're standing in it. Read the map now, not when he's already inside.",
  2: "Look before you touch. Every line you read now is one you won't have to guess at later.",
  3: 'Snapshot first. Pull the plug on the whole shop and you have stopped him and the business together.',
  4: 'He never leaves just one door. Find every one of them, or he walks back in.',
  5: "Restore from before he arrived, or you'll restore him too.",
  6: "Write it down while it still hurts. That's how the next night goes better.",
};

export const GATES: readonly GateStep[] = P.steps.map((s) => ({ n: s.n, title: s.title, aim: s.aim, points: s.points.map(plain), remark: REMARKS[s.n] ?? '' }));

/**
 * The legal plinth: the playbook's own sentence, verbatim, and what the law it cites actually asks (GDPR Articles 33
 * and 34), so the player does not take away that every customer must always be told within 72 hours (KI-199).
 */
export const LEGAL = {
  file: plain(P.legal),
  hours: P.hours,
  inside: 'Inside the company: tell legal as soon as you are sure it is a breach. Not before, and not late.',
  regulator: 'GDPR Article 33: the supervisory authority is notified without undue delay and, where feasible, within 72 hours of becoming aware of a breach, unless it is unlikely to put people at risk.',
  people: 'GDPR Article 34: the people affected are told without undue delay when the breach is likely to put them at high risk.',
};

/** The Chart Room's places, each with its exact values for the inspection card. */
export interface Place {
  id: string;
  title: string;
  lines: string[];
}

const part = (name: string) => S.parts.find((p) => p.name.toLowerCase().startsWith(name.toLowerCase()));
export const PLACE_FACTS: readonly Place[] = [
  ...S.parts.map((p) => ({ id: p.name, title: p.name, lines: [plain(p.where), plain(p.notes)].filter(Boolean) })),
  ...S.logs.map((l) => ({ id: l.name, title: l.name, lines: [l.path, plain(l.what)] })),
  ...S.doors.map((d) => ({ id: d.feature, title: d.feature, lines: [d.address, /always/i.test(d.off) ? 'Cannot be switched off' : `Switched off in: ${d.off}`] })),
  { id: 'Backups', title: 'Backups', lines: [plain(S.backups)] },
];
export const LOGIN = S.doors.find((d) => /always/i.test(d.off))?.feature ?? 'Login';
export const DB_PATH = plain(part('Database')?.where ?? []);

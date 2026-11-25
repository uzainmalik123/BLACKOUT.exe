// The briefing files as things to look at, not walls of text (D-182): each CON-01 file's facts pulled out of its
// own Markdown (its tables, lists and lines), so the pictures can never say something the file doesn't. The full
// text stays one click away. Pure: tested against the files themselves.

import { BRIEFING } from '../../content/briefing';
import { parseMarkdown, plain, type Block, type Inline } from './markdown';

const file = (id: string): Block[] => parseMarkdown(BRIEFING.find((f) => f.id === id)!.markdown);

/** The blocks under the first heading whose text starts with `title` (until the next heading of that level or higher). */
function section(blocks: Block[], title: string): Block[] {
  const i = blocks.findIndex((b) => b.kind === 'heading' && plain(b.text).toLowerCase().startsWith(title.toLowerCase()));
  if (i < 0) return [];
  const level = (blocks[i] as Extract<Block, { kind: 'heading' }>).level;
  const out: Block[] = [];
  for (let j = i + 1; j < blocks.length; j++) {
    const b = blocks[j]!;
    if (b.kind === 'heading' && b.level <= level) break;
    out.push(b);
  }
  return out;
}

const first = <K extends Block['kind']>(blocks: Block[], kind: K) => blocks.find((b): b is Extract<Block, { kind: K }> => b.kind === kind);
const rows = (blocks: Block[]) => first(blocks, 'table')?.rows ?? [];
const text = (xs: Inline[] | undefined) => (xs ? plain(xs) : '');
/** The lead: the paragraph straight after the file's title. */
const lead = (blocks: Block[]) => first(blocks.slice(1, 3), 'para')?.text ?? [];

// ------------------------------------------------------------------ the system map

export interface SystemView {
  lead: Inline[];
  parts: Array<{ name: string; where: Inline[]; notes: Inline[] }>;
  logs: Array<{ name: string; path: string; what: Inline[] }>;
  doors: Array<{ feature: string; address: string; off: string }>;
  backups: Inline[];
}

export function systemView(): SystemView {
  const b = file('system-map');
  return {
    lead: lead(b),
    parts: rows(section(b, 'What runs where')).map((r) => ({ name: text(r[0]), where: r[1] ?? [], notes: r[2] ?? [] })),
    logs: rows(section(b, 'Logs')).map((r) => ({ name: text(r[0]), path: text(r[1]), what: r[2] ?? [] })),
    doors: rows(section(b, 'The public parts')).map((r) => ({ feature: text(r[0]), address: text(r[1]), off: text(r[2]) })),
    backups: first(section(b, 'Backups'), 'para')?.text ?? [],
  };
}

/** A part of the system by the start of its name ("Web server", "Database"…), for placing it on the map. */
export const part = (v: SystemView, name: string) => v.parts.find((p) => p.name.toLowerCase().startsWith(name.toLowerCase()));

// ------------------------------------------------------------------ who has admin access

export interface AdminsView {
  rule: Inline[];
  admins: Array<{ email: string; who: string }>;
  others: Array<{ email: string; role: string }>;
  customers: number | null;
  everyoneElse: Inline[];
  weaknesses: Inline[][];
}

export function adminsView(): AdminsView {
  const b = file('admins');
  const others = section(b, 'Other special roles');
  const after = first(others.filter((x) => x.kind === 'para'), 'para')?.text ?? [];
  const m = /\((\d+) accounts\)/.exec(text(after));
  return {
    rule: lead(b),
    admins: rows(section(b, 'Admins')).map((r) => ({ email: text(r[0]), who: text(r[1]) })),
    others: rows(others).map((r) => ({ email: text(r[0]), role: text(r[1]) })),
    customers: m ? Number(m[1]) : null,
    everyoneElse: after,
    weaknesses: first(section(b, 'Known weaknesses'), 'list')?.items ?? [],
  };
}

// ------------------------------------------------------------------ what normal looks like

export interface LogPiece {
  label: string;
  text: string;
}

export interface TrafficView {
  lead: Inline[];
  line: string;
  /** The sample line cut into its fields, in the file's own words. */
  pieces: LogPiece[];
  signals: Array<{ signal: string; normal: Inline[]; watch: Inline[] }>;
  noise: Inline[];
}

/** The labels, in the order the file's "Reading it left to right" names them. */
export const LOG_LABELS = ['who', 'when', 'what they asked for', 'status code', 'response size in bytes', 'where they came from', 'their browser (user agent)'] as const;

export function cutLogLine(line: string): LogPiece[] {
  const m = /^(\S+) \S+ \S+ \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"\s*$/.exec(line.trim());
  if (!m) return [];
  return LOG_LABELS.map((label, i) => ({ label, text: m[i + 1]! }));
}

export function trafficView(): TrafficView {
  const b = file('normal-traffic');
  const line = first(section(b, 'A normal access log line'), 'code')?.text.trim() ?? '';
  return {
    lead: lead(b),
    line,
    pieces: cutLogLine(line),
    signals: rows(section(b, 'Normal, at night')).map((r) => ({ signal: text(r[0]), normal: r[1] ?? [], watch: r[2] ?? [] })),
    noise: first(section(b, 'Background noise'), 'para')?.text ?? [],
  };
}

/** The file's own sentence naming the fields, for checking the labels against it. */
export function readingSentence(): string {
  for (const x of section(file('normal-traffic'), 'A normal access log line')) if (x.kind === 'para' && /left to right/i.test(plain(x.text))) return plain(x.text);
  return '';
}

// ------------------------------------------------------------------ the playbook

export interface PlaybookStep {
  n: number;
  title: string;
  /** What the step is for, after the colon or in brackets. */
  aim: string;
  points: Inline[][];
}

export interface PlaybookView {
  lead: Inline[];
  steps: PlaybookStep[];
  legal: Inline[];
  /** The notification deadline in hours, read from the legal line. */
  hours: number | null;
}

export function playbookView(): PlaybookView {
  const b = file('playbook');
  const steps: PlaybookStep[] = [];
  b.forEach((x, i) => {
    if (x.kind !== 'heading' || x.level !== 2) return;
    const h = /^(\d+)\.\s*([^:(]+?)\s*(?:[:(]\s*(.*?)\)?)?$/.exec(plain(x.text));
    if (!h) return;
    const body = section(b.slice(i), plain(x.text));
    const list = first(body, 'list');
    const para = first(body, 'para');
    steps.push({ n: Number(h[1]), title: h[2]!.trim(), aim: (h[3] ?? '').trim(), points: list ? list.items : para ? [para.text] : [] });
  });
  const legal = first(section(b, 'Legal'), 'para')?.text ?? [];
  const m = /(\d+)\s*hours/.exec(text(legal));
  return { lead: lead(b), steps, legal, hours: m ? Number(m[1]) : null };
}

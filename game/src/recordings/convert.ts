// Turns one raw recording run (recording/record.sh) into the D-15 format. Pure functions only:
// file reading, hashing and sql.js loading live in scripts/convert-recording.ts.
import type { Database, SqlValue } from 'sql.js';
import {
  validateRecording,
  type AccessEvent,
  type AppEvent,
  type DbEvent,
  type ExfilEvent,
  type FileEvent,
  type RecEvent,
  type Recording,
  type Row,
} from './format.ts';

/** What record.sh writes to run.json. */
export interface RunMeta {
  move: string;
  variant: string;
  label: string;
  tool: string;
  image: string;
  publicIp: string;
  attackerIp: string;
  startedAtMs: number;
  endedAtMs: number;
}

export interface FileInfo {
  size: number;
  sha256: string;
  bytes: Uint8Array;
}

/** Files at most this big carry their content, so the shell can `cat` them (D-15). */
export const MAX_EMBEDDED_BYTES = 64 * 1024;

/** record.sh waits this long after the tool exits for logs to flush; app lines in it still count. */
const FLUSH_MS = 2000;

/** Juice Shop's scoreboard chatter: a real shop doesn't log it (D-15). */
const SCOREBOARD = /^(info: )?(Solved \d-star |Cheat score )/;

/** nginx `access.jsonl` (the `rec` log_format in recording/nginx/nginx.conf) → access events. */
export function parseAccessJsonl(text: string, startMs: number): AccessEvent[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const r = JSON.parse(line) as Record<string, string | number>;
      return {
        t: Math.round(Number(r.msec) * 1000) - startMs,
        kind: 'access',
        ip: String(r.ip),
        method: String(r.method),
        target: String(r.target),
        protocol: String(r.protocol),
        status: Number(r.status),
        bytes: Number(r.bytes),
        referer: String(r.referer),
        userAgent: String(r.ua),
        requestTimeMs: Math.round(Number(r.rt) * 1000),
      };
    });
}

/** `docker logs --timestamps` output → app events inside the run window, minus scoreboard lines. */
export function parseAppLog(text: string, startMs: number, endMs: number): AppEvent[] {
  const events: AppEvent[] = [];
  for (const line of text.split('\n')) {
    const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z (.*)$/.exec(line);
    if (!m) continue;
    const ms = Date.parse(`${m[1]}.${(m[2] ?? '').padEnd(3, '0').slice(0, 3)}Z`);
    const text = m[3]!;
    if (ms < startMs || ms > endMs + FLUSH_MS || SCOREBOARD.test(text)) continue;
    events.push({ t: ms - startMs, kind: 'app', text });
  }
  return events;
}

function cell(v: SqlValue): string | number | null {
  if (v instanceof Uint8Array) return `base64:${toBase64(v)}`;
  return v;
}

function tableRows(db: Database, table: string): { keyName: string; rows: Map<string, Row> } {
  const cols = db.exec(`PRAGMA table_info("${table}")`)[0]?.values.map((v) => String(v[1])) ?? [];
  const keyName = cols.includes('id') ? 'id' : 'rowid';
  const rows = new Map<string, Row>();
  const res = db.exec(`SELECT rowid AS "__rowid", * FROM "${table}"`)[0];
  if (!res) return { keyName, rows };
  for (const values of res.values) {
    const row: Row = {};
    res.columns.forEach((c, i) => {
      if (c !== '__rowid') row[c] = cell(values[i]!);
    });
    const key = keyName === 'id' ? row.id : cell(values[0]!);
    rows.set(String(key), row);
  }
  return { keyName, rows };
}

function userTables(db: Database): string[] {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0];
  return res ? res.values.map((v) => String(v[0])) : [];
}

/** Row-level diff of every table present in both snapshots, all stamped at `t`. */
export function diffDatabases(before: Database, after: Database, t: number): DbEvent[] {
  const events: DbEvent[] = [];
  const afterTables = new Set(userTables(after));
  for (const table of userTables(before).filter((name) => afterTables.has(name))) {
    const b = tableRows(before, table);
    const a = tableRows(after, table);
    const keyOf = (k: string) => ({ [b.keyName]: Number.isNaN(Number(k)) ? k : Number(k) });
    for (const [k, oldRow] of b.rows) {
      const newRow = a.rows.get(k);
      if (!newRow) {
        events.push({ t, kind: 'db', op: 'delete', table, key: keyOf(k), before: oldRow });
        continue;
      }
      const changed = Object.keys({ ...oldRow, ...newRow }).filter((c) => oldRow[c] !== newRow[c]);
      if (changed.length === 0) continue;
      const pick = (row: Row) => Object.fromEntries(changed.map((c) => [c, row[c] ?? null]));
      events.push({ t, kind: 'db', op: 'update', table, key: keyOf(k), before: pick(oldRow), after: pick(newRow) });
    }
    for (const [k, newRow] of a.rows) {
      if (!b.rows.has(k)) events.push({ t, kind: 'db', op: 'insert', table, key: keyOf(k), after: newRow });
    }
  }
  return events;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

/** Uploads folder diff (paths relative to `uploads/`), all stamped at `t`. */
export function diffUploads(before: Map<string, FileInfo>, after: Map<string, FileInfo>, t: number): FileEvent[] {
  const event = (op: FileEvent['op'], path: string, f: FileInfo, embed: boolean): FileEvent => ({
    t, kind: 'file', op, path, size: f.size, sha256: f.sha256,
    ...(embed && f.size <= MAX_EMBEDDED_BYTES ? { contentBase64: toBase64(f.bytes) } : {}),
  });
  const events: FileEvent[] = [];
  for (const [path, f] of before) if (!after.has(path)) events.push(event('remove', path, f, false));
  for (const [path, f] of after) {
    const old = before.get(path);
    if (!old) events.push(event('add', path, f, true));
    else if (old.sha256 !== f.sha256) events.push(event('change', path, f, true));
  }
  return events.sort((x, y) => x.path.localeCompare(y.path));
}

interface TrafficEntry {
  n: number;
  target: string;
  body: string;
}

function parseTraffic(traffic: string): TrafficEntry[] {
  return traffic
    .split(/^#{20,}$/m)
    .map((block) => block.trim())
    .filter((block) => block.startsWith('HTTP request'))
    .map((block) => {
      const n = Number(/^HTTP request \[#(\d+)\]/.exec(block)?.[1]);
      const target = /^\S+ (\S+) HTTP\/[\d.]+$/m.exec(block)?.[1] ?? '';
      const response = block.slice(block.search(/^HTTP response \[/m));
      const bodyAt = response.indexOf('\n\n');
      return { n, target, body: bodyAt < 0 ? '' : response.slice(bodyAt + 2) };
    });
}

/**
 * sqlmap's `-t` traffic log, matched request by request to the attacker's access lines, says which
 * Users rows left in which response. Each (row, column) is reported once, at the first response
 * that carried it. Throws if the two logs disagree, rather than guess the timing.
 */
export function exfilFromTraffic(
  traffic: string,
  access: AccessEvent[],
  users: { id: number; email: string; password: string }[],
): ExfilEvent[] {
  const entries = parseTraffic(traffic);
  if (entries.length !== access.length) {
    throw new Error(`traffic has ${entries.length} requests, access log has ${access.length}`);
  }
  const leaked = new Set<string>();
  const events: ExfilEvent[] = [];
  entries.forEach((entry, i) => {
    const line = access[i]!;
    if (entry.target !== line.target) {
      throw new Error(`request #${entry.n} is ${entry.target} but access line ${i + 1} is ${line.target}`);
    }
    const byColumns = new Map<string, number[]>();
    for (const u of users) {
      const columns = (['email', 'password'] as const).filter(
        (c) => u[c] !== '' && entry.body.includes(u[c]) && !leaked.has(`${u.id}.${c}`),
      );
      if (columns.length === 0) continue;
      columns.forEach((c) => leaked.add(`${u.id}.${c}`));
      const k = columns.join(',');
      byColumns.set(k, [...(byColumns.get(k) ?? []), u.id]);
    }
    for (const [k, keys] of byColumns) events.push({ t: line.t, kind: 'exfil', table: 'Users', keys, columns: k.split(',') });
  });
  return events;
}

/** Deep copy of `value` with every occurrence of `from` in every string replaced by `to`. */
export function rewriteIp<T>(value: T, from: string, to: string): T {
  if (typeof value === 'string') return value.split(from).join(to) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => rewriteIp(v, from, to)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteIp(v, from, to)])) as T;
  }
  return value;
}

/** Assembles, sorts, rewrites and validates a recording; throws with the validator's errors. */
export function buildRecording(meta: RunMeta, events: RecEvent[]): Recording {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const lastT = sorted.at(-1)?.t ?? 0;
  const recording: Recording = rewriteIp(
    {
      format: 1,
      move: meta.move,
      variant: meta.variant,
      label: meta.label,
      recordedAt: new Date(meta.startedAtMs).toISOString(),
      durationMs: Math.max(meta.endedAtMs - meta.startedAtMs, lastT),
      attackerIp: meta.publicIp,
      juiceShop: meta.image,
      tool: meta.tool,
      events: sorted,
    },
    meta.attackerIp,
    meta.publicIp,
  );
  const errors = validateRecording(recording);
  if (errors.length > 0) throw new Error(`invalid recording ${meta.move}.${meta.variant}:\n${errors.join('\n')}`);
  return recording;
}

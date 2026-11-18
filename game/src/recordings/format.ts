// The recording format (docs/DECISIONS.md D-15): one file per move variant, replayed by SYS-03.

export type Row = Record<string, string | number | null>;

export interface AccessEvent {
  t: number;
  kind: 'access';
  ip: string;
  method: string;
  target: string;
  protocol: string;
  status: number;
  bytes: number;
  referer: string;
  userAgent: string;
  requestTimeMs: number;
}

export interface AppEvent {
  t: number;
  kind: 'app';
  text: string;
}

export interface DbEvent {
  t: number;
  kind: 'db';
  op: 'insert' | 'update' | 'delete';
  table: string;
  key: Record<string, string | number>;
  before?: Row;
  after?: Row;
}

export interface FileEvent {
  t: number;
  kind: 'file';
  op: 'add' | 'change' | 'remove';
  path: string;
  size: number;
  sha256: string;
  contentBase64?: string;
}

export interface ExfilEvent {
  t: number;
  kind: 'exfil';
  table: string;
  keys: number[];
  columns: string[];
}

export type RecEvent = AccessEvent | AppEvent | DbEvent | FileEvent | ExfilEvent;

export interface Recording {
  format: 1;
  move: string;
  variant: string;
  label: string;
  recordedAt: string;
  durationMs: number;
  attackerIp: string;
  juiceShop: string;
  tool: string;
  events: RecEvent[];
}

/** True for an IPv4 address inside 203.0.113.0/24 (TEST-NET-3), the only attacker range a recording may hold. */
export function isTestNet3(ip: string): boolean {
  const m = /^203\.0\.113\.(\d{1,3})$/.exec(ip);
  return m !== null && Number(m[1]) <= 255;
}

const HEADER_STRINGS = ['move', 'variant', 'label', 'recordedAt', 'juiceShop', 'tool'] as const;

type Errors = string[];
type Fields = Record<string, unknown>;

const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isCell = (v: unknown) => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

function want(errors: Errors, at: string, ok: boolean, what: string): void {
  if (!ok) errors.push(`${at}: expected ${what}`);
}

function checkRow(errors: Errors, at: string, row: unknown, needed: boolean): void {
  if (row === undefined && !needed) return;
  want(errors, at, isObject(row) && Object.values(row).every(isCell), 'a row of strings, numbers and nulls');
}

/** The fields each kind carries (D-15), checked as strictly as the converter writes them. */
const KIND_CHECKS: Record<string, (errors: Errors, at: string, e: Fields) => void> = {
  access(errors, at, e) {
    if (typeof e.ip !== 'string' || !isTestNet3(e.ip)) errors.push(`${at}.ip: must be inside 203.0.113.0/24`);
    for (const k of ['method', 'target', 'protocol']) want(errors, `${at}.${k}`, typeof e[k] === 'string' && e[k] !== '', 'a non-empty string');
    for (const k of ['referer', 'userAgent']) want(errors, `${at}.${k}`, typeof e[k] === 'string', 'a string');
    for (const k of ['status', 'bytes', 'requestTimeMs']) want(errors, `${at}.${k}`, isCount(e[k]), 'a whole number ≥ 0');
  },
  app(errors, at, e) {
    want(errors, `${at}.text`, typeof e.text === 'string', 'a string');
  },
  db(errors, at, e) {
    want(errors, `${at}.op`, e.op === 'insert' || e.op === 'update' || e.op === 'delete', 'insert, update or delete');
    want(errors, `${at}.table`, typeof e.table === 'string' && e.table !== '', 'a non-empty string');
    want(
      errors, `${at}.key`,
      isObject(e.key) && Object.keys(e.key).length === 1 && Object.values(e.key).every((v) => typeof v === 'string' || Number.isFinite(v)),
      'one key column with a string or number',
    );
    checkRow(errors, `${at}.before`, e.before, e.op !== 'insert');
    checkRow(errors, `${at}.after`, e.after, e.op !== 'delete');
  },
  file(errors, at, e) {
    want(errors, `${at}.op`, e.op === 'add' || e.op === 'change' || e.op === 'remove', 'add, change or remove');
    want(errors, `${at}.path`, typeof e.path === 'string' && e.path !== '', 'a non-empty string');
    want(errors, `${at}.size`, isCount(e.size), 'a whole number ≥ 0');
    want(errors, `${at}.sha256`, typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256), '64 lowercase hex digits');
    if (e.contentBase64 !== undefined) want(errors, `${at}.contentBase64`, typeof e.contentBase64 === 'string', 'a string');
  },
  exfil(errors, at, e) {
    want(errors, `${at}.table`, typeof e.table === 'string' && e.table !== '', 'a non-empty string');
    want(errors, `${at}.keys`, Array.isArray(e.keys) && e.keys.length > 0 && e.keys.every((k) => Number.isFinite(k)), 'a non-empty array of numbers');
    want(
      errors, `${at}.columns`,
      Array.isArray(e.columns) && e.columns.length > 0 && e.columns.every((c) => typeof c === 'string' && c !== ''),
      'a non-empty array of column names',
    );
  },
};

/** Problems with a parsed recording, each naming its path (`events[3].t: …`). Empty means valid. */
export function validateRecording(x: unknown): string[] {
  if (typeof x !== 'object' || x === null) return ['recording: not an object'];
  const r = x as Record<string, unknown>;
  const errors: string[] = [];
  if (r.format !== 1) errors.push(`format: expected 1, got ${String(r.format)}`);
  for (const k of HEADER_STRINGS) if (typeof r[k] !== 'string' || r[k] === '') errors.push(`${k}: expected a non-empty string`);
  const duration = r.durationMs;
  const durationOk = typeof duration === 'number' && Number.isFinite(duration) && duration >= 0;
  if (!durationOk) errors.push('durationMs: expected a number ≥ 0');
  if (typeof r.attackerIp !== 'string' || !isTestNet3(r.attackerIp)) errors.push('attackerIp: must be inside 203.0.113.0/24');
  if (!Array.isArray(r.events)) return [...errors, 'events: expected an array'];

  let lastT = 0;
  r.events.forEach((e: unknown, i: number) => {
    const at = `events[${i}]`;
    if (!isObject(e)) {
      errors.push(`${at}: not an object`);
      return;
    }
    if (typeof e.t !== 'number' || !Number.isFinite(e.t) || e.t < 0) errors.push(`${at}.t: expected a number ≥ 0`);
    else {
      if (e.t < lastT) errors.push(`${at}.t: ${e.t} comes before the previous event (${lastT})`);
      if (durationOk && e.t > duration) errors.push(`${at}.t: ${e.t} is after durationMs (${duration})`);
      lastT = Math.max(lastT, e.t);
    }
    const check = typeof e.kind === 'string' && Object.hasOwn(KIND_CHECKS, e.kind) ? KIND_CHECKS[e.kind] : undefined;
    if (check) check(errors, at, e);
    else errors.push(`${at}.kind: unknown kind ${String(e.kind)}`);
  });
  return errors;
}

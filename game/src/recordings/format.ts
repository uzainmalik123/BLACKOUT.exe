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

const KINDS = new Set(['access', 'app', 'db', 'file', 'exfil']);
const HEADER_STRINGS = ['move', 'variant', 'label', 'recordedAt', 'juiceShop', 'tool'] as const;

/** Problems with a parsed recording, each naming its path (`events[3].t: …`). Empty means valid. */
export function validateRecording(x: unknown): string[] {
  if (typeof x !== 'object' || x === null) return ['recording: not an object'];
  const r = x as Record<string, unknown>;
  const errors: string[] = [];
  if (r.format !== 1) errors.push(`format: expected 1, got ${String(r.format)}`);
  for (const k of HEADER_STRINGS) if (typeof r[k] !== 'string' || r[k] === '') errors.push(`${k}: expected a non-empty string`);
  const duration = r.durationMs;
  if (typeof duration !== 'number' || duration < 0) errors.push('durationMs: expected a number ≥ 0');
  if (typeof r.attackerIp !== 'string' || !isTestNet3(r.attackerIp)) errors.push('attackerIp: must be inside 203.0.113.0/24');
  if (!Array.isArray(r.events)) return [...errors, 'events: expected an array'];

  let lastT = 0;
  r.events.forEach((e: unknown, i: number) => {
    const at = `events[${i}]`;
    if (typeof e !== 'object' || e === null) {
      errors.push(`${at}: not an object`);
      return;
    }
    const ev = e as Record<string, unknown>;
    if (typeof ev.t !== 'number' || ev.t < 0) errors.push(`${at}.t: expected a number ≥ 0`);
    else {
      if (ev.t < lastT) errors.push(`${at}.t: ${ev.t} comes before the previous event (${lastT})`);
      if (typeof duration === 'number' && ev.t > duration) errors.push(`${at}.t: ${ev.t} is after durationMs (${duration})`);
      lastT = Math.max(lastT, ev.t);
    }
    if (typeof ev.kind !== 'string' || !KINDS.has(ev.kind)) errors.push(`${at}.kind: unknown kind ${String(ev.kind)}`);
    if (ev.kind === 'access' && (typeof ev.ip !== 'string' || !isTestNet3(ev.ip))) errors.push(`${at}.ip: must be inside 203.0.113.0/24`);
  });
  return errors;
}

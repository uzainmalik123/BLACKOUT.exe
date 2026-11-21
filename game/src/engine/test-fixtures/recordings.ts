// TEST-ONLY. A made-up recording library covering every ATK and MIN row, so the sims (SYS-16) and the Director
// tests can run before the real recordings exist (docs/TEAMMATE_TASKS.md A8). Nothing here is a real attack,
// and nothing here may ever be copied into src/recordings/. Real recordings replace these as REC-03/REC-05 land.
import type { AccessEvent, RecEvent, Recording } from '../../recordings/format';
import { MOVES } from '../../rules/moves';
import { MINION_IDS, type MinionId, type MoveId } from '../../rules/vocabulary';
import { libraryFrom, type RecordingLibrary } from '../library';

const SHA = (n: number) => n.toString(16).padStart(64, '0');

export function fakeRecording(
  move: MoveId | MinionId,
  variant: string,
  opts: { ip: string; quiet?: boolean; events?: RecEvent[]; durationMs?: number },
): Recording {
  const events = (opts.events ?? []).map((e, i) => ({ ...e, t: e.t || i * 100 })).sort((a, b) => a.t - b.t);
  const last = events.length > 0 ? events[events.length - 1]!.t : 0;
  return {
    format: 1,
    move,
    variant,
    label: `${opts.quiet ? 'quiet' : 'loud'}: made-up ${move} for tests`,
    recordedAt: '2026-11-20T00:00:00.000Z',
    durationMs: opts.durationMs ?? last + 100,
    attackerIp: opts.ip,
    juiceShop: 'test',
    tool: 'test',
    events,
  };
}

const access = (ip: string, method: string, target: string, status: number, userAgent: string, bytes = 200): AccessEvent =>
  ({ t: 0, kind: 'access', ip, method, target, protocol: 'HTTP/1.1', status, bytes, referer: '', userAgent, requestTimeMs: 5 });

const many = (n: number, f: (i: number) => RecEvent): RecEvent[] => Array.from({ length: n }, (_, i) => f(i));

/** The events each row describes in "What the defender sees", shrunk to a handful. */
/**
 * ATK-08.b/.c shaped like the real recordings (D-32), both with sqlmap's agent: .b low and slow (62 probing 500s in the
 * first 30 s, then one row per request until about 149 s); .c loud (about 90 s of probing, nothing stolen, then
 * every row in under 3 s). The committed ATK-08.b/.c replace these in the sims as soon as they are on main.
 */
function harvest(ip: string, variant: 'b' | 'c'): RecEvent[] {
  const [probeMs, dumpMs] = variant === 'b' ? [29_500, 119_000] : [91_400, 2_800];
  const ua = 'sqlmap/1.10.11#pip (https://sqlmap.org)';
  const errors = Array.from({ length: 62 }, (_, i): RecEvent[] => [
    { ...access(ip, 'GET', `/rest/products/search?q=e${i}`, 500, ua), t: 1 + Math.floor((i * probeMs) / 62) },
    { t: 2 + Math.floor((i * probeMs) / 62), kind: 'app', text: 'Error: SQLITE_ERROR: near "(": syntax error' },
  ]).flat();
  const rows = Array.from({ length: 325 }, (_, k): RecEvent[] => {
    const t = probeMs + Math.floor((k * dumpMs) / 325);
    return [
      { ...access(ip, 'GET', `/rest/products/search?q=r${k}`, 200, ua), t },
      { t: t + 1, kind: 'exfil', table: 'Users', keys: [k + 1], columns: ['email', 'password'] },
    ];
  }).flat();
  return [...errors, ...rows];
}

function eventsFor(id: MoveId | MinionId, ip: string, quiet: boolean, variant = 'a'): RecEvent[] {
  if (id === 'ATK-08' && (variant === 'b' || variant === 'c')) return harvest(ip, variant);
  const ua = quiet ? 'Mozilla/5.0' : undefined;
  switch (id) {
    case 'ATK-01': return many(60, (i) => access(ip, 'GET', `/w${i}`, 404, ua ?? 'Fuzz Faster U Fool v2.1')); // 6 s: long enough to be cut
    case 'ATK-02': return [access(ip, 'GET', '/ftp/acquisitions.md', 200, ua ?? 'curl/8.0'), access(ip, 'GET', '/ftp/package.json.bak%2500.md', 200, ua ?? 'curl/8.0')];
    case 'ATK-03': return [access(ip, 'POST', '/rest/user/login', 200, ua ?? 'curl/8.0')];
    case 'ATK-04': return [...many(5, () => access(ip, 'POST', '/rest/user/login', 401, ua ?? 'Mozilla/4.0 (Hydra)')), access(ip, 'POST', '/rest/user/login', 200, ua ?? 'Mozilla/4.0 (Hydra)')];
    case 'ATK-05': return [
      access(ip, 'POST', '/rest/user/reset-password', 200, ua ?? 'curl/8.0'),
      { t: 0, kind: 'db', op: 'update', table: 'Users', key: { id: 2 }, before: { password: 'old' }, after: { password: 'new' } }, // only the changed columns, as convert.ts writes them
      access(ip, 'POST', '/rest/user/login', 200, ua ?? 'curl/8.0'),
    ];
    case 'ATK-06': return [
      access(ip, 'POST', '/api/Users', 201, ua ?? 'curl/8.0'),
      { t: 0, kind: 'db', op: 'insert', table: 'Users', key: { id: 326 }, after: { id: 326, email: 'death@juice-sh.op', role: 'admin' } },
    ];
    case 'ATK-07': return many(5, (i) => ({ ...access(ip, 'GET', `/api/Users/${i + 1}`, 200, ua ?? 'curl/8.0'), t: i * 1000 + 1 })); // one a second
    case 'ATK-08': return [ // .a: fast, like the real ATK-08.a (never picked in play, D-31); .b/.c are harvest()
      ...many(30, (i) => access(ip, 'GET', `/rest/products/search?q=${i}`, i < 20 ? 500 : 200, ua ?? 'sqlmap/1.10')),
      ...many(5, (i) => ({ t: 0, kind: 'exfil', table: 'Users', keys: Array.from({ length: 65 }, (_, k) => k + 1 + 65 * i), columns: ['email', 'password'] }) as RecEvent), // all 325 seed rows
    ];
    case 'ATK-09': return [ // page by page: one page a second
      ...many(3, (i) => ({ ...access(ip, 'GET', `/api/Users?page=${i}`, 200, ua ?? 'curl/8.0', 9000), t: i * 1000 + 1 })),
      ...many(3, (i) => ({ t: i * 1000 + 500, kind: 'exfil', table: 'Users', keys: Array.from({ length: i === 2 ? 105 : 110 }, (_, k) => k + 1 + 110 * i), columns: ['email', 'password'] }) as RecEvent), // all 325 seed rows
    ];
    case 'ATK-10': return [
      ...many(3, (i) => access(ip, 'GET', `/rest/basket/${i + 1}`, 200, ua ?? 'curl/8.0')),
      { t: 0, kind: 'exfil', table: 'Baskets', keys: [1, 2, 3], columns: ['UserId'] },
    ];
    case 'ATK-11': return [
      access(ip, 'POST', '/api/Users', 201, ua ?? 'curl/8.0'),
      { t: 0, kind: 'db', op: 'insert', table: 'Users', key: { id: 327 }, after: { id: 327, email: 'support-ops@juice-sh.op', role: 'admin' } },
    ];
    case 'ATK-12': return [
      access(ip, 'GET', '/rest/user/change-password?new=x&repeat=x', 200, ua ?? 'curl/8.0'),
      { t: 0, kind: 'db', op: 'update', table: 'Users', key: { id: 7 }, before: { password: 'old' }, after: { password: 'x' } },
    ];
    case 'ATK-13': return [
      access(ip, 'POST', '/file-upload', 204, ua ?? 'curl/8.0'),
      { t: 0, kind: 'file', op: 'add', path: 'complaints/invoice.zip', size: 512, sha256: SHA(13) },
    ];
    case 'ATK-14': return many(2, (i) => access(ip, 'GET', `/rest/user/whoami?${i}`, 200, ua ?? 'curl/8.0'));
    case 'ATK-15': return [
      access(ip, 'PUT', '/api/Products/1', 200, ua ?? 'curl/8.0'),
      { t: 0, kind: 'db', op: 'update', table: 'Products', key: { id: 1 }, before: { description: 'The all-time classic.' }, after: { description: 'DEATH WAS HERE' } },
    ];
    case 'ATK-16': return [
      access(ip, 'PUT', '/api/Products/2', 200, ua ?? 'curl/8.0'),
      { t: 0, kind: 'db', op: 'update', table: 'Products', key: { id: 2 }, before: { description: 'Made from oranges' }, after: { description: '<script>steal()</script>' } },
    ];
    case 'ATK-17': return [
      access(ip, 'POST', '/file-upload', 204, ua ?? 'curl/8.0'),
      { t: 0, kind: 'file', op: 'add', path: 'complaints/READ_ME_MORTAL.txt', size: 66, sha256: SHA(17) },
      access(ip, 'PUT', '/api/Products/1', 200, ua ?? 'curl/8.0'), // like ATK-17.a: the first product on the home page renamed
      { t: 0, kind: 'db', op: 'update', table: 'Products', key: { id: 1 }, before: { name: 'Apple Juice (1000ml)', description: 'The all-time classic.' }, after: { name: 'READ_ME_MORTAL', description: 'PAY OR THE SOULS BURN' } },
    ];
    case 'MIN-01': return many(20, (i) => access(ip, 'GET', ['/wp-admin', '/.env', '/phpmyadmin', '/wp-login.php'][i % 4]!, 404, ua ?? 'python-requests/2.31 scanner'));
    case 'MIN-02': return [ // like MIN-02.a: failed logins, and each success an exfil of a leaked-password reuser (D-41)
      ...many(10, (i) => ({ ...access(ip, 'POST', '/rest/user/login', i % 5 === 4 ? 200 : 401, ua ?? 'Mozilla/5.0 (stuffer)'), t: 1 + i * 100 })),
      ...[43, 51].map((key, k): RecEvent => ({ t: 1 + (4 + 5 * k) * 100 + 1, kind: 'exfil', table: 'Users', keys: [key], columns: ['email', 'password'] })),
    ];
    case 'MIN-03': return many(20, (i) => access(ip, 'GET', `/api/Products?page=${i}`, 200, ua ?? 'Go-http-client/1.1', 4000));
    case 'MIN-04': return many(5, () => access(ip, 'POST', '/api/Feedbacks', 201, ua ?? 'python-requests/2.31'));
  }
}

function build(): RecordingLibrary {
  const ids: Array<MoveId | MinionId> = [...MOVES.map((m) => m.id), ...MINION_IDS];
  const recordings: Recording[] = [];
  ids.forEach((id, n) => {
    (['a', 'b', 'c'] as const).forEach((variant, v) => {
      const quiet = variant === 'c';
      const ip = `203.0.113.${10 + n + 70 * v}`; // unique per (move, variant); never a committed recording's IP
      recordings.push(fakeRecording(id, variant, { ip, quiet, events: eventsFor(id, ip, quiet, variant) }));
    });
  });
  return libraryFrom(recordings);
}

export const FIXTURE_LIBRARY: RecordingLibrary = build();

/** Every attacker address the fixtures use, for tests that want blocks to land mid-move. */
export const FIXTURE_IPS: readonly string[] = [...MOVES.map((m) => m.id), ...MINION_IDS].flatMap((id) => FIXTURE_LIBRARY.variantsOf(id).map((v) => v.info.ip));

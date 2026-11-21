// TEST-ONLY. A made-up recording library covering every ATK and MIN row, so the sims (SYS-16) and the Director
// tests can run before the real recordings exist (docs/TEAMMATE_TASKS.md A8). Nothing here is a real attack,
// and nothing here may ever be copied into src/recordings/. Real recordings replace these as REC-03/REC-05 land.
import type { AccessEvent, RecEvent, Recording } from '../../recordings/format';
import { MOVES } from '../../rules/moves';
import { MINION_IDS, type CustomerId, type MinionId, type MoveId } from '../../rules/vocabulary';
import { libraryFrom, type RecordingLibrary } from '../library';

const SHA = (n: number) => n.toString(16).padStart(64, '0');

export function fakeRecording(
  move: MoveId | MinionId | CustomerId,
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
function harvest(ip: string, variant: 'b' | 'c' | 'd' | 'e' | 'f' | 'g'): RecEvent[] {
  const quiet = variant === 'b' || variant === 'd' || variant === 'e';
  const [probeMs, dumpMs] = quiet ? [29_500, 119_000] : [91_400, 2_800];
  // D-63's halves: .d/.f rows 1–163, .e/.g rows 164–325 (the quiet ones with a browser agent, D-35); .b/.c every row.
  const [first, count] = variant === 'd' || variant === 'f' ? [1, 163] : variant === 'e' || variant === 'g' ? [164, 162] : [1, 325];
  const ua = variant === 'd' || variant === 'e' ? 'Mozilla/5.0 (X11; Linux x86_64)' : 'sqlmap/1.10.11#pip (https://sqlmap.org)';
  const errors = Array.from({ length: 62 }, (_, i): RecEvent[] => [
    { ...access(ip, 'GET', `/rest/products/search?q=e${i}`, 500, ua), t: 1 + Math.floor((i * probeMs) / 62) },
    { t: 2 + Math.floor((i * probeMs) / 62), kind: 'app', text: 'Error: SQLITE_ERROR: near "(": syntax error' },
  ]).flat();
  const rows = Array.from({ length: count }, (_, k): RecEvent[] => {
    const t = probeMs + Math.floor((k * dumpMs) / count);
    return [
      { ...access(ip, 'GET', `/rest/products/search?q=r${k}`, 200, ua), t },
      { t: t + 1, kind: 'exfil', table: 'Users', keys: [first + k], columns: ['email', 'password'] },
    ];
  }).flat();
  return [...errors, ...rows];
}

function eventsFor(id: MoveId | MinionId, ip: string, quiet: boolean, variant = 'a'): RecEvent[] {
  if (id === 'ATK-08' && 'bcdefg'.includes(variant) && variant.length === 1) return harvest(ip, variant as 'b' | 'c' | 'd' | 'e' | 'f' | 'g');
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
    case 'ATK-09': { // one by one, like ATK-09.b/.c (D-63): .a and .b ids 1–163, .c ids 164–325, ten accounts a second
      const [first, count] = variant === 'c' ? [164, 162] : [1, 163];
      return Array.from({ length: count }, (_, k): RecEvent[] => [
        { ...access(ip, 'GET', `/api/Users/${first + k}`, 200, ua ?? 'curl/8.0', 300), t: 1 + k * 100 },
        { t: 2 + k * 100, kind: 'exfil', table: 'Users', keys: [first + k], columns: ['email'] },
      ]).flat();
    }
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
    const variants = id === 'ATK-08' ? ['a', 'b', 'c', 'd', 'e', 'f', 'g'] : ['a', 'b', 'c']; // ATK-08's halves (D-63)
    variants.forEach((variant, v) => {
      const quiet = variant === 'c' || variant === 'd' || variant === 'e';
      const ip = v < 3 ? `203.0.113.${10 + n + 70 * v}` : `203.0.113.${247 + v}`; // unique per (move, variant); never a committed recording's IP
      recordings.push(fakeRecording(id, variant, { ip, quiet, events: eventsFor(id, ip, quiet, variant) }));
    });
  });
  return libraryFrom(recordings);
}

export const FIXTURE_LIBRARY: RecordingLibrary = build();

const BROWSERS = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
];

/**
 * Made-up customer traffic (REC-06's shape, D-65): 8 shoppers on 203.0.113.2–.9 over 60 s, every one doing everything
 * REC-06's shoppers do, in this order: a page load, the product list and reviews; a search; a login with two typos (three
 * tries in 3 s: a rate limit 429s the third); a second search; a sign-up; a basket add and a checkout; feedback; a
 * complaint with an upload; a forgot-password lookup; a look at /ftp. One db insert (a sign-up's Users row) that SYS-19
 * must never apply. Uniform shoppers, so whichever subset a level plays, every flow is there and the counts are known.
 */
export const FIXTURE_VISIT: Array<[string, string, number]> = [
  ['GET', '/', 200], ['GET', '/main.js', 200], ['GET', '/rest/products/search?q=', 200], ['GET', '/rest/products/1/reviews', 200],
  ['GET', '/rest/products/search?q=apple', 200],
  ['POST', '/rest/user/login', 401], ['POST', '/rest/user/login', 401], ['POST', '/rest/user/login', 200], ['GET', '/rest/user/whoami', 200],
  ['GET', '/rest/products/search?q=juice', 200],
  ['GET', '/api/SecurityQuestions/', 200], ['POST', '/api/Users/', 201], ['POST', '/api/SecurityAnswers/', 201],
  ['POST', '/api/BasketItems/', 200], ['GET', '/rest/basket/1', 200], ['POST', '/rest/basket/1/checkout', 200],
  ['GET', '/rest/captcha/', 200], ['POST', '/api/Feedbacks/', 201],
  ['POST', '/file-upload', 204], ['POST', '/api/Complaints/', 201],
  ['GET', '/rest/user/security-question?email=amy%40juice-sh.op', 200], ['POST', '/rest/user/reset-password', 200],
  ['GET', '/ftp', 200], ['GET', '/ftp/legal.md', 200],
];
export const FIXTURE_SHOPPERS = Array.from({ length: 8 }, (_, i) => `203.0.113.${2 + i}`);

export function fakeTraffic(): Recording {
  const events: RecEvent[] = FIXTURE_SHOPPERS.flatMap((ip, i) =>
    FIXTURE_VISIT.map(([method, target, status], k): RecEvent => ({ ...access(ip, method, target, status, BROWSERS[i % BROWSERS.length]!, 300), t: 1000 + i * 2000 + k * 1500 })));
  events.push({ t: 55_000, kind: 'db', op: 'insert', table: 'Users', key: { id: 400 }, after: { id: 400, email: 'new.shopper@example.org', role: 'customer' } });
  const r = fakeRecording('CUST', 'a', { ip: '203.0.113.1', events, durationMs: 60_000 });
  return { ...r, label: 'ordinary customers: made-up, 8 shoppers over 60 s' };
}

export const FIXTURE_TRAFFIC: Recording = fakeTraffic();

/** The same library with the made-up customers playing underneath (SYS-19). */
export function withTraffic(library: RecordingLibrary, traffic: Recording = FIXTURE_TRAFFIC): RecordingLibrary {
  const cust = libraryFrom([traffic]).variantsOf('CUST');
  return { variantsOf: (move) => (move === 'CUST' ? cust : library.variantsOf(move)) };
}

/** Every attacker address the fixtures use, for tests that want blocks to land mid-move. */
export const FIXTURE_IPS: readonly string[] = [...MOVES.map((m) => m.id), ...MINION_IDS].flatMap((id) => FIXTURE_LIBRARY.variantsOf(id).map((v) => v.info.ip));

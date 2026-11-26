/// <reference types="node" />
// The committed recordings (D-15) and the baseline DB the game boots from.
import { readFileSync, readdirSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { TAP_BY_ID, TAPS } from '../rules/taps';
import { isTestNet3, validateRecording, type AccessEvent, type DbEvent, type ExfilEvent, type FileEvent, type Recording } from './format';

const dir = new URL('./', import.meta.url);
const jsonFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));
// Customer traffic (REC-06) sits one folder down so it's never loaded as a move (D-62).
const trafficFiles = readdirSync(new URL('traffic/', dir)).filter((f) => f.endsWith('.json')).map((f) => `traffic/${f}`);
// The leaky taps (PRD §4.1) too: not moves, read by the taps engine only (D-130).
const tapFiles = readdirSync(new URL('taps/', dir)).filter((f) => f.endsWith('.json')).map((f) => `taps/${f}`);
const folderOf = (move: string) => (move === 'CUST' ? 'traffic/' : /^TAP-\d\d$/.test(move) ? 'taps/' : '');
const raw = (file: string) => readFileSync(new URL(file, dir), 'utf8');
const load = (file: string) => JSON.parse(raw(file)) as Recording;
const accessOf = (r: Recording) => r.events.filter((e): e is AccessEvent => e.kind === 'access');
const dbOf = (r: Recording) => r.events.filter((e): e is DbEvent => e.kind === 'db');
const filesOf = (r: Recording) => r.events.filter((e): e is FileEvent => e.kind === 'file');
const exfilOf = (r: Recording) => r.events.filter((e): e is ExfilEvent => e.kind === 'exfil');
async function baseline() {
  const SQL = await initSqlJs();
  return new SQL.Database(readFileSync(new URL('juiceshop.sqlite', dir)));
}

describe('every committed recording', () => {
  it('exists', () => {
    const moves = ['ATK-01', 'ATK-03', 'ATK-03.b', 'ATK-04', 'ATK-04.b', 'ATK-06', 'ATK-08', 'ATK-08.b', 'ATK-08.c', 'ATK-08.d', 'ATK-08.e', 'ATK-08.f', 'ATK-08.g', 'ATK-09.b', 'ATK-09.c', 'ATK-11', 'ATK-13', 'ATK-15', 'ATK-17', 'MIN-01', 'MIN-02', 'MIN-03', 'MIN-04'];
    expect(jsonFiles).toEqual(expect.arrayContaining(moves.map((m) => (m.includes('.') ? `${m}.json` : `${m}.a.json`))));
  });

  it.each([...jsonFiles, ...trafficFiles, ...tapFiles])('%s is valid D-15, named after its move and variant, with no rig address left', (file) => {
    const r = load(file);
    expect(validateRecording(r)).toEqual([]);
    expect(file).toBe(`${folderOf(r.move)}${r.move}.${r.variant}.json`);
    expect(raw(file)).not.toMatch(/\b10\.66\.\d+\.\d+\b/);
    expect(accessOf(r).every((e) => isTestNet3(e.ip))).toBe(true);
  });
});

describe('ATK-03.a: SQL injection on login', () => {
  const r = load('ATK-03.a.json');

  it('is one successful login with no failed attempts first', () => {
    const logins = accessOf(r).filter((e) => e.target === '/rest/user/login');
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatchObject({ method: 'POST', status: 200 });
  });
});

describe('ATK-08.a: sqlmap UNION dump through search', () => {
  const r = load('ATK-08.a.json');

  it('is a few hundred sqlmap search requests, about one per stolen row', () => {
    const access = accessOf(r);
    expect(access.length).toBeGreaterThanOrEqual(325);
    expect(access.every((e) => e.userAgent.startsWith('sqlmap/') && e.target.startsWith('/rest/products/search?q='))).toBe(true);
  });

  it('leaks every Users row with its email and password hash', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(new URL('juiceshop.sqlite', dir)));
    const ids = db.exec('SELECT id FROM Users')[0]!.values.map((v) => Number(v[0]));
    const leaked = (column: string) =>
      new Set(r.events.flatMap((e) => (e.kind === 'exfil' && e.table === 'Users' && e.columns.includes(column) ? e.keys : [])));
    expect([...leaked('email')].sort()).toEqual([...ids].sort());
    expect([...leaked('password')].sort()).toEqual([...ids].sort());
  });
});

describe('ATK-08.b and ATK-08.c: the paced dumps (D-32, D-35)', () => {
  const leakedAll = async (r: Recording) => {
    const db = await baseline();
    const ids = db.exec('SELECT id FROM Users')[0]!.values.map((v) => Number(v[0])).sort();
    return [...new Set(exfilOf(r).flatMap((e) => e.keys))].sort().join() === ids.join();
  };

  it('ATK-08.b (low and slow, quiet) dumps every customer over 2 to 3 minutes, with a browser agent and mixed-case SQL (D-35)', async () => {
    const r = load('ATK-08.b.json');
    const access = accessOf(r);
    expect(access.some((e) => /sqlmap/i.test(e.userAgent))).toBe(false);
    expect(access.every((e) => e.userAgent.startsWith('Mozilla/5.0'))).toBe(true);
    // randomcase can land on all capitals by chance: a case-sensitive rule catches about one request in 400
    expect(access.filter((e) => e.target.includes('UNION%20ALL%20SELECT')).length).toBeLessThanOrEqual(5);
    const steals = exfilOf(r).map((e) => e.t);
    expect(steals.at(-1)! - accessOf(r)[0]!.t).toBeGreaterThanOrEqual(120_000);
    expect(r.durationMs).toBeLessThanOrEqual(180_000);
    expect(await leakedAll(r)).toBe(true);
  });

  it('ATK-08.c (loud) probes for about 90 s with nothing stolen, then dumps every customer in seconds', async () => {
    const r = load('ATK-08.c.json');
    const steals = exfilOf(r).map((e) => e.t);
    expect(steals[0]!).toBeGreaterThan(80_000);
    expect(steals.at(-1)! - steals[0]!).toBeLessThan(10_000);
    expect(accessOf(r).filter((e) => e.t < steals[0]! && e.status === 500).length).toBeGreaterThanOrEqual(60);
    expect(await leakedAll(r)).toBe(true);
  });
});

describe('ATK-08.d to .g: the harvest in halves, so no single run takes every customer (D-63)', () => {
  const stolen = (file: string) => [...new Set(exfilOf(load(file)).flatMap((e) => e.keys))];
  const allIds = async () => (await baseline()).exec('SELECT id FROM Users')[0]!.values.map((v) => Number(v[0])).sort((x, y) => x - y);

  it.each([['d', 'e'], ['f', 'g']])('ATK-08.%s and .%s each steal about half of Users, together all of it, no row twice', async (first, second) => {
    const one = stolen(`ATK-08.${first}.json`);
    const two = stolen(`ATK-08.${second}.json`);
    for (const half of [one, two]) {
      expect(half.length).toBeGreaterThanOrEqual(150);
      expect(half.length).toBeLessThanOrEqual(175);
    }
    expect(one.filter((id) => two.includes(id))).toEqual([]);
    expect([...one, ...two].sort((x, y) => x - y)).toEqual(await allIds());
  });

  it.each(['d', 'e'])('ATK-08.%s keeps .b\'s quiet shape: browser agent, mixed-case SQL, 2 to 3 minutes', (v) => {
    const r = load(`ATK-08.${v}.json`);
    expect(accessOf(r).every((e) => e.userAgent.startsWith('Mozilla/5.0'))).toBe(true);
    expect(accessOf(r).filter((e) => e.target.includes('UNION%20ALL%20SELECT')).length).toBeLessThanOrEqual(5);
    expect(r.durationMs).toBeGreaterThanOrEqual(120_000);
    expect(r.durationMs).toBeLessThanOrEqual(180_000);
  });

  it.each(['f', 'g'])('ATK-08.%s keeps .c\'s loud shape: sqlmap agent, about 90 s of probing with nothing stolen, then a fast dump', (v) => {
    const r = load(`ATK-08.${v}.json`);
    expect(accessOf(r).every((e) => e.userAgent.startsWith('sqlmap/'))).toBe(true);
    const steals = exfilOf(r).map((e) => e.t);
    expect(steals[0]!).toBeGreaterThan(80_000);
    expect(steals.at(-1)! - steals[0]!).toBeLessThan(10_000);
  });
});

describe('ATK-01.a: ffuf directory scan', () => {
  const r = load('ATK-01.a.json');

  it('is thousands of ffuf requests, nearly all 200s (the shop answers unknown paths with its index page)', () => {
    const access = accessOf(r);
    expect(access.length).toBeGreaterThan(4000);
    expect(access.every((e) => e.userAgent.startsWith('Fuzz Faster U Fool'))).toBe(true);
    expect(access.filter((e) => e.status === 404)).toHaveLength(0);
    expect(access.filter((e) => e.status === 200).length / access.length).toBeGreaterThan(0.99);
  });
});

describe('ATK-04.a: Hydra against the admin login', () => {
  const r = load('ATK-04.a.json');

  it('is a burst of failed logins and exactly one success, Hydra user agent', () => {
    const posts = accessOf(r).filter((e) => e.method === 'POST' && e.target === '/rest/user/login');
    expect(posts.filter((e) => e.status === 401).length).toBeGreaterThan(20);
    expect(posts.filter((e) => e.status === 200)).toHaveLength(1);
    expect(accessOf(r).every((e) => e.userAgent.includes('Hydra'))).toBe(true);
  });
});

describe('ATK-06.a and ATK-11.a: admins made through sign-up', () => {
  it.each([
    ['ATK-06.a.json', 'reaper@example.org'],
    ['ATK-11.a.json', 'support-ops@juice-sh.op'],
  ])('%s inserts %s with role admin', (file, email) => {
    const users = dbOf(load(file)).filter((e) => e.table === 'Users' && e.op === 'insert');
    expect(users).toHaveLength(1);
    expect(users[0]!.after).toMatchObject({ email, role: 'admin' });
  });
});

describe('ATK-09.b and .c: the user list scraped one account at a time, in two halves (D-63)', () => {
  it.each([
    ['ATK-09.b.json', 1, 163],
    ['ATK-09.c.json', 164, 325],
  ])('%s asks for ids %i to %i one by one, over 2 to 3 minutes, and leaks emails only', (file, first, last) => {
    const r = load(file);
    expect(accessOf(r).map((e) => e.target)).toEqual(Array.from({ length: last - first + 1 }, (_, i) => `/api/Users/${first + i}`));
    expect(r.durationMs).toBeGreaterThanOrEqual(120_000);
    expect(r.durationMs).toBeLessThanOrEqual(180_000);
    const leaked = exfilOf(r).flatMap((e) => e.keys);
    expect(leaked.every((id) => id >= first && id <= last)).toBe(true);
    expect(exfilOf(r).every((e) => e.columns.join() === 'email')).toBe(true);
  });

  it('the two halves together leak every live user\'s email, and no user twice', async () => {
    const db = await baseline();
    const live = db.exec('SELECT id FROM Users WHERE deletedAt IS NULL')[0]!.values.map((v) => Number(v[0]));
    const b = exfilOf(load('ATK-09.b.json')).flatMap((e) => e.keys);
    const c = exfilOf(load('ATK-09.c.json')).flatMap((e) => e.keys);
    expect([...b, ...c].sort((x, y) => x - y)).toEqual([...live].sort((x, y) => x - y));
  });
});

describe('ATK-13.a and ATK-17.a: files planted through the zip upload', () => {
  it.each([
    ['ATK-13.a.json', 'complaints/rip.php'],
    ['ATK-17.a.json', 'complaints/READ_ME_MORTAL.txt'],
  ])('%s adds %s', (file, path) => {
    expect(filesOf(load(file)).map((f) => [f.op, f.path])).toEqual([['add', path]]);
  });
});

describe('ATK-15.a and ATK-17.a: products rewritten with no login', () => {
  it('ATK-15.a rewrites three descriptions', () => {
    const updates = dbOf(load('ATK-15.a.json')).filter((e) => e.table === 'Products' && e.op === 'update');
    expect(updates.map((e) => e.key.id)).toEqual([1, 2, 3]);
    expect(updates.every((e) => String(e.after?.description).includes('Death'))).toBe(true);
  });

  it('ATK-17.a renames the first product to his demand', () => {
    const [update] = dbOf(load('ATK-17.a.json'));
    expect(update).toMatchObject({ table: 'Products', key: { id: 1 }, after: { name: 'READ_ME_MORTAL' } });
  });
});

describe('MIN-01.a: crawler wave', () => {
  it('is 24 probes for PHP, WordPress and config files, zgrab user agent', () => {
    const access = accessOf(load('MIN-01.a.json'));
    expect(access).toHaveLength(24);
    expect(access.every((e) => e.userAgent.includes('zgrab'))).toBe(true);
  });
});

describe('MIN-02.a: credential stuffing wave', () => {
  const r = load('MIN-02.a.json');

  it('comes from a different address every attempt', () => {
    const access = accessOf(r);
    expect(new Set(access.map((e) => e.ip)).size).toBe(access.length);
  });

  it('steals exactly the customers whose login succeeded, all seeded reusers', async () => {
    const wins = accessOf(r).filter((e) => e.status === 200);
    const stolen = exfilOf(r).flatMap((e) => e.keys);
    expect(stolen).toHaveLength(wins.length);
    expect(stolen.every((id) => id > 25)).toBe(true);
    expect(exfilOf(r).map((e) => e.t)).toEqual(wins.map((e) => e.t));
  });
});

describe('MIN-03.a and MIN-04.a: the should minions, one wave each (REC-05, D-132)', () => {
  const WAVE_MS = 20_000; // a wave lasts 20 real s (config.ts) and replays a recorded second per real second

  it('MIN-03.a is a scraper hammering the catalogue: GET /api/Products only, about 2 a second, a Scrapy agent, inside one wave', () => {
    const r = load('MIN-03.a.json');
    const access = accessOf(r);
    expect(access.length).toBeGreaterThanOrEqual(20);
    expect(access.every((e) => e.method === 'GET' && e.target === '/api/Products' && e.status === 200 && e.userAgent.startsWith('Scrapy/'))).toBe(true);
    expect(access.every((e) => e.bytes > 10_000)).toBe(true); // the whole catalogue each time
    expect(r.durationMs).toBeLessThanOrEqual(WAVE_MS);
    expect(new Set(access.map((e) => e.ip)).size).toBe(1);
  });

  it('MIN-04.a is a spam bot: each post fetches a CAPTCHA first, every post is accepted, and the spam lands in Feedbacks, inside one wave', () => {
    const r = load('MIN-04.a.json');
    const access = accessOf(r);
    const posts = access.filter((e) => e.method === 'POST' && e.target === '/api/Feedbacks/');
    expect(posts.length).toBe(10);
    expect(posts.every((e) => e.status === 201)).toBe(true);
    access.forEach((e, i) => expect(e.target).toBe(i % 2 === 0 ? '/rest/captcha/' : '/api/Feedbacks/'));
    const spam = dbOf(r).filter((e) => e.table === 'Feedbacks' && e.op === 'insert');
    expect(spam).toHaveLength(10);
    expect(spam.every((e) => /www\.example\.(com|net|org)/.test(String(e.after?.comment)))).toBe(true);
    expect(r.durationMs).toBeLessThanOrEqual(WAVE_MS);
  });
});

describe('CUST.a: ordinary customer traffic (REC-06, D-61)', () => {
  const r = load('traffic/CUST.a.json');
  const access = accessOf(r);

  it('is in traffic/, not among the moves, and lasts about ten minutes', () => {
    expect(trafficFiles).toContain('traffic/CUST.a.json');
    expect(jsonFiles.some((f) => f.startsWith('CUST'))).toBe(false);
    expect(r.durationMs).toBeGreaterThan(540_000);
    expect(r.durationMs).toBeLessThan(720_000);
  });

  it('comes from 40 to 80 addresses, none a Death or minion address, all with browser user agents', () => {
    const ips = new Set(access.map((e) => e.ip));
    expect(ips.size).toBeGreaterThanOrEqual(40);
    expect(ips.size).toBeLessThanOrEqual(80);
    const attackers = new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => accessOf(load(f)).map((e) => e.ip)));
    expect([...ips].filter((ip) => attackers.has(ip))).toEqual([]);
    expect(access.every((e) => e.userAgent.startsWith('Mozilla/5.0'))).toBe(true);
  });

  it('has the ordinary things shoppers do, nothing broken and no attack payloads', () => {
    const has = (method: string, target: RegExp, status: number) => access.some((e) => e.method === method && target.test(e.target) && e.status === status);
    expect(has('GET', /^\/rest\/products\/search\?q=[a-z]/, 200)).toBe(true);
    expect(has('POST', /^\/rest\/user\/login$/, 401)).toBe(true);
    expect(has('POST', /^\/rest\/user\/login$/, 200)).toBe(true);
    expect(has('POST', /^\/api\/BasketItems\/$/, 200)).toBe(true);
    expect(has('POST', /^\/rest\/basket\/\d+\/checkout$/, 200)).toBe(true);
    expect(has('POST', /^\/api\/Users\/$/, 201)).toBe(true);
    expect(has('POST', /^\/api\/Feedbacks\/$/, 201)).toBe(true);
    expect(has('POST', /^\/file-upload$/, 204)).toBe(true);
    expect(has('POST', /^\/api\/Complaints\/$/, 201)).toBe(true);
    expect(access.filter((e) => e.status >= 500)).toEqual([]);
    expect(access.filter((e) => /union|select|%27|'|<script|\.\.\/|\.php/i.test(e.target))).toEqual([]);
    const admins = dbOf(r).filter((e) => e.table === 'Users' && e.op === 'insert' && e.after?.role !== 'customer');
    expect(admins).toEqual([]);
  });
});

describe('CUST.b: shoppers who reset a password and open /ftp (KI-82, D-131)', () => {
  const r = load('traffic/CUST.b.json');
  const access = accessOf(r);
  const count = (method: string, target: RegExp, status: number) => access.filter((e) => e.method === method && target.test(e.target) && e.status === status).length;

  it('is short, from 15 to 30 addresses, none a Death or minion address, all with browser user agents', () => {
    expect(r.durationMs).toBeGreaterThan(150_000);
    expect(r.durationMs).toBeLessThan(300_000);
    const ips = new Set(access.map((e) => e.ip));
    expect(ips.size).toBeGreaterThanOrEqual(15);
    expect(ips.size).toBeLessThanOrEqual(30);
    const attackers = new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => accessOf(load(f)).map((e) => e.ip)));
    expect([...ips].filter((ip) => attackers.has(ip))).toEqual([]);
    expect(access.every((e) => e.userAgent.startsWith('Mozilla/5.0'))).toBe(true);
  });

  it('has forgot-password flows: the question looked up, a mistyped answer refused, then reset, and a login with the new password', () => {
    expect(count('GET', /^\/rest\/user\/security-question\?email=[^&]+@example\.(com|net|org)$/, 200)).toBeGreaterThanOrEqual(4);
    expect(count('POST', /^\/rest\/user\/reset-password$/, 401)).toBeGreaterThanOrEqual(4);
    expect(count('POST', /^\/rest\/user\/reset-password$/, 200)).toBeGreaterThanOrEqual(3);
    const resets = access.filter((e) => e.target === '/rest/user/reset-password' && e.status === 200);
    for (const reset of resets) {
      expect(access.some((e) => e.ip === reset.ip && e.t > reset.t && e.target === '/rest/user/login' && e.status === 200)).toBe(true);
    }
  });

  it('has shoppers reading /ftp/legal.md from the About page, and one opening /ftp itself', () => {
    expect(count('GET', /^\/ftp\/legal\.md$/, 200)).toBeGreaterThanOrEqual(4);
    expect(count('GET', /^\/ftp$/, 200)).toBeGreaterThanOrEqual(1);
    expect(count('GET', /^\/api\/Feedbacks\/$/, 200)).toBeGreaterThanOrEqual(4); // the About page's carousel
  });

  it('is otherwise ordinary: searches, logins, baskets, nothing broken and no attack payloads', () => {
    expect(count('GET', /^\/rest\/products\/search\?q=[a-z]/, 200)).toBeGreaterThan(10);
    expect(count('POST', /^\/api\/BasketItems\/$/, 200)).toBeGreaterThanOrEqual(1);
    expect(access.filter((e) => e.status >= 500)).toEqual([]);
    expect(access.filter((e) => /union|select|%27|'|<script|\.\.\/|\.php/i.test(e.target))).toEqual([]);
    expect(access.filter((e) => /^\/ftp\/./.test(e.target) && e.target !== '/ftp/legal.md')).toEqual([]); // no confidential file opened
  });
});

describe('the quiet login variants, a WAF rule does not match them (SYS-23, D-237)', () => {
  const browser = (e: AccessEvent) => e.userAgent.startsWith('Mozilla/5.0') && !/hydra|curl|sqlmap/i.test(e.userAgent);

  it('ATK-03.b: one login from a browser, no quote or comment in the line, and it lands (200)', () => {
    const r = load('ATK-03.b.json');
    expect(r.label.startsWith('quiet')).toBe(true);
    expect(r.attackerIp).toBe('203.0.113.26');
    const access = accessOf(r);
    expect(access.map((e) => [e.method, e.target, e.status])).toEqual([['POST', '/rest/user/login', 200]]);
    expect(access.every(browser)).toBe(true);
  });

  it('ATK-04.b: POSTs only, 10 s or more apart (never three logins in 15 s, the rate limit), 401s then one 200', () => {
    const r = load('ATK-04.b.json');
    expect(r.label.startsWith('quiet')).toBe(true);
    expect(r.attackerIp).toBe('203.0.113.45');
    const access = accessOf(r);
    expect(access.every((e) => e.method === 'POST' && e.target === '/rest/user/login' && browser(e))).toBe(true);
    expect(access.map((e) => e.status)).toEqual([...Array<number>(access.length - 1).fill(401), 200]);
    expect(access.length).toBe(18);
    for (let i = 1; i < access.length; i++) expect(access[i]!.t - access[i - 1]!.t).toBeGreaterThanOrEqual(10_000);
    for (let i = 2; i < access.length; i++) expect(access[i]!.t - access[i - 2]!.t).toBeGreaterThanOrEqual(15_000);
  });
});

describe('CUST.c: shoppers whose searches and feedback hold quotes, the false positives of a SQLi rule (SYS-23, D-237)', () => {
  const r = load('traffic/CUST.c.json');
  const access = accessOf(r);
  const quoted = access.filter((e) => /^\/rest\/products\/search\?q=.*%27/.test(e.target));

  it('is about two minutes from 12 addresses, none a Death or minion address, all with browser user agents', () => {
    expect(r.durationMs).toBeGreaterThan(90_000);
    expect(r.durationMs).toBeLessThan(150_000);
    const ips = new Set(access.map((e) => e.ip));
    expect(ips.size).toBe(12);
    const attackers = new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => accessOf(load(f)).map((e) => e.ip)));
    expect([...ips].filter((ip) => attackers.has(ip))).toEqual([]);
    expect(access.every((e) => e.userAgent.startsWith('Mozilla/5.0'))).toBe(true);
  });

  it('has 8 searches with an apostrophe; each answers 500 (the shop\'s search is injectable) and its shopper searches again without it', () => {
    expect(quoted.length).toBe(8);
    for (const q of quoted) {
      expect(q.status).toBe(500);
      const retry = access.find((e) => e.ip === q.ip && e.t > q.t && /^\/rest\/products\/search\?q=[^&]/.test(e.target) && !e.target.includes('%27'));
      expect(retry?.status, q.target).toBe(200);
    }
    expect(access.filter((e) => e.status >= 500)).toEqual(quoted); // nothing else broke
  });

  it('has double-quoted searches and two feedbacks with quotes, and no attack payloads', () => {
    expect(access.filter((e) => /^\/rest\/products\/search\?q=%22/.test(e.target) && e.status === 200).length).toBeGreaterThanOrEqual(2);
    const feedbacks = dbOf(r).filter((e) => e.table === 'Feedbacks' && e.op === 'insert');
    expect(feedbacks.length).toBe(2);
    expect(feedbacks.every((e) => /['"]/.test(String(e.after?.comment)))).toBe(true);
    expect(access.filter((e) => /union|select|--|<script|\.\.\/|\.php/i.test(e.target))).toEqual([]);
  });
});

describe('the leaky taps, each scraped for real (PRD §4.1, KI-59, D-130)', () => {
  const tap = (id: string) => load(`taps/${id}.a.json`);
  const leaked = (r: Recording) => [...new Set(exfilOf(r).flatMap((e) => e.keys))].sort((x, y) => x - y);

  it('every tap is recorded, and no tap sits among the moves', () => {
    expect(tapFiles).toEqual(TAPS.map((t) => `taps/${t.id}.a.json`));
    expect(jsonFiles.filter((f) => f.startsWith('TAP-'))).toEqual([]);
  });

  it.each(TAPS.map((t) => t.id))('%s is GET 200s on the exposed route only, with no login and a scraper user agent', (id) => {
    const route = TAP_BY_ID[id].closedBy.rule.path.replace('*', '\\d+');
    for (const e of accessOf(tap(id))) {
      expect(e).toMatchObject({ method: 'GET', status: 200, userAgent: 'python-requests/2.32.3' });
      expect(e.target).toMatch(new RegExp(`^${route}(/|$)`));
    }
  });

  it.each(TAPS.map((t) => t.id))('%s leaks exactly the accounts its rule names, the ones its recording really took (D-135)', (id) => {
    const rule = TAP_BY_ID[id].leaks;
    expect(rule).not.toBe('every-customer');
    expect(leaked(tap(id))).toEqual([...(rule as readonly number[])].sort((x, y) => x - y));
  });

  it('TAP-02 hands over each poster\'s password hash with their email; TAP-03 only emails', () => {
    expect(exfilOf(tap('TAP-02')).every((e) => e.columns.includes('password'))).toBe(true);
    expect(exfilOf(tap('TAP-03')).every((e) => e.columns.join() === 'email')).toBe(true);
  });

  it('TAP-01: the listing, then the access log, growing; it carries the emails of the customers who looked up a security question (D-135)', () => {
    const [listing, ...fetches] = accessOf(tap('TAP-01'));
    expect(listing!.target).toBe('/support/logs');
    expect(fetches.length).toBeGreaterThanOrEqual(5);
    for (const e of fetches) expect(e.target).toMatch(/^\/support\/logs\/access\.log\.\d{4}-\d\d-\d\d$/);
    for (let i = 1; i < fetches.length; i++) expect(fetches[i]!.bytes).toBeGreaterThan(fetches[i - 1]!.bytes);
    expect(leaked(tap('TAP-01')).length).toBe(5); // CUST.b's five resetters, run first in the same rig session
    expect(exfilOf(tap('TAP-01')).every((e) => e.columns.join() === 'email')).toBe(true);
  });
});

describe('the baseline DB (juiceshop.sqlite)', () => {
  it('opens in sql.js, with the admin and an isActive column on Users', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(new URL('juiceshop.sqlite', dir)));
    expect(Number(db.exec('SELECT count(*) FROM Users')[0]!.values[0]![0])).toBeGreaterThan(0);
    const admins = db.exec("SELECT email FROM Users WHERE role = 'admin'")[0]!.values.map((v) => v[0]);
    expect(admins).toContain('admin@juice-sh.op');
    const columns = db.exec('PRAGMA table_info(Users)')[0]!.values.map((v) => v[1]);
    expect(columns).toContain('isActive');
  });

  it('has the 300 seeded customers (D-26), all at example.* addresses', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(new URL('juiceshop.sqlite', dir)));
    const seeded = db.exec("SELECT email FROM Users WHERE id > 25")[0]!.values.map((v) => String(v[0]));
    expect(seeded).toHaveLength(300);
    expect(seeded.every((e) => /@example\.(com|net|org)$/.test(e))).toBe(true);
  });
});

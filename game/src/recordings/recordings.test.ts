/// <reference types="node" />
// The committed recordings (D-15) and the baseline DB the game boots from.
import { readFileSync, readdirSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { isTestNet3, validateRecording, type AccessEvent, type DbEvent, type ExfilEvent, type FileEvent, type Recording } from './format';

const dir = new URL('./', import.meta.url);
const jsonFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));
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
    const moves = ['ATK-01', 'ATK-03', 'ATK-04', 'ATK-06', 'ATK-08', 'ATK-08.b', 'ATK-08.c', 'ATK-09', 'ATK-11', 'ATK-13', 'ATK-15', 'ATK-17', 'MIN-01', 'MIN-02'];
    expect(jsonFiles).toEqual(expect.arrayContaining(moves.map((m) => (m.includes('.') ? `${m}.json` : `${m}.a.json`))));
  });

  it.each(jsonFiles)('%s is valid D-15, named after its move and variant, with no rig address left', (file) => {
    const r = load(file);
    expect(validateRecording(r)).toEqual([]);
    expect(file).toBe(`${r.move}.${r.variant}.json`);
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

describe('ATK-08.b and ATK-08.c: the paced dumps (D-32)', () => {
  const leakedAll = async (r: Recording) => {
    const db = await baseline();
    const ids = db.exec('SELECT id FROM Users')[0]!.values.map((v) => Number(v[0])).sort();
    return [...new Set(exfilOf(r).flatMap((e) => e.keys))].sort().join() === ids.join();
  };

  it('ATK-08.b (low and slow) dumps every customer over 2 to 3 minutes', async () => {
    const r = load('ATK-08.b.json');
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

describe('ATK-09.a: the user list through the API', () => {
  const r = load('ATK-09.a.json');

  it('is one request that leaks every live user\'s email, but no password hash', async () => {
    expect(accessOf(r)).toHaveLength(1);
    const db = await baseline();
    const live = db.exec('SELECT id FROM Users WHERE deletedAt IS NULL')[0]!.values.map((v) => Number(v[0]));
    const leaked = exfilOf(r).flatMap((e) => e.keys);
    expect([...leaked].sort()).toEqual([...live].sort());
    expect(exfilOf(r).every((e) => e.columns.join() === 'email')).toBe(true);
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

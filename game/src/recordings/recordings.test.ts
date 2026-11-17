/// <reference types="node" />
// The committed recordings (D-15) and the baseline DB the game boots from.
import { readFileSync, readdirSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { isTestNet3, validateRecording, type AccessEvent, type Recording } from './format';

const dir = new URL('./', import.meta.url);
const jsonFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));
const raw = (file: string) => readFileSync(new URL(file, dir), 'utf8');
const load = (file: string) => JSON.parse(raw(file)) as Recording;
const accessOf = (r: Recording) => r.events.filter((e): e is AccessEvent => e.kind === 'access');

describe('every committed recording', () => {
  it('exists', () => {
    expect(jsonFiles).toEqual(expect.arrayContaining(['ATK-03.a.json', 'ATK-08.a.json']));
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

  it('is about a hundred sqlmap search requests', () => {
    const access = accessOf(r);
    expect(access.length).toBeGreaterThanOrEqual(100);
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
});

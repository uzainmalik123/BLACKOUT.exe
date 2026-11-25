import { describe, expect, it } from 'vitest';
import { plain } from './markdown';
import { LOG_LABELS, adminsView, cutLogLine, part, playbookView, readingSentence, systemView, trafficView } from './views';

describe('screen 3: the files as pictures, read from the files themselves (CON-01, D-182)', () => {
  it('the system map has its six parts, two logs, seven public doors and the hourly backups', () => {
    const v = systemView();
    expect(v.parts.map((p) => p.name)).toEqual(['Web server', 'The shop', 'Database', 'Customer uploads', 'Firewall', 'Web application firewall']);
    expect(plain(part(v, 'Database')!.where)).toBe('/srv/juice-shop/data/juiceshop.sqlite');
    expect(plain(part(v, 'Firewall')!.notes)).toMatch(/no addresses blocked/);
    expect(v.logs.map((l) => l.path)).toEqual(['/var/log/nginx/access.log', '/var/log/juice-shop/app.log']);
    expect(v.doors).toHaveLength(7);
    expect(v.doors.find((d) => d.feature === 'Login')!.off).toBe('(always on)');
    expect(plain(v.backups)).toMatch(/every hour/);
    expect(plain(v.lead)).toMatch(/only defender/);
  });

  it('the admin list has the eight admins, five other special roles, 312 customers and the rule', () => {
    const v = adminsView();
    expect(v.admins).toHaveLength(8);
    expect(v.admins[0]).toEqual({ email: 'admin@juice-sh.op', who: 'The shared shop administrator account' });
    expect(v.others).toHaveLength(5);
    expect(v.others.map((o) => o.role)).toContain('Accounting');
    expect(v.customers).toBe(312);
    expect(plain(v.rule)).toMatch(/not created by us/);
    expect(v.weaknesses).toHaveLength(2);
  });

  it('the sample log line cuts into the seven fields the file names, in its order', () => {
    const v = trafficView();
    expect(v.pieces.map((p) => p.label)).toEqual([...LOG_LABELS]);
    expect(v.pieces[0]!.text).toBe('198.51.100.23');
    expect(v.pieces[3]!.text).toBe('200');
    expect(v.pieces[2]!.text).toMatch(/^GET \/rest\/products\/search/);
    const sentence = readingSentence();
    for (const label of LOG_LABELS) expect(sentence, label).toContain(label);
    expect(cutLogLine('not a log line')).toEqual([]);
  });

  it('the normal-traffic board has every signal with its normal and its worth-a-look', () => {
    const v = trafficView();
    expect(v.signals.map((s) => s.signal)).toEqual(['Status codes', 'Search queries', 'Logins', 'User agents', 'App log', 'New accounts', 'Uploads']);
    for (const s of v.signals) {
      expect(plain(s.normal).length).toBeGreaterThan(3);
      expect(plain(s.watch).length).toBeGreaterThan(3);
    }
    expect(plain(v.noise)).toMatch(/bots/);
  });

  it('the playbook is six numbered steps with their aims and points, and a 72-hour legal clock', () => {
    const v = playbookView();
    expect(v.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(v.steps.map((s) => s.title)).toEqual(['Preparation', 'Identification', 'Containment', 'Eradication', 'Recovery', 'Lessons learned']);
    expect(v.steps[0]!.aim).toMatch(/doing it now/);
    expect(v.steps[2]!.points.map(plain).join(' ')).toMatch(/Snapshot the evidence/);
    for (const s of v.steps) expect(s.points.length, s.title).toBeGreaterThan(0);
    expect(v.hours).toBe(72);
  });
});

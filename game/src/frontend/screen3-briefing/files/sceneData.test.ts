import { describe, expect, it } from 'vitest';
import { ADMINS, ARCHIVE, FIELDS, GATES, LANES, LEGAL, LOGIN, PLACE_FACTS, PLACES, SAMPLE, SPECIAL, initials, seedOf, suspects } from './sceneData';

describe('the four briefing places keep every fact of the files (D-222)', () => {
  it('names four places with Kiro\'s line for each, as the brief words them', () => {
    expect(PLACES['system-map'].caption).toBe('Seven doors. Six can close. Login never does.');
    expect(PLACES.admins.caption).toBe("Know who belongs. Fear whoever doesn't.");
    expect(PLACES['normal-traffic'].caption).toBe("Every visitor leaves footprints. Find the ones that don't belong.");
    expect(PLACES.playbook.caption).toBe('Evidence first. Panic later. One missed backdoor brings him back.');
  });

  it('the Chart Room: every part, log, door and the backups, with their exact values', () => {
    const ids = PLACE_FACTS.map((p) => p.id);
    for (const id of ['Web server', 'The shop', 'Database', 'Customer uploads', 'Firewall', 'Web application firewall', 'Access log', 'App log', 'Login', 'Product search', 'Backups']) expect(ids).toContain(id);
    expect(PLACE_FACTS.find((p) => p.id === 'Database')!.lines.join(' ')).toMatch(/\/srv\/juice-shop\/data\/juiceshop\.sqlite.*312 customers, 56 products/);
    expect(PLACE_FACTS.find((p) => p.id === 'Login')!.lines).toEqual(['/rest/user/login', 'Cannot be switched off']);
    expect(PLACE_FACTS.filter((p) => p.lines.some((l) => /^Switched off in/.test(l))).length).toBe(6);
    expect(LOGIN).toBe('Login');
  });

  it('the Identity Archive: all eight admins and five other roles, the rule, the customers and both weaknesses', () => {
    expect(ADMINS.length).toBe(8);
    expect(SPECIAL.length).toBe(5);
    expect(ADMINS[0]).toMatchObject({ email: 'admin@juice-sh.op', role: 'The shared shop administrator account', kind: 'admin', initials: 'AD' });
    expect(SPECIAL.find((d) => d.email === 'ciso@juice-sh.op')?.role).toBe('Deluxe (security officer)');
    expect(ARCHIVE.rule).toMatch(/not created by us/);
    expect(ARCHIVE.customers).toBe(312);
    expect(ARCHIVE.weaknesses.length).toBe(2);
    expect(initials('bjoern.kimminich@gmail.com')).toBe('BK');
    expect(initials('cloud-admin@juice-sh.op')).toBe('CA');
    expect(seedOf('a')).toBe(seedOf('a'));
    expect(seedOf('a')).not.toBe(seedOf('b'));
  });

  it('the Evidence Observatory: every signal as a pair of lanes, the sample line in its seven fields', () => {
    expect(LANES.map((l) => l.signal)).toEqual(['Status codes', 'Search queries', 'Logins', 'User agents', 'App log', 'New accounts', 'Uploads']);
    expect(LANES.find((l) => l.signal === 'User agents')!.watch).toMatch(/sqlmap/);
    expect(FIELDS.length).toBe(7);
    expect(FIELDS[0]).toEqual({ label: 'who', text: '198.51.100.23' });
    expect(SAMPLE.noise).toMatch(/wp-admin/);
  });

  it('Spot the intruder: three events from the file\'s own line and words, exactly one deserving a look', () => {
    const s = suspects();
    expect(s.length).toBe(3);
    expect(s.filter((x) => x.intruder).length).toBe(1);
    const bad = s.find((x) => x.intruder)!;
    expect(bad.line).toMatch(/search\?q='\)\)\+UNION\+SELECT\+…--/);
    for (const x of s) expect(x.line.startsWith('198.51.100.23 - - [21/Nov/2026:02:14:07 +0000] "GET /rest/products/search?q=')).toBe(true);
    expect(s.filter((x) => !x.intruder).map((x) => x.line)).toEqual([expect.stringContaining('q=juice '), expect.stringContaining('q=banana ')]);
  });

  it('the Six Gates: six steps in order with every point verbatim, and a remark at each', () => {
    expect(GATES.map((g) => g.title)).toEqual(['Preparation', 'Identification', 'Containment', 'Eradication', 'Recovery', 'Lessons learned']);
    expect(GATES[2]!.points[0]).toBe("Snapshot the evidence before you change anything. Once you delete or restore, it's gone.");
    expect(GATES[3]!.points.some((p) => /Find all of them before you declare victory/.test(p))).toBe(true);
    for (const g of GATES) {
      expect(g.points.length, g.title).toBeGreaterThan(0);
      expect(g.remark.length, g.title).toBeGreaterThan(10);
    }
  });

  it('the legal plinth keeps the file\'s sentence and tells Article 33 (the authority, 72 hours) from Article 34 (the people, when the risk is high)', () => {
    expect(LEGAL.file).toMatch(/within 72 hours/);
    expect(LEGAL.hours).toBe(72);
    expect(LEGAL.regulator).toMatch(/Article 33.*supervisory authority.*72 hours/);
    expect(LEGAL.people).toMatch(/Article 34.*high risk/);
    expect(LEGAL.people).not.toMatch(/72/);
  });
});

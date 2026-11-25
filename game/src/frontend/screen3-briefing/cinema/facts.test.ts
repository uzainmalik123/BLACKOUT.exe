import { describe, expect, it } from 'vitest';
import { DOORS, EVIDENCE, FACTS, QUIZ, SUSPICIOUS, quizScore } from './facts';

describe('screen 3: every fact in the cinematic comes from the files (D-189)', () => {
  it('the shop: 312 customers, 56 products, the four parts in order', () => {
    expect(FACTS.customers).toBe(312);
    expect(FACTS.products).toBe(56);
    expect(FACTS.parts.map((p) => p.id)).toEqual(['customers', 'web', 'app', 'db']);
    expect(FACTS.parts[1]!.sub).toMatch(/nginx/);
    expect(FACTS.parts[3]!.sub).toMatch(/juiceshop\.sqlite$/);
  });

  it('seven doors, six that can close, Login that never does', () => {
    expect(DOORS.length).toBe(7);
    expect(FACTS.closable).toBe(6);
    expect(FACTS.alwaysOpen).toEqual(['Login']);
    expect(DOORS.find((d) => d.feature === 'Login')?.address).toBe('/rest/user/login');
  });

  it('the defences as the file has them, and the backups with their trade-off', () => {
    expect(FACTS.firewall.state).toBe('Empty tonight: no addresses blocked');
    expect(FACTS.waf.state).toBe('No rules switched on');
    expect(FACTS.backups).toMatch(/every hour/);
    expect(FACTS.backups).toMatch(/good and bad/);
  });

  it('the logs, the normal line, and the crimson evidence made only of the file\'s own tokens', () => {
    expect(FACTS.logs.map((l) => l.path)).toEqual(['/var/log/nginx/access.log', '/var/log/juice-shop/app.log']);
    expect(FACTS.normalLine).toMatch(/^198\.51\.100\.23 /);
    expect(EVIDENCE.map((e) => e.signal)).toEqual(['Status codes', 'Search queries', 'User agents', 'App log']);
    expect(SUSPICIOUS.map((s) => s.text)).toEqual([
      "GET /rest/products/search?q=' UNION SELECT --",
      'POST /rest/user/login → 401',
      'User-Agent: sqlmap · Fuzz Faster U Fool',
      '/var/log/juice-shop/app.log: SQLITE_ERROR',
    ]);
  });

  it('eight admins, the rule about anyone else, six steps, and legal\'s 72 hours with "as soon as you\'re sure"', () => {
    expect(FACTS.admins.length).toBe(8);
    expect(FACTS.rule).toMatch(/not created by us/);
    expect(FACTS.steps).toEqual(['Preparation', 'Identification', 'Containment', 'Eradication', 'Recovery', 'Lessons learned']);
    expect(FACTS.hours).toBe(72);
    expect(FACTS.legal).toMatch(/as soon as you're sure/);
  });
});

describe('screen 3: the optional quick check keeps the three questions', () => {
  it('asks the unknown admin, the first move and legal\'s deadline, each answered by the files', () => {
    expect(QUIZ.map((q) => q.id)).toEqual(['admin', 'first', 'legal']);
    expect(QUIZ[0]!.options[QUIZ[0]!.answer]).toMatch(/already inside/);
    expect(QUIZ[1]!.options[QUIZ[1]!.answer]).toBe('Snapshot the evidence');
    expect(QUIZ[1]!.reveal).toMatch(/^Snapshot the evidence before you change anything/);
    expect(QUIZ[2]!.options[QUIZ[2]!.answer]).toBe('72 hours');
    expect(QUIZ[2]!.reveal).toMatch(/72 hours/);
  });

  it('scores the answers', () => {
    expect(quizScore({})).toEqual({ right: 0, of: 3 });
    expect(quizScore({ admin: 1, first: 1, legal: 0 })).toEqual({ right: 2, of: 3 });
  });
});

/// <reference types="node" />
// Task 20.1 (R15.7): the Shell has no source of randomness or real time of its own.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFixture } from './test-fixtures/fixture';
import { shellSources } from './test-fixtures/source-scan';

const FORBIDDEN: [string, RegExp][] = [
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date() with no argument', /\bnew\s+Date\s*\(\s*\)/],
  ['performance.now', /\bperformance\s*\.\s*now\b/],
  ['getRandomValues', /\bgetRandomValues\b/],
  ['randomUUID', /\brandomUUID\b/],
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['process.hrtime', /\bhrtime\b/],
];

describe('Shell source: no nondeterminism (R15.7)', () => {
  it('uses none of the forbidden APIs', () => {
    const bad: string[] = [];
    for (const { rel, code } of shellSources()) {
      for (const [label, re] of FORBIDDEN) if (re.test(code)) bad.push(`${rel}: ${label}`);
    }
    expect(bad).toEqual([]);
  });
});

const throws = (name: string) => () => {
  throw new Error(`${name} was called by the Shell`);
};

// No date, no history, no locked-account deletedAt (R15.6).
const SESSION = [
  'ls /var/log/nginx',
  'grep -c 200 /var/log/nginx/access.log',
  'cat /var/log/juice-shop/app.log | head -5',
  'sqlite3 /srv/juice-shop/data/juiceshop.sqlite "SELECT id, email FROM Users ORDER BY id LIMIT 3"',
  'ls -l /srv/juice-shop/uploads/complaints',
  'sha256sum /srv/juice-shop/uploads/complaints/rip.php',
  'whois 203.0.113.9',
  'ping -c 2 203.0.113.9',
  'nmap 203.0.113.9',
  'curl -I 203.0.113.9',
  'iptables -A INPUT -s 203.0.113.9 -j DROP',
  'iptables -L',
  'ss -tln',
  'tar czf /evidence/snap.tgz /var/log/nginx',
  'ls /evidence',
  'systemctl status nginx',
  'rm /srv/juice-shop/uploads/complaints/rip.php',
  'echo-not-a-command',
];

describe('Shell runtime: seeded determinism with the platform RNG removed (R15.7)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives identical outputs on two Engines with the same seed, with random sources throwing', { timeout: 60_000 }, async () => {
    const opts = {
      seed: 11,
      advanceMs: 90_000,
      plant: [{ path: 'complaints/rip.php', content: '<?php system($_GET[0]);' }],
    };
    const a = makeFixture(opts);
    const b = makeFixture(opts);

    vi.spyOn(Math, 'random').mockImplementation(throws('Math.random'));
    vi.spyOn(Date, 'now').mockImplementation(throws('Date.now'));
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(throws('crypto.getRandomValues'));

    const outA: unknown[] = [];
    const outB: unknown[] = [];
    for (const line of SESSION) {
      outA.push(await a.shell.run(line));
      outB.push(await b.shell.run(line));
    }
    expect(outA).toEqual(outB);
    expect(outA.filter((r) => (r as { output: string }).output !== '').length).toBeGreaterThan(SESSION.length / 2);
    expect(a.internalErrors).toEqual([]);
    expect(b.internalErrors).toEqual([]);
  });
});

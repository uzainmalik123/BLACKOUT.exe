// Feature: shell, Property 25: Determinism and no randomness
// **Validates: Requirements 12.1, 15.6, 15.7**
// Not mocked here: fast-check seeds itself from Date.now and Math.random, so a throwing stub would break the runner.
// determinism-source.test.ts scans the sources and runs a fixed session with those functions throwing.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeFixture, type Fixture } from './test-fixtures/fixture';
import type { RunResult } from './types';

const LOG = '/var/log/nginx/access.log';
const APP = '/var/log/juice-shop/app.log';
const UP = '/srv/juice-shop/uploads';
const DB = '/srv/juice-shop/data/juiceshop.sqlite';

const arbIp = fc.tuple(fc.integer({ min: 1, max: 223 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 1, max: 254 })).map((p) => p.join('.'));
const arbFile = fc.constantFrom(LOG, APP, `${UP}/a.php`, `${UP}/d/b.txt`, '/etc/hostname', `${UP}/nope`);

/** Read-only and investigation lines. No `date`, no `history`, nothing that prints a locked account's deletedAt (KI-91). */
const arbReadLine: fc.Arbitrary<string> = fc.oneof(
  arbFile.chain((f) => fc.constantFrom(`cat ${f}`, `head -n 3 ${f}`, `tail -n 2 ${f}`, `wc -l ${f}`, `file ${f}`, `sha256sum ${f}`, `ls -l ${f}`)),
  fc.constantFrom(`grep GET ${LOG}`, `grep -c 200 ${LOG}`, `cat ${LOG} | sort | uniq -c`, `awk '{print $1}' ${LOG} | sort | uniq -c`, `cut -d' ' -f1 ${LOG} | head -n 4`),
  fc.constantFrom('ls', 'ls -la /', `ls ${UP}`, `ls ${UP}/d`, 'ls /tmp', 'ls /evidence', 'pwd', 'cd /tmp', 'cd /', `cd ${UP}`, 'ss -tln', 'iptables -L', 'systemctl status nginx', 'help', 'man ls', 'man grep', 'ls /nowhere', 'nosuchcmd x', 'cat | wc'),
  fc.constantFrom('SELECT 1', 'SELECT count(*) FROM Users', '.tables').map((q) => `sqlite3 ${DB} "${q}"`),
  arbIp.chain((ip) => fc.constantFrom(`whois ${ip}`, `ping -c 2 ${ip}`, `nmap ${ip}`, `curl -I ${ip}`)),
);

/** Lines that write to /tmp, mixed with reads. */
const arbWriteLine: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('a', 'b', 'c').chain((n) => fc.constantFrom(`mkdir /tmp/${n}`, `cp ${UP}/a.php /tmp/${n}`, `cat ${LOG} | head -n 2 > /tmp/${n}`, `rm /tmp/${n}`, `cat /tmp/${n}`, `ls /tmp`, `tar czf /tmp/${n}.tgz ${UP}`, `wc -l /tmp/${n}`)),
  arbReadLine,
);

const arbSeed = fc.integer({ min: 1, max: 1_000_000 });
const arbAdvance = fc.constantFrom(0, 30_000, 120_000);

const make = (seed: number, advanceMs: number): Fixture =>
  makeFixture({
    seed,
    baseline: false,
    advanceMs,
    plant: [
      { path: 'a.php', content: 'x\ny' },
      { path: 'd/b.txt', content: 'q' },
    ],
  });

const same = (a: RunResult, b: RunResult): void => {
  expect(a.output).toBe(b.output);
  expect(a.exitCode).toBe(b.exitCode);
  expect(a.clear).toBe(b.clear);
};

describe('Property 25: determinism and no randomness', () => {
  it('`date` prints the same text for the same game time and different text for different game times', async () => {
    const a = make(7, 30_000);
    const b = make(7, 30_000);
    const da = await a.shell.run('date');
    expect(da.exitCode).toBe(0);
    expect(da.output).not.toBe('');
    same(da, await b.shell.run('date'));
    same(da, await a.shell.run('date')); // real time passing between calls does not matter

    a.engine.advance(120_000);
    const later = await a.shell.run('date');
    expect(later.output).not.toBe(da.output);
    b.engine.advance(120_000);
    same(later, await b.shell.run('date'));
    expect(a.internalErrors).toEqual([]);
  }, 30_000);

  it('a line gives the same result on two same-seed Engines after the same prior lines, and twice in a row', async () => {
    await fc.assert(
      fc.asyncProperty(arbSeed, arbAdvance, fc.array(arbReadLine, { maxLength: 3 }), arbReadLine, async (seed, adv, prior, line) => {
        const a = make(seed, adv);
        const b = make(seed, adv);
        for (const p of prior) same(await a.shell.run(p), await b.shell.run(p));
        const ra = await a.shell.run(line);
        const rb = await b.shell.run(line);
        same(ra, rb);
        expect(a.internalErrors).toEqual([]);

        // A read-only line has no effect, so the same line again gives the same result.
        same(await a.shell.run(line), ra);
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('two same-seed shells give equal output sequences for lines including writes to /tmp', async () => {
    await fc.assert(
      fc.asyncProperty(arbSeed, arbAdvance, fc.array(arbWriteLine, { minLength: 1, maxLength: 8 }), async (seed, adv, lines) => {
        const a = make(seed, adv);
        const b = make(seed, adv);
        for (const l of lines) same(await a.shell.run(l), await b.shell.run(l));
        expect(a.internalErrors).toEqual([]);
        expect(b.internalErrors).toEqual([]);
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});

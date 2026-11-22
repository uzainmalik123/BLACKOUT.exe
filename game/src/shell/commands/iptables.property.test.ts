// Feature: shell, Property 19: `iptables` add then delete is the identity on the listing
// **Validates: Requirements 9.3, 9.4, 9.5, 9.7**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const arbIp = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map((o) => o.join('.'));
const arbBlockedAndNew = fc
  .tuple(fc.uniqueArray(arbIp, { maxLength: 6 }), arbIp)
  .filter(([blocked, ip]) => !blocked.includes(ip));

const TIMEOUT_MS = 30_000;

describe('Property 19: iptables add then delete', () => {
  it(
    'add then delete leaves the listing unchanged; -L lists the Engine order and sends no action; ok:false prints its message only',
    async () => {
      await fc.assert(
        fc.asyncProperty(arbBlockedAndNew, async ([blocked, ip]) => {
          const { shell, engine } = makeFixture({ baseline: false });
          for (const b of blocked) expect((await shell.run(`iptables -A INPUT -s ${b} -j DROP`)).exitCode).toBe(0);
          const act = vi.spyOn(engine, 'act');

          const before = await shell.run('iptables -L');
          expect(act).not.toHaveBeenCalled();
          const expected = ['Chain INPUT (policy ACCEPT)', ...engine.world.firewall.blocked.map((b) => `DROP       all  --  ${b}  anywhere`)];
          expect(before.output).toBe(expected.join('\n'));
          expect(engine.world.firewall.blocked).toEqual(blocked);

          expect((await shell.run(`iptables -A INPUT -s ${ip} -j DROP`)).exitCode).toBe(0);
          expect((await shell.run('iptables -L')).output).toContain(ip);
          expect((await shell.run(`iptables -D INPUT -s ${ip} -j DROP`)).exitCode).toBe(0);
          expect((await shell.run('iptables -L')).output).toBe(before.output);

          // ok:false: deleting an unblocked address, then adding an already blocked one.
          const del = await shell.run(`iptables -D INPUT -s ${ip} -j DROP`);
          expect(del.exitCode).not.toBe(0);
          expect(del.output).toBe(`${ip} is not blocked`);
          expect((await shell.run('iptables -L')).output).toBe(before.output);
          if (blocked.length > 0) {
            const dup = await shell.run(`iptables -A INPUT -s ${blocked[0]} -j DROP`);
            expect(dup.exitCode).not.toBe(0);
            expect(dup.output).toBe(`${blocked[0]} is already blocked`);
            expect((await shell.run('iptables -L')).output).toBe(before.output);
          }
        }),
        { numRuns: 100 },
      );
    },
    TIMEOUT_MS,
  );
});

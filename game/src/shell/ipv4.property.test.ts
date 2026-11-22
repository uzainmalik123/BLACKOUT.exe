// Feature: shell, Property 20: Network and firewall targets are validated once and consistently
// **Validates: Requirements 6.3, 6.4, 6.5, 6.8, 9.1, 9.2, 9.6**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { isIPv4 } from './netdata';
import { makeFixture } from './test-fixtures/fixture';

const octet = fc.oneof(
  fc.integer({ min: 0, max: 255 }).map(String),
  fc.integer({ min: 0, max: 999 }).map(String), // out of range
  fc.integer({ min: 0, max: 99 }).map((n) => `0${n}`), // leading zero
  fc.constantFrom('', ' ', 'a', '-1', '1e2', '0x1', '٣'),
);
const arbIPv4 = fc.tuple(octet, octet, octet, octet).map((o) => o.join('.'));
const arbDots = fc.array(octet, { minLength: 0, maxLength: 6 }).map((o) => o.join('.')); // missing or extra octets
const arbPadded = fc.tuple(fc.constantFrom('', ' ', '\t', '\n'), arbIPv4, fc.constantFrom('', ' ', '\t', '\n', '.'));
const arbHostname = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}(\.[a-z]{2,5}){0,2}$/);
const arbWild = fc.string({ maxLength: 20 });
const arbTarget = fc.oneof(
  { weight: 4, arbitrary: arbIPv4 },
  { weight: 2, arbitrary: arbDots },
  { weight: 2, arbitrary: arbPadded.map((p) => p.join('')) },
  { weight: 1, arbitrary: arbHostname },
  { weight: 1, arbitrary: arbWild },
);

describe('Property 20: isIPv4 agrees with the Engine and the iptables handler', () => {
  it('isIPv4(s) equals "DEF-06 add does not answer `is not an IPv4 address`", and iptables sends DEF-06 exactly then', async () => {
    const { shell, engine } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    await fc.assert(
      fc.asyncProperty(arbTarget, async (s) => {
        act.mockClear();
        const direct = await engine.act({ type: 'DEF-06', op: 'add', ip: s });
        const engineAccepts = direct.ok || direct.message !== `${s} is not an IPv4 address`;
        expect(isIPv4(s)).toBe(engineAccepts);
        if (direct.ok) await engine.act({ type: 'DEF-06', op: 'delete', ip: s });

        // Through the shell. A single quote cannot be written inside single quotes, so such strings are skipped.
        if (s.includes("'")) return;
        act.mockClear();
        await shell.run(`iptables -A INPUT -s '${s}' -j DROP`);
        const sent = act.mock.calls.filter(([a]) => a.type === 'DEF-06');
        expect(sent.length).toBe(isIPv4(s) ? 1 : 0);
        if (isIPv4(s)) await engine.act({ type: 'DEF-06', op: 'delete', ip: s });
      }),
      { numRuns: 200 },
    );
  }, 30_000);
});

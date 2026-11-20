// SYS-17's property-based tests (fast-check): random sequences of player actions never crash the engine,
// never make souls go back up, and never leave heartbeat outside 0–100.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FEATURES, type PlayerAction, type WafRule } from '../rules/vocabulary';
import { applyAction } from './actions';
import { advance } from './advance';
import { EMPTY_LIBRARY, type RecordingLibrary } from './library';
import { SEED_ACCOUNTS } from './seed';
import { soulsStolen } from './souls';
import { initialWorld } from './state';

const ips = ['203.0.113.23', '203.0.113.81', '203.0.113.100', '203.0.113.200', '10.0.0.1', 'nope'];
const emails = [...SEED_ACCOUNTS.map((a) => a.email), 'death@juice-sh.op', 'support-ops@juice-sh.op', 'nobody@juice-sh.op'];
const paths = ['complaints/invoice.zip', 'READ_ME_MORTAL.txt', 'nope.txt'];
const patches = ['login', 'registration', 'search', 'basket-ownership', 'change-password', 'token-verify', 'product-update'] as const;
const rules: WafRule[] = [
  { kind: 'sqli' }, { kind: 'block-user-agent', pattern: 'sqlmap' }, { kind: 'block-user-agent', pattern: 'scanner' },
  { kind: 'block-path', method: 'PUT', path: '/api/Products' }, { kind: 'rate-limit', path: '/api/*' }, { kind: 'rate-limit', path: '/rest/user/login' },
];

/** Every DEF type with targets from small pools, so unknown targets and repeats happen often. */
export const arbAction: fc.Arbitrary<PlayerAction> = fc.oneof(
  fc.record({ type: fc.constant('DEF-01' as const), query: fc.string() }),
  fc.record({ type: fc.constant('DEF-02' as const), sql: fc.string() }),
  fc.record({ type: fc.constant('DEF-03' as const), path: fc.constantFrom(...paths) }),
  fc.record({ type: fc.constant('DEF-04' as const), ip: fc.constantFrom(...ips), mode: fc.constantFrom('passive' as const, 'active' as const) }),
  fc.record({ type: fc.constant('DEF-05' as const), name: fc.constantFrom('a', 'b', 'c') }),
  fc.record({ type: fc.constant('DEF-06' as const), ip: fc.constantFrom(...ips), op: fc.constantFrom('add' as const, 'delete' as const) }),
  fc.constant({ type: 'DEF-07' as const }),
  fc.record({ type: fc.constant('DEF-08' as const), email: fc.constantFrom(...emails) }),
  fc.constant({ type: 'DEF-09' as const }),
  fc.record({ type: fc.constant('DEF-10' as const), feature: fc.constantFrom(...FEATURES), enabled: fc.boolean() }),
  fc.constant({ type: 'DEF-11' as const }),
  fc.record({ type: fc.constant('DEF-12' as const), rule: fc.constantFrom(...rules) }),
  fc.record({ type: fc.constant('DEF-13' as const), patch: fc.constantFrom(...patches) }),
  fc.record({ type: fc.constant('DEF-14' as const), email: fc.constantFrom(...emails) }),
  fc.record({ type: fc.constant('DEF-15' as const), path: fc.constantFrom(...paths) }),
  fc.record({ type: fc.constant('DEF-16' as const), email: fc.constantFrom(...emails) }),
  fc.record({ type: fc.constant('DEF-17' as const), backupId: fc.integer({ min: 0, max: 5 }) }),
  fc.record({ type: fc.constant('DEF-18' as const), what: fc.constantFrom('nginx' as const, ...FEATURES) }),
  fc.constant({ type: 'DEF-19' as const }),
  fc.record({ type: fc.constant('DEF-20' as const), to: fc.constantFrom('legal' as const, 'customers' as const) }),
);

const arbScript = fc.array(fc.tuple(arbAction, fc.integer({ min: 0, max: 5000 })), { maxLength: 60 });

export function checkEngineInvariants(library: RecordingLibrary, numRuns: number): void {
  fc.assert(
    fc.property(fc.integer(), arbScript, (seed, steps) => {
      const w = initialWorld(seed, 'medium');
      let stolen = 0;
      for (const [a, realMs] of steps) {
        applyAction(w, a);
        advance(w, library, realMs);
        expect(soulsStolen(w)).toBeGreaterThanOrEqual(stolen);
        stolen = soulsStolen(w);
        expect(w.heartbeat).toBeGreaterThanOrEqual(0);
        expect(w.heartbeat).toBeLessThanOrEqual(100);
      }
      expect(JSON.parse(JSON.stringify(w))).toEqual(w);
    }),
    { numRuns },
  );
}

describe('engine invariants under random play (SYS-17)', () => {
  it('never throws, never gives souls back, never leaves heartbeat outside 0–100, stays JSON-plain (no recordings)', () => {
    checkEngineInvariants(EMPTY_LIBRARY, 300);
  });

  it('two runs with the same seed and script produce identical event logs', () => {
    fc.assert(
      fc.property(fc.integer(), arbScript, (seed, steps) => {
        const run = () => {
          const w = initialWorld(seed, 'medium');
          for (const [a, realMs] of steps) {
            applyAction(w, a);
            advance(w, EMPTY_LIBRARY, realMs);
          }
          return w.events;
        };
        expect(run()).toEqual(run());
      }),
      { numRuns: 50 },
    );
  });
});

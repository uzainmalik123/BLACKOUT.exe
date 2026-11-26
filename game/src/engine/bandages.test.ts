// SYS-23, D-231: a WAF rule or the rate limit is a bandage. An untried rule is attempted and cuts the move; after the
// level's breathers the move's quiet variants slip it; loud ones never do; a move with no quiet recording stays stopped.
// The SQLi rule set's false positives: a shopper's quoted search answers 403 and costs the shop.
import { describe, expect, it } from 'vitest';
import type { AccessEvent, RecEvent } from '../recordings/format';
import { MOVE_BY_ID } from '../rules/moves';
import type { Difficulty, MoveId } from '../rules/vocabulary';
import { applyAction } from './actions';
import { advance } from './advance';
import { anyEvaded, bandage, evaded, stepBandages, tried } from './bandages';
import { CONFIG } from './config';
import { stepCustomers } from './customers';
import { directorTick, playableVariants } from './director';
import { found } from './doors';
import { stopperHolds } from './facts';
import { integrateHeartbeat } from './heartbeat';
import { libraryFrom } from './library';
import { eventsOfKind } from './log';
import { initialWorld, type World } from './state';
import { committedLibrary } from './test-fixtures/committed';
import { lab } from './test-fixtures/lab';
import { FIXTURE_LIBRARY, fakeRecording } from './test-fixtures/recordings';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_S = 30_000;
const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];
const real = committedLibrary();
const only = (lib: typeof real, ids: string[]) => libraryFrom(ids.flatMap((m) => lib.variantsOf(m as MoveId).map((v) => v.recording)));
const sqli = { kind: 'sqli' } as const;

/** A world where the scan has landed and the search door is the only move left, with a rule already on. */
function readyToHarvest(level: Difficulty): World {
  const w = lab(initialWorld(1, level));
  w.death.knowledge.push('map');
  w.death.played.push({ move: 'ATK-01', variant: 'a', outcome: 'landed' });
  w.nextWaveAt = { 'MIN-01': Infinity, 'MIN-02': Infinity, 'MIN-03': Infinity, 'MIN-04': Infinity };
  w.taps.nextAt = Infinity;
  return w;
}

describe('a WAF rule is attempted, cuts, and is evaded (D-231)', () => {
  for (const level of LEVELS) {
    it(`${level}: the SQLi rule set before the first visit: the visit is attempted, frozen, cut by DEF-12, the door counts found, and after ${CONFIG[level].bandage.breathers} longest breather(s) the quiet half plays through it`, () => {
      const lib = only(FIXTURE_LIBRARY, ['ATK-01', 'ATK-08']);
      const w = readyToHarvest(level);
      applyAction(w, { type: 'DEF-12', rule: sqli });
      directorTick(w, lib);
      const started = eventsOfKind(w, 'move-started');
      expect(started).toMatchObject([{ move: 'ATK-08' }]); // attempted
      expect(['d', 'e', 'f', 'g']).toContain(started[0]!.variant);
      advance(w, lib, CONFIG[level].doors.pauseGraceGameMs / 30 + 200); // frozen for the grace, then cut
      expect(eventsOfKind(w, 'move-cut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-12' }]);
      expect(w.logs.access.filter((l) => l.by === 'ATK-08')).toEqual([]); // not a line got through
      expect(found(w, 'ATK-08')).toBe(true);
      expect(w.bandages).toMatchObject([{ move: 'ATK-08', rule: sqli }]);
      expect(tried(w, 'ATK-08', sqli)).toBe(true);
      expect(evaded(w, 'ATK-08', sqli)).toBe(false);
      expect(w.bandages[0]!.evadesAt - w.bandages[0]!.at).toBe(CONFIG[level].bandage.breathers * CONFIG[level].breatherGameMs.max);
      expect(playableVariants(w, lib, MOVE_BY_ID['ATK-08'])).toEqual([]); // tried: not picked again until the breathers are over
      w.clock.gameMs = w.bandages[0]!.evadesAt;
      w.death.nextMoveAt = 0;
      advance(w, lib, 100);
      expect(eventsOfKind(w, 'rule-evaded')).toMatchObject([{ move: 'ATK-08', rule: sqli }]);
      expect(playableVariants(w, lib, MOVE_BY_ID['ATK-08']).map((v) => v.variant)).toEqual(['d', 'e']); // the quiet halves, on Hard too
      directorTick(w, lib);
      advance(w, lib, 5000);
      expect(w.logs.access.filter((l) => l.by === 'ATK-08').length).toBeGreaterThan(0); // through the rule
      expect(eventsOfKind(w, 'move-cut')).toHaveLength(1);
    });
  }

  it('loud variants stay stopped by an evaded rule; another rule needs its own bandage; a rule never tried is not evaded', () => {
    const w = lab(initialWorld(1, 'medium'));
    w.waf.push({ kind: 'sqli' }, { kind: 'block-path', method: 'PUT', path: '/api/Products' });
    bandage(w, 'ATK-08', sqli);
    bandage(w, 'ATK-08', sqli); // once
    expect(w.bandages).toHaveLength(1);
    w.clock.gameMs = w.bandages[0]!.evadesAt;
    const quiet = { ip: 'x', quiet: true, targets: [], move: 'ATK-08', variant: 'd' };
    const loud = { ...quiet, quiet: false, variant: 'f' };
    expect(stopperHolds(w, { action: 'DEF-12', rule: sqli }, quiet)).toBe(false);
    expect(stopperHolds(w, { action: 'DEF-12', rule: sqli }, loud)).toBe(true);
    expect(anyEvaded(w, 'ATK-08')).toBe(true);
    expect(anyEvaded(w, 'ATK-17')).toBe(false);
    expect(stopperHolds(w, { action: 'DEF-12', rule: { kind: 'block-path', method: 'PUT', path: '/api/Products' } }, { ...quiet, move: 'ATK-17', variant: 'c' })).toBe(true); // a different rule, never tried
  });

  it('the login rate limit is a bandage too: it cuts the password guessing, and a quiet variant slips it once evaded', () => {
    const lib = only(FIXTURE_LIBRARY, ['ATK-01', 'ATK-04']);
    const w = readyToHarvest('medium');
    applyAction(w, { type: 'DEF-07' });
    directorTick(w, lib);
    expect(eventsOfKind(w, 'move-started')).toMatchObject([{ move: 'ATK-04' }]); // attempted (D-231: no longer a Need)
    advance(w, lib, CONFIG.medium.doors.pauseGraceGameMs / 30 + 200);
    expect(eventsOfKind(w, 'move-cut')).toMatchObject([{ move: 'ATK-04', by: 'DEF-07' }]);
    expect(w.bandages).toMatchObject([{ move: 'ATK-04', rule: { kind: 'rate-limit', path: '/rest/user/login' } }]);
    w.clock.gameMs = w.bandages[0]!.evadesAt;
    expect(playableVariants(w, lib, MOVE_BY_ID['ATK-04']).map((v) => v.variant)).toEqual(['c']); // the made-up quiet one
  });

  it('the login doors evade with their quiet recordings: ATK-03.b slips the SQLi rule set, ATK-04.b the rate limit (KI-231 closed by D-237)', () => {
    for (const move of ['ATK-03', 'ATK-04'] as const) {
      const lib = only(real, ['ATK-01', move]);
      expect(lib.variantsOf(move).filter((v) => v.info.quiet).map((v) => v.variant)).toEqual(['b']);
      const w = readyToHarvest('medium');
      const rule = move === 'ATK-03' ? sqli : { kind: 'rate-limit', path: '/rest/user/login' } as const;
      w.waf.push(rule);
      bandage(w, move, rule);
      w.clock.gameMs = w.bandages[0]!.evadesAt;
      stepBandages(w, lib);
      expect(eventsOfKind(w, 'rule-evaded')).toMatchObject([{ move }]);
      expect(playableVariants(w, lib, MOVE_BY_ID[move]).map((v) => v.variant)).toEqual(['b']); // the loud .a stays stopped
    }
  });

  it('a user-agent rule only ever matches a variant whose recorded agent carries the pattern: the ffuf rule never touches the browser-agent scan, the sqlmap rule never the quiet halves', () => {
    const w = lab(initialWorld(1, 'medium'));
    w.waf.push({ kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' }, { kind: 'block-user-agent', pattern: 'sqlmap' });
    const [a, b] = real.variantsOf('ATK-01');
    expect(stopperHolds(w, { action: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } }, { ...a!.info, ip: 'fresh' })).toBe(true);
    expect(stopperHolds(w, { action: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } }, { ...b!.info, ip: 'fresh' })).toBe(false);
    for (const v of real.variantsOf('ATK-08')) expect(stopperHolds(w, { action: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'sqlmap' } }, { ...v.info, ip: 'fresh' }), v.variant).toBe('acfg'.includes(v.variant));
  });
});

describe('the SQLi rule set\'s false positives (D-231 rule 6)', () => {
  it("a shopper's quoted search answers 403 under the rule, costs its class and raises a ticket; without the rule it is served", () => {
    const access = (t: number, target: string): RecEvent => ({ t, kind: 'access', ip: '203.0.113.2', method: 'GET', target, protocol: 'HTTP/1.1', status: 200, bytes: 300, referer: '', userAgent: 'Mozilla/5.0 (X11)', requestTimeMs: 5 } as AccessEvent);
    const traffic = fakeRecording('CUST', 'a', { ip: '203.0.113.1', durationMs: 10_000, events: [access(1000, '/rest/products/search?q=apple'), access(2000, "/rest/products/search?q=O'Brien"), access(3000, '/rest/products/search?q=Dad%27s%20juice')] });
    const lib = libraryFrom([traffic]);
    const play = (rule: boolean) => {
      const w = initialWorld(1, 'hard'); // every made-up shopper plays
      if (rule) w.waf.push({ kind: 'sqli' });
      for (let i = 0; i < 50; i++) { w.clock.gameMs += CONFIG.hard.tickGameMs; stepCustomers(w, lib); integrateHeartbeat(w, CONFIG.hard.tickGameMs); }
      return w;
    };
    const off = play(false);
    expect(off.logs.access.map((l) => l.status)).toEqual([200, 200, 200]);
    expect(off.heartbeat).toBe(100);
    const on = play(true);
    expect(on.logs.access.map((l) => l.status)).toEqual([200, 403, 403]);
    expect(on.heartbeat).toBeLessThan(100);
    expect(on.tickets).toMatchObject([{ about: 'search', status: 403 }]);
    expect(on.customers.failed).toBe(2);
  });
});

describe('the WAF-only player on every level (D-231, SYS-23)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  const searchDoor = only(real, ['ATK-01', 'ATK-08']);
  const REAL_MIN = 60_000;

  for (const level of LEVELS) {
    it(`${level}: the SQLi rule set after the first dump holds for the breathers, then the door is robbed again; with the search patch the door closes for good and he is banished`, () => {
      const run = (patch: boolean) => {
        let acted = false;
        const w = readyToHarvest(level);
        w.clock.shiftEndsAt = Number.MAX_SAFE_INTEGER;
        for (let ms = 0; ms < 40 * REAL_MIN && !w.ending; ms += 100) {
          if (!acted && eventsOfKind(w, 'move-landed').some((e) => e.move === 'ATK-08')) {
            acted = true;
            applyAction(w, { type: 'DEF-12', rule: sqli });
            if (patch) applyAction(w, { type: 'DEF-13', patch: 'search' });
          }
          advance(w, searchDoor, 100);
        }
        return w;
      };
      const wafOnly = run(false);
      const cut = eventsOfKind(wafOnly, 'move-cut').find((e) => e.move === 'ATK-08' && e.by === 'DEF-12')!;
      expect(cut).toBeDefined();
      expect(eventsOfKind(wafOnly, 'rule-evaded')).toMatchObject([{ move: 'ATK-08', rule: sqli }]);
      expect(eventsOfKind(wafOnly, 'souls-stolen').filter((e) => e.by === 'ATK-08' && e.t > cut.t).length).toBeGreaterThan(0); // robbed again
      expect(eventsOfKind(wafOnly, 'banished')).toEqual([]);
      expect(wafOnly.ending).toBe('souls-lost');
      const patched = run(true);
      expect(patched.ending).toBe('banished');
      const applied = eventsOfKind(patched, 'patch-applied')[0]!;
      expect(eventsOfKind(patched, 'souls-stolen').filter((e) => e.t > applied.t + REAL_S)).toEqual([]); // nothing after the patch lands
    });
  }
});

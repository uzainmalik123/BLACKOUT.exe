// SYS-19, D-65: the customers underneath everything. Unit tests on the made-up traffic (test-fixtures), then the
// committed CUST.a (REC-06) in whole runs on every level.
import { describe, expect, it } from 'vitest';
import type { Difficulty, PlayerAction, WafRule } from '../rules/vocabulary';
import { applyAction } from './actions';
import { CONFIG } from './config';
import { classify, pathMatches, ruleBlocks, stepCustomers } from './customers';
import { integrateHeartbeat } from './heartbeat';
import { EMPTY_LIBRARY, libraryFrom, type RecordingLibrary } from './library';
import { eventsOfKind } from './log';
import { attackerAddresses, bump, customerAddresses, drawAddress, POOL_RANGES, recordedAttackerAddresses } from './pool';
import { stepWaves } from './minions';
import { startReplay } from './replay';
import { runSim } from './sim';
import { initialWorld, type World } from './state';
import { committedLibrary } from './test-fixtures/committed';
import { FIXTURE_IPS, FIXTURE_LIBRARY, FIXTURE_TRAFFIC, FIXTURE_VISIT, withTraffic } from './test-fixtures/recordings';
import type { AccessEvent, Recording } from '../recordings/format';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_MIN = 60_000;
const TRAFFIC = withTraffic(FIXTURE_LIBRARY); // the made-up moves and customers
const custLines = (w: World) => w.logs.access.filter((l) => l.by === 'CUST');
const inRanges = (ip: string) => POOL_RANGES.some((r) => ip.startsWith(`${r}.`));

/**
 * Customers alone: no Director, no minions, no taps (nothing to banish or rob), the clock and the heartbeat running.
 * `actions` apply at the start; `during` may act every 100 real ms.
 */
function customersOnly(opts: { level?: Difficulty; library?: RecordingLibrary; actions?: PlayerAction[]; realMs: number; during?: (w: World, realMs: number) => PlayerAction[]; setup?: (w: World) => void }): World {
  const level = opts.level ?? 'hard'; // 6 of the 8 made-up shoppers play
  const library = opts.library ?? TRAFFIC;
  const w = initialWorld(1, level);
  opts.setup?.(w);
  for (const a of opts.actions ?? []) applyAction(w, a);
  for (let realMs = 0; realMs < opts.realMs && w.heartbeat > 0; realMs += 100) {
    for (const a of opts.during?.(w, realMs) ?? []) applyAction(w, a);
    w.clock.gameMs += CONFIG[level].tickGameMs;
    stepCustomers(w, library);
    integrateHeartbeat(w, CONFIG[level].tickGameMs);
  }
  return w;
}

describe('what a customer request is (D-65, PR #73)', () => {
  it.each([
    ['GET', '/rest/products/search?q=apple', 'search'], ['GET', '/rest/products/search?q=fruit%20press', 'search'], ['GET', '/rest/products/search?q=', 'page'],
    ['POST', '/rest/user/login', 'login'], ['GET', '/rest/user/whoami', 'login'], ['GET', '/rest/saveLoginIp', 'login'],
    ['POST', '/api/Users/', 'signup'], ['GET', '/api/SecurityQuestions/', 'signup'], ['POST', '/api/SecurityAnswers/', 'signup'],
    ['GET', '/rest/basket/3', 'basket'], ['POST', '/api/BasketItems/', 'basket'], ['PUT', '/api/BasketItems/12', 'basket'],
    ['POST', '/rest/basket/3/checkout', 'checkout'], ['GET', '/api/Addresss', 'checkout'], ['POST', '/api/Cards/', 'checkout'], ['GET', '/api/Deliverys/1', 'checkout'], ['GET', '/rest/wallet/balance', 'checkout'], ['GET', '/rest/track-order/5267-abc', 'checkout'],
    ['GET', '/rest/captcha/', 'feedback'], ['POST', '/api/Feedbacks/', 'feedback'],
    ['POST', '/file-upload', 'complaint'], ['POST', '/api/Complaints/', 'complaint'],
    ['GET', '/rest/user/security-question?email=amy%40juice-sh.op', 'password-reset'], ['POST', '/rest/user/reset-password', 'password-reset'],
    ['GET', '/ftp', 'ftp'], ['GET', '/ftp/legal.md', 'ftp'],
    ['GET', '/', 'page'], ['GET', '/main.js', 'page'], ['GET', '/assets/public/images/products/apple_juice-2x.avif', 'page'], ['GET', '/rest/products/7/reviews', 'page'],
    ['GET', '/api/Products/7?d=Fri', 'page'], ['GET', '/api/Quantitys/', 'page'], ['GET', '/rest/admin/application-configuration', 'page'], ['GET', '/rest/languages', 'page'],
  ])('%s %s is %s', (method, target, cls) => {
    expect(classify(method, target)).toBe(cls);
  });

  it('WAF rules match customers literally: a user agent by substring, a path by segments with * as one, SQLi only on injection tokens', () => {
    const line = (method: string, target: string, userAgent = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0.0.0') => ({ method, target, userAgent });
    expect(pathMatches('/rest/products/*/reviews', '/rest/products/12/reviews')).toBe(true);
    expect(pathMatches('/rest/products/*/reviews', '/rest/products/search')).toBe(false);
    expect(pathMatches('/api/*', '/api/BasketItems/')).toBe(true);
    expect(pathMatches('/api/Products', '/api/Products/1')).toBe(true); // a prefix
    expect(pathMatches('/api/Products', '/api/ProductsX')).toBe(false);
    expect(pathMatches('/support/logs', '/support/logs/access.log.2026-10-31')).toBe(true);
    expect(ruleBlocks({ kind: 'block-user-agent', pattern: 'mozilla' }, line('GET', '/'))).toBe(true);
    expect(ruleBlocks({ kind: 'block-user-agent', pattern: 'sqlmap' }, line('GET', '/'))).toBe(false);
    expect(ruleBlocks({ kind: 'block-path', method: 'PUT', path: '/api/Products' }, line('GET', '/api/Products/1?d=x'))).toBe(false); // the method matters
    expect(ruleBlocks({ kind: 'block-path', method: 'GET', path: '/rest/products/*/reviews' }, line('GET', '/rest/products/3/reviews'))).toBe(true);
    expect(ruleBlocks({ kind: 'sqli' }, line('GET', '/rest/products/search?q=apple'))).toBe(false);
    expect(ruleBlocks({ kind: 'sqli' }, line('GET', "/rest/products/search?q=')) UNION SELECT 1--"))).toBe(true);
    expect(ruleBlocks({ kind: 'rate-limit', path: '/rest/user/login' }, line('POST', '/rest/user/login'))).toBe(false); // a limit answers bursts, not every hit
  });
});

describe('the shared address pool (D-60, D-65)', () => {
  it('draws from the three documentation ranges and never an address in the avoid set; bump steps past one without a new draw', () => {
    const seq = [0, 0, 0, 0, 0.5, 0.5]; // 192.0.2.1 twice (avoided), then 198.51.100.128
    let i = 0;
    const random = () => seq[i++ % seq.length]!;
    expect(drawAddress(random, new Set(['192.0.2.1']))).toBe('198.51.100.128');
    expect(bump('203.0.113.100', new Set(['203.0.113.100', '203.0.113.101']), 100, 249)).toBe('203.0.113.102');
    expect(bump('203.0.113.249', new Set(['203.0.113.249']), 100, 249)).toBe('203.0.113.100'); // wraps inside the range
    expect(bump('198.51.100.7', new Set())).toBe('198.51.100.7');
    expect(recordedAttackerAddresses(FIXTURE_LIBRARY)).toEqual(new Set(FIXTURE_IPS)); // the fixtures write every line from their attacker address
  });

  it('each loop gives its shoppers fresh addresses across all three ranges, never a recorded attacker\'s, never one Death or a wave holds, no two the same', () => {
    const w = initialWorld(3, 'hard');
    w.waves.push({ id: 9, minion: 'MIN-01', n: 1, ips: ['192.0.2.10', '198.51.100.10', '203.0.113.10'], startedAt: 0, endsAt: 1e9, successesDone: 0 });
    startReplay(w, FIXTURE_LIBRARY.variantsOf('ATK-03')[0]!, 'death');
    const held = attackerAddresses(w);
    expect(held.size).toBe(4);
    const loops: Array<Record<string, string>> = [];
    for (let realMs = 0; realMs < 10 * REAL_MIN; realMs += 100) {
      w.clock.gameMs += 3000;
      stepCustomers(w, TRAFFIC);
      if (w.customers.loop > loops.length) loops.push({ ...w.customers.addresses });
    }
    expect(loops.length).toBe(11); // a 60 s loop: the first with the run, then every 60 s
    const seen = new Set<string>();
    for (const loop of loops) {
      const ips = Object.values(loop);
      expect(ips).toHaveLength(Math.round(8 * CONFIG.hard.customers.share));
      expect(new Set(ips).size).toBe(ips.length);
      for (const ip of ips) {
        expect(inRanges(ip), ip).toBe(true);
        expect(FIXTURE_IPS, ip).not.toContain(ip);
        expect(held.has(ip), ip).toBe(false);
        seen.add(ip);
      }
    }
    expect(POOL_RANGES.filter((r) => [...seen].some((ip) => ip.startsWith(`${r}.`)))).toHaveLength(3); // all three ranges in use
    expect(seen.size).toBeGreaterThan(30); // fresh shoppers each loop
    expect(custLines(w).every((l) => loops.some((loop) => Object.values(loop).includes(l.ip)))).toBe(true);
    expect(customerAddresses(w)).toEqual(new Set(Object.values(loops.at(-1)!)));
  });

  it("Death's fresh address, a wave's and a proxy pool never take a customer's", () => {
    const w = initialWorld(1, 'hard');
    w.clock.gameMs += 3000;
    stepCustomers(w, TRAFFIC);
    const held = customerAddresses(w);
    expect(held.size).toBe(6);
    // Force the collision: give the customers every address the minions' draw could land on except one
    const w2 = initialWorld(1, 'hard');
    w2.customers = { ...w2.customers, loop: 1, addresses: Object.fromEntries(Array.from({ length: 149 }, (_, i) => [`r${i}`, `203.0.113.${100 + i}`])) };
    for (let realMs = 0; realMs < 2 * REAL_MIN; realMs += 100) { w2.clock.gameMs += 3000; stepCustomers(w2, EMPTY_LIBRARY); } // keep the addresses as set
    w2.nextWaveAt['MIN-01'] = 0;
    stepWaves(w2, FIXTURE_LIBRARY);
    const wave = w2.waves[0]!;
    expect(wave.ips).toEqual(['203.0.113.249', '203.0.113.249', '203.0.113.249']); // the one address customers don't hold
  });
});

describe('how the world answers customers (SYS-19, D-65)', () => {
  const statusOf = (w: World, pred: (l: World['logs']['access'][number]) => boolean) => new Set(custLines(w).filter(pred).map((l) => l.status));
  const isSearch = (l: { target: string }) => /^\/rest\/products\/search\?q=.+/.test(l.target);

  it('plays the loop as recorded from pool addresses, tagged CUST, and never applies its db events: no new account, no soul, no dbChange', () => {
    const w = customersOnly({ realMs: 2 * REAL_MIN });
    const lines = custLines(w);
    expect(lines.length).toBeGreaterThan(50);
    expect(lines.every((l) => inRanges(l.ip) && l.status < 400 || l.status === 401)).toBe(true);
    expect(w.accounts.some((a) => a.email === 'new.shopper@example.org')).toBe(false);
    expect(w.accounts).toHaveLength(initialWorld(1, 'hard').accounts.length);
    expect(w.souls.stolen).toEqual([]);
    expect(w.logs.dbChanges).toEqual([]);
    expect(w.customers.failed).toBe(0);
    expect(w.tickets).toEqual([]);
    expect(w.heartbeat).toBe(100);
    expect(w.customers.loop).toBe(3); // 60 s loops over 2 real minutes: the first with the run, then at 60 and 120 s
    expect(lines.length).toBe(2 * 6 * FIXTURE_VISIT.length); // two whole loops of 6 shoppers (the third just began)
    expect(w.customers.served).toBe(lines.length);
  });

  it('search off answers 503 to searches and nothing else; back on, they answer as recorded', () => {
    const w = customersOnly({ actions: [{ type: 'DEF-10', feature: 'search', enabled: false }], realMs: REAL_MIN });
    expect(statusOf(w, isSearch)).toEqual(new Set([503]));
    expect(statusOf(w, (l) => l.target === '/rest/products/search?q=')).toEqual(new Set([200])); // the product list is not a search
    expect(statusOf(w, (l) => !isSearch(l)).has(503)).toBe(false);
    const back = customersOnly({ actions: [{ type: 'DEF-10', feature: 'search', enabled: false }], realMs: 2 * REAL_MIN, during: (_w, ms) => (ms === 59_000 ? [{ type: 'DEF-18', what: 'search' }] : []) });
    expect(custLines(back).filter(isSearch).map((l) => l.status)).toContain(200); // the second loop's searches
    expect(custLines(back).filter(isSearch).map((l) => l.status)).toContain(503);
  });

  it('registration off fails sign-ups, uploads off the complaint\'s upload only, password-reset off the reset, ftp off /ftp; the CAPTCHA on fails nobody', () => {
    const off = (feature: 'registration' | 'uploads' | 'password-reset' | 'ftp') => customersOnly({ actions: [{ type: 'DEF-10', feature, enabled: false }], realMs: REAL_MIN });
    const reg = off('registration');
    expect(statusOf(reg, (l) => classify(l.method, l.target) === 'signup')).toEqual(new Set([503]));
    expect(custLines(reg).filter((l) => l.status === 503).every((l) => classify(l.method, l.target) === 'signup')).toBe(true);
    const up = off('uploads');
    expect(statusOf(up, (l) => l.target === '/file-upload')).toEqual(new Set([503]));
    expect(statusOf(up, (l) => l.target === '/api/Complaints/')).toEqual(new Set([201]));
    expect(custLines(up).filter((l) => l.status === 503)).toHaveLength(6); // one upload per shopper
    const reset = off('password-reset');
    expect(statusOf(reset, (l) => classify(l.method, l.target) === 'password-reset')).toEqual(new Set([503]));
    const ftp = off('ftp');
    expect(statusOf(ftp, (l) => l.target.startsWith('/ftp'))).toEqual(new Set([503]));
    expect(custLines(ftp).filter((l) => l.status === 503)).toHaveLength(12);
    const captcha = customersOnly({ actions: [{ type: 'DEF-10', feature: 'feedback-captcha', enabled: true }], realMs: REAL_MIN });
    expect(captcha.customers.failed).toBe(0);
  });

  it('a rate limit on the login answers 429 to the third attempt within 15 s and nothing else; nobody gives up over it', () => {
    const w = customersOnly({ actions: [{ type: 'DEF-07' }], realMs: REAL_MIN });
    const logins = custLines(w).filter((l) => l.target === '/rest/user/login');
    for (const ip of new Set(logins.map((l) => l.ip))) expect(logins.filter((l) => l.ip === ip).map((l) => l.status)).toEqual([401, 401, 429]); // each shopper's third try in 3 s
    expect(custLines(w).filter((l) => l.status === 429)).toHaveLength(6);
    expect(w.tickets.map((t) => [t.about, t.status])).toEqual(Array(6).fill(['login', 429]));
    expect(w.customers.lost).toBe(0);
    expect(w.heartbeat).toBeCloseTo(100 - CONFIG.hard.heartbeat.dip['DEF-07']! - 6 * CONFIG.hard.customers.cost.login, 0); // plus a little recovery after the last 429
  });

  it('a user-agent rule answers 403 to every browser it names; a path rule to the paths it covers; the SQLi set to nobody', () => {
    const ua = customersOnly({ actions: [{ type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Firefox' } }], realMs: REAL_MIN });
    expect(statusOf(ua, (l) => l.userAgent.includes('Firefox'))).toEqual(new Set([403]));
    expect(statusOf(ua, (l) => !l.userAgent.includes('Firefox')).has(403)).toBe(false);
    const reviews: WafRule = { kind: 'block-path', method: 'GET', path: '/rest/products/*/reviews' };
    const path = customersOnly({ actions: [{ type: 'DEF-12', rule: reviews }], realMs: REAL_MIN });
    expect(statusOf(path, (l) => l.target.endsWith('/reviews'))).toEqual(new Set([403]));
    expect(custLines(path).filter((l) => l.status === 403).every((l) => l.target.endsWith('/reviews'))).toBe(true);
    expect(path.customers.lost).toBe(0); // a page bit failing annoys; it doesn't drive a shopper off
    expect(path.heartbeat).toBeLessThan(100);
    const sqli = customersOnly({ actions: [{ type: 'DEF-12', rule: { kind: 'sqli' } }], realMs: REAL_MIN });
    expect(sqli.customers.failed).toBe(0);
  });

  it('a blocked address writes no line at all, and every request behind it fails: a "blocked" ticket, the cost, then churn', () => {
    let victim: string | undefined;
    const w = customersOnly({
      realMs: REAL_MIN,
      during: (w) => {
        if (victim || w.customers.loop === 0) return [];
        victim = w.customers.addresses['203.0.113.2']; // the first shopper, before their first line
        return victim ? [{ type: 'DEF-06', ip: victim, op: 'add' }] : [];
      },
    });
    expect(victim).toBeDefined();
    expect(custLines(w).some((l) => l.ip === victim)).toBe(false);
    expect(w.tickets).toMatchObject([{ ip: victim, status: 'blocked', about: 'page' }]);
    expect(w.customers.failed).toBe(6); // four page bits, the search, the first login try: then they gave up
    expect(eventsOfKind(w, 'customer-lost')).toHaveLength(1);
    expect(w.heartbeatMax).toBe(100 - CONFIG.hard.customers.churn);
    expect(w.logs.dbChanges).toEqual([]); // dropped at the firewall: no angry feedback reaches the shop
  });

  it('with the plug pulled no customer line appears and nothing is charged; they are back once nginx is', () => {
    const w = customersOnly({ actions: [{ type: 'DEF-11' }], realMs: REAL_MIN, during: (_w, ms) => (ms === 30_000 ? [{ type: 'DEF-18', what: 'nginx' }] : []) });
    const lines = custLines(w);
    expect(lines.length).toBeGreaterThan(0);
    expect(Math.min(...lines.map((l) => l.t))).toBeGreaterThanOrEqual(30_000 * 30);
    expect(w.customers.failed).toBe(0);
    expect(w.tickets).toEqual([]);
  });
});

describe('two customer recordings take turns (KI-82, D-131)', () => {
  // A made-up CUST.b: the same 8 shoppers over 30 s, each only looking up a security question, resetting, and opening /ftp.
  const tail = FIXTURE_VISIT.slice(-4);
  const SECOND: Recording = {
    ...FIXTURE_TRAFFIC, variant: 'b', durationMs: 30_000,
    events: FIXTURE_TRAFFIC.events.filter((e): e is AccessEvent => e.kind === 'access' && tail.some(([m, t]) => m === e.method && t === e.target))
      .map((e, i) => ({ ...e, t: 500 + i * 100 })),
  };
  const BOTH = libraryFrom([FIXTURE_TRAFFIC, SECOND]);
  const ratio = CONFIG.hard.gameMsPerRealMs;

  it('the loop plays CUST.a, then CUST.b, then CUST.a again, each for its own length', () => {
    const w = customersOnly({ library: BOTH, realMs: 100_000 });
    expect(w.customers.loop).toBe(3); // a: 0–60 real s, b: 60–90, a again from 90
    const second = custLines(w).filter((l) => l.t >= 60_000 * ratio && l.t < 90_000 * ratio);
    expect(second.length).toBe(6 * tail.length); // Hard plays 6 of the 8 shoppers
    expect(second.every((l) => tail.some(([m, t]) => m === l.method && t === l.target))).toBe(true);
    const third = custLines(w).filter((l) => l.t >= 90_000 * ratio);
    expect(third.length).toBeGreaterThan(0);
    expect(third.some((l) => l.target === '/')).toBe(true); // CUST.a's page load again
  });
});

describe('the backlash: cost, complaints, churn (D-65)', () => {
  const cost = CONFIG.hard.customers.cost;

  it('each failed search costs its price at once; one ticket per shopper per loop; a second failure means churn, angry feedback and the rest of the visit gone', () => {
    const w = customersOnly({ actions: [{ type: 'DEF-10', feature: 'search', enabled: false }], realMs: 59_000 }); // one loop
    const failed = custLines(w).filter((l) => l.status === 503);
    const shoppers = new Set(failed.map((l) => l.ip));
    expect(w.tickets.map((t) => t.ip)).toEqual([...shoppers]); // one each, in order of their first failure
    expect(w.tickets.every((t) => t.about === 'search' && t.status === 503 && t.text.includes('Search'))).toBe(true);
    expect(eventsOfKind(w, 'ticket')).toHaveLength(w.tickets.length);
    // every shopper searches twice: all six gave up at the second search; their sign-ups, baskets and checkouts never came
    const lost = eventsOfKind(w, 'customer-lost');
    expect(lost).toHaveLength(6);
    expect(failed).toHaveLength(12);
    expect(custLines(w).filter((l) => l.target === '/rest/basket/1/checkout')).toEqual([]);
    expect(w.customers.lost).toBe(lost.length);
    expect(w.heartbeatMax).toBe(100 - lost.length * CONFIG.hard.customers.churn);
    const gone = w.customers.gone;
    for (const recorded of gone) {
      const ip = w.customers.addresses[recorded]!;
      const mine = custLines(w).filter((l) => l.ip === ip);
      expect(mine.slice(-3).map((l) => [l.target, l.status])).toEqual([['/rest/products/search?q=juice', 503], ['/rest/captcha/', 200], ['/api/Feedbacks/', 201]]); // the second failure, then only the angry feedback
    }
    const feedback = w.logs.dbChanges.filter((c) => c.table === 'Feedbacks');
    expect(feedback).toHaveLength(gone.length);
    expect(feedback[0]).toMatchObject({ op: 'insert', after: { rating: 1, UserId: null } });
    expect(String(feedback[0]!.after!.comment)).toMatch(/Search/);
    expect(feedback.map((c) => c.key.id)).toEqual(feedback.map((_c, i) => 1001 + i));
    // the bill: every 503 at the search price, nothing recovered while they kept failing
    const paid = failed.length * cost.search;
    expect(w.heartbeat).toBeCloseTo(Math.min(w.heartbeatMax, 100 - paid), 1);
  });

  it('a sign-up that fails costs more than a search, and the customer who could not register is lost for good', () => {
    const w = customersOnly({ actions: [{ type: 'DEF-10', feature: 'registration', enabled: false }], realMs: 59_000 });
    const failed = custLines(w).filter((l) => l.status === 503);
    expect(failed.length).toBeGreaterThanOrEqual(10); // per shopper the questions, then the account (the third request never comes): ten of them flatline the shop
    expect(failed.every((l) => classify(l.method, l.target) === 'signup')).toBe(true);
    expect(eventsOfKind(w, 'customer-lost').every((e) => e.about === 'signup')).toBe(true);
    expect(w.heartbeat).toBe(0);
    expect(10 * cost.signup).toBeGreaterThanOrEqual(100);
    expect(cost.signup).toBeGreaterThan(cost.search);
  });

  it('once the flag is back on the complaints stop, and a real minute later the shop recovers again, but never above its new maximum', () => {
    const w = customersOnly({ actions: [{ type: 'DEF-10', feature: 'search', enabled: false }], realMs: 4 * REAL_MIN, during: (_w, ms) => (ms === 59_000 ? [{ type: 'DEF-18', what: 'search' }] : []) });
    const last = eventsOfKind(w, 'ticket').at(-1)!;
    expect(last.t).toBeLessThan(60 * 30_000);
    expect(w.heartbeatMax).toBeLessThan(100);
    expect(w.heartbeat).toBeGreaterThan(w.heartbeatMax - 10); // three minutes of +2 brought it back up
    expect(w.heartbeat).toBeLessThanOrEqual(w.heartbeatMax);
  });

  it('with no traffic in the library nothing happens: no loop, no lines, no cost', () => {
    const w = customersOnly({ library: FIXTURE_LIBRARY, realMs: REAL_MIN, actions: [{ type: 'DEF-10', feature: 'search', enabled: false }] });
    expect(w.customers.loop).toBe(0);
    expect(custLines(w)).toEqual([]);
    expect(w.heartbeat).toBe(100);
  });
});

describe('the committed customers (REC-06) in whole runs', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  const real = committedLibrary();
  const idle = (difficulty: Difficulty, seed = 1) => runSim({ seed, difficulty, library: real, maxRealMs: 20 * REAL_MIN, player: () => [] });

  it('an idle Medium run: customers write at least 60% of the lines outside the scan and the minions\' waves, about 2 a second; Easy about 1, Hard about 4 (SYS-19, D-134)', () => {
    const r = idle('medium');
    const lines = r.world.logs.access;
    const cust = lines.filter((l) => l.by === 'CUST').length;
    const bursts = lines.filter((l) => l.by === 'ATK-01' || l.by?.startsWith('MIN-')).length; // Death's scan and the waves: bursts by nature
    expect(lines.some((l) => l.by?.startsWith('MIN-'))).toBe(true);
    expect(cust / (lines.length - bursts)).toBeGreaterThanOrEqual(0.6);
    expect(cust / (r.realMs / 1000)).toBeGreaterThan(1.5);
    expect(cust / (r.realMs / 1000)).toBeLessThan(2.8);
    expect(r.world.customers.failed).toBe(0); // nobody did anything to them
    expect(r.world.tickets).toEqual([]);
    for (const [level, lo, hi] of [['easy', 0.6, 1.5], ['hard', 3, 5.5]] as const) {
      const e = idle(level);
      expect(e.world.logs.access.filter((l) => l.by === 'CUST').length / (e.realMs / 1000), level).toBeGreaterThan(lo);
      expect(e.world.logs.access.filter((l) => l.by === 'CUST').length / (e.realMs / 1000), level).toBeLessThan(hi);
    }
  });

  it('customers sit in all three ranges, never on a recorded attacker address nor one Death or a wave holds while it is theirs, and Death never on theirs', () => {
    const r = idle('medium', 2);
    const cust = r.world.logs.access.filter((l) => l.by === 'CUST');
    expect(POOL_RANGES.filter((range) => cust.some((l) => l.ip.startsWith(`${range}.`)))).toHaveLength(3);
    const attackers = recordedAttackerAddresses(real);
    expect(cust.some((l) => attackers.has(l.ip))).toBe(false);
    // at every moment, no address carries both a customer's line and an attacker's line within the same loop
    const byLoop = new Map<string, Set<string>>();
    const lengths = real.variantsOf('CUST').map((v) => v.recording.durationMs * CONFIG.medium.gameMsPerRealMs);
    const loopAt = (t: number) => { let n = 0; for (let start = 0; ; n++) { start += lengths[n % lengths.length]!; if (t < start) return n; } };
    for (const l of r.world.logs.access) {
      const loop = loopAt(l.t);
      const key = `${loop} ${l.ip}`;
      byLoop.set(key, (byLoop.get(key) ?? new Set()).add(l.by === 'CUST' ? 'CUST' : 'attacker'));
    }
    expect([...byLoop.values()].filter((s) => s.size > 1)).toEqual([]);
  });

  it('with search off every customer search answers 503 (the product list does not); with the plug pulled no customer line appears', () => {
    const off = runSim({ seed: 1, difficulty: 'medium', library: real, maxRealMs: 3 * REAL_MIN, player: (_w, ms) => (ms === 0 ? [{ type: 'DEF-10', feature: 'search', enabled: false }] : []) });
    const searches = off.world.logs.access.filter((l) => l.by === 'CUST' && /search\?q=.+/.test(l.target));
    expect(searches.length).toBeGreaterThan(5); // fewer than usual: a shopper whose second search fails gives up
    expect(new Set(searches.map((l) => l.status))).toEqual(new Set([503]));
    expect(new Set(off.world.logs.access.filter((l) => l.by === 'CUST' && l.target === '/rest/products/search?q=').map((l) => l.status))).toEqual(new Set([200]));
    expect(off.world.tickets.length).toBeGreaterThan(0);
    const plug = runSim({ seed: 1, difficulty: 'medium', library: real, maxRealMs: 3 * REAL_MIN, player: (_w, ms) => (ms === 0 ? [{ type: 'DEF-11' }] : []) });
    expect(plug.world.logs.access.filter((l) => l.by === 'CUST')).toEqual([]);
    expect(plug.world.customers.failed).toBe(0);
  });

  it('both recordings take turns: CUST.a then CUST.b, and every CUST.b loop has its password resets and /ftp readers (KI-82, D-131)', () => {
    expect(real.variantsOf('CUST').map((v) => v.variant)).toEqual(['a', 'b']);
    const only = libraryFrom(real.variantsOf('CUST').map((v) => v.recording));
    const [a, b] = real.variantsOf('CUST').map((v) => v.recording.durationMs * CONFIG.medium.gameMsPerRealMs) as [number, number];
    const w = initialWorld(1, 'medium');
    for (let realMs = 0; realMs < 45 * REAL_MIN; realMs += 100) { w.clock.gameMs += 3000; stepCustomers(w, only); }
    const lines = custLines(w);
    for (let start = 0, loop = 1; start + (loop % 2 ? a : b) <= w.clock.gameMs; start += loop % 2 ? a : b, loop++) {
      const inLoop = lines.filter((l) => l.t >= start && l.t < start + (loop % 2 ? a : b));
      const of = (cls: string) => inLoop.filter((l) => classify(l.method, l.target) === cls).length;
      if (loop % 2) expect(of('password-reset') + of('ftp'), `loop ${loop} (CUST.a)`).toBe(0);
      else {
        expect(of('password-reset'), `loop ${loop} (CUST.b)`).toBeGreaterThanOrEqual(2);
        expect(of('ftp'), `loop ${loop} (CUST.b)`).toBeGreaterThanOrEqual(1);
      }
    }
    expect(w.customers.loop).toBeGreaterThanOrEqual(6);
  });

  it('on Medium, customers alone: search off flatlines the shop in about 15 real minutes, everything off in about 10; password-reset off and ftp off now cost a little (KI-82)', () => {
    const only = libraryFrom(real.variantsOf('CUST').map((v) => v.recording));
    const minutes = (actions: PlayerAction[]) => {
      const w = initialWorld(1, 'medium');
      for (const a of actions) applyAction(w, a);
      let realMs = 0;
      for (; realMs < 30 * REAL_MIN && w.heartbeat > 0; realMs += 100) {
        w.clock.gameMs += 3000;
        stepCustomers(w, only);
        integrateHeartbeat(w, 3000);
      }
      return { minutes: realMs / REAL_MIN, w };
    };
    const search = minutes([{ type: 'DEF-10', feature: 'search', enabled: false }]);
    expect(search.minutes).toBeGreaterThan(13); // about 15 in a whole run, where Death's open door drains too (exploits.test.ts)
    expect(search.minutes).toBeLessThan(20); // 18.8 with CUST.b taking turns (fewer searches a minute than CUST.a, D-131); 17.3 on CUST.a alone
    const all = minutes((['search', 'registration', 'password-reset', 'uploads', 'ftp'] as const).map((feature) => ({ type: 'DEF-10', feature, enabled: false })));
    expect(all.minutes).toBeGreaterThan(8.5);
    expect(all.minutes).toBeLessThan(14); // 10.1 in the whole run (exploits.test.ts)
    expect(all.minutes).toBeLessThan(search.minutes);
    expect(all.w.heartbeatMax).toBeLessThan(90); // churn: shoppers who gave up
    for (const feature of ['ftp', 'password-reset'] as const) {
      const off = minutes([{ type: 'DEF-10', feature, enabled: false }]);
      expect(off.w.customers.failed, feature).toBeGreaterThan(0);
      expect(off.w.tickets.some((t) => t.about === feature && t.status === 503), feature).toBe(true);
      expect(off.minutes, feature).toBe(30); // a price, not a flatline: still alive after 30 real minutes
    }
  });
});

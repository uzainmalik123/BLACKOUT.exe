// SYS-20 (D-110): the detection data the dashboard's three tools read (UI-09). Pure selectors over the access log:
// nothing is invented, every number is counted from real lines, and nothing says who an address belongs to.
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { errorRate, statusClass, topTalkers } from './detection';
import { Engine } from './engine';
import { eventsOfKind } from './log';
import { initialWorld, type AccessLine, type World } from './state';
import { committedLibrary } from './test-fixtures/committed';
import { lab } from './test-fixtures/lab';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_S = 30_000; // game ms (SYS-01)
const REAL_MIN = 60 * REAL_S;

function line(w: World, t: number, ip: string, status: number, by: AccessLine['by'] = 'CUST', target = '/'): void {
  w.logs.access.push({ t, ip, method: 'GET', target, protocol: 'HTTP/1.1', status, bytes: 100, referer: '', userAgent: 'x', by });
}

describe('status class per access line (SYS-20 c)', () => {
  it('maps a status to its class, for colouring', () => {
    expect([101, 200, 204, 301, 304, 401, 404, 429, 500, 503].map(statusClass)).toEqual(['1xx', '2xx', '2xx', '3xx', '3xx', '4xx', '4xx', '4xx', '5xx', '5xx']);
  });
});

describe('top talkers (SYS-20 a)', () => {
  it('counts requests and errors per address over the last real minute, busiest first, ties by errors then address; older lines are out', () => {
    const w = initialWorld(1, 'medium');
    w.clock.gameMs = 3 * REAL_MIN;
    const since = w.clock.gameMs - REAL_MIN;
    line(w, since - 1, '203.0.113.9', 200, 'ATK-01'); // just outside the window
    for (let i = 0; i < 5; i++) line(w, since + i, '203.0.113.9', i < 2 ? 500 : 200, 'ATK-01');
    for (let i = 0; i < 5; i++) line(w, since + 10 + i, '192.0.2.4', i === 0 ? 404 : 200, 'CUST');
    for (let i = 0; i < 3; i++) line(w, since + 20 + i, '198.51.100.7', 200, 'CUST');
    line(w, w.clock.gameMs, '203.0.113.150', 200, 'MIN-01'); // right now counts
    expect(topTalkers(w)).toEqual([
      { ip: '203.0.113.9', requests: 5, errors: 2 },
      { ip: '192.0.2.4', requests: 5, errors: 1 },
      { ip: '198.51.100.7', requests: 3, errors: 0 },
      { ip: '203.0.113.150', requests: 1, errors: 0 },
    ]);
    expect(topTalkers(w, { n: 2 })).toHaveLength(2);
    expect(topTalkers(w, { n: 2 })[1]!.ip).toBe('192.0.2.4');
  });

  it('is empty on a fresh world and never says who an address belongs to', () => {
    const w = initialWorld(1, 'medium');
    expect(topTalkers(w)).toEqual([]);
    line(w, 0, '203.0.113.9', 200, 'ATK-01');
    for (const t of topTalkers(w)) expect(Object.keys(t).sort()).toEqual(['errors', 'ip', 'requests']);
  });

  it('the window is one real minute on every level (the game clock runs at the same ratio)', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const w = initialWorld(1, difficulty);
      const window = 60_000 * CONFIG[difficulty].gameMsPerRealMs;
      w.clock.gameMs = 10 * window;
      line(w, w.clock.gameMs - window - 1, '10.0.0.1', 200);
      line(w, w.clock.gameMs - window, '10.0.0.2', 200);
      expect(topTalkers(w).map((t) => t.ip), difficulty).toEqual(['10.0.0.2']);
    }
  });
});

describe('error rate (SYS-20 b)', () => {
  it('buckets 4xx and 5xx per real minute from the start of the run to now, empty minutes included, the current minute partial', () => {
    const w = initialWorld(1, 'medium');
    line(w, 0, '192.0.2.4', 200);
    line(w, 1000, '192.0.2.4', 404);
    line(w, REAL_MIN - 1, '203.0.113.9', 500, 'ATK-01');
    line(w, REAL_MIN, '203.0.113.9', 500, 'ATK-01'); // the first ms of minute 1
    line(w, 3 * REAL_MIN + 5, '192.0.2.5', 429);
    w.clock.gameMs = 3 * REAL_MIN + 10;
    expect(errorRate(w)).toEqual([
      { minute: 0, from: 0, to: REAL_MIN, requests: 3, clientErrors: 1, serverErrors: 1 },
      { minute: 1, from: REAL_MIN, to: 2 * REAL_MIN, requests: 1, clientErrors: 0, serverErrors: 1 },
      { minute: 2, from: 2 * REAL_MIN, to: 3 * REAL_MIN, requests: 0, clientErrors: 0, serverErrors: 0 },
      { minute: 3, from: 3 * REAL_MIN, to: 4 * REAL_MIN, requests: 1, clientErrors: 1, serverErrors: 0 },
    ]);
  });

  it('a fresh world has one empty minute; the series only grows with the clock and the log', () => {
    const w = initialWorld(1, 'medium');
    expect(errorRate(w)).toEqual([{ minute: 0, from: 0, to: REAL_MIN, requests: 0, clientErrors: 0, serverErrors: 0 }]);
    w.clock.gameMs = REAL_MIN;
    expect(errorRate(w)).toHaveLength(2);
    line(w, 10, '192.0.2.4', 503);
    expect(errorRate(w)[0]).toMatchObject({ requests: 1, serverErrors: 1 });
    line(w, REAL_MIN, '192.0.2.4', 200);
    expect(errorRate(w)[1]).toMatchObject({ requests: 1, serverErrors: 0 });
  });
});

describe('on a seeded run (the committed recordings)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  it("during the scan the scanner's address tops the talkers with thousands of requests, and the first minute's series carries its 500s; the Engine exposes both", () => {
    const engine = new Engine({ seed: 1, difficulty: 'medium', library: committedLibrary() });
    lab(engine.world); // the lab: Death from 0 (D-230)
    for (let i = 0; i < 400; i++) engine.advance(100); // 40 real s: the scan (13 s) has landed
    const scan = eventsOfKind(engine.world, 'move-started').find((e) => e.move === 'ATK-01')!;
    const top = engine.topTalkers();
    expect(top[0]!.ip).toBe(scan.ip);
    expect(top[0]!.requests).toBeGreaterThan(1000);
    expect(top[0]!.errors).toBeGreaterThan(0); // the 500s on /api and /rest words
    expect(top.length).toBeGreaterThan(1); // the customers are there too
    const [first] = engine.errorRate();
    expect(first!.serverErrors).toBeGreaterThanOrEqual(top[0]!.errors); // plus the odd minion probe that 500s (/api/.env)
    expect(first!.requests).toBe(engine.world.logs.access.length);
    const totals = engine.errorRate().reduce((n, m) => n + m.requests, 0);
    expect(totals).toBe(engine.world.logs.access.length);
  });
});

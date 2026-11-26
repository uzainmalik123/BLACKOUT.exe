// SYS-20, D-232: alerts open on a per-route threshold, never at move start, and carry a route, a symptom and a gate.
// Each detector on crafted lines; every committed recording played alone; the customers alone open nothing.
import { describe, expect, it } from 'vitest';
import type { Actor, MinionId, MoveId } from '../rules/vocabulary';
import { gateOf, openAlert, stepAlerts } from './alerts';
import { advance } from './advance';
import { CONFIG } from './config';
import { stepCustomers } from './customers';
import { eventsOfKind } from './log';
import { libraryFrom } from './library';
import { startReplay } from './replay';
import { initialWorld, type World } from './state';
import { stepTaps } from './taps';
import { committedLibrary } from './test-fixtures/committed';
import { lab } from './test-fixtures/lab';
import { FIXTURE_LIBRARY, FIXTURE_TRAFFIC, withTraffic } from './test-fixtures/recordings';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_S = 30_000;
const TH = CONFIG.medium.alerts;
const SPOILER = /\b(ATK|MIN|TAP|DEF)-\d|\bdeath\b/i;

/** One access line, stamped `t` game ms, then the detectors. */
function line(w: World, t: number, ip: string, method: string, target: string, status: number, by: Actor = 'ATK-01', userAgent = 'Mozilla/5.0 (X11)'): void {
  w.logs.access.push({ t, ip, method, target, protocol: 'HTTP/1.1', status, bytes: 100, referer: '', userAgent, by });
  w.clock.gameMs = t;
  stepAlerts(w);
}
const open = (w: World) => w.alerts.filter((a) => a.closedAt === undefined);

describe('the detectors, one by one (D-232)', () => {
  it('a request burst from one address: exactly at the count, from an attacker, never from a customer', () => {
    const w = initialWorld(1, 'medium');
    w.replays.push({ id: 1, owner: 'death', move: 'ATK-01', variant: 'a', ip: '203.0.113.9', recordedIp: '203.0.113.9', startedAt: 0, cursor: 0 }); // the actor is active
    for (let i = 1; i < TH.burst.count; i++) line(w, i * 100, '203.0.113.9', 'GET', `/w${i}`, 200);
    expect(w.alerts).toEqual([]);
    line(w, TH.burst.count * 100, '203.0.113.9', 'GET', '/w', 200);
    expect(open(w)).toMatchObject([{ about: 'ATK-01', route: '/', gate: 'front door' }]);
    expect(open(w)[0]!.symptom).toBe(`unusual activity on the site: ${TH.burst.count} requests in ${TH.burst.windowRealS} s from one address`);
    expect(eventsOfKind(w, 'alert-opened')).toMatchObject([{ about: 'ATK-01', route: '/' }]);
    expect(w.incident).toMatchObject({ by: 'alert' }); // D-230: the first alert declares the incident
    const c = initialWorld(1, 'medium');
    for (let i = 1; i <= 2 * TH.burst.count; i++) line(c, i * 100, '192.0.2.4', 'GET', `/w${i}`, 200, 'CUST');
    expect(c.alerts).toEqual([]);
    const slow = initialWorld(1, 'medium');
    slow.replays.push({ id: 1, owner: 'death', move: 'ATK-01', variant: 'a', ip: '203.0.113.9', recordedIp: '203.0.113.9', startedAt: 0, cursor: 0 });
    for (let i = 1; i <= 2 * TH.burst.count; i++) line(slow, i * (TH.burst.windowRealS + 1) * REAL_S, '203.0.113.9', 'GET', `/w${i}`, 200); // outside the window every time
    expect(slow.alerts).toEqual([]);
  });

  it('probe-looking paths over every address (a crawler wave rotates its lines through three)', () => {
    const w = initialWorld(1, 'medium');
    w.waves.push({ id: 1, minion: 'MIN-01', n: 1, ips: ['203.0.113.101', '203.0.113.102', '203.0.113.103'], startedAt: 0, endsAt: 10 * REAL_S, successesDone: 0 });
    const probes = ['/wp-admin/', '/.env', '/phpmyadmin/', '/wp-login.php', '/.git/config', '/backup.bak', '/.htaccess', '/index.php', '/wp-content/x', '/.env.backup'];
    probes.forEach((p, i) => line(w, (i + 1) * 100, `203.0.113.10${(i % 3) + 1}`, 'GET', p, 404, 'MIN-01'));
    expect(open(w)).toMatchObject([{ about: 'MIN-01', route: '/', gate: 'front door' }]);
    expect(open(w)[0]!.symptom).toMatch(/PHP, WordPress or config paths/);
  });

  it('failed logins from one address, or many in all; a login from a command-line client; errors on search per address', () => {
    const w = initialWorld(1, 'medium');
    w.replays.push({ id: 1, owner: 'death', move: 'ATK-04', variant: 'a', ip: '203.0.113.44', recordedIp: '203.0.113.44', startedAt: 0, cursor: 0 });
    for (let i = 1; i <= TH.failedLogins.count; i++) line(w, i * 100, '203.0.113.44', 'POST', '/rest/user/login', 401, 'ATK-04', 'Mozilla/5.0 (Hydra)');
    expect(open(w)).toMatchObject([{ about: 'ATK-04', route: '/rest/user/login', gate: 'passwords' }]);
    expect(open(w)[0]!.symptom).toBe(`unusual activity on /rest/user/login: ${TH.failedLogins.count} failed logins in ${TH.failedLogins.windowRealS} s from one address`);
    const many = initialWorld(1, 'medium');
    many.waves.push({ id: 1, minion: 'MIN-02', n: 1, ips: ['203.0.113.201', '203.0.113.202', '203.0.113.203'], startedAt: 0, endsAt: 10 * REAL_S, successesDone: 0 });
    for (let i = 1; i <= TH.failedLoginsAll.count; i++) line(many, i * 50, `203.0.113.${1 + (i % 200)}`, 'POST', '/rest/user/login', 401, 'MIN-02', 'python-requests/2.32');
    expect(open(many)).toMatchObject([{ about: 'MIN-02', route: '/rest/user/login' }]);
    expect(open(many)[0]!.symptom).toMatch(/failed logins in 30 s from many addresses/);
    const cli = initialWorld(1, 'medium');
    cli.replays.push({ id: 1, owner: 'death', move: 'ATK-03', variant: 'a', ip: '203.0.113.23', recordedIp: '203.0.113.23', startedAt: 0, cursor: 0 });
    line(cli, 100, '192.0.2.5', 'POST', '/rest/user/login', 200, 'CUST', 'Mozilla/5.0 (Macintosh)'); // a shopper
    line(cli, 200, '203.0.113.23', 'POST', '/rest/user/login', 200, 'ATK-03', 'curl/8.23.0');
    expect(open(cli)).toMatchObject([{ about: 'ATK-03', route: '/rest/user/login', gate: 'login' }]);
    expect(open(cli)[0]!.symptom).toBe('a login succeeded from a command-line client (curl) on /rest/user/login');
    const search = initialWorld(1, 'medium');
    search.replays.push({ id: 1, owner: 'death', move: 'ATK-08', variant: 'd', ip: '203.0.113.85', recordedIp: '203.0.113.85', startedAt: 0, cursor: 0 });
    for (let i = 1; i < TH.searchErrors.count; i++) line(search, i * 100, '203.0.113.85', 'GET', `/rest/products/search?q=${i}'`, 500, 'ATK-08');
    for (let i = 1; i <= 3; i++) line(search, 1000 + i * 100, `192.0.2.${i}`, 'GET', "/rest/products/search?q=O'Brien", 500, 'CUST'); // KI-236: shoppers' quoted searches error too, a few per address
    expect(search.alerts).toEqual([]);
    line(search, 2000, '203.0.113.85', 'GET', '/rest/products/search?q=x', 500, 'ATK-08');
    expect(open(search)).toMatchObject([{ about: 'ATK-08', route: '/rest/products/search', gate: 'search' }]);
    expect(open(search)[0]!.symptom).toBe(`unusual activity on /rest/products/search: ${TH.searchErrors.count} server errors in ${TH.searchErrors.windowRealS} s from one address`);
  });

  it("a scraper's pace on an API route, feedback spam, a new admin row, a new upload, a product changed", () => {
    const pace = initialWorld(1, 'medium');
    pace.replays.push({ id: 1, owner: 'death', move: 'ATK-09', variant: 'b', ip: '203.0.113.30', recordedIp: '203.0.113.30', startedAt: 0, cursor: 0 });
    for (let i = 1; i <= TH.apiPace.count; i++) line(pace, i * 100, '203.0.113.30', 'GET', `/api/Users/${i}`, 200, 'ATK-09', 'curl/8.23.0');
    expect(open(pace)).toMatchObject([{ about: 'ATK-09', route: '/api/Users', gate: 'admin API' }]);
    const fb = initialWorld(1, 'medium');
    fb.waves.push({ id: 1, minion: 'MIN-04', n: 1, ips: ['203.0.113.187'], startedAt: 0, endsAt: 10 * REAL_S, successesDone: 0 });
    for (let i = 1; i <= TH.feedback.count; i++) line(fb, i * 100, '203.0.113.187', 'POST', '/api/Feedbacks/', 201, 'MIN-04', 'python-requests/2.32');
    expect(open(fb)).toMatchObject([{ about: 'MIN-04', route: '/api/Feedbacks', gate: 'feedback' }]);
    const admin = initialWorld(1, 'medium');
    admin.replays.push({ id: 1, owner: 'death', move: 'ATK-11', variant: 'a', ip: '203.0.113.61', recordedIp: '203.0.113.61', startedAt: 0, cursor: 0 });
    line(admin, 100, '203.0.113.61', 'POST', '/api/Users', 201, 'ATK-11');
    admin.logs.dbChanges.push({ t: 100, op: 'insert', table: 'Users', key: { id: 327 }, after: { id: 327, email: 'support-ops@juice-sh.op', role: 'admin' } });
    stepAlerts(admin);
    expect(open(admin)).toMatchObject([{ about: 'ATK-11', route: '/api/Users', gate: 'sign-up', symptom: 'a new account with the admin role appeared in Users' }]);
    const up = initialWorld(1, 'medium');
    up.replays.push({ id: 1, owner: 'death', move: 'ATK-13', variant: 'a', ip: '203.0.113.70', recordedIp: '203.0.113.70', startedAt: 0, cursor: 0 });
    up.files.push({ path: 'complaints/rip.php', size: 1, sha256: 'a'.repeat(64), plantedBy: 'ATK-13' });
    stepAlerts(up);
    expect(open(up)).toMatchObject([{ about: 'ATK-13', route: '/file-upload', gate: 'uploads', symptom: 'a new file appeared in uploads/ (complaints/rip.php)' }]);
    stepAlerts(up);
    expect(up.alerts).toHaveLength(1); // seen once
    const prod = initialWorld(1, 'medium');
    prod.replays.push({ id: 1, owner: 'death', move: 'ATK-15', variant: 'a', ip: '203.0.113.75', recordedIp: '203.0.113.75', startedAt: 0, cursor: 0 });
    line(prod, 100, '203.0.113.75', 'PUT', '/api/Products/1', 200, 'ATK-15', 'curl/8.23.0');
    prod.logs.dbChanges.push({ t: 100, op: 'update', table: 'Products', key: { id: 1 }, after: { description: 'x' } });
    stepAlerts(prod);
    expect(open(prod)).toMatchObject([{ about: 'ATK-15', route: '/api/Products', gate: 'products' }]);
  });

  it('one open alert per actor; a burst seen once its actor is gone is history at once; the gate names follow the route', () => {
    const w = initialWorld(1, 'medium');
    expect(openAlert(w, 'ATK-01', '/', 'one')).toBeDefined();
    expect(openAlert(w, 'ATK-01', '/rest/user/login', 'two')).toBeUndefined();
    expect(w.alerts).toHaveLength(1);
    stepAlerts(w); // ATK-01 is not active: its alert closes at once
    expect(w.alerts[0]!.closedAt).toBe(w.clock.gameMs);
    expect(['/', '/rest/user/login', '/rest/products/search', '/api/Users', '/api/Products', '/file-upload', '/api/Feedbacks', '/support/logs', '/rest/memories', '/rest/products/*/reviews'].map(gateOf))
      .toEqual(['front door', 'login', 'search', 'admin API', 'products', 'uploads', 'feedback', 'open logs', 'photo wall', 'reviews']);
  });
});

describe('every committed recording played alone (D-232)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  const real = committedLibrary();
  const MOVES_RECORDED: MoveId[] = ['ATK-01', 'ATK-03', 'ATK-04', 'ATK-06', 'ATK-08', 'ATK-09', 'ATK-11', 'ATK-13', 'ATK-15', 'ATK-17'];

  /** The route an alert names was really used by the recording: its lines ask for it, or its DB/file change is the one that route makes. */
  function usedRoute(rec: Parameters<typeof libraryFrom>[0][number], route: string): boolean {
    if (route === '/') return true;
    if (rec.events.some((e) => e.kind === 'access' && e.target.split('?')[0]!.startsWith(route))) return true;
    if (route === '/api/Users') return rec.events.some((e) => e.kind === 'db' && e.table === 'Users' && e.op === 'insert');
    if (route === '/file-upload') return rec.events.some((e) => e.kind === 'file');
    if (route === '/api/Products') return rec.events.some((e) => e.kind === 'db' && e.table === 'Products');
    return false;
  }

  for (const move of MOVES_RECORDED) {
    for (const v of real.variantsOf(move)) {
      it(`${move}.${v.variant} opens one alert after its first lines, with a route it really used, a symptom and a gate, and no spoiler`, () => {
        const w = lab(initialWorld(1, 'hard')); // Hard: every variant may play
        startReplay(w, v, 'death');
        expect(w.alerts).toEqual([]); // D-232: nothing at move start
        for (let i = 0; i < 4000 && w.replays.length > 0 && !w.ending; i++) advance(w, real, 100);
        const alerts = w.alerts.filter((a) => a.about === move);
        expect(alerts.length, `${move}.${v.variant}`).toBe(1);
        const a = alerts[0]!;
        expect(a.openedAt).toBeGreaterThanOrEqual(w.logs.access.find((l) => l.by === move)?.t ?? Infinity);
        expect(a.symptom).not.toMatch(SPOILER);
        expect(a.gate).not.toMatch(SPOILER);
        expect(a.gate).toBe(gateOf(a.route));
        expect(usedRoute(v.recording, a.route), `${move}.${v.variant}: ${a.route}`).toBe(true);
        expect(a.closedAt).toBeDefined(); // closed with the move
      });
    }
  }

  for (const id of ['MIN-01', 'MIN-02', 'MIN-03', 'MIN-04'] as MinionId[]) {
    it(`${id}'s wave opens an alert by its lines, named by its route, closed with the wave`, () => {
      const w = lab(initialWorld(1, 'hard'));
      w.nextWaveAt = { 'MIN-01': Infinity, 'MIN-02': Infinity, 'MIN-03': Infinity, 'MIN-04': Infinity, [id]: 0 };
      for (let i = 0; i < 600 && !eventsOfKind(w, 'wave-ended').length; i++) advance(w, real, 100);
      const alerts = w.alerts.filter((a) => a.about === id);
      expect(alerts.length, id).toBe(1);
      expect(alerts[0]!.symptom).not.toMatch(SPOILER);
      expect(alerts[0]!.openedAt).toBeGreaterThanOrEqual(eventsOfKind(w, 'wave-started')[0]!.t);
      expect(alerts[0]!.closedAt).toBeDefined();
    });
  }

  it('a leaky tap opens its alert with the tap, from the scraper\'s first line', () => {
    const w = initialWorld(1, 'medium');
    w.taps.nextAt = 0;
    stepTaps(w);
    const id = w.taps.open[0]!.id;
    expect(w.alerts).toMatchObject([{ about: id, route: expect.stringMatching(/^\//), gate: expect.any(String) }]);
    expect(w.alerts[0]!.symptom).not.toMatch(SPOILER);
    expect(w.alerts[0]!.symptom).toContain('unknown client');
  });

  it('the customers alone open no alert: the committed traffic on Hard for 15 real minutes, and the made-up traffic', () => {
    for (const library of [real, withTraffic(FIXTURE_LIBRARY, FIXTURE_TRAFFIC)]) {
      const w = initialWorld(1, 'hard');
      for (let i = 0; i < 15 * 600; i++) {
        w.clock.gameMs += CONFIG.hard.tickGameMs;
        stepCustomers(w, library);
        stepAlerts(w);
      }
      expect(w.logs.access.length).toBeGreaterThan(1000);
      expect(w.alerts).toEqual([]);
      expect(w.incident.declaredAt).toBeUndefined();
    }
  });
});

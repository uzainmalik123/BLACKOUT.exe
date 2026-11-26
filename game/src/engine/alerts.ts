// Alerts (SYS-20, D-232): IDS-style. An alert opens when a per-route detector over the detection data crosses its
// threshold (a request burst, probe paths, failed logins, a command-line login, search errors, a scraper's pace,
// feedback spam, a new admin row, a new upload, a product changed), never at move start, and it carries a `route`, a
// `symptom` built from the count and a `gate` name. `about` (the actor of the line that crossed) stays internal: it is
// how the alert closes when that move lands or is cut, that wave ends or that tap closes, and it is a spoiler.
// A customer's line never opens one. One open alert per actor at a time.
import { TAP_BY_ID } from '../rules/taps';
import type { Actor, TapId } from '../rules/vocabulary';
import { CONFIG, type AlertThresholds } from './config';
import { emit } from './log';
import { declareIncident } from './shift';
import type { AccessLine, Alert, World } from './state';

const REAL_S = 30_000; // game ms (SYS-01)

/** The gate name a route belongs to, in the player's words (D-225's entrances, D-235). */
export function gateOf(route: string): string {
  if (route === '/') return 'front door';
  if (route === '/rest/user/login') return 'login';
  if (route === '/rest/user/login (passwords)') return 'passwords';
  if (route === '/rest/products/search') return 'search';
  if (route === '/api/Users (sign-up)') return 'sign-up';
  if (route === '/api/Users') return 'admin API';
  if (route === '/api/Products') return 'products';
  if (route === '/file-upload') return 'uploads';
  if (route === '/api/Feedbacks') return 'feedback';
  for (const tap of Object.values(TAP_BY_ID)) if (tap.closedBy.rule.path === route) return tap.name.toLowerCase();
  return route;
}

function nextId(world: World): number {
  return world.death.nextId++;
}

/** Opens an alert about `about` on `route` with `symptom`, unless one is already open about that actor. */
export function openAlert(world: World, about: Actor, route: string, symptom: string): Alert | undefined {
  if (world.alerts.some((a) => a.about === about && a.closedAt === undefined)) return undefined;
  const id = nextId(world);
  const alert: Alert = { id, about, openedAt: world.clock.gameMs, route: route.replace(/ \(.*\)$/, ''), symptom, gate: gateOf(route) };
  world.alerts.push(alert);
  world.quietAlertsSince = world.clock.gameMs;
  emit(world, { kind: 'alert-opened', alert: id, about, route: alert.route, symptom });
  declareIncident(world, 'alert'); // D-230: the first alert lifts the change freeze
  return alert;
}

/** Closes every open alert about `about` (a move landed or cut, a wave over, a tap closed). */
export function closeAlert(world: World, about: Actor): void {
  for (const alert of world.alerts) {
    if (alert.about !== about || alert.closedAt !== undefined) continue;
    alert.closedAt = world.clock.gameMs;
    world.quietAlertsSince = world.clock.gameMs;
    emit(world, { kind: 'alert-closed', alert: alert.id, about });
  }
}

/** A leaky tap's alert opens with the tap (D-232): its scraper's first line names the route. */
export function openTapAlert(world: World, id: TapId, firstTarget: string): void {
  const route = TAP_BY_ID[id].closedBy.rule.path;
  const path = firstTarget.split('?')[0]!;
  openAlert(world, id, route, `unusual activity on ${route}: an unknown client fetched ${path} and keeps coming back for it`);
}

const PROBE = /\/wp-|\.php(\b|$)|\/\.env|\/\.git|phpmyadmin|\.bak(\b|$)|\/\.htaccess/i;
const PACED_ROUTES = ['/api/Users', '/api/Products', '/rest/memories', '/support/logs'] as const;

/** A sliding window of game-ms stamps per key: pushes `t`, drops what fell out of the window, returns the count. */
function count(world: World, key: string, t: number, windowRealS: number): number {
  const windows = world.detect.windows;
  const since = t - windowRealS * REAL_S;
  const ts = (windows[key] ??= []);
  ts.push(t);
  let drop = 0;
  while (drop < ts.length && ts[drop]! < since) drop++;
  if (drop > 0) ts.splice(0, drop);
  return ts.length;
}

/** The detector's count crossed its threshold on this line: the exact moment it reaches `count` (not every line after). */
const crossed = (n: number, threshold: { count: number }) => n === threshold.count;

/** The actor whose line can open an alert: never a customer's (D-232). */
const hostile = (by: Actor) => by !== 'CUST';

function detectLine(world: World, l: AccessLine, th: AlertThresholds): void {
  const path = l.target.split('?')[0]!;
  const t = l.t;
  // 1. A request burst from one address: a scan, a fast dump.
  const burst = count(world, `burst|${l.ip}`, t, th.burst.windowRealS);
  if (crossed(burst, th.burst) && hostile(l.by)) openAlert(world, l.by, '/', `unusual activity on the site: ${burst} requests in ${th.burst.windowRealS} s from one address`);
  // 2. Probe-looking paths: WordPress, PHP, dotfiles, backups. Over every address: a crawler wave rotates its lines through several, and no shopper asks for these.
  if (PROBE.test(path)) {
    const n = count(world, 'probes|*', t, th.probes.windowRealS);
    if (crossed(n, th.probes) && hostile(l.by)) openAlert(world, l.by, '/', `unusual activity on the site: ${n} requests for PHP, WordPress or config paths in ${th.probes.windowRealS} s`);
  }
  if (path === '/rest/user/login' && l.method === 'POST') {
    // 3. Failed logins: a burst from one address (a password list), or many in all (credential stuffing from many addresses).
    if (l.status === 401) {
      const one = count(world, `logins|${l.ip}`, t, th.failedLogins.windowRealS);
      const all = count(world, 'logins|*', t, th.failedLoginsAll.windowRealS);
      if (crossed(one, th.failedLogins) && hostile(l.by)) openAlert(world, l.by, '/rest/user/login (passwords)', `unusual activity on /rest/user/login: ${one} failed logins in ${th.failedLogins.windowRealS} s from one address`);
      else if (crossed(all, th.failedLoginsAll) && hostile(l.by)) openAlert(world, l.by, '/rest/user/login (passwords)', `unusual activity on /rest/user/login: ${all} failed logins in ${th.failedLoginsAll.windowRealS} s from many addresses`);
      // 3b. A slow spray from one address: few tries a minute, so the burst never crosses, but they add up (ATK-04.b).
      const slow = count(world, `slowlogins|${l.ip}`, t, th.slowFailedLogins.windowRealS);
      if (crossed(slow, th.slowFailedLogins) && hostile(l.by)) openAlert(world, l.by, '/rest/user/login (passwords)', `unusual activity on /rest/user/login: ${slow} failed logins in ${th.slowFailedLogins.windowRealS} s from one address, spread out`);
    }
    // 4. A login that succeeded from a command-line client: no browser sends that agent.
    if (l.status === 200 && !/^Mozilla/.test(l.userAgent) && hostile(l.by)) openAlert(world, l.by, '/rest/user/login', `a login succeeded from a command-line client (${l.userAgent.split('/')[0] || 'unknown agent'}) on /rest/user/login`);
  }
  // 5. Server errors on search: an injection being probed. Per address (KI-236: a shopper's quoted search errors too).
  if (path === '/rest/products/search' && l.status >= 500) {
    const n = count(world, `search5xx|${l.ip}`, t, th.searchErrors.windowRealS);
    if (crossed(n, th.searchErrors) && hostile(l.by)) openAlert(world, l.by, '/rest/products/search', `unusual activity on /rest/products/search: ${n} server errors in ${th.searchErrors.windowRealS} s from one address`);
  }
  // 6. A scraper's pace on an API route.
  const paced = PACED_ROUTES.find((r) => path === r || path.startsWith(`${r}/`));
  if (paced !== undefined) {
    const n = count(world, `pace|${paced}`, t, th.apiPace.windowRealS); // over every address: a scraper wave rotates its addresses
    if (crossed(n, th.apiPace) && hostile(l.by)) openAlert(world, l.by, paced, `unusual activity on ${paced}: ${n} requests in ${th.apiPace.windowRealS} s`);
  }
  // 7. Feedback spam.
  if (l.method === 'POST' && path.startsWith('/api/Feedbacks')) {
    const n = count(world, 'feedback|*', t, th.feedback.windowRealS); // over every address: a spam wave rotates its addresses
    if (crossed(n, th.feedback) && hostile(l.by)) openAlert(world, l.by, '/api/Feedbacks', `unusual activity on /api/Feedbacks: ${n} posts in ${th.feedback.windowRealS} s`);
  }
}

/** The actor behind a DB change at `t`: the move writing the only lines of that moment (`dbChanges` carry no actor). */
function actorAt(world: World, t: number): Actor | undefined {
  for (let i = world.logs.access.length - 1; i >= 0; i--) {
    const l = world.logs.access[i]!;
    if (Math.abs(l.t - t) <= 2 * REAL_S && l.by !== 'CUST') return l.by;
    if (l.t < t - 2 * REAL_S) break;
  }
  const r = world.replays.find((x) => x.owner === 'death');
  return r?.move as Actor | undefined;
}

/** One tick: feed the new lines, DB changes and uploads to the detectors. */
export function stepAlerts(world: World): void {
  const th = CONFIG[world.difficulty].alerts;
  const d = world.detect;
  for (; d.logCursor < world.logs.access.length; d.logCursor++) detectLine(world, world.logs.access[d.logCursor]!, th);
  for (; d.dbCursor < world.logs.dbChanges.length; d.dbCursor++) {
    const c = world.logs.dbChanges[d.dbCursor]!;
    if (c.table === 'Users' && c.op === 'insert' && c.after?.role === 'admin') {
      const by = actorAt(world, c.t);
      if (by) openAlert(world, by, '/api/Users (sign-up)', 'a new account with the admin role appeared in Users');
    } else if (c.table === 'Products' && c.op === 'update') {
      const by = actorAt(world, c.t);
      if (by) openAlert(world, by, '/api/Products', 'a product was changed through PUT /api/Products');
    }
  }
  for (const f of world.files) {
    if (f.plantedBy === undefined || d.files.includes(f.path)) continue;
    d.files.push(f.path);
    openAlert(world, f.plantedBy, '/file-upload', `a new file appeared in uploads/ (${f.path})`);
  }
  // A burst seen in the tick its actor finished: the alert is history at once (its symptom stays in the list).
  for (const a of world.alerts) {
    if (a.closedAt !== undefined || a.about === 'CUST') continue;
    const active = world.replays.some((r) => r.move === a.about) || world.waves.some((w) => w.minion === a.about) || world.taps.open.some((t) => t.id === a.about);
    if (!active) closeAlert(world, a.about);
  }
}

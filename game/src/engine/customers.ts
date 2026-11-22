// Customer traffic (SYS-19, D-60, D-65): REC-06's shoppers play underneath everything, looping (CUST.a, then CUST.b, in
// turn: D-131), from the shared
// address pool, and the world answers them as a real shop would: 503 from a disabled feature, 429 from a rate
// limit, 403 from a WAF rule that matches them, nothing at all behind a blocked address or a pulled plug. Each
// request the player's actions fail costs heartbeat by what the customer was doing (the backlash), the customer
// complains (a support ticket), and one who fails twice gives up for good (churn). Their DB changes are never
// applied; customers are never souls.
import type { AccessEvent } from '../recordings/format';
import type { Feature, RequestClass, WafRule } from '../rules/vocabulary';
import { gameTimeIso } from './clock';
import { CONFIG } from './config';
import { backlash, churn } from './heartbeat';
import type { RecordingLibrary } from './library';
import { emit } from './log';
import { attackerAddresses, drawAddress, recordedAttackerAddresses } from './pool';
import { mulberry, type AccessLine, type Ticket, type World } from './state';

const SQLI = /'|%27|\bunion\b|\bselect\b|--/i; // what an SQLi rule set would flag in a target: nothing a shopper sends (D-65)
const ERROR_BYTES = { 403: 153, 429: 169, 503: 197 } as const; // nginx's default error pages (estimates, KI-84)
const FEEDBACK_ID_BASE = 1000; // angry Feedbacks rows start here, clear of the baseline's and the recording's own

/** What a customer request is, by method and path (D-65, from PR #73's list). */
export function classify(method: string, target: string): RequestClass {
  const path = target.split('?')[0]!;
  if (path === '/rest/products/search') return /[?&]q=[^&]/.test(target) ? 'search' : 'page'; // the empty q= is the product list
  if (path === '/rest/user/login' || path === '/rest/user/whoami' || path === '/rest/saveLoginIp') return 'login';
  if (path.startsWith('/api/Users') || path.startsWith('/api/SecurityQuestions') || path.startsWith('/api/SecurityAnswers')) return 'signup';
  if (/^\/rest\/basket\/\d+\/checkout$/.test(path) || path.startsWith('/api/Addresss') || path.startsWith('/api/Deliverys') || path.startsWith('/api/Cards') || path === '/rest/wallet/balance' || path.startsWith('/rest/track-order')) return 'checkout';
  if (path.startsWith('/rest/basket') || path.startsWith('/api/BasketItems')) return 'basket';
  if (path.startsWith('/rest/captcha') || path.startsWith('/api/Feedbacks')) return 'feedback';
  if (path === '/file-upload' || path.startsWith('/api/Complaints')) return 'complaint';
  if (path.startsWith('/rest/user/reset-password') || path.startsWith('/rest/user/security-question')) return 'password-reset';
  if (path === '/ftp' || path.startsWith('/ftp/')) return 'ftp';
  return 'page';
}

/** The feature a request needs, if the flags console can switch it off (D-65). */
const FEATURE_OF: Partial<Record<RequestClass, Feature>> = { search: 'search', signup: 'registration', 'password-reset': 'password-reset', ftp: 'ftp' };
function featureNeeded(about: RequestClass, path: string): Feature | undefined {
  if (about === 'complaint') return path === '/file-upload' ? 'uploads' : undefined; // the complaint text still posts
  return FEATURE_OF[about];
}

/** A WAF path pattern against a request path: segment by segment, `*` matching one segment, the pattern a prefix. */
export function pathMatches(pattern: string, path: string): boolean {
  const want = pattern.split('/').filter((s) => s !== '');
  const have = path.split('/').filter((s) => s !== '');
  if (want.length === 0 || want.length > have.length) return false;
  return want.every((seg, i) => seg === '*' || seg === have[i]);
}

/** D-65: does this WAF rule block this customer request? Literal, unlike the Director's symbolic stoppers (D-24). */
export function ruleBlocks(rule: WafRule, line: { method: string; target: string; userAgent: string }): boolean {
  const path = line.target.split('?')[0]!;
  switch (rule.kind) {
    case 'sqli': return SQLI.test(line.target);
    case 'block-user-agent': return line.userAgent.toLowerCase().includes(rule.pattern.toLowerCase());
    case 'block-path': return rule.method.toUpperCase() === line.method.toUpperCase() && pathMatches(rule.path, path);
    case 'rate-limit': return false; // a rate limit answers 429 to bursts, see rateLimited()
  }
}

function nextRandom(world: World): number {
  const { value, state } = mulberry(world.customers.rng);
  world.customers.rng = state;
  return value;
}

/** D-65: a rate-limited path answers 429 to an address past `burst` hits within the window (recorded time). */
function rateLimited(world: World, recordedIp: string, path: string, t: number): boolean {
  const { windowMs, burst } = CONFIG[world.difficulty].customers.rateLimit;
  let limited = false;
  for (const rule of world.waf) {
    if (rule.kind !== 'rate-limit' || !pathMatches(rule.path, path)) continue;
    const key = `${recordedIp} ${rule.path}`;
    const hits = (world.customers.hits[key] ?? []).filter((h) => t - h < windowMs);
    if (hits.length >= burst) limited = true;
    hits.push(t);
    world.customers.hits[key] = hits;
  }
  return limited;
}

const TICKET_TEXT: Record<Ticket['status'], Partial<Record<RequestClass, string>> & { default: string }> = {
  503: {
    default: 'Your site keeps showing an error page. Is something wrong?',
    search: "Search has been broken for a while now. I can't find anything, every search says 503.",
    signup: "I'm trying to create an account and it just errors out. Twice now.",
    complaint: "I can't attach my invoice to my complaint, the upload fails every time.",
    'password-reset': "Forgot-password doesn't work. I'm locked out of my own account.",
    ftp: "The documents link on your site gives an error page.",
  },
  429: { default: "Your site keeps telling me 'too many requests'. I'm one person.", login: "I mistyped my password and now your site says 'too many requests'. I just want to log in." },
  403: { default: "I get a 'Forbidden' page when I open your shop. I haven't done anything." },
  blocked: { default: "Your website doesn't load at all from my connection. Other sites are fine." },
};

const FEEDBACK_TEXT: Partial<Record<RequestClass, string>> & { default: string } = {
  default: 'Gave up. Your shop is broken today, every page errors. Taking my order elsewhere.',
  search: "Search is dead and I can't find a single product. Giving up, shopping elsewhere.",
  signup: "Couldn't even sign up, your form errors every time. Not coming back.",
  checkout: 'Checkout failed and now I have no idea if I was charged. Awful.',
  login: "Can't log in, your site keeps blocking me. One star.",
};

function line(world: World, t: number, ip: string, e: Pick<AccessEvent, 'method' | 'target' | 'protocol' | 'referer' | 'userAgent'>, status: number, bytes: number): void {
  const out: AccessLine = { t, ip, method: e.method, target: e.target, protocol: e.protocol, status, bytes, referer: e.referer, userAgent: e.userAgent, by: 'CUST' };
  world.logs.access.push(out);
}

/** One failed request: its cost, a ticket at the shopper's first failure this loop, and churn at the second (D-65). */
function fail(world: World, library: RecordingLibrary, e: AccessEvent, t: number, ip: string, about: RequestClass, status: Ticket['status']): void {
  const c = world.customers;
  backlash(world, about);
  const first = c.failures[e.ip] === undefined;
  const n = (c.failures[e.ip] ?? 0) + (about === 'page' ? 0 : 1); // a page bit failing to load annoys; what they were trying to do failing drives them off
  c.failures[e.ip] = n;
  if (first) {
    const texts = TICKET_TEXT[status];
    const ticket: Ticket = { id: world.tickets.length + 1, t, ip, userAgent: e.userAgent, about, status, text: texts[about] ?? texts.default };
    world.tickets.push(ticket);
    emit(world, { kind: 'ticket', ticket: ticket.id, about, status });
  }
  if (n >= CONFIG[world.difficulty].customers.giveUpAfter && !c.gone.includes(e.ip)) {
    c.gone.push(e.ip);
    angryFeedback(world, library, e, t, ip, about, status);
    churn(world, about);
  }
}

/** On the way out a shopper who can still reach the shop leaves one-star feedback: real lines and a Feedbacks row. */
function angryFeedback(world: World, library: RecordingLibrary, e: AccessEvent, t: number, ip: string, about: RequestClass, status: Ticket['status']): void {
  if (status === 'blocked' || status === 403) return; // dropped at the firewall, or the WAF would block the feedback too
  const post = { method: 'POST', target: '/api/Feedbacks/', protocol: e.protocol, referer: e.referer, userAgent: e.userAgent };
  const captcha = { ...post, method: 'GET', target: '/rest/captcha/' };
  if (world.waf.some((r) => ruleBlocks(r, post) || ruleBlocks(r, captcha))) return;
  const sample = (target: string) => library.variantsOf('CUST').flatMap((v) => v.recording.events).find((x): x is AccessEvent => x.kind === 'access' && x.target === target);
  line(world, t, ip, captcha, 200, sample('/rest/captcha/')?.bytes ?? 49);
  line(world, t, ip, post, 201, sample('/api/Feedbacks/')?.bytes ?? 228);
  const id = FEEDBACK_ID_BASE + world.customers.lost + 1;
  const at = gameTimeIso(world, t).replace('T', ' ').replace('Z', ' +00:00');
  const comment = `${FEEDBACK_TEXT[about] ?? FEEDBACK_TEXT.default} (anonymous)`;
  world.logs.dbChanges.push({ t, op: 'insert', table: 'Feedbacks', key: { id }, after: { id, UserId: null, comment, rating: 1, createdAt: at, updatedAt: at } });
}

/** The rarest, most valuable thing a shopper does in the recording: the strata a loop samples from (D-65, D-131). */
const STRATA: readonly RequestClass[] = ['signup', 'complaint', 'checkout', 'password-reset', 'ftp', 'login', 'search', 'page'];

/**
 * A new loop: a fresh seeded subset of the recording's shoppers, each with a pool address nobody holds (D-65). The subset
 * keeps the recording's mix: shoppers are grouped by the rarest thing they do (a sign-up, a complaint, a checkout, a
 * login, a search, just browsing) and each group gives its share, largest remainders first, so a loop always has about
 * the same number of sign-ups and checkouts and the cost of a flag doesn't swing on who happened to be sampled.
 */
function startLoop(world: World, library: RecordingLibrary, shoppers: Shoppers, startedAt: number): void {
  const c = world.customers;
  c.loop += 1;
  c.loopStartedAt = startedAt;
  c.cursor = 0;
  c.failures = {};
  c.gone = [];
  c.hits = {};
  const share = CONFIG[world.difficulty].customers.share;
  const total = Math.round(shoppers.all.length * share);
  const quota = STRATA.map((s) => ({ stratum: s, exact: (shoppers.byStratum[s]?.length ?? 0) * share }));
  const counts = quota.map((q) => Math.floor(q.exact));
  for (const q of [...quota.keys()].sort((a, b) => (quota[b]!.exact % 1) - (quota[a]!.exact % 1))) {
    if (counts.reduce((n, k) => n + k, 0) >= total) break;
    if (counts[q]! < (shoppers.byStratum[quota[q]!.stratum]?.length ?? 0)) counts[q]! += 1;
  }
  const avoid = new Set([...recordedAttackerAddresses(library), ...attackerAddresses(world)]);
  const addresses: Record<string, string> = {};
  quota.forEach((q, i) => {
    const pool = [...(shoppers.byStratum[q.stratum] ?? [])];
    for (let k = 0; k < counts[i]! && pool.length > 0; k++) {
      const recorded = pool.splice(Math.floor(nextRandom(world) * pool.length), 1)[0]!;
      const ip = drawAddress(() => nextRandom(world), avoid);
      avoid.add(ip);
      addresses[recorded] = ip;
    }
  });
  c.addresses = addresses;
}

/** One tick: play the customer requests that are due, as the world answers them now. */
export function stepCustomers(world: World, library: RecordingLibrary): void {
  const traffic = library.variantsOf('CUST').filter((v) => v.recording.durationMs > 0);
  if (traffic.length === 0) return;
  const recordingOf = (loop: number) => traffic[(loop - 1) % traffic.length]!.recording; // CUST.a, CUST.b, CUST.a, … (D-131)
  const ratio = CONFIG[world.difficulty].gameMsPerRealMs;
  const c = world.customers;
  const now = world.clock.gameMs;
  if (c.loop === 0) startLoop(world, library, shoppersOf(recordingOf(1)), 0); // the first loop starts with the run
  for (let end = c.loopStartedAt + recordingOf(c.loop).durationMs * ratio; now >= end; end = c.loopStartedAt + recordingOf(c.loop).durationMs * ratio) {
    startLoop(world, library, shoppersOf(recordingOf(c.loop + 1)), end);
  }
  const rec = recordingOf(c.loop);
  const blocked = new Set(world.firewall.blocked);
  while (c.cursor < rec.events.length && c.loopStartedAt + rec.events[c.cursor]!.t * ratio <= now) {
    const e = rec.events[c.cursor]!;
    c.cursor++;
    if (e.kind !== 'access') continue; // db events are never applied (D-65)
    const ip = c.addresses[e.ip];
    if (ip === undefined || c.gone.includes(e.ip) || world.nginx === 'stopped') continue; // not this loop's shopper, gave up, or nothing reaches a stopped server
    const t = c.loopStartedAt + e.t * ratio;
    const about = classify(e.method, e.target);
    const path = e.target.split('?')[0]!;
    if (blocked.has(ip)) {
      fail(world, library, e, t, ip, about, 'blocked');
      continue;
    }
    if (world.waf.some((r) => ruleBlocks(r, e))) {
      line(world, t, ip, e, 403, ERROR_BYTES[403]);
      fail(world, library, e, t, ip, about, 403);
      continue;
    }
    if (rateLimited(world, e.ip, path, e.t)) {
      line(world, t, ip, e, 429, ERROR_BYTES[429]);
      fail(world, library, e, t, ip, about, 429);
      continue;
    }
    const feature = featureNeeded(about, path);
    if (feature !== undefined && !world.features[feature]) {
      line(world, t, ip, e, 503, ERROR_BYTES[503]);
      fail(world, library, e, t, ip, about, 503);
      continue;
    }
    line(world, t, ip, e, e.status, e.bytes);
    c.served += 1;
  }
}

interface Shoppers { all: string[]; byStratum: Partial<Record<RequestClass, string[]>> }
const shoppersCache = new WeakMap<object, Shoppers>();
/** The recorded addresses in the traffic, in first-seen order, and grouped by the rarest thing each does. */
function shoppersOf(rec: { events: readonly { kind: string }[] }): Shoppers {
  let shoppers = shoppersCache.get(rec);
  if (!shoppers) {
    const best = new Map<string, number>();
    for (const e of rec.events as AccessEvent[]) {
      if (e.kind !== 'access') continue;
      const rank = STRATA.indexOf(classify(e.method, e.target));
      const i = rank === -1 ? STRATA.length - 1 : rank;
      best.set(e.ip, Math.min(best.get(e.ip) ?? Infinity, i));
    }
    const byStratum: Partial<Record<RequestClass, string[]>> = {};
    for (const [ip, i] of best) (byStratum[STRATA[i]!] ??= []).push(ip);
    shoppers = { all: [...best.keys()], byStratum };
    shoppersCache.set(rec, shoppers);
  }
  return shoppers;
}

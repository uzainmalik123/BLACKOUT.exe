// Plain-words explanations of log lines (PRD CON-05, for KIRO-05's hover and "explain this line"): one per
// recorded line type, pre-written, used when Kiro is offline (KIRO-09) and, on Easy, as the hover text. A line
// type is a shape of line in the access log (what was asked for and what the shop answered) or the app log; the
// explanation says what the request was, who or what likely sent it, and what is normal or not about it. It
// never names an internal id and never tells the player what to do (D-152).

export interface ParsedAccess {
  ip: string;
  method: string;
  /** The request target as logged (path plus query). */
  target: string;
  path: string;
  /** The query string without `?`, URL-decoded; '' when there is none. */
  query: string;
  protocol: string;
  status: number;
  bytes: number;
  referer: string;
  userAgent: string;
}

const COMBINED = /^(\S+) \S+ \S+ \[([^\]]*)\] "(\S+) (\S+) (\S+)" (\d{3}) (\d+) "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"\s*$/;

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** Parses one line of nginx's `combined` format (the access log the engine renders); undefined for anything else. */
export function parseCombined(line: string): ParsedAccess | undefined {
  const m = COMBINED.exec(line);
  if (!m) return undefined;
  const [, ip, , method, target, protocol, status, bytes, referer, userAgent] = m as unknown as string[];
  const q = target!.indexOf('?');
  return {
    ip: ip!,
    method: method!,
    target: target!,
    path: q < 0 ? target! : target!.slice(0, q),
    query: q < 0 ? '' : decode(target!.slice(q + 1)),
    protocol: protocol!,
    status: Number(status),
    bytes: Number(bytes),
    referer: referer === '-' ? '' : referer!,
    userAgent: userAgent === '-' ? '' : userAgent!,
  };
}

export type Sender = 'browser' | 'curl' | 'python' | 'sqlmap' | 'ffuf' | 'hydra' | 'scrapy' | 'zgrab' | 'none' | 'unknown';

/** Who or what likely sent a request, from its user agent: one sentence each, added after the line type's text. */
export const SENDERS: Readonly<Record<Sender, string>> = {
  browser: 'The user agent is an ordinary browser\'s, what a shopper\'s page sends; a tool can copy it just as easily, so judge by the pattern, not the name.',
  curl: 'It was sent with curl, a command-line tool: someone typing requests by hand or a script, not a shopper on the page.',
  python: 'It was sent by a Python script (python-requests), not a browser.',
  sqlmap: 'The user agent says sqlmap, an automated SQL injection tool that fires many query shapes at one parameter until the database answers with data.',
  ffuf: 'The user agent says ffuf ("Fuzz Faster U Fool"), a tool that tries a wordlist of paths as fast as it can to map a site.',
  hydra: 'The user agent says Hydra, a password-guessing tool that tries a list of passwords against a login form.',
  scrapy: 'It was sent by Scrapy, a web-scraping framework: a script collecting pages, not a person.',
  zgrab: 'It was sent by zgrab, an internet-wide scanner that tries known paths on every address it can reach.',
  none: 'It carries no user agent at all, which no browser does: a script or a hand-written request.',
  unknown: 'The user agent is not one we know; treat it as a script until the pattern says otherwise.',
};

export function senderOf(userAgent: string): Sender {
  const ua = userAgent;
  if (ua === '') return 'none';
  if (/sqlmap/i.test(ua)) return 'sqlmap';
  if (/Fuzz Faster U Fool|ffuf/i.test(ua)) return 'ffuf';
  if (/Hydra/.test(ua)) return 'hydra';
  if (/Scrapy/i.test(ua)) return 'scrapy';
  if (/zgrab/i.test(ua)) return 'zgrab';
  if (/^curl\//i.test(ua)) return 'curl';
  if (/python-requests/i.test(ua)) return 'python';
  if (/^Mozilla\/5\.0 \((Windows|Macintosh|X11|iPhone|iPad|Linux; Android)/.test(ua) && /(Chrome|Firefox|Safari|Edg)\//.test(ua)) return 'browser';
  return 'unknown';
}

export interface AccessType {
  id: string;
  log: 'access';
  /** A few words for a tooltip title. */
  title: string;
  test: (a: ParsedAccess) => boolean;
  text: string;
}

export interface AppType {
  id: string;
  log: 'app';
  title: string;
  test: RegExp;
  text: string;
}

export type LineType = AccessType | AppType;

const SQL_SHAPE = /union|select|'|"|\)|--|\|\||char\(|sleep\(|\bor\b.*=/i;
const ASSET = /\.(js|mjs|css|map|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|json|txt|xml|mp3|mp4|webm)$/i;
const idPath = (prefix: string) => new RegExp(`^${prefix.replace(/\//g, '\\/')}\\/\\d+\\/?$`);

const t = (id: string, title: string, test: (a: ParsedAccess) => boolean, text: string): AccessType => ({ id, log: 'access', title, test, text });

/**
 * The access log's line types, first match wins. Every recorded access line (D-15) hits one of them, and each is
 * hit by some recorded line or by a line the customer engine writes (SYS-19: 403, 429, 503); the test checks both.
 */
export const ACCESS_TYPES: readonly AccessType[] = [
  // What the world writes for shoppers turned away (SYS-19, D-65).
  t('turned-away-403', 'Forbidden', (a) => a.status === 403,
    'The shop answered 403 Forbidden: a web-application rule on our side matched this request and refused it before the shop saw it. If this address is a shopper\'s, the rule is catching customers too.'),
  t('turned-away-429', 'Too many requests', (a) => a.status === 429,
    'The shop answered 429 Too Many Requests: this address sent more requests in a short time than the path allows, so this one was refused. Tools hit this; so does a customer who retries fast.'),
  t('turned-away-503', 'Feature switched off', (a) => a.status === 503,
    'The shop answered 503 Service Unavailable: the feature behind this path is switched off on our side right now, so the request could not be served. Every visitor gets this answer here, shoppers included.'),

  // Search.
  t('search-injection-error', 'Search: injected SQL, broken', (a) => a.path === '/rest/products/search' && SQL_SHAPE.test(a.query) && a.status >= 500,
    'A product search whose q= holds SQL, not words: quotes, parentheses, UNION SELECT. The shop pastes the search text into its database query, and this shape broke the query, so the answer is a 500 and the app log has the database error. No shopper types this; a tool is feeling out the query\'s shape.'),
  t('search-injection-hit', 'Search: injected SQL, answered', (a) => a.path === '/rest/products/search' && SQL_SHAPE.test(a.query) && a.status < 400,
    'A product search whose q= holds SQL (quotes, UNION SELECT) and got a 200: the injected query ran and the answer carried whatever it selected, which can be rows from any table, not products. Each small 200 of this shape is data leaving the shop.'),
  t('search', 'Product search', (a) => a.path === '/rest/products/search',
    'A product search: the words after q= are what was typed in the search box. Ordinary shopping; many of these per visit is normal.'),

  // Login and sessions.
  t('login-ok', 'Login succeeded', (a) => a.path === '/rest/user/login' && a.method === 'POST' && a.status === 200,
    'A successful login: the shop accepted an email and password sent in the request body (which the access log does not show) and handed back a session token. Normal for a shopper; a success with no failures before it from a new address is worth a second look, and so is one right after a burst of failures.'),
  t('login-failed', 'Login failed', (a) => a.path === '/rest/user/login' && a.method === 'POST' && a.status === 401,
    'A failed login: wrong email or password, answered 401. One or two from an address is a shopper mistyping; a burst from one address is password guessing, and single failures from many addresses at once are leaked passwords being tried.'),
  t('login-get', 'Login fetched, not posted', (a) => a.path === '/rest/user/login' && a.method !== 'POST',
    'A GET of the login path: the login only takes POST, so the shop had no route for this and crashed the request with a 500 and a stack trace in the app log. Browsers never do this; password-guessing tools do it before each try.'),
  t('session-check', 'Who am I', (a) => a.path === '/rest/user/whoami' || a.path === '/rest/saveLoginIp',
    'The page asking the shop who is logged in (and noting the address it came from): housekeeping a browser does after a login and on every reload. Normal.'),

  // Passwords and accounts.
  t('reset-ok', 'Password reset done', (a) => a.path === '/rest/user/reset-password' && a.status === 200,
    'A password reset that went through: the security question was answered correctly and that account now has a new password. If the customer did not ask for it, someone else now holds their account.'),
  t('reset-failed', 'Password reset refused', (a) => a.path === '/rest/user/reset-password' && a.status >= 400,
    'A password reset refused with 401: the security-question answer was wrong. One is a customer who forgot; several for the same account are someone guessing the answer.'),
  t('security-question', 'Forgot-password lookup', (a) => a.path === '/rest/user/security-question',
    'The forgot-password page asking which security question an account has. The email is in the URL, so this line names a customer in plain text: anyone who reads this log learns that address.'),
  t('security-answer', 'Security answer saved', (a) => a.path.startsWith('/api/SecurityAnswers'),
    'The second half of a sign-up: the new account\'s security question and answer being saved. Normal right after a 201 on /api/Users.'),
  t('signup', 'Account created', (a) => (a.path === '/api/Users' || a.path === '/api/Users/') && a.method === 'POST',
    'A new account was created (201). The fields sent, including the role the account asked for, are in the request body, which this log does not show; the Users table in the database says what the shop actually stored.'),
  t('user-record', 'One account read', (a) => idPath('/api/Users').test(a.path) && a.method === 'GET',
    'One account\'s record from the admin API: email, role and dates, read by number. A 404 is a number with no account. An admin page reads one or two; one address reading the numbers in order, one after another, is copying the customer list.'),
  t('user-list', 'All accounts read', (a) => (a.path === '/api/Users' || a.path === '/api/Users/') && a.method === 'GET',
    'Every account in the shop in one answer, from the admin API. The admin page does this once when it opens; anyone else doing it is taking the customer list.'),

  // Shopping.
  t('basket', 'Basket', (a) => /^\/rest\/basket\/\d+\/?$/.test(a.path) || a.path.startsWith('/api/BasketItems'),
    'A shopper\'s basket: reading it by number, or adding and changing items. Normal; one session reading many basket numbers in a row is looking into other people\'s baskets.'),
  t('checkout', 'Checkout', (a) => /^\/rest\/basket\/\d+\/checkout/.test(a.path) || /^\/api\/(Addresss|Cards|Deliverys)/.test(a.path) || a.path === '/rest/wallet/balance',
    'Checkout: an address, a card, a delivery option or the wallet balance, then the order itself. Ordinary shopping.'),
  t('reviews', 'Product reviews', (a) => /^\/rest\/products\/\d+\/reviews/.test(a.path),
    'The reviews of one product. The answer names each reviewer by email, with no login needed, so an address walking product numbers through this path is collecting customer emails, not reading reviews.'),
  t('product-update', 'Product changed', (a) => /^\/api\/Products\/\d+/.test(a.path) && (a.method === 'PUT' || a.method === 'PATCH'),
    'A product\'s record was changed through the API, and the shop accepted it without asking who was sending. Whatever was written (a new name, a new description) is what every customer now sees on the page.'),
  t('catalogue', 'Catalogue', (a) => /^\/api\/Products/.test(a.path) || a.path === '/api/Quantitys/' || a.path === '/api/Quantitys',
    'The product catalogue and stock counts, read as the shop page loads or scrolls. Normal; the same address reading it over and over without ever buying is a scraper, and the load slows the shop.'),

  // Feedback, uploads, files.
  t('captcha', 'Feedback puzzle', (a) => a.path.startsWith('/rest/captcha'),
    'The feedback form fetching its CAPTCHA puzzle. The shop\'s own puzzle sends its answer along with the question, so a script can read the answer and post; one fetch per feedback is normal, hundreds are a bot.'),
  t('feedback-post', 'Feedback posted', (a) => a.path.startsWith('/api/Feedbacks') && a.method === 'POST',
    'A feedback message was posted and will show on the shop\'s feedback page. One now and then is a customer; a steady stream from one address is spam.'),
  t('feedback-list', 'Feedback read', (a) => a.path.startsWith('/api/Feedbacks'),
    'The shop\'s feedback list being read, as the about page does. Normal.'),
  t('complaint', 'Complaint filed', (a) => a.path.startsWith('/api/Complaints') && a.method === 'POST',
    'A complaint was filed through the complaint form (201). When a file came with it there is a /file-upload line from the same address just before this one.'),
  t('upload', 'File uploaded', (a) => a.path === '/file-upload',
    'A file was uploaded through the complaint form (204 means accepted with nothing to say back). The shop checks the name, not the content, and unpacks a zip into its uploads folder. Look in uploads/complaints for what arrived.'),
  t('ftp-listing', 'Public folder listed', (a) => a.path === '/ftp' || a.path === '/ftp/',
    'The shop\'s public /ftp folder listed: a leftover directory that shows every file in it to anyone. A 200 here means someone saw the file names.'),
  t('ftp-file', 'Public folder file', (a) => a.path.startsWith('/ftp/'),
    'A file read from the shop\'s public /ftp folder, with no login. Legal notes are meant to be there; company documents and backup files are not, and a 200 means the file was handed over.'),
  t('support-logs', 'Server logs read', (a) => a.path.startsWith('/support/logs'),
    'Someone read the shop\'s own access logs through the web, from a support path that lists and serves them with no login. The logs hold every URL customers visited, including the ones with an email in them.'),
  t('memories', 'Photo wall', (a) => a.path.startsWith('/rest/memories'),
    'The photo wall\'s pictures, with no login. Each picture comes with its poster\'s full account record, password hash included, so a large 200 here is customer data leaving the shop.'),

  // The page itself.
  t('config', 'Page settings', (a) => /^\/rest\/(admin\/application-(configuration|version)|languages)$/.test(a.path) || a.path.startsWith('/api/SecurityQuestions'),
    'The shop page fetching its own settings as it loads: configuration, version, languages, the list of security questions. Every visit does this. Normal.'),
  t('home', 'Home page', (a) => a.method === 'GET' && (a.path === '/' || a.path === '/index.html') && a.status < 300,
    'The shop\'s home page, the first thing a browser loads. Normal; a tool fetches it too, once.'),
  t('asset', 'Page file', (a) => a.method === 'GET' && (a.path.startsWith('/assets/') || ASSET.test(a.path)) && a.status < 300,
    'A file the page is built from: a script, a stylesheet, an image, a translation. Browsers fetch dozens of these per visit; they say nothing on their own.'),
  t('redirect', 'Redirected', (a) => a.status >= 300 && a.status < 400,
    'The shop sent the caller somewhere else (a 301 or 302), usually because a folder was asked for without its trailing slash. Harmless on its own.'),

  // Paths the shop has no page for.
  t('api-probe', 'Path that crashed the shop', (a) => a.status >= 500,
    'A request to a path the shop has no page for, which crashed it: a 500 here and an error with a stack trace in the app log. Anything starting with /api or /rest that the shop does not know does this ("Unexpected path"), and so do a few pages asked for without what they need (a profile with no login, a redirect with no target). Browsers only ask for paths the page knows; this is a scanner guessing names.'),
  t('probe', 'Unknown path', (a) => a.status === 200 || a.status === 404,
    'A path that is not part of the shop (a configuration file, an admin page from some other software, a word from a list). The shop answers unknown paths with its home page, so a 200 here does not mean the file exists: only the size tells (the home page is always the same size). Scanners send thousands of these; shoppers none.'),
];

const app = (id: string, title: string, test: RegExp, text: string): AppType => ({ id, log: 'app', title, test, text });

/** The app log's line types, first match wins; every recorded app line hits one. */
export const APP_TYPES: readonly AppType[] = [
  app('sqlite-error', 'Database error', /^Error: SQLITE_ERROR:/,
    'The database refused a query: "near X: syntax error" means text from a request was pasted into the SQL and broke it. The shop\'s own pages never produce this; it is what a search or a login with SQL in it leaves behind. The quoted fragment shows the shape being tried.'),
  app('unexpected-path', 'No route', /^Error: Unexpected path:/,
    'The shop was asked for an API path it has no code for and raised an error instead of a plain 404. The path is quoted; a run of these with made-up names is a scanner, and one with SQL in the query is an injection tool\'s request that fell through to the error.'),
  app('illegal-activity', 'Shop refused a request', /^Error: Blocked illegal activity by/,
    'The shop\'s own check refused a request from the quoted address: a path it treats as an attack (a known exploit name or a redirect to a site it does not trust). The shop handled this one itself; it says the address is probing.'),
  app('type-error', 'Shop code crashed', /^TypeError:/,
    'The shop\'s code hit a value it did not expect and crashed the request. The lines after it say where. Usually a request shaped in a way the page never sends.'),
  app('stack-frame', 'Stack trace line', /^\s+at /,
    'One line of a stack trace: where in the shop\'s code the error above it happened. It belongs to that error; read the first line of the trace, the rest is the path through the code.'),
];

const UNKNOWN_ACCESS = 'A request to the shop that matches no pattern we know: look at the path, the status (2xx answered, 4xx refused, 5xx crashed) and the user agent.';
const UNKNOWN_APP = 'A line from the shop\'s own log that matches no pattern we know. Lines that start with "Error:" are requests the shop could not handle; lines starting with "at" belong to the error above them.';

/** The line type of a rendered log line (access or app log), or undefined when none matches. */
export function lineType(line: string): LineType | undefined {
  const a = parseCombined(line);
  if (a) return ACCESS_TYPES.find((type) => type.test(a));
  return APP_TYPES.find((type) => type.test.test(line));
}

export interface Explanation {
  /** The line type's id, or undefined for a line no type matches. */
  type: string | undefined;
  title: string;
  text: string;
}

/** The plain-words explanation of a log line: the type's text, plus who likely sent it for an access line. */
export function explainLine(line: string): Explanation {
  const a = parseCombined(line);
  const type = lineType(line);
  if (a) {
    const text = type ? type.text : UNKNOWN_ACCESS;
    return { type: type?.id, title: type?.title ?? 'Request', text: `${text} ${SENDERS[senderOf(a.userAgent)]}` };
  }
  return { type: type?.id, title: type?.title ?? 'App log line', text: type ? type.text : UNKNOWN_APP };
}

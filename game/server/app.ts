// The Kiro server's HTTP surface (PRD SYS-12, KIRO-01..10, D-190): `POST /api/kiro/run` for a run token, then
// `POST /api/kiro/ask|hint|explain|draft|debrief` with the token and the browser's snapshot; `POST /mcp/<token>`
// is the MCP endpoint `kiro-cli acp` calls for that run's tools; in production it also serves `dist/` and answers
// the host's `GET /healthz` (SYS-18).
// Every reply goes through the rails (src/kiro/rails.ts) before it leaves; a failed check, a timeout or a spent
// cap answers with CON-03's rule-written text and `offline: true` (KIRO-09). Plain `node:http`, no framework.
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { OFFLINE_ANSWER, debriefTemplate } from '../src/content/kiro-fallback';
import { pickDraft } from '../src/kiro/client';
import { gapWords } from '../src/kiro/gaps';
import { debriefMatches, guardDraft, hintIsClean, replyIsClean, type DebriefFacts } from '../src/kiro/rails';
import type { KiroSnapshot } from '../src/kiro/snapshot';
import type { AuthMode } from './auth';
import { handleMcp } from './mcp';
import { INPUT_MAX, askPrompt, debriefPrompt, draftPrompt, explainPrompt, hintPrompt, type CallKind } from './prompt';
import { CAPS, type Runs } from './runs';

export interface AppOptions {
  runs: Runs;
  /** The built game to serve at `/` (production); undefined in dev, where Vite serves the page and proxies `/api/kiro`. */
  distDir?: string;
  /** The cached auth mode (`watchAuth`, D-201) for `/healthz`'s `kiroAuth`; undefined until the first probe finishes. */
  auth?: () => AuthMode | undefined;
  log?: (line: string) => void;
}

type Json = Record<string, unknown>;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.wasm': 'application/wasm', '.sqlite': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

function isSnapshot(v: unknown): v is KiroSnapshot {
  if (v === null || typeof v !== 'object') return false;
  const s = v as Partial<KiroSnapshot>;
  return (
    typeof s.difficulty === 'string' && typeof s.clock === 'object' && s.clock !== null && Array.isArray(s.alerts) && Array.isArray(s.accounts) &&
    Array.isArray(s.uploads) && typeof s.logs === 'object' && s.logs !== null && Array.isArray(s.logs.access) && Array.isArray(s.logs.app) && Array.isArray(s.actions)
  );
}

function isReport(v: unknown): v is DebriefFacts {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Partial<DebriefFacts>;
  return (
    Array.isArray(r.facts) && r.facts.every((f) => typeof f?.label === 'string' && typeof f?.value === 'string') &&
    typeof r.grades === 'object' && r.grades !== null && ['detect', 'contain', 'eradicate', 'recover'].every((p) => /^[ABCDF]$/.test(String((r.grades as Record<string, unknown>)[p]))) &&
    Array.isArray(r.mistakes) && r.mistakes.every((m) => typeof m?.title === 'string' && typeof m?.why === 'string') &&
    Array.isArray(r.missed) && r.missed.every((m) => typeof m === 'string')
  );
}

const CALLS: ReadonlySet<string> = new Set<CallKind>(['ask', 'hint', 'explain', 'draft', 'debrief']);

/** The request handler, for `http.createServer(createHandler(opts))`. */
export function createHandler(opts: AppOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const { runs } = opts;

  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (req.method !== 'POST' && path !== 'health') return send(res, 405, { error: 'POST only' });
    if (path === 'health') return send(res, 200, { ok: true, callsToday: runs.callsToday, capPerDay: CAPS.perDay, capPerRun: CAPS.perRun });
    const raw = await readBody(req, INPUT_MAX.snapshotJson + 100_000);
    if (raw === null) return send(res, 413, { error: 'body too large' });
    let body: Json;
    try {
      body = JSON.parse(raw === '' ? '{}' : raw) as Json;
    } catch {
      return send(res, 400, { error: 'bad JSON' });
    }
    if (body === null || typeof body !== 'object') return send(res, 400, { error: 'bad body' });

    if (path === 'run') {
      const created = runs.create();
      if (!created) return send(res, 429, { error: 'daily cap reached', offline: true });
      return send(res, 200, created);
    }
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token || !runs.has(token)) return send(res, 401, { error: 'no run token' });
    if (path === 'end') {
      runs.end(token);
      return send(res, 200, { ok: true });
    }
    if (!CALLS.has(path)) return send(res, 404, { error: 'unknown call' });
    const kind = path as CallKind;
    if (!isSnapshot(body.snapshot)) return send(res, 400, { error: 'bad snapshot' });
    const snapshot = body.snapshot;
    runs.setSnapshot(token, snapshot);

    // The call's input and its rule-written fallback (KIRO-09).
    let prompt: string;
    let fallback: Json;
    let gap: string | undefined;
    let report: DebriefFacts | undefined;
    switch (kind) {
      case 'ask': {
        const q = typeof body.question === 'string' ? body.question.trim() : '';
        if (q === '' || q.length > INPUT_MAX.question) return send(res, 400, { error: `question must be 1–${INPUT_MAX.question} characters` });
        prompt = askPrompt(q, snapshot);
        fallback = { text: OFFLINE_ANSWER };
        break;
      }
      case 'explain': {
        const line = typeof body.line === 'string' ? body.line.trim() : '';
        if (line === '' || line.length > INPUT_MAX.line) return send(res, 400, { error: `line must be 1–${INPUT_MAX.line} characters` });
        prompt = explainPrompt(line, snapshot);
        fallback = { text: OFFLINE_ANSWER };
        break;
      }
      case 'hint': {
        gap = typeof body.gap === 'string' ? body.gap : undefined;
        prompt = hintPrompt(gap, snapshot);
        const text = typeof body.fallback === 'string' && body.fallback.trim() !== '' ? body.fallback : gapWords(gap);
        fallback = { text: text ?? OFFLINE_ANSWER };
        break;
      }
      case 'draft': {
        const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
        if (goal === '' || goal.length > INPUT_MAX.goal) return send(res, 400, { error: `goal must be 1–${INPUT_MAX.goal} characters` });
        prompt = draftPrompt(goal, snapshot);
        const d = pickDraft(goal);
        fallback = { title: d.title, why: d.why, lines: [...d.lines], stripped: 0 };
        break;
      }
      case 'debrief': {
        if (!isReport(body.report) || JSON.stringify(body.report).length > INPUT_MAX.reportJson) return send(res, 400, { error: 'bad report' });
        report = body.report;
        prompt = debriefPrompt(report);
        fallback = { text: debriefTemplate(report) };
        break;
      }
    }

    const outcome = await runs.call(token, kind, prompt);
    if (!outcome.ok) return send(res, 200, { ...fallback, offline: true, reason: outcome.reason });
    const { text, latencyMs, credits } = outcome.result;
    const meta = { offline: false, latencyMs, ...(credits !== undefined && { credits }) };
    const refused = () => {
      opts.log?.(`[kiro] run ${token.slice(0, 8)} ${kind} refused by the rails: ${JSON.stringify(text.slice(0, 1000))}`);
      return send(res, 200, { ...fallback, offline: true, reason: 'rails' });
    };

    // The rails (KIRO-03, KIRO-06, KIRO-08): what fails them never reaches the player.
    switch (kind) {
      case 'ask':
      case 'explain':
        return replyIsClean(text) ? send(res, 200, { text, ...meta }) : refused();
      case 'hint':
        return hintIsClean(text, gap) ? send(res, 200, { text, ...meta }) : refused();
      case 'draft': {
        const guarded = guardDraft(text);
        if (guarded.lines.length === 0) return refused();
        // The title: Kiro's first short line of prose before the code, else a plain label (a long first line is an answer, not a title).
        const first = text.split('```')[0]!.split('\n').map((l) => l.replace(/^[#*\s-]+/, '').trim()).find((l) => l !== '');
        const title = first !== undefined && first.length <= 60 ? first.replace(/[.:]$/, '') : 'Kiro\'s draft';
        return send(res, 200, { title, why: '', lines: guarded.lines, stripped: guarded.stripped.length, ...meta });
      }
      case 'debrief':
        return debriefMatches(text, report!, snapshot) ? send(res, 200, { text, ...meta }) : refused(); // D-191: numbers Kiro saw in the snapshot are allowed
    }
  }

  async function mcp(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
    if (!runs.has(token)) return send(res, 404, { error: 'unknown run' });
    if (req.method === 'GET') {
      res.writeHead(405, { allow: 'POST' });
      res.end();
      return;
    }
    if (req.method === 'DELETE') {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const raw = await readBody(req, 1_000_000);
    if (raw === null) return send(res, 413, { error: 'body too large' });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }
    const reply = handleMcp(body, () => runs.snapshotOf(token));
    if (reply.body === undefined) {
      res.writeHead(reply.status, { 'mcp-session-id': token.slice(0, 16) });
      res.end();
      return;
    }
    const text = JSON.stringify(reply.body);
    res.writeHead(reply.status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'mcp-session-id': token.slice(0, 16) });
    res.end(text);
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    const dist = opts.distDir;
    if (!dist) return send(res, 404, { error: 'not found' });
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(dist, rel);
    if (!file.startsWith(dist)) return send(res, 403, { error: 'forbidden' });
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html'); // the page owns its routes
    if (!existsSync(file)) return send(res, 404, { error: 'not found' });
    const ext = extname(file);
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    createReadStream(file).pipe(res);
  }

  /**
   * The host's health check (SYS-18, Fly's `/healthz`): 200 when the page is servable, 503 when `dist/` is missing.
   * `kiroAuth` (D-201) is the cached probe's answer: `key`, `cli-login`, or `none` (also before the first probe
   * finishes). Kiro offline never fails the check (KIRO-09: the game plays on). Never touches Kiro itself.
   */
  function healthz(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'GET only' });
    const page = opts.distDir === undefined || existsSync(join(opts.distDir, 'index.html'));
    send(res, page ? 200 : 503, { ok: page, page, callsToday: runs.callsToday, ...(opts.auth && { kiroAuth: opts.auth()?.mode ?? 'none' }) });
  }

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    if (p === '/healthz') return healthz(req, res);
    const done = (promise: Promise<void>) =>
      promise.catch((e: Error) => {
        opts.log?.(`[kiro] ${req.method} ${p}: ${e.message}`);
        if (!res.headersSent) send(res, 500, { error: 'server error' });
        else res.end();
      });
    if (p.startsWith('/api/kiro/')) return void done(api(req, res, p.slice('/api/kiro/'.length)));
    if (p.startsWith('/mcp/')) return void done(mcp(req, res, p.slice('/mcp/'.length)));
    serveStatic(req, res, p);
  };
}

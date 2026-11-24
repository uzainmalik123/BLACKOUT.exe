// The game tools as an MCP server over HTTP (MCP "Streamable HTTP": JSON-RPC 2.0 in a POST body, a JSON reply),
// inside the game server's process (PRD KIRO-07, SYS-12, D-190). `kiro-cli acp` is given its URL per run
// (`/mcp/<run token>`), so the tools read that run's latest snapshot. Hand-rolled: four methods, no SDK.
import { runTool, TOOLS } from './tools';
import type { KiroSnapshot } from '../src/kiro/snapshot';

export const MCP_PROTOCOL_VERSION = '2025-03-26';

type Json = Record<string, unknown>;

export interface McpReply {
  status: number;
  body?: unknown;
}

function result(id: unknown, value: unknown): Json {
  return { jsonrpc: '2.0', id, result: value };
}

function error(id: unknown, code: number, message: string): Json {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function handleOne(msg: Json, snapshot: () => KiroSnapshot | undefined): Json | undefined {
  const { id, method, params } = msg;
  if (typeof method !== 'string') return id === undefined ? undefined : error(id, -32600, 'invalid request');
  if (id === undefined) return undefined; // a notification (notifications/initialized, notifications/cancelled): nothing to say
  const p = (params ?? {}) as Json;
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: typeof p.protocolVersion === 'string' ? p.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'game', version: '1' },
        instructions: 'Read-only tools over what the defender can see on screen: alerts, meters, the newest log lines, accounts, uploads, defences, recent actions and the terminal\'s command list.',
      });
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: TOOLS });
    case 'tools/call': {
      const name = typeof p.name === 'string' ? p.name : '';
      const args = (p.arguments ?? {}) as Json;
      const s = snapshot();
      if (!s) return result(id, { content: [{ type: 'text', text: 'The dashboard has not sent its state yet.' }], isError: true });
      const out = runTool(name, args, s);
      return result(id, { content: [{ type: 'text', text: out.text }], ...(out.isError && { isError: true }) });
    }
    default:
      return error(id, -32601, `method not found: ${method}`);
  }
}

/** Handles one POST body (a message or a batch). 202 with no body for notifications only, 200 with JSON otherwise. */
export function handleMcp(body: unknown, snapshot: () => KiroSnapshot | undefined): McpReply {
  if (Array.isArray(body)) {
    const replies = body.map((m) => handleOne((m ?? {}) as Json, snapshot)).filter((r): r is Json => r !== undefined);
    return replies.length === 0 ? { status: 202 } : { status: 200, body: replies };
  }
  if (body === null || typeof body !== 'object') return { status: 400, body: error(null, -32700, 'parse error') };
  const reply = handleOne(body as Json, snapshot);
  return reply === undefined ? { status: 202 } : { status: 200, body: reply };
}

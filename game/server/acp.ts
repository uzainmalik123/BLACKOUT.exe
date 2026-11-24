// A small Agent Client Protocol client (agentclientprotocol.com, JSON-RPC 2.0 over stdio, one JSON object per
// line) for `kiro-cli acp` (PRD SYS-12, D-190). Hand-rolled on purpose: the game needs five methods
// (`initialize`, `session/new`, `session/prompt`, `session/cancel` and answering `session/request_permission`),
// and the official SDK is 5 MB. Anything the agent asks that we do not serve (`fs/read_text_file`, terminals)
// gets a JSON-RPC error, never a file: the in-game agent has no file access by design (KI-13).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface AcpOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Receives every `session/update` and `_kiro/*` notification (for logging and usage). */
  onNotification?: (method: string, params: unknown) => void;
  log?: (line: string) => void;
}

export interface McpServerSpec {
  name: string;
  type: 'http';
  url: string;
  headers: Array<{ name: string; value: string }>;
}

export interface PromptResult {
  text: string;
  stopReason: string;
  latencyMs: number;
  /** Credits the turn used, when the agent reported them (Kiro's `turn_completion` summary). */
  credits?: number;
  toolCalls: string[]; // tool names the agent called this turn, as reported
}

type Json = Record<string, unknown>;

/** How long the next turn waits for a cancelled one to settle before the agent is given up. */
export const DRAIN_MS = 3000;
/** How long `kill()` waits for the agent to exit after SIGTERM before it sends SIGKILL (KI-195). */
export const KILL_GRACE_MS = 1500;

interface Turn {
  text: string[];
  credits?: number;
  toolCalls: string[];
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class AcpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

/** One agent process. `start()` runs `initialize`; `newSession()` then `prompt()`; `kill()` ends it. */
export class AcpAgent {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private buffer = '';
  private exited: Error | undefined;
  /** Settles when the OS process is really gone (`exit`, or a spawn that failed): what `kill()` waits for (KI-195). */
  private gone: Promise<void> = Promise.resolve();
  private procGone = true;
  /** The turn in flight, if any: chunks and usage land here. */
  private turn: Turn | undefined;
  /** A cancelled turn's `session/prompt`, still unanswered: the next turn waits for it (bounded by DRAIN_MS). */
  private draining: Promise<void> | undefined;
  readonly agentInfo: { name?: string; version?: string } = {};
  /** The tool tags the agent says its model can see (Kiro's `_kiro/tools/didChange`): `@<server>/<tool>` for MCP tools. */
  readonly toolTags = new Set<string>();
  private toolWaiters: Array<() => void> = [];

  constructor(private readonly opts: AcpOptions) {}

  get alive(): boolean {
    return this.proc !== undefined && this.exited === undefined;
  }

  async start(): Promise<void> {
    const proc = spawn(this.opts.command, this.opts.args, { cwd: this.opts.cwd, env: this.opts.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.procGone = false;
    this.gone = new Promise<void>((resolve) => {
      const settle = () => {
        this.procGone = true;
        resolve();
      };
      proc.once('exit', settle);
      proc.once('error', () => {
        if (proc.pid === undefined) settle(); // never started, so there is no exit to wait for
      });
    });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => this.opts.log?.(`[agent stderr] ${chunk.trimEnd()}`));
    proc.on('error', (e) => this.fail(new AcpError(`agent failed to start: ${e.message}`)));
    proc.on('exit', (code, signal) => this.fail(new AcpError(`agent exited (${code ?? signal})`)));
    const result = (await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'kiro-game-server', version: '1' },
    })) as { agentInfo?: { name?: string; version?: string } };
    Object.assign(this.agentInfo, result.agentInfo ?? {});
  }

  /** `session/new` in `cwd` with the given MCP servers; `modeId` picks the custom agent (Kiro's `_meta.kiro.modeId`). */
  async newSession(params: { cwd: string; mcpServers: McpServerSpec[]; modeId?: string }): Promise<{ sessionId: string; modes?: string[] }> {
    const result = (await this.request('session/new', {
      cwd: params.cwd,
      mcpServers: params.mcpServers,
      ...(params.modeId !== undefined && { _meta: { kiro: { modeId: params.modeId } } }),
    })) as { sessionId: string; modes?: { availableModes?: Array<{ id: string }> } };
    return { sessionId: result.sessionId, modes: result.modes?.availableModes?.map((m) => m.id) };
  }

  /** `session/set_mode`: picks the agent for a session whose `session/new` did not (Kiro lists custom agents as modes). */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.request('session/set_mode', { sessionId, modeId });
  }

  /**
   * One prompt turn. Resolves with the agent's text once `session/prompt` returns. On `timeoutMs` the turn is
   * cancelled (`session/cancel`) and the promise rejects; the session stays usable.
   */
  async prompt(sessionId: string, text: string, timeoutMs: number): Promise<PromptResult> {
    if (this.turn) throw new AcpError('a turn is already in flight');
    const draining = this.draining;
    if (draining) {
      // The last turn timed out and was cancelled; its late chunks must not land in this one. Wait a little for
      // the agent to settle (`session/prompt` answers with stopReason cancelled), else give the agent up.
      await Promise.race([draining, new Promise((r) => setTimeout(r, DRAIN_MS))]);
      if (this.stillDraining()) throw new AcpError('agent did not cancel the previous turn');
    }
    const turn: Turn = { text: [], toolCalls: [] };
    this.turn = turn;
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const request = this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }) as Promise<{ stopReason?: string }>;
    try {
      const result = await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.notify('session/cancel', { sessionId });
            this.draining = request.catch(() => undefined).then(() => {
              this.draining = undefined;
            });
            reject(new AcpError(`timeout after ${timeoutMs} ms`));
          }, timeoutMs);
        }),
      ]);
      return {
        text: turn.text.join(''),
        stopReason: result.stopReason ?? 'unknown',
        latencyMs: Date.now() - started,
        ...(turn.credits !== undefined && { credits: turn.credits }),
        toolCalls: turn.toolCalls,
      };
    } finally {
      if (timer) clearTimeout(timer);
      // A cancelled turn still answers `session/prompt` later (stopReason cancelled); let that response drop.
      this.turn = undefined;
    }
  }

  private stillDraining(): boolean {
    return this.draining !== undefined;
  }

  /**
   * True once every `tags` entry is in the agent's tool catalogue (D-191, KI-191): what proves the model can see
   * our MCP tools, not just that the server connected. False when `timeoutMs` passes first.
   */
  waitForTools(tags: readonly string[], timeoutMs: number): Promise<boolean> {
    const has = () => tags.every((t) => this.toolTags.has(t));
    if (has()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.toolWaiters = this.toolWaiters.filter((w) => w !== check);
        resolve(false);
      }, timeoutMs);
      const check = () => {
        if (!has()) return;
        clearTimeout(timer);
        this.toolWaiters = this.toolWaiters.filter((w) => w !== check);
        resolve(true);
      };
      this.toolWaiters.push(check);
    });
  }

  /**
   * Ends the agent and settles once its process has really exited (KI-195): a signal is only a request, and
   * Windows will not delete a folder a live process sits in, so a caller removing the agent's cwd must await this.
   * An agent still there after `graceMs` gets SIGKILL; one that outlives that too is given up after another
   * `graceMs`, so this never hangs. Safe to call again: a later call waits for the same exit.
   */
  async kill(graceMs = KILL_GRACE_MS): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    if (this.exited === undefined) this.fail(new AcpError('agent killed'));
    if (this.procGone) return;
    proc.kill();
    if (await this.exitWithin(graceMs)) return;
    this.opts.log?.(`[agent] still running ${graceMs} ms after SIGTERM; sending SIGKILL`);
    proc.kill('SIGKILL');
    if (!(await this.exitWithin(graceMs))) this.opts.log?.(`[agent] did not exit after SIGKILL; giving up on it`);
  }

  /** True when the process exits within `ms`. */
  private async exitWithin(ms: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((r) => {
      timer = setTimeout(() => r(false), ms);
    });
    try {
      return await Promise.race([this.gone.then(() => true as const), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  private request(method: string, params: Json): Promise<unknown> {
    if (this.exited) return Promise.reject(this.exited);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: Json): void {
    if (!this.exited) this.send({ jsonrpc: '2.0', method, params });
  }

  private respond(id: unknown, body: { result: unknown } | { error: { code: number; message: string } }): void {
    if (!this.exited) this.send({ jsonrpc: '2.0', id, ...body });
  }

  private send(msg: Json): void {
    this.proc?.stdin.write(JSON.stringify(msg) + '\n');
  }

  private fail(e: Error): void {
    if (this.exited) return;
    this.exited = e;
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line === '') continue;
      let msg: Json;
      try {
        msg = JSON.parse(line) as Json;
      } catch {
        this.opts.log?.(`[agent] not JSON: ${line.slice(0, 200)}`);
        continue;
      }
      this.onMessage(msg);
    }
  }

  private onMessage(msg: Json): void {
    const { id, method } = msg;
    if (method === undefined && typeof id === 'number') {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if ('error' in msg) {
        const err = msg.error as { code?: number; message?: string };
        p.reject(new AcpError(err.message ?? 'agent error', err.code));
      } else p.resolve(msg.result);
      return;
    }
    if (typeof method !== 'string') return;
    const params = msg.params as Json | undefined;
    if (id !== undefined) {
      this.onRequest(id, method, params ?? {});
      return;
    }
    if (method === 'session/update') this.onUpdate((params?.update ?? {}) as Json);
    else if (method === '_kiro/tools/didChange') {
      // Kiro's catalogue of what the model can see: tags such as `@game/alerts`. A notification replaces the set.
      const tags = (params?.tags ?? []) as Array<{ tag?: string }>;
      this.toolTags.clear();
      for (const t of tags) if (typeof t.tag === 'string') this.toolTags.add(t.tag);
      for (const w of [...this.toolWaiters]) w();
    }
    this.opts.onNotification?.(method, params);
  }

  /** Agent → client requests. Only a permission request for one of our MCP tools is granted; everything else is refused. */
  private onRequest(id: unknown, method: string, params: Json): void {
    if (method === 'session/request_permission') {
      const options = (params.options ?? []) as Array<{ optionId: string; kind?: string }>;
      const toolCall = (params.toolCall ?? {}) as Json;
      const mcp = ((toolCall._meta as Json | undefined)?.kiro as Json | undefined)?.mcpTool as { identity?: { serverName?: string } } | undefined;
      const title = String(toolCall.title ?? toolCall.name ?? '');
      const ours = mcp?.identity?.serverName === 'game' || /^game[/_:]|@game\b/.test(title) || (toolCall.kind === 'other' && mcp === undefined && /^(alerts|meters|search_logs|tail_logs|accounts|uploads|defences|recent_actions|command_list)$/.test(title));
      const pick = (kinds: string[]) => options.find((o) => kinds.includes(o.kind ?? ''));
      const choice = ours ? (pick(['allow_once', 'allow_always']) ?? options[0]) : (pick(['reject_once', 'reject_always']) ?? options[options.length - 1]);
      this.opts.log?.(`[agent] permission for "${title}": ${ours ? 'allowed' : 'REFUSED'}`);
      if (choice) this.respond(id, { result: { outcome: { outcome: 'selected', optionId: choice.optionId } } });
      else this.respond(id, { result: { outcome: { outcome: 'cancelled' } } });
      return;
    }
    // fs/*, terminal/*, elicitation/*, _kiro/*: not served. The agent was told we have no file system (initialize).
    this.opts.log?.(`[agent] refused request ${method}`);
    this.respond(id, { error: { code: -32601, message: `${method} is not available to this agent` } });
  }

  private onUpdate(update: Json): void {
    const kind = update.sessionUpdate;
    const turn = this.turn;
    if (kind === 'agent_message_chunk') {
      const content = update.content as { type?: string; text?: string } | undefined;
      if (turn && content?.type === 'text' && typeof content.text === 'string') turn.text.push(content.text);
    } else if (kind === 'tool_call') {
      const name = String(update.name ?? update.title ?? '?');
      if (turn) turn.toolCalls.push(name);
    } else if (kind === 'usage_update') {
      const cost = update.cost as { amount?: number; currency?: string } | undefined;
      if (turn && cost && typeof cost.amount === 'number' && /credit/i.test(cost.currency ?? '')) turn.credits = (turn.credits ?? 0) + cost.amount;
    } else if (kind === 'session_info_update') {
      const kiro = (update._meta as Json | undefined)?.kiro as Json | undefined;
      if (kiro?.kind === 'turn_completion') {
        const summaries = (kiro.promptTurnSummaries ?? []) as Array<{ unit?: string; usage?: number }>;
        let credits = 0;
        let any = false;
        for (const s of summaries) {
          if (typeof s.usage === 'number' && (s.unit === undefined || /credit/i.test(s.unit))) {
            credits += s.usage;
            any = true;
          }
        }
        if (turn && any) turn.credits = (turn.credits ?? 0) + credits;
      }
    }
  }
}

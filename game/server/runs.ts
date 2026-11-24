// The runs (PRD SYS-12, KIRO-10, D-190): one token per run, one `kiro-cli acp` process per run (started at the
// run's first call, in an empty temp folder outside the repo holding only our custom agent), the caps (60 calls
// a run, 400 a day, D-23), the 25 s timeout (KIRO-09) and the log line per call with the credits Kiro reported.
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpAgent, AcpError, type PromptResult } from './acp';
import type { CallKind } from './prompt';
import type { KiroSnapshot } from '../src/kiro/snapshot';

export const CAPS = { perRun: 60, perDay: 400 } as const; // D-23 (tune)
export const CALL_TIMEOUT_MS = 25_000; // KIRO-09 (tune)
export const RUN_IDLE_MS = 20 * 60_000; // a run nobody has used for this long loses its agent process
export const AGENT_NAME = 'kiro-game';
/** The MCP server's name as the agent sees it: the agent config's `tools: ["@game"]` names it. */
export const MCP_SERVER_NAME = 'game';

export interface RunsOptions {
  /** How to start the agent: the real `kiro-cli acp --agent-engine v3`, or the fake one in tests. */
  agentCommand: { command: string; args: string[]; env?: NodeJS.ProcessEnv };
  /** The folder holding `kiro-game.json` and `kiro-game.md` (the repo's `.kiro/agents/`), copied into each run's temp cwd. */
  agentDir: string;
  /** The MCP URL the agent gets for a run: the game server's own `/mcp/<token>` endpoint. */
  mcpUrl: (token: string) => string;
  log?: (line: string) => void;
  now?: () => number;
  /** Agent engines that pick the custom agent by mode (`kiro-cli acp` v3) need `session/new` to say so. */
  modeId?: string;
  /** Tests lower these; the game uses CAPS and CALL_TIMEOUT_MS. */
  caps?: { perRun: number; perDay: number };
  timeoutMs?: number;
}

interface Run {
  token: string;
  createdAt: number;
  lastUsedAt: number;
  calls: number;
  snapshot?: KiroSnapshot;
  agent?: AcpAgent;
  sessionId?: string;
  cwd?: string;
  queue: Promise<unknown>;
}

export type CallOutcome =
  | { ok: true; result: PromptResult }
  | { ok: false; reason: 'cap-run' | 'cap-day' | 'timeout' | 'agent-error' | 'busy'; detail?: string };

export class Runs {
  private readonly runs = new Map<string, Run>();
  private day = '';
  private dayCalls = 0;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly sweeper: NodeJS.Timeout;
  readonly caps: { perRun: number; perDay: number };
  readonly timeoutMs: number;

  constructor(private readonly opts: RunsOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.log ?? ((l) => console.log(l));
    this.caps = opts.caps ?? CAPS;
    this.timeoutMs = opts.timeoutMs ?? CALL_TIMEOUT_MS;
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  /** The calls made today (UTC); the day's counter resets at midnight. */
  get callsToday(): number {
    this.rollDay();
    return this.dayCalls;
  }

  private rollDay(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.dayCalls = 0;
    }
  }

  /** A new run and its token, or null once the day's cap is spent (the client then plays offline, KIRO-09). */
  create(): { token: string; callsLeft: number } | null {
    this.rollDay();
    if (this.dayCalls >= this.caps.perDay) return null;
    const token = randomBytes(16).toString('hex');
    const t = this.now();
    this.runs.set(token, { token, createdAt: t, lastUsedAt: t, calls: 0, queue: Promise.resolve() });
    this.log(`[kiro] run ${token.slice(0, 8)} created (${this.runs.size} live, ${this.dayCalls}/${this.caps.perDay} calls today)`);
    return { token, callsLeft: this.caps.perRun };
  }

  has(token: string): boolean {
    return this.runs.has(token);
  }

  /** The latest snapshot a run's browser sent: what the MCP tools read. */
  snapshotOf(token: string): KiroSnapshot | undefined {
    return this.runs.get(token)?.snapshot;
  }

  /** Remembers the browser's latest view of the world for the run (every call sends one). */
  setSnapshot(token: string, snapshot: KiroSnapshot): void {
    const run = this.runs.get(token);
    if (run) run.snapshot = snapshot;
  }

  /**
   * One Kiro call on a run: counts against both caps, starts the agent on first use, runs the prompt with the
   * timeout, and logs count, latency and credits. Calls on one run are queued (one turn at a time per session).
   */
  async call(token: string, kind: CallKind, prompt: string): Promise<CallOutcome> {
    const run = this.runs.get(token);
    if (!run) return { ok: false, reason: 'agent-error', detail: 'unknown run' };
    this.rollDay();
    if (run.calls >= this.caps.perRun) return { ok: false, reason: 'cap-run' };
    if (this.dayCalls >= this.caps.perDay) return { ok: false, reason: 'cap-day' };
    run.calls += 1;
    this.dayCalls += 1;
    run.lastUsedAt = this.now();
    const n = run.calls;
    const job = run.queue.then(() => this.turn(run, kind, prompt));
    run.queue = job.catch(() => undefined);
    const outcome = await job;
    const tag = `[kiro] run ${token.slice(0, 8)} ${kind} #${n} (today ${this.dayCalls}/${this.caps.perDay})`;
    if (outcome.ok) {
      const r = outcome.result;
      this.log(`${tag}: ${r.latencyMs} ms, credits ${r.credits ?? 'n/a'}, tools [${r.toolCalls.join(' ')}], stop ${r.stopReason}, ${r.text.length} chars`);
    } else this.log(`${tag}: ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ''}`);
    return outcome;
  }

  private async turn(run: Run, kind: CallKind, prompt: string): Promise<CallOutcome> {
    try {
      if (!run.agent || !run.agent.alive || !run.sessionId) await this.startAgent(run);
      const result = await run.agent!.prompt(run.sessionId!, prompt, this.timeoutMs);
      if (result.stopReason === 'cancelled' || result.stopReason === 'refusal') return { ok: false, reason: 'agent-error', detail: `stop ${result.stopReason}` };
      return { ok: true, result };
    } catch (e) {
      const err = e as Error;
      if (err instanceof AcpError && /^timeout/.test(err.message)) return { ok: false, reason: 'timeout', detail: err.message };
      if (err instanceof AcpError && /already in flight/.test(err.message)) return { ok: false, reason: 'busy' };
      // A dead agent, or one that would not cancel a timed-out turn, is dropped so the next call starts a fresh one.
      if (run.agent && (!run.agent.alive || /did not cancel/.test(err.message))) this.dropAgent(run);
      return { ok: false, reason: 'agent-error', detail: err.message };
    }
  }

  private async startAgent(run: Run): Promise<void> {
    this.dropAgent(run);
    // An empty folder outside the repo, holding only the custom agent (KI-13): nothing to read even with a tool.
    const cwd = mkdtempSync(join(tmpdir(), 'kiro-game-'));
    mkdirSync(join(cwd, '.kiro', 'agents'), { recursive: true });
    mkdirSync(join(cwd, '.kiro', 'prompts'), { recursive: true });
    cpSync(join(this.opts.agentDir, `${AGENT_NAME}.json`), join(cwd, '.kiro', 'agents', `${AGENT_NAME}.json`));
    // The prompt lives next to the agents folder, not in it: Kiro reads every .md under .kiro/agents/ as an agent.
    cpSync(join(this.opts.agentDir, '..', 'prompts', `${AGENT_NAME}.md`), join(cwd, '.kiro', 'prompts', `${AGENT_NAME}.md`));
    run.cwd = cwd;
    const tag = run.token.slice(0, 8);
    const agent = new AcpAgent({
      ...this.opts.agentCommand,
      // ASBX_KIRO_MANDATORY_MCPS: Kiro's agent server (KAS) otherwise hides MCP tools in a "deferred catalog" the
      // model has to load first; naming our server puts its tools straight in the model's context (D-190, KI-191).
      env: { ...(this.opts.agentCommand.env ?? process.env), ASBX_KIRO_MANDATORY_MCPS: MCP_SERVER_NAME },
      cwd,
      log: (l) => this.log(`[kiro] run ${tag} ${l}`),
      onNotification: (method, params) => {
        if (method === '_kiro/mcp/status') this.log(`[kiro] run ${tag} mcp status: ${JSON.stringify((params as { servers?: unknown })?.servers ?? params).slice(0, 300)}`);
        else if (method === '_kiro/error/rate_limit' || method === '_kiro.dev/error/rate_limit') this.log(`[kiro] run ${tag} RATE LIMITED: ${JSON.stringify(params).slice(0, 300)}`);
      },
    });
    run.agent = agent;
    const started = Date.now();
    await agent.start();
    const session = await agent.newSession({
      cwd,
      mcpServers: [{ name: MCP_SERVER_NAME, type: 'http', url: this.opts.mcpUrl(run.token), headers: [] }],
      ...(this.opts.modeId !== undefined && { modeId: this.opts.modeId }),
    });
    run.sessionId = session.sessionId;
    if (this.opts.modeId !== undefined && session.modes && session.modes.includes(this.opts.modeId)) {
      // Belt and braces: some engines ignore `_meta.kiro.modeId` on session/new and need set_mode.
      await agent.setMode(session.sessionId, this.opts.modeId).catch((e: Error) => this.log(`[kiro] run ${tag} set_mode: ${e.message}`));
    } else if (this.opts.modeId !== undefined && session.modes && !session.modes.includes(this.opts.modeId)) {
      throw new AcpError(`agent ${this.opts.modeId} not offered by the engine (modes: ${session.modes.join(', ')})`);
    }
    this.log(`[kiro] run ${tag} agent ${agent.agentInfo.name ?? '?'} ${agent.agentInfo.version ?? ''} ready in ${Date.now() - started} ms, session ${session.sessionId}`);
  }

  private dropAgent(run: Run): void {
    run.agent?.kill();
    run.agent = undefined;
    run.sessionId = undefined;
    if (run.cwd) {
      rmSync(run.cwd, { recursive: true, force: true });
      run.cwd = undefined;
    }
  }

  /** Ends a run: its agent process and temp folder go. The token stops working. */
  end(token: string): void {
    const run = this.runs.get(token);
    if (!run) return;
    this.dropAgent(run);
    this.runs.delete(token);
    this.log(`[kiro] run ${token.slice(0, 8)} ended after ${run.calls} calls`);
  }

  private sweep(): void {
    const t = this.now();
    for (const run of this.runs.values()) if (t - run.lastUsedAt > RUN_IDLE_MS) this.end(run.token);
  }

  shutdown(): void {
    clearInterval(this.sweeper);
    for (const token of [...this.runs.keys()]) this.end(token);
  }
}

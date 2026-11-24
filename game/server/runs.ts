// The runs (PRD SYS-12, KIRO-10, D-190, D-191): one token per run, one `kiro-cli acp` process per run (started at
// the run's first call, in an empty temp folder outside the repo holding only our custom agent), the caps (60 calls
// a run, 400 a day, D-23) persisted to a small JSON file so a restart keeps the day's count (KI-193), the 25 s
// timeout (KIRO-09), a check at session start that the model can really see the game tools (KI-191), and the log
// line per call with the credits Kiro reported.
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AcpAgent, AcpError, type PromptResult } from './acp';
import type { CallKind } from './prompt';
import { TOOLS } from './tools';
import type { KiroSnapshot } from '../src/kiro/snapshot';

export const CAPS = { perRun: 60, perDay: 400 } as const; // D-23 (tune)
export const CALL_TIMEOUT_MS = 25_000; // KIRO-09 (tune)
export const RUN_IDLE_MS = 20 * 60_000; // a run nobody has used for this long loses its agent process
export const TOOLS_WAIT_MS = 8000; // how long a new session may take to list the game tools before the run goes offline (KI-191)
export const AGENT_NAME = 'kiro-game';
/** The MCP server's name as the agent sees it: the agent config's `tools: ["@game"]` names it. */
export const MCP_SERVER_NAME = 'game';
/** The catalogue entries that prove the model sees every game tool (Kiro tags MCP tools `@<server>/<tool>`). */
export const TOOL_TAGS: readonly string[] = TOOLS.map((t) => `@${MCP_SERVER_NAME}/${t.name}`);

export interface RunsOptions {
  /** How to start the agent: the real `kiro-cli acp --agent-engine v3`, or the fake one in tests. */
  agentCommand: { command: string; args: string[]; env?: NodeJS.ProcessEnv };
  /** The folder holding `kiro-game.json` (the repo's `.kiro/agents/`); the prompt is in its sibling `prompts/`. Both are copied into each run's temp cwd. */
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
  /** Where the counters live between restarts (KI-193): a JSON file, written on every change. Undefined: memory only. */
  stateFile?: string;
  toolsWaitMs?: number;
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
  /** The agent started but never listed the game tools (KI-191): every call of this run answers offline. */
  noTools?: boolean;
}

/** What the state file holds: the day's counter and the live runs' counters (their agent processes are not kept). */
interface PersistedState {
  day: string;
  dayCalls: number;
  runs: Array<{ token: string; createdAt: number; lastUsedAt: number; calls: number }>;
}

export type CallOutcome =
  | { ok: true; result: PromptResult }
  | { ok: false; reason: 'cap-run' | 'cap-day' | 'timeout' | 'agent-error' | 'busy' | 'no-tools'; detail?: string };

export class Runs {
  private readonly runs = new Map<string, Run>();
  private day = '';
  private dayCalls = 0;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly sweeper: NodeJS.Timeout;
  readonly caps: { perRun: number; perDay: number };
  readonly timeoutMs: number;
  readonly toolsWaitMs: number;

  constructor(private readonly opts: RunsOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.log ?? ((l) => console.log(l));
    this.caps = opts.caps ?? CAPS;
    this.timeoutMs = opts.timeoutMs ?? CALL_TIMEOUT_MS;
    this.toolsWaitMs = opts.toolsWaitMs ?? TOOLS_WAIT_MS;
    this.load();
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
      this.save();
    }
  }

  /** KI-193: the counters come back from the state file, so a restart (a deploy, a crash) keeps the day's cap. */
  private load(): void {
    const file = this.opts.stateFile;
    if (!file || !existsSync(file)) return;
    try {
      const s = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistedState>;
      if (typeof s.day === 'string' && typeof s.dayCalls === 'number') {
        this.day = s.day;
        this.dayCalls = s.dayCalls;
      }
      for (const r of s.runs ?? []) {
        if (typeof r.token === 'string' && typeof r.calls === 'number') this.runs.set(r.token, { token: r.token, createdAt: r.createdAt ?? this.now(), lastUsedAt: r.lastUsedAt ?? this.now(), calls: r.calls, queue: Promise.resolve() });
      }
      this.log(`[kiro] state restored from ${file}: ${this.dayCalls} calls on ${this.day}, ${this.runs.size} runs`);
    } catch (e) {
      this.log(`[kiro] state file ${file} unreadable (${(e as Error).message}); starting fresh`);
    }
  }

  private save(): void {
    const file = this.opts.stateFile;
    if (!file) return;
    const state: PersistedState = {
      day: this.day,
      dayCalls: this.dayCalls,
      runs: [...this.runs.values()].map((r) => ({ token: r.token, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, calls: r.calls })),
    };
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(state));
      renameSync(tmp, file); // atomic: a crash mid-write never leaves half a file
    } catch (e) {
      this.log(`[kiro] state file ${file} not written: ${(e as Error).message}`);
    }
  }

  /** A new run and its token, or null once the day's cap is spent (the client then plays offline, KIRO-09). */
  create(): { token: string; callsLeft: number } | null {
    this.rollDay();
    if (this.dayCalls >= this.caps.perDay) return null;
    const token = randomBytes(16).toString('hex');
    const t = this.now();
    this.runs.set(token, { token, createdAt: t, lastUsedAt: t, calls: 0, queue: Promise.resolve() });
    this.save();
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
    if (run.noTools) return { ok: false, reason: 'no-tools' }; // KI-191: not counted; Kiro never answered this run
    run.calls += 1;
    this.dayCalls += 1;
    run.lastUsedAt = this.now();
    this.save();
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
      if (run.noTools) return { ok: false, reason: 'no-tools' };
      const result = await run.agent!.prompt(run.sessionId!, prompt, this.timeoutMs);
      if (result.stopReason === 'cancelled' || result.stopReason === 'refusal') return { ok: false, reason: 'agent-error', detail: `stop ${result.stopReason}` };
      return { ok: true, result };
    } catch (e) {
      const err = e as Error;
      if (err instanceof AcpError && /^timeout/.test(err.message)) return { ok: false, reason: 'timeout', detail: err.message };
      if (err instanceof AcpError && /already in flight/.test(err.message)) return { ok: false, reason: 'busy' };
      // A dead agent, or one that would not cancel a timed-out turn, is dropped so the next call starts a fresh one.
      if (run.agent && (!run.agent.alive || /did not cancel/.test(err.message))) await this.dropAgent(run);
      return { ok: false, reason: 'agent-error', detail: err.message };
    }
  }

  private async startAgent(run: Run): Promise<void> {
    await this.dropAgent(run);
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
    // KI-191: the server connecting is not enough; the model must have the tools in its catalogue.
    const seen = await agent.waitForTools(TOOL_TAGS, this.toolsWaitMs);
    if (!seen) {
      const missing = TOOL_TAGS.filter((t) => !agent.toolTags.has(t));
      this.log(`[kiro] run ${tag} ERROR: the agent never listed the game tools (missing ${missing.join(' ')}); this run plays offline. Is ASBX_KIRO_MANDATORY_MCPS honoured by this kiro-cli? (KI-191)`);
      run.noTools = true;
      await this.dropAgent(run);
      return;
    }
    this.log(`[kiro] run ${tag} agent ${agent.agentInfo.name ?? '?'} ${agent.agentInfo.version ?? ''} ready in ${Date.now() - started} ms, session ${session.sessionId}, ${TOOL_TAGS.length} game tools listed`);
  }

  /**
   * Stops a run's agent and removes its temp folder (KI-195). The run lets go of both at once, so a new agent can
   * start meanwhile; the folder goes only after the process has exited (Windows refuses to delete a live
   * process's cwd), and a folder that still will not go is logged, never thrown: clean-up must not fail a call.
   */
  private async dropAgent(run: Run): Promise<void> {
    const { agent, cwd } = run;
    run.agent = undefined;
    run.sessionId = undefined;
    run.cwd = undefined;
    if (agent) await agent.kill();
    if (!cwd) return;
    try {
      // The retries cover a virus scanner or indexer still holding a file for a moment after the exit.
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (e) {
      this.log(`[kiro] run ${run.token.slice(0, 8)} temp folder ${cwd} not removed: ${(e as Error).message}`);
    }
  }

  /** Ends a run: the token stops working at once; settles when its agent process and temp folder are gone. */
  async end(token: string): Promise<void> {
    const run = this.runs.get(token);
    if (!run) return;
    this.runs.delete(token);
    this.save();
    await this.dropAgent(run);
    this.log(`[kiro] run ${token.slice(0, 8)} ended after ${run.calls} calls`);
  }

  private sweep(): void {
    const t = this.now();
    for (const run of this.runs.values()) if (t - run.lastUsedAt > RUN_IDLE_MS) void this.end(run.token);
  }

  /** Stops every agent and removes every temp folder; the tokens survive a restart (KI-193), only the processes go. */
  async shutdown(): Promise<void> {
    clearInterval(this.sweeper);
    this.save(); // first: the counters are safe even if the process is killed while the agents exit
    await Promise.all([...this.runs.values()].map((run) => this.dropAgent(run)));
  }
}

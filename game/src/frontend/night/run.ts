// One night shift's run (D-223): the engine with the chosen difficulty, a fresh seed and the real baseline database,
// the shell on it, and Kiro's client on it. The screens read `engine.world` and the detection selectors; every
// change goes through `engine.act` or `shell.run`. Also the first check's readings, taken from the live world.

import { Engine } from '../../engine/engine';
import { createKiro, type Kiro } from '../../kiro/client';
import type { Difficulty } from '../../rules/vocabulary';
import { createShell } from '../../shell';
import type { Shell } from '../../shell/types';
import { EVIDENCE } from '../screen3-briefing/cinema/facts';
import type { Readings } from './judge';

/** The tools the briefing says name themselves in the user agent (CON-01's "worth a look"). */
const TOOLS = (EVIDENCE.find((e) => e.signal === 'User agents')?.tokens ?? []).filter((t) => !/Mozilla/.test(t));

export interface Run {
  engine: Engine;
  shell: Shell;
  kiro: Kiro;
  difficulty: Difficulty;
  seed: number;
}

/** A run on the given engine (built by the caller, so tests can hand in their own baseline). */
export function runOn(engine: Engine, onInternalError: (e: unknown) => void = () => undefined): Run {
  engine.beginShift(); // SYS-22 (D-230, KI-230): a run is made as the desk shows; his first move waits its seeded delay from here
  return { engine, shell: createShell(engine, { onInternalError }), kiro: createKiro(engine), difficulty: engine.world.difficulty, seed: engine.world.seed };
}

/** A fresh seed for a new shift. */
export const freshSeed = (): number => (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;

/** Login attempts and failures, and requests from self-naming tools, in the access log's last `windowMs`. */
function scan(engine: Engine, windowMs: number): { logins: number; failures: number; tools: number; tool?: string } {
  const lines = engine.world.logs.access;
  const from = engine.world.clock.gameMs - windowMs;
  let n = 0;
  let failed = 0;
  let tools = 0;
  let tool: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.t < from) break;
    const named = TOOLS.find((t) => l.userAgent.includes(t));
    if (named) {
      tools++;
      tool ??= named;
    }
    if (!l.target.startsWith('/rest/user/login')) continue;
    n++;
    if (l.status === 401) failed++;
  }
  return { logins: n, failures: failed, tools, tool };
}

/** The first check's readings: the live world as the dashboard shows it, nothing else (D-223). */
export function readingsOf(engine: Engine): Readings {
  const w = engine.world;
  const rate = engine.errorRate();
  const now = rate[rate.length - 1];
  const top = engine.topTalkers(1)[0];
  const l = scan(engine, 60 * 30_000);
  return {
    nginx: w.nginx,
    requests: now?.requests ?? 0,
    clientErrors: now?.clientErrors ?? 0,
    serverErrors: now?.serverErrors ?? 0,
    openAlerts: w.alerts.filter((a) => a.closedAt === undefined).length,
    heartbeat: Math.round(w.heartbeat),
    heartbeatMax: Math.round(w.heartbeatMax),
    logins: l.logins,
    loginFailures: l.failures,
    top: top ? { ip: top.ip, requests: top.requests, errors: top.errors } : undefined,
    toolAgents: l.tools,
    toolName: l.tool,
  };
}

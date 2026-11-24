// Which way `kiro-cli` will log in for the runs (PRD SYS-18, KIRO-09, D-200, D-201): the one line the server logs
// at start-up so a deploy's log says at once whether Kiro is online, and the `kiroAuth` field of `GET /healthz`.
// Three modes: a `KIRO_API_KEY` in the environment (Fly: `fly secrets set KIRO_API_KEY=…`; it wins), the CLI's
// own login on the machine (`kiro-cli login --use-device-flow` on the Fly machine, D-201; `kiro-cli login` on
// the team's machines), or none, in which case every run plays offline with the rule-written text (KIRO-09).
// Detection spends no credits: with a key nothing is run; otherwise `kiro-cli whoami --format json` is asked (it
// reads the local credential store and exits 1 with `{"account":null}` when logged out). `watchAuth` repeats it
// every AUTH_PROBE_MS so a lapsed login shows in `/healthz` (KI-203); it never spawns an agent.
import { execFile } from 'node:child_process';

export type AuthMode =
  | { mode: 'key' }
  | { mode: 'cli-login'; who?: string }
  | { mode: 'none'; why: string };

/** What `/healthz` reports as `kiroAuth`. */
export type KiroAuth = AuthMode['mode'];

/** How often the CLI login is re-checked (`kiro-cli whoami`, ≈ 2 s, no credits, no agent). */
export const AUTH_PROBE_MS = 10 * 60_000;

export interface DetectAuthOptions {
  /** The environment the agent will run with (`KIRO_API_KEY` is read from it). */
  env: NodeJS.ProcessEnv;
  /** The Kiro CLI binary (`KIRO_CLI`, default `kiro-cli`). */
  kiroCli: string;
  /** Tests swap the whoami command for a script; the default is `<kiroCli> whoami --format json`. */
  whoami?: { command: string; args: string[] };
  timeoutMs?: number;
}

/** What `kiro-cli whoami --format json` prints (2.37.1: `accountType`/`email`; 3.5.0 logged out: `{"account":null}`). */
interface WhoAmI {
  account?: { email?: string; accountType?: string } | null;
  accountType?: string;
  email?: string;
}

export function detectAuth(opts: DetectAuthOptions): Promise<AuthMode> {
  if (opts.env.KIRO_API_KEY) return Promise.resolve({ mode: 'key' });
  const { command, args } = opts.whoami ?? { command: opts.kiroCli, args: ['whoami', '--format', 'json'] };
  return new Promise((resolve) => {
    execFile(command, args, { env: opts.env, timeout: opts.timeoutMs ?? 10_000, encoding: 'utf8' }, (err, stdout, stderr) => {
      const parsed = parseWhoAmI(stdout);
      if (parsed?.who !== undefined) return resolve({ mode: 'cli-login', who: parsed.who });
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return resolve({ mode: 'none', why: `${command} not found on PATH` });
      if (err && (err as { killed?: boolean }).killed) return resolve({ mode: 'none', why: `${command} whoami timed out` });
      const detail = (stderr || stdout || (err ? err.message : '')).trim().split('\n')[0] ?? '';
      resolve({ mode: 'none', why: parsed?.loggedOut ? 'kiro-cli is not logged in' : `kiro-cli whoami failed${detail ? `: ${detail.slice(0, 160)}` : ''}` });
    });
  });
}

/** `who` when the output names a signed-in account; `loggedOut` when it says there is none; undefined when unparseable. */
export function parseWhoAmI(stdout: string): { who?: string; loggedOut: boolean } | undefined {
  let j: WhoAmI;
  try {
    j = JSON.parse(stdout.trim()) as WhoAmI;
  } catch {
    return undefined;
  }
  if (j === null || typeof j !== 'object') return undefined;
  const account = j.account && typeof j.account === 'object' ? j.account : j;
  const who = account.email ?? account.accountType;
  if (typeof who === 'string' && who !== '') return { who, loggedOut: false };
  return { loggedOut: j.account === null || j.account === undefined };
}

/** The start-up log line's wording. */
export function describeAuth(a: AuthMode): string {
  switch (a.mode) {
    case 'key':
      return '[kiro] auth: KIRO_API_KEY set (passed to kiro-cli as its environment)';
    case 'cli-login':
      return `[kiro] auth: kiro-cli login on this machine${a.who ? ` (${a.who})` : ''}`;
    case 'none':
      return `[kiro] auth: none (${a.why}); every run plays offline with the rule-written text (KIRO-09)`;
  }
}

export interface WatchAuthOptions extends DetectAuthOptions {
  /** Between probes (default AUTH_PROBE_MS). A key is never re-probed: the environment cannot change. */
  intervalMs?: number;
  /** Called with every probe's result, the first one included; `prev` is undefined the first time. */
  onResult?: (next: AuthMode, prev: AuthMode | undefined) => void;
}

export interface AuthWatch {
  /** The last probe's result; undefined until the first one finishes (≈ 2 s after start without a key, at once with one). */
  current(): AuthMode | undefined;
  /** The first probe's result. */
  ready: Promise<AuthMode>;
  stop(): void;
}

/** The cached auth mode: probed now and then every `intervalMs` (D-201). `/healthz` reads `current()`; nothing else runs. */
export function watchAuth(opts: WatchAuthOptions): AuthWatch {
  let last: AuthMode | undefined;
  let timer: NodeJS.Timeout | undefined;
  let probing: Promise<AuthMode> | undefined;
  const probe = (): Promise<AuthMode> => {
    if (probing) return probing; // a slow whoami never overlaps the next tick
    probing = detectAuth(opts).then((next) => {
      const prev = last;
      last = next;
      probing = undefined;
      opts.onResult?.(next, prev);
      return next;
    });
    return probing;
  };
  const ready = probe();
  if (!opts.env.KIRO_API_KEY) {
    timer = setInterval(() => void probe(), opts.intervalMs ?? AUTH_PROBE_MS);
    timer.unref();
  }
  return {
    current: () => last,
    ready,
    stop: () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

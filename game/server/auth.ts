// Which way `kiro-cli` will log in for the runs (PRD SYS-18, KIRO-09, D-200): the one line the server logs at
// start-up so a deploy's log says at once whether Kiro is online. Three modes: a `KIRO_API_KEY` in the
// environment (Fly: `fly secrets set KIRO_API_KEY=…`), the CLI's own login on the machine (`kiro-cli login`, how
// the team's machines run it), or none, in which case every run plays offline with the rule-written text
// (KIRO-09). Detection spends no credits: with a key nothing is run; otherwise `kiro-cli whoami --format json`
// is asked once (it reads the local credential store and exits 1 with `{"account":null}` when logged out).
import { execFile } from 'node:child_process';

export type AuthMode =
  | { mode: 'key' }
  | { mode: 'login'; who?: string }
  | { mode: 'none'; why: string };

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
      if (parsed?.who !== undefined) return resolve({ mode: 'login', who: parsed.who });
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
    case 'login':
      return `[kiro] auth: kiro-cli login on this machine${a.who ? ` (${a.who})` : ''}`;
    case 'none':
      return `[kiro] auth: none (${a.why}); every run plays offline with the rule-written text (KIRO-09)`;
  }
}

// The Kiro server's entry point (PRD SYS-12, D-190): `npm run server` in game/. Reads the repo-root `.env`
// (KIRO_API_KEY, optional), starts `http` on PORT (8787), and runs one `kiro-cli acp --agent-engine v3` per run
// with the custom agent in `.kiro/agents/kiro-game.*`. With `--serve-dist` (or NODE_ENV=production) it also
// serves `game/dist` and answers `GET /healthz` for the host (SYS-18; the Fly image runs it this way, D-200).
// In dev, Vite proxies `/api/kiro/*` here.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './app';
import { describeAuth, watchAuth } from './auth';
import { AGENT_NAME, Runs } from './runs';

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = resolve(here, '..');
const repoRoot = resolve(gameDir, '..');

/** The repo's one `.env` (AGENTS.md): KEY=value lines, quotes stripped, never printed. */
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]!] === undefined && v !== '') process.env[m[1]!] = v;
  }
}

export function main(): void {
  loadDotEnv(join(repoRoot, '.env'));
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '127.0.0.1';
  const serveDist = process.argv.includes('--serve-dist') || process.env.NODE_ENV === 'production';
  const kiroCli = process.env.KIRO_CLI ?? 'kiro-cli';
  const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

  // The agent's environment: a copy of ours (PATH, HOME for the login), plus KIRO_API_KEY when the .env has one.
  // Runs adds ASBX_KIRO_MANDATORY_MCPS so Kiro's agent server shows the game tools to the model (runs.ts).
  const env: NodeJS.ProcessEnv = { ...process.env };
  // The auth mode, one line at start-up (SYS-18, D-200): a key, the CLI's own login, or none (every run then plays
  // offline, KIRO-09). Costs no credits; with a key nothing is run. Re-probed every AUTH_PROBE_MS for `/healthz`'s
  // `kiroAuth` (D-201), with a line whenever the answer changes (a lapsed login, or a login done on the machine).
  const auth = watchAuth({
    env,
    kiroCli,
    onResult: (next, prev) => {
      if (prev === undefined) log(describeAuth(next));
      else if (prev.mode !== next.mode) log(`[kiro] auth changed: ${prev.mode} → ${next.mode}; ${describeAuth(next)}`);
    },
  });

  // KI-193: the caps survive a restart in a small JSON file (gitignored), KIRO_STATE_FILE to move it.
  const stateFile = process.env.KIRO_STATE_FILE ?? join(gameDir, 'server', '.state', 'runs.json');
  const runs = new Runs({
    agentCommand: { command: kiroCli, args: ['acp', '--agent-engine', 'v3'], env },
    agentDir: join(repoRoot, '.kiro', 'agents'),
    mcpUrl: (token) => `http://127.0.0.1:${port}/mcp/${token}`,
    modeId: AGENT_NAME,
    stateFile,
    log,
  });
  const distDir = serveDist ? join(gameDir, 'dist') : undefined;
  if (distDir && !existsSync(join(distDir, 'index.html'))) log(`[kiro] WARNING: ${distDir}/index.html is missing: run \`npm run build\` first`);
  const server = createServer(createHandler({ runs, distDir, auth: () => auth.current(), log }));
  server.listen(port, host, () => log(`[kiro] listening on http://${host}:${port}${distDir ? ` (serving ${distDir})` : ' (API only; Vite proxies /api/kiro)'}; agent ${AGENT_NAME} via ${kiroCli}`));

  const stop = () => {
    log('[kiro] shutting down');
    auth.stop();
    setTimeout(() => process.exit(0), 2000).unref();
    // The agents exit before their temp folders go (KI-195); the timer above still bounds the whole stop.
    void runs.shutdown().then(() => server.close(() => process.exit(0)));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();

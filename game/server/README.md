# The Kiro server (PRD SYS-12, KIRO-01..10, KDEV-06; D-190)

The one small server the game needs: it runs the **real Kiro** (`kiro-cli acp`, the Agent Client Protocol over stdio) **on rails** for the Kiro panel. The game itself runs in the browser and works without this server (every Kiro feature falls back to rule-written text, KIRO-09).

## Run it

```sh
cd game
npm run server            # http://127.0.0.1:8787, API only; `npm run dev` proxies /api/kiro/* here
npm run server -- --serve-dist   # also serves game/dist (after `npm run build`): the production shape (SYS-18)
```

The Fly image (`Dockerfile` at the repo root, `docs/HOSTING.md`, D-200) runs exactly this shape: `tsx server/main.ts` with `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=8080`, `kiro-cli` from Kiro's Linux zip, as a non-root user.

Environment (read from the repo-root `.env`, see `.env.example`, or the shell):

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `8787`, `127.0.0.1` | Where to listen (`HOST=0.0.0.0` in a container) |
| `KIRO_CLI` | `kiro-cli` | The Kiro CLI binary (2.37.1 is what this was built against) |
| `KIRO_API_KEY` | unset | Passed to `kiro-cli` as its environment when set and wins over any login (on Fly: `fly secrets set KIRO_API_KEY=…`; the user's plan has none, D-201). **Unset: `kiro-cli` uses its own login** (`kiro-cli login`), which is how the team's machines and the Fly machine run it |
| `KIRO_STATE_FILE` | `server/.state/runs.json` | The counters between restarts (KI-193); `/data/runs.json` in the Fly image |
| `XDG_DATA_HOME` | unset (kiro-cli's own default, `~/.local/share`) | Not the server's: kiro-cli's data folder, `<XDG_DATA_HOME>/kiro-cli/`, holds its login; the Fly image sets `/data/xdg` so the login lives on the volume (D-201) |
| `NODE_ENV=production` | | Same as `--serve-dist` |

At start-up the server logs **which auth mode kiro-cli will use** (`server/auth.ts`, D-200; no credits: with a key nothing runs, else `kiro-cli whoami --format json`): `[kiro] auth: KIRO_API_KEY set …`, `[kiro] auth: kiro-cli login on this machine (<who>)`, or `[kiro] auth: none (<why>); every run plays offline …` (KIRO-09). The same probe repeats every 10 minutes for `/healthz` (D-201).

Logs go to stdout, one line per call: `[kiro] run <id> ask #3 (today 12/400): 7462 ms, credits 0.104, tools [@game/alerts @game/tail_logs], stop end_turn, 720 chars`. The credits are what Kiro's agent server reports per turn (`session_info_update` / `turn_completion`); KI-02 reads them from here.

## What it does

- `GET /healthz` → 200 `{ ok, page, callsToday, kiroAuth }` when the page is servable (in dev, with no `dist/`, the API alone is healthy), 503 when `dist/index.html` is missing. The host's check (Fly, SYS-18); it never starts Kiro. `/api/kiro/health` is the client's.
- `POST /api/kiro/run` → `{ token, callsLeft }`. A run token per game; refused with 429 once the day's cap is spent.
- `POST /api/kiro/ask | hint | explain | draft | debrief` with `{ token, snapshot, … }` (`src/kiro/client.ts` sends them). The **snapshot** (`src/kiro/snapshot.ts`) is the browser's spoiler-free view of the world: meters, alerts (kind and time only), the newest 500 log lines as rendered, accounts, uploads, defences, the player's last 20 actions. The server keeps the latest one per run; that is what Kiro's tools read.
- `POST /mcp/<token>`: the game tools (KIRO-07) as an **MCP server over HTTP**, inside this process. `kiro-cli acp` is given its URL in `session/new`. Nine read-only tools: `alerts`, `meters`, `search_logs`, `tail_logs`, `accounts`, `uploads`, `defences`, `recent_actions`, `command_list`. No write tool exists.
- One **`kiro-cli acp --agent-engine v3` process per run**, started at the run's first call, in an **empty temp folder outside the repo** that holds only the custom agent (`.kiro/agents/kiro-game.json`, prompt `.kiro/prompts/kiro-game.md`). The agent has **no built-in tools** (`tools: ["@game"]`, every built-in capability denied): the KI-13 fix. The process is killed when the run ends (`POST /api/kiro/end`) or after 20 idle minutes.
- **Rails** (`src/kiro/rails.ts`), applied before anything reaches the player: every drafted line through the shell's `checkCommandLine`, unsupported lines stripped (KIRO-08); a hint about one of Death's moves may name no closing action and nothing may name an internal id (KIRO-03, D-151's vocabulary); the debrief must quote every fact and grade and add no number (KIRO-06). What fails a rail, times out (25 s), errors or hits a cap answers with the CON-03 text and `offline: true` (KIRO-09).
- **Caps** (KIRO-10, D-23): 60 calls a run, 400 a day (UTC, in memory).

## Tests

`npm test` runs `server/server.test.ts` against **a fake ACP agent** (`server/test/fake-acp.mjs`): no Kiro, no credits. `npm run test:kiro-live` (`KIRO_LIVE=1`) runs `server/live.test.ts` against the real `kiro-cli`: five calls, about half a credit; log it in `docs/KIRO_USAGE.md`.

## Logging `kiro-cli` in

Log the CLI in once on the machine (`kiro-cli login`; on a machine without a browser, `kiro-cli login --use-device-flow`, which prints a URL and a code to confirm on any device) and the server inherits that session: this is how the team's laptops and the Fly machine run it (D-201; `docs/HOSTING.md` §3 is the Fly runbook, with the session kept on a volume through `XDG_DATA_HOME`). A key, on a plan that has one, goes in the repo-root `.env` as `KIRO_API_KEY=…` (never in git; CI's secrets guard blocks it) and wins over the login.

The server re-checks the login every 10 minutes (`server/auth.ts`, `watchAuth`: `kiro-cli whoami`, cached, no credits, no agent) and `GET /healthz` reports it as `kiroAuth`: `key`, `cli-login` or `none`; a change logs `[kiro] auth changed: cli-login → none`. A lapsed login means every run plays offline until `kiro-cli login` is run again (KI-203).

## Notes

- **The game tools and Kiro's deferred catalogue (KI-191, D-191).** `ASBX_KIRO_MANDATORY_MCPS=game` is set on the agent's environment (`server/runs.ts`): Kiro's agent server otherwise hides MCP tools in a deferred catalog the model has to load first, and the in-game Kiro then never looked at the logs. Because that knob is internal to Kiro, **the server verifies it at every session start**: it waits (up to 8 s) for Kiro's tool catalogue (`_kiro/tools/didChange`) to list all nine `@game/<tool>` tags. If it does not, the log says `ERROR: the agent never listed the game tools (missing @game/alerts …); this run plays offline` and every call of that run answers with the rule-written text and `reason: "no-tools"`; the day's counter is charged once. A green session logs `… ready in N ms, session …, 9 game tools listed`.
- **The counters survive restarts (KI-193).** `server/.state/runs.json` (gitignored; `KIRO_STATE_FILE` to move it) holds the day's call count and the live runs' counts and tokens, written atomically on every change, so a deploy or a crash does not reset the daily cap. The agent processes are not persisted: a run's next call starts a fresh one.
- The prompt file lives in `.kiro/prompts/`, not `.kiro/agents/`: every `.md` under `agents/` is read as another agent.
- The v3 engine lists the names of the user's global `~/.kiro/skills` to every session (KI-192); the agent has no tool to open them and its cwd is an empty temp folder, so nothing leaks.

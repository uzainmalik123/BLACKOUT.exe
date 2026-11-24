# The Kiro server (PRD SYS-12, KIRO-01..10, KDEV-06; D-190)

The one small server the game needs: it runs the **real Kiro** (`kiro-cli acp`, the Agent Client Protocol over stdio) **on rails** for the Kiro panel. The game itself runs in the browser and works without this server (every Kiro feature falls back to rule-written text, KIRO-09).

## Run it

```sh
cd game
npm run server            # http://127.0.0.1:8787, API only; `npm run dev` proxies /api/kiro/* here
npm run server -- --serve-dist   # also serves game/dist (after `npm run build`): the production shape (SYS-18)
```

Environment (read from the repo-root `.env`, see `.env.example`, or the shell):

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `8787`, `127.0.0.1` | Where to listen (`HOST=0.0.0.0` in a container) |
| `KIRO_CLI` | `kiro-cli` | The Kiro CLI binary (2.37.1 is what this was built against) |
| `KIRO_API_KEY` | unset | Passed to `kiro-cli` as its environment when set. **Unset: `kiro-cli` uses its own login** (`kiro-cli login`), which is how the team's machines run it; this build of `kiro-cli` reports `is_api_key=false` in its logs when there is none, so a key is honoured if the CLI supports it |
| `NODE_ENV=production` | | Same as `--serve-dist` |

Logs go to stdout, one line per call: `[kiro] run <id> ask #3 (today 12/400): 7462 ms, credits 0.104, tools [@game/alerts @game/tail_logs], stop end_turn, 720 chars`. The credits are what Kiro's agent server reports per turn (`session_info_update` / `turn_completion`); KI-02 reads them from here.

## What it does

- `POST /api/kiro/run` → `{ token, callsLeft }`. A run token per game; refused with 429 once the day's cap is spent.
- `POST /api/kiro/ask | hint | explain | draft | debrief` with `{ token, snapshot, … }` (`src/kiro/client.ts` sends them). The **snapshot** (`src/kiro/snapshot.ts`) is the browser's spoiler-free view of the world: meters, alerts (kind and time only), the newest 500 log lines as rendered, accounts, uploads, defences, the player's last 20 actions. The server keeps the latest one per run; that is what Kiro's tools read.
- `POST /mcp/<token>`: the game tools (KIRO-07) as an **MCP server over HTTP**, inside this process. `kiro-cli acp` is given its URL in `session/new`. Nine read-only tools: `alerts`, `meters`, `search_logs`, `tail_logs`, `accounts`, `uploads`, `defences`, `recent_actions`, `command_list`. No write tool exists.
- One **`kiro-cli acp --agent-engine v3` process per run**, started at the run's first call, in an **empty temp folder outside the repo** that holds only the custom agent (`.kiro/agents/kiro-game.json`, prompt `.kiro/prompts/kiro-game.md`). The agent has **no built-in tools** (`tools: ["@game"]`, every built-in capability denied): the KI-13 fix. The process is killed when the run ends (`POST /api/kiro/end`) or after 20 idle minutes.
- **Rails** (`src/kiro/rails.ts`), applied before anything reaches the player: every drafted line through the shell's `checkCommandLine`, unsupported lines stripped (KIRO-08); a hint about one of Death's moves may name no closing action and nothing may name an internal id (KIRO-03, D-151's vocabulary); the debrief must quote every fact and grade and add no number (KIRO-06). What fails a rail, times out (25 s), errors or hits a cap answers with the CON-03 text and `offline: true` (KIRO-09).
- **Caps** (KIRO-10, D-23): 60 calls a run, 400 a day (UTC, in memory).

## Tests

`npm test` runs `server/server.test.ts` against **a fake ACP agent** (`server/test/fake-acp.mjs`): no Kiro, no credits. `npm run test:kiro-live` (`KIRO_LIVE=1`) runs `server/live.test.ts` against the real `kiro-cli`: five calls, about half a credit; log it in `docs/KIRO_USAGE.md`.

## Pointing `kiro-cli` at a key

Put `KIRO_API_KEY=…` in the repo-root `.env` (never in git; CI's secrets guard blocks it) and start the server. Without it, log the CLI in once on the machine (`kiro-cli login`) and the server inherits that session.

## Notes

- `ASBX_KIRO_MANDATORY_MCPS=game` is set on the agent's environment (`server/runs.ts`): Kiro's agent server otherwise hides MCP tools in a deferred catalog the model has to load first, and the in-game Kiro then never looked at the logs (KI-191).
- The prompt file lives in `.kiro/prompts/`, not `.kiro/agents/`: every `.md` under `agents/` is read as another agent.

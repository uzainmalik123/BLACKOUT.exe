# Teammate tasks: what you can build now, without Uzain

> Written 2026-11-18. Deadline **2026-12-04**. Uzain is busy for a while, so this is the work you can do on your own, in order.
>
> Everything here is a row in **`docs/PRD.md`**. The row is the spec: build what it says, and its **Done when** is how you know you're finished. Read `AGENTS.md` first: it has the rules (PRD rows only, status in PRD §16, decisions in `docs/DECISIONS.md`, `npm run health` green, no secrets).

---

## Before you start

1. **Wait for PR #50 to be merged** (the recording rig and the first two recordings). Your work builds on what it adds:
   - `game/src/recordings/format.ts`: the recording format (decision **D-15** explains every field).
   - `game/src/recordings/ATK-03.a.json` (login SQL injection) and `ATK-08.a.json` (sqlmap dumping customers): two real recordings to play with.
   - `game/src/recordings/juiceshop.sqlite`: the shop's database before any attack. `sql.js` is already a dependency.
2. Branch from `origin/main` for each task; one PR per task (or per small group of rows). Add the rows you moved to **PRD §16 Status** in the same PR.
3. If a row is unclear or turns out wrong, **don't improvise in code**. Write the question in `docs/KNOWN_ISSUES.md` and move to the next task. Uzain rules on it later.

---

## What's blocked on Uzain (don't start these)

| Blocked | Why |
|---|---|
| New recordings (REC-03, the other ATK moves, MIN recordings, REC-04 fake customers) | The rig runs on Uzain's machine; recording also needs a way to capture curl responses first (REC-02 is still `building`) |
| Everything Kiro: SYS-12, KIRO-01 to KIRO-11, KDEV-03/05/06 | Needs Uzain's Kiro account and credits; the cost per call isn't measured yet (KI-02) |
| SYS-18 hosting | No host picked (KI-04) |
| The name, the category, the trailer | Team decisions |

---

## Track A: the rules engine (start here; most important)

The game's brain, with **no UI**. Pure TypeScript in `game/src/rules/` and `game/src/engine/`, tested with Vitest. This is what the rough first playable version (target **Nov 22**) runs on. Build it in this order:

| # | Rows | What to build | Notes |
|---|---|---|---|
| A1 | **SYS-04** | The world state: one typed model for accounts, sessions, signing key, files, feature flags, firewall rules, WAF rules, backups, Death's gains, footholds, evidence | Everything else reads and writes through it |
| A2 | **SYS-17** | The rules as data: `game/src/rules/moves.ts` (PRD §3: every ATK row's stage, Needs, Gains, Stopped by), `actions.ts` (§5: every DEF row), `minions.ts` (§4). Plus the consistency tests from the row, and the **property-based tests with fast-check** (add it as a dev dependency) | Copy the PRD tables faithfully, including the D-18 and D-19 changes (ATK-15/16 need `map` and are stopped by DEF-12 too; ATK-12 needs `user-session`, which MIN-02 can supply) |
| A3 | **SYS-01, SYS-05, SYS-06** | Game clock (1 real s = 30 game s), souls, heartbeat with the exact drain/recover numbers in SYS-06 | Write the SYS-06 Done-when test first: "plug pulled only" flatlines at the expected minute |
| A4 | **SYS-10** | The event log: every Death move, minion wave, player action and Kiro call, timestamped in game time | The report and the sims read only from this |
| A5 | **SYS-03** | The replay engine: plays a recording's events into a virtual access log, app log, DB and files at game speed; stops a recording mid-way when an action cuts it (e.g. blocking its IP) | Test it on ATK-03.a and ATK-08.a. Each `exfil` event = souls stolen (SYS-05). Render `access` events into nginx `combined` lines yourself (D-15) |
| A6 | **SYS-07** | Banishment and the return | Needs A2's footholds |
| A7 | **SYS-02** | The Director | Deterministic for a seed, and keeps stage order (D-19): a stage-N move only after a stage-(N-1) move, except during the return or after a tip-off. SYS-17's stage-order test needs it |
| A8 | **SYS-16** | Playthrough sims: SIM-1 to SIM-7 | With only two real recordings, sims may use **made-up recordings inside test files** (clearly test-only, never in `game/src/recordings/`). They become real as recordings arrive |

Then, still headless and independent:

| # | Rows | What to build |
|---|---|---|
| A9 | **SYS-11** | Report grading: pure rules over the event log (time to notice, souls lost, whack-a-mole, evidence before eradication, ...). One test per rule with a crafted event log |
| A10 | **SYS-08** | Difficulty dials as config; the test diffs two configs |
| A11 | **SYS-13, SYS-14** | Struggle detector; notification clock |

---

## Track B: the shell (SYS-09)

Our own terminal: the command list is fixed in the PRD row and in `.kiro/steering/game-shell.md`. It reads the virtual files that A5 fills, and `sqlite3` runs real SQLite (sql.js) on `juiceshop.sqlite`.

**Ask Uzain one thing before starting:** the PRD says the shell is built **from a Kiro spec** (KDEV-02), because it's one of our Kiro-usage showcases for the judges. If you have Kiro access, build it in Kiro from a spec in `.kiro/specs/shell/` and log the session in `docs/KIRO_USAGE.md`. If not, do Track A first and leave the shell until that's sorted.

---

## Track C: the look (in parallel with A, small doses)

Reanimator failed by building screens before the core loop worked, so **no game screens until Track A's replay (A5) runs**. These two are safe because they're self-contained:

| Rows | What to build | Notes |
|---|---|---|
| **UI-05 (renderer only)** | The dot-matrix renderer: still images moved by code, turned into dots live (4 dot sizes by brightness, 4×4 Bayer dither, colour tint, flicker, impact frames). GAME_PLAN §11 describes it | The old one is on the **`failed`** branch in `reanimator/src/render/` (`dither.ts`, `draw.ts`, `renderer.ts`); reusing it is allowed (D-02). A demo page with one still image is enough for now |
| **CON-06** | Art stills: Death (≥ 5 poses), 4 minions (crawlers = rats, wraith swarm = wisps, gnawer = grub, poltergeist = flicker), room props | Free/own images only: the video can't contain anything copyrighted (SUB-03) |

After A5 works: **UI-01** (desktop gate), **UI-02** (menu), **UI-03** (briefing), then **UI-04** (the dashboard) on top of the real engine.

---

## Track D: writing (no code; fill gaps between tasks)

| Rows | What to write | Where |
|---|---|---|
| **CON-01** | The briefing files: system map, who's a legit admin, what normal traffic looks like, the company playbook (PICERL steps) | `game/src/content/briefing/` as Markdown |
| **CON-04** | Death's taunts: ≥ 3 per ATK move, plus "you blocked me", "you tipped me off", "banished", "I'm back" | `game/src/content/taunts.ts` |
| **CON-05** | One plain-words explanation per log line type. Start with the line types in ATK-03.a and ATK-08.a | `game/src/content/explanations.ts` |
| **CON-03** | The rule-written fallback texts for Kiro's hints and debrief (used when Kiro is offline) | `game/src/content/fallbacks.ts` |

Everything you write must be **true to real incident response** (GAME_PLAN §9): the test is "would this help or hurt the same way in a real incident?"

---

## Suggested order for the next week

1. A1 → A2 → A3 (the core numbers, all tested)
2. A4 → A5 (now the real recordings play)
3. A6, then A7, then A8
4. Track D and the renderer whenever you need a break from the engine
5. Tell Uzain when A5 runs: that's when the first playable screen can start

## When you're done with a task

- `npm run health` green in `game/`.
- PRD §16 updated with the rows you moved (`building` or `done`).
- Anything you found that's wrong or unclear → `docs/KNOWN_ISSUES.md`; anything you decided → `docs/DECISIONS.md` (only within what the row already says).
- Open a PR; Uzain reviews when back, or merge it yourself if CI is green and it only touches your track.

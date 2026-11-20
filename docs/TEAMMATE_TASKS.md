# Teammate tasks: your lanes

> Updated 2026-11-20 (D-21). Deadline **2026-12-04**.
>
> **Uzain (with Claude) builds the rules engine (Track A), the recordings and Kiro.** You own **the shell, the look and the writing**. That splits the game along clean lines: the engine is the brain; you build everything the player touches and sees.
>
> Everything here is a row in **`docs/PRD.md`**. The row is the spec, and its **Done when** is how you know you're finished. Read `AGENTS.md` first (PRD rows only, status in PRD §16, decisions in `docs/DECISIONS.md`, `npm run health` green, no secrets).

---

## How to work

1. Branch from `origin/main` for each task; one PR per task (or small group of rows). Add the rows you moved to **PRD §16 Status** in the same PR.
2. If a row is unclear or wrong, **don't improvise in code**: write the question in `docs/KNOWN_ISSUES.md` and move on. Uzain rules on it.
3. Stay inside your folders so the two of us never edit the same files: `game/src/shell/`, `game/src/ui/`, `game/src/render/`, `game/src/content/`, `game/public/art/`. The engine lives in `game/src/engine/` and `game/src/rules/` (Uzain's).
4. Useful things already on main:
   - `game/src/recordings/ATK-03.a.json` and `ATK-08.a.json`: real attack recordings (format: `format.ts`, decision **D-15**). Good for realistic log lines in your screens and texts.
   - `game/src/recordings/juiceshop.sqlite`: the shop's database; `sql.js` is already a dependency.

---

## 1. The shell (SYS-09), start here

The player's main tool, and a **must** for the first playable version. The command list is fixed in the PRD row and in `.kiro/steering/game-shell.md`.

- **Build it in Kiro from a spec** (KDEV-02): it's one of our Kiro showcases for the judges. Put the spec in `.kiro/specs/shell/` (requirements, design, tasks) made from the SYS-09 row, implement it in Kiro, and log every session in `docs/KIRO_USAGE.md` (date, feature, what it built, credits). **Ask Uzain how you get Kiro access** before starting.
- **The contract with the engine:** the shell never touches game state directly. Define one interface in `game/src/shell/world.ts`, for example:
  - read: a virtual file system (`/var/log/nginx/access.log`, `/var/log/juice-shop/app.log`, `/srv/juice-shop/uploads/...`), the sql.js database
  - act: `blockIp`, `unblockIp`, `listFirewall`, `stopService`, `startService`, `snapshotEvidence`, `deleteFile`, ...: one method per DEF row the terminal can trigger (DEF-01 to DEF-06, DEF-08, DEF-11, DEF-14, DEF-15, DEF-18)
  
  Build and test the shell against a fake `World` of your own. Uzain's engine implements the same interface later. Send Uzain the interface as soon as it's drafted, so both sides agree early.
- **Tests:** each command's supported flags; the fast-check property test (random input never throws, it only prints an error); the exported command list matches `.kiro/steering/game-shell.md` (KDEV-01).

## 2. The look

| Order | Rows | What to build | Notes |
|---|---|---|---|
| 2a | **UI-05 (renderer)** | The dot-matrix renderer: still images moved by code, turned into dots live (4 dot sizes by brightness, 4×4 Bayer dither, colour tint, flicker, impact frames). GAME_PLAN §11 | The old one is on the **`failed`** branch in `reanimator/src/render/` (`dither.ts`, `draw.ts`, `renderer.ts`); reusing it is allowed (D-02) |
| 2b | **CON-06** | Art stills: Death (≥ 5 poses), 4 minions (crawlers = rats, wraith swarm = wisps, gnawer = grub, poltergeist = flicker), room props | Own or free-licence images only (SUB-03: no copyrighted material in the video) |
| 2c | **UI-01, UI-02, UI-03** | Desktop gate, menu (scenario + difficulty), briefing screen with its timer (Easy: none, Medium 3 min, Hard 90 s) | These don't need the engine. Briefing text comes from CON-01 (below) |
| 2d | **UI-04** | The SOC dashboard: log panel, alerts, 💀/🫀 meters, game clock, terminal (your shell), consoles, Kiro panel | **Lay it out against the engine's state types once SYS-04 is on main**; wire it to the live engine when SYS-03 (replay) runs. Uzain will tell you both moments |
| 2e | **UI-06, UI-07** | Endings; the report screen (after SYS-11 exists) | |
| 2f | **UI-08** | Sound (should): ambience, heartbeat that speeds up as it weakens, impact hits | Own or free-licence only |

## 3. Writing (no code; fill gaps between tasks)

| Rows | What to write | Where |
|---|---|---|
| **CON-01** | Briefing files: system map, who's a legit admin, normal traffic, the company playbook (PICERL steps) | `game/src/content/briefing/` (Markdown) |
| **CON-04** | Death's taunts: ≥ 3 per ATK move, plus "you blocked me", "you tipped me off", "banished", "I'm back" | `game/src/content/taunts.ts` |
| **CON-05** | One plain-words explanation per log line type; start with the lines in ATK-03.a and ATK-08.a | `game/src/content/explanations.ts` |
| **CON-03** | Rule-written fallback texts for Kiro's hints and debrief (used when Kiro is offline) | `game/src/content/fallbacks.ts` |

Everything you write must be true to real incident response (GAME_PLAN §9): "would this help or hurt the same way in a real incident?"

---

## Suggested order

1. Shell interface (`world.ts`) → send it to Uzain → the shell in Kiro
2. Renderer and art, and the menu/briefing screens, between shell tasks
3. The dashboard once SYS-04 is on main; wire it up once SYS-03 runs
4. Writing whenever you need a break

**Target:** shell + menu + briefing ready by **Nov 24**, so the first playable version (engine + shell + a rough dashboard) can come together around **Nov 25**.

## When you're done with a task

- `npm run health` green in `game/`.
- PRD §16 updated with the rows you moved.
- Questions → `docs/KNOWN_ISSUES.md`; decisions within the row → `docs/DECISIONS.md`.
- Open a PR; Uzain reviews, or merge it yourself if CI is green and it only touches your folders.

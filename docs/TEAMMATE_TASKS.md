# Teammate tasks: everything the player sees

> For **BLACKOUT.exe** (the Kiroween 2026 entry; named in D-210). Updated 2026-11-21 (D-36). Deadline **2026-12-04**.
>
> **Uzain builds the brain:** the engine, the shell's logic, Kiro's server, report grading, recordings, hosting. **You build everything the player sees and hears:** every scene, the dot-matrix renderer, art, sound, the terminal window.
>
> Start with **`docs/SCENES.md`** (every scene: what it's for, what it must contain, how it should feel; layout and style are yours) and **`docs/ENGINE_API.md`** (how a scene reads the engine and sends the player's actions). Read `AGENTS.md` for the repo rules.

---

## How to work

1. **Use the real engine from day one.** It runs headless already: `new Engine({ seed, difficulty })`, call `advance()` every frame, draw `engine.world`. No fake data needed. For the three parts that aren't built yet (shell, Kiro, report), use the stub described in ENGINE_API §5.
2. **Your folders:** `game/src/ui/`, `game/src/render/`, `game/public/` (art, fonts, sounds). Uzain's: `game/src/engine/`, `game/src/rules/`, `game/src/shell/`, `game/src/kiro/`. You never need to edit his, and he won't edit yours.
3. **Branch from `origin/main`**, one PR per scene or feature, `npm run health` green. Add the UI rows you moved to **PRD §16 Status** in the same PR.
4. If you need something from the engine that ENGINE_API.md doesn't give you, **ask** (or write it in `docs/KNOWN_ISSUES.md`) rather than reading engine internals: those can change.
5. Merge your own PR when CI is green and it only touches your folders.

## The list

| Order | Rows | What |
|---|---|---|
| 1 | **UI-04** (skeleton) | The dashboard with the real engine: meters, clock, logs, alerts. **This is the first playable version; aim for Nov 24** |
| 2 | **UI-02, UI-03** | Menu and briefing (content CON-01 comes from Uzain's side; use placeholder text until then) |
| 3 | **UI-04** (rest) | Terminal window (stub shell), consoles wired to `engine.act`, Kiro panel (stub) |
| 4 | **UI-05** + **CON-06** | The dot-matrix renderer (the old one is on the `failed` branch, `reanimator/src/render/`; reuse is allowed, D-02), Death and the minions, reacting to events |
| 5 | **UI-06, UI-07** | The four endings; the report screen (stub report until SYS-11 lands) |
| 6 | **UI-01**, transition, **UI-08** | Desktop gate, "Death arrives", sound |

**Content you don't have to write:** briefing files (CON-01), taunts (CON-04), log explanations (CON-05) and fallback texts (CON-03) come from Uzain's side. Art (CON-06) is yours.

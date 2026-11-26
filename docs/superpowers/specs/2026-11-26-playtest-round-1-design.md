# Playtest round 1: the calm first minute, honest alerts, a WAF that is only a bandage, tools within reach

Status: draft for the team's approval, 2026-11-26. Numbering block for this work: decisions D-230..D-239, issues KI-230..KI-239. New PRD rows: SYS-22, SYS-23, SYS-24, DEF-21, UI-11, UI-12.

## Intent and why

The first real playthrough (2026-11-26, Uzain) found four things:

1. Death's scan starts the instant the briefing ends (`nextMoveAt: 0`). The player has no moment to learn the room, and the opening is a wall.
2. The player can harden everything before anything has happened, and that is almost free.
3. Two clicks win on Easy: the SQLi rule set stops the login injection on every level and the search dump on Easy (D-34), the login rate limit stops Hydra and the password bots (DEF-07), and D-117 counts a WAF rule as a "real fix" for the win. The WAF console is a win button.
4. Too much is on screen at once, the tools sit behind menus in the top right, and the player can't tell what to do next.

The game's promise (GAME_PLAN §9) is that every mechanic teaches something true. All four fixes below are things real incident responders live with: change control, IDS alerts that name a symptom and never the attacker, WAF rules that get evaded, and the discipline of confirming an attacker before acting on a hunch.

## Goals

- A short calm opening in which the player can look around and learn the panels, with no way to pre-harden.
- Death's arrival is felt through signs in the data, never announced.
- Discovery is an explicit act the player performs, not something the judge infers from a lucky `tail`.
- A WAF rule helps for a while and then fails; only the code patch ends a door.
- Every tool is one click away, several can be open at once, and a one-line strip always says what the current job is.
- A newcomer on Easy never has to type a command; a player who wants the real terminal picks Medium or Hard, and the menu says so before they choose.

## Non-goals and anti-goals

- No new attack recordings, no new Death moves.
- No tutorial that plays the game for the player: the player performs every taught step; the training shift uses a scripted drill intruder, never Death's real quiet techniques.
- Nothing that tells the player which gate Death is using before they have confirmed it themselves.
- Not a UI redesign by the brain side: the screens stay the teammate's; this spec fixes what they must contain and how the engine supports it.

## Constraints

- AGENTS.md rules: PRD row and decision first, then code; `npm run health` green; the PRD-sync tests still pass.
- The judging engine (SYS-21, D-114/D-115) already defines "relevant" actions by outcome; the new discovery act builds on it, it does not replace it.
- Deadline 2026-12-04. Everything here is must-have except where marked.

## Approaches considered

### The opening
- A. A fixed timer of silence, then the scan. Rejected: a player can still pre-harden at second one, and a timer alone teaches nothing.
- **B (chosen). A short random wait plus a change freeze.** Death's first move waits a seeded 15–30 real seconds (Easy 25–30, Medium 20–30, Hard 15–25, all _(tune)_). Customers flow from second one, so the logs show what "normal" looks like. Minions start only after Death's first move. Until the first alert opens, every change action is refused with the in-world reason; reads work. The freeze lifts the moment the first alert opens.

### The two-click win
- A. WAF rules never affect Death. Rejected: real WAFs do stop naive attacks, and the player would learn a falsehood.
- **B (chosen). A WAF rule is a bandage.** It stops the move it matches now; Death evades it after a breather (Easy: after two) with his quiet variant, on every level. Only a deployed code patch (DEF-13) closes a door for good. A SQLi rule also catches some real customers (false positives), a visible cost. D-117 changes to "patch only".
- C. Keep today's rules and only raise the costs. Rejected: still a win button on Easy.

### Alerts and discovery
- A. Alerts name the move ("Death is dumping the database"). Rejected: no attacker announces himself; it kills the investigation.
- **B (chosen). IDS-style alerts and an explicit flag.** An alert says the route and the symptom ("unusual activity on `/rest/user/login`: 40 failed logins in 30 s"), never who. The player confirms an attacker by **flagging an address** (a new action, DEF-21) from a log line, the top-talkers list or the terminal. A correct flag is the discovery: the judge counts it, and from then on the gate panel may say "attacker confirmed at login". A wrong flag is a false lead: it costs nothing immediately, but the report lists "chased N false leads" and the struggle detector treats it as time lost.

### The tools on screen
- A. One console with tabs. Rejected: one thing visible at a time, and the player hides the logs to act.
- **B (chosen, the team's idea). A dock and floating windows.** Every tool is one click on a dock along one edge; it opens as a floating window (draggable, close at top right, several open at once); no nested menus. A one-line **"Now:"** strip shows the judge's current playbook phase in plain words. During the opening, panels appear as the tutorial text points at them.

## What gets built

### SYS-22: The shift start and the change freeze (engine)
- `config.ts` per level: `firstMoveDelayRealMs: [min, max]` (Easy 25–30 s, Medium 20–30 s, Hard 15–25 s, _(tune)_), drawn from the seed. The Director's first move waits for it; minion waves and taps wait for Death's first move.
- `world.incident: { declaredAt?: number }`. It is set when the first alert opens (`alert-opened`). Until then every change action (DEF-05..DEF-20 except DEF-19 escalate, which is allowed and also declares the incident) answers `ok: false` with the message `No incident declared. Change control forbids production changes outside an incident.`; the shell prints that message for `iptables`, `systemctl`, `rm`, `tar czf /evidence/…`, `sqlite3` lock/delete. Reads work. The freeze never returns once lifted.
- Event `incident-declared` with `by: 'alert' | 'escalation'`.
- `ENGINE_API`: `world.incident`, the event, the refusal text, and that the screens should show the freeze as a locked state with the reason, not as hidden controls.
- Tests: an action at second 5 is refused and leaves the world unchanged; the first alert lifts the freeze; escalation lifts it too; Death's first move lands inside the configured window on every level and seed; minions never start before it; the exploit cheaters still can't win; a do-nothing player still loses.

### Tutorial text (content, CON-03 extended)
- `kiro-fallback.ts` gains a `tutorial` section: Easy, five short steps that point at the panels in order (the log, the alerts, the meters, the terminal with one safe command to try, the dock); Medium, three lines; Hard, one line ("Change freeze is on until an incident is declared. Look around."). The text never mentions Death's moves or gates. The live Kiro may rephrase it (KIRO-03's rules apply).
- Shown by the Kiro panel during the freeze; the screens decide the look.

### SYS-23: The WAF is a bandage (engine)
- A WAF rule that cuts or blocks a Death move marks that door `bandaged`. After the next breather (Easy: the next two), the Director picks the quiet variant of the same move, which the rule does not match, on every level; `wafEvasion` in `config.ts` is replaced by this rule (D-34 superseded).
- D-117 amended: winning (banished) and `clean-handover` require the **code patch** on every soul door Death got into; a WAF rule, a flag, a revoke or a lock never counts as the fix.
- False positives: while a SQLi rule set is on, a seeded share of customer requests whose query holds an apostrophe or a quote (searches like `O'Brien`, feedback with quotes) answer `403` and count as failed requests under D-65's backlash (price class of the request). The share is _(tune)_, about 1 in 40 searches; CUST.a and CUST.b are inspected for such requests and the rule is applied to them.
- Tests: a WAF-only player loses the door again after the breather on every level; the patch ends it; the false-positive cost shows in the log and heartbeat; SIM-8/SIM-9 and the exploit suite still hold; the prd-sync test passes with the rows updated.

### DEF-21: Flag an address (engine + shell + screens)
- `PlayerAction { type: 'DEF-21'; ip: string; note?: string }`. From the terminal: `flag <ip> [note]` (one new shell command; the steering command list and `COMMAND_LIST` grow by one; KDEV-01's test keeps them in sync). From the screens: a "flag" action on a log line or a top-talkers row.
- Effect: `world.flags: Array<{ ip, at, correct: boolean }>`. `correct` is true when the address is one Death or his proxies use or have used (`deathAddresses`), or a minion's current wave address. The judge counts a correct flag as the discovery of that move (relevance by outcome, D-115, gains the flag as its clearest case); the gate panel may then show "attacker confirmed" for the routes that address used. A wrong flag is logged; the report lists "chased false leads: N" as a mistake when N ≥ 2; the struggle detector counts a wrong flag as a non-relevant action.
- Flagging is allowed during the change freeze: it changes nothing in production. Three things declare the incident and lift the freeze: the first alert, an escalation (DEF-19), and a correct flag (a sharp player who spots the scan before the first alert has declared the incident themselves). A wrong flag declares nothing. Decision D-233 records that.
- Spoiler rule: the engine never tells the screens whether a flag was correct in a way that reveals Death's other addresses; it only confirms the flagged address.
- Tests: correct and wrong flags; the judge's discovery time moves to the flag; two wrong flags become a report mistake; a flag during the freeze is accepted.

### Alerts (engine data, screens show)
- Every alert gains `route` (the path family, e.g. `/rest/user/login`) and `symptom` (a plain sentence built from what the detection data saw: failed-login burst, error burst on search, a new admin account, a file in uploads, a scraper's pace). The `about` field stays internal. ENGINE_API documents `route` and `symptom` and says the screens show only those.
- **Easy names the gate (the team's call).** On Easy an alert also says which gate is under attack in plain words ("this looks like an attack on the login gate") and the dock highlights that gate's console; the attacker is still not named and the address still has to be flagged. Medium and Hard show the symptom only.
- Tests: every alert the committed recordings produce has a route and a symptom, and neither contains a move id or the word Death; on Easy the gate sentence names a route that the move really used.


### SYS-24 + UI-12: The training shift (a 5-minute tutorial scenario)
- **What it is (the team's call).** A separate entry on the menu, "Training shift", about five minutes: a watered-down intruder walks through a simplified attack while the tutorial narrates where to look, which tool to open and what kind of action stops it; the player performs each step themselves. It never teaches the real techniques in detail, never shows Death's quiet variants, footholds, taps, minions, the return or the finale, and never says how to beat the full game. Players go into the real scenario knowing the room, not the answers.
- **Engine, SYS-24: a scripted Director.** `new Engine({ scenario: 'training' })` runs the same engine with the Director replaced by a script: a fixed list of steps, each `{ move, variant, teach: TutorialStep, waitFor: Predicate, timeoutRealMs }`. The intruder plays only the loud variants (ATK-01.a scan, ATK-04.a password guessing, ATK-08.c loud dump) at a slow pace; between moves the script waits until the player has done the taught action (a flag, a block, the login rate limit, search off) or the timeout passes, then moves on. No minions, no taps, no customers' backlash, no shift end, no souls-lost ending: souls and heartbeat move so the meters are seen, but the run ends with "drill complete" and a short card (what was learned), not the report. The change freeze is on for the first step and lifted by the first alert, like the real game. Kiro's tutorial text (CON-03's `tutorial` section) carries every step; the live Kiro may rephrase.
- **The intruder is not Death.** The training shift calls it "a drill" (a scripted test attacker from the company's own security team): the horror beats stay for the real scenario.
- **Screens, UI-12 (the teammate):** the menu entry; an overlay that shows the current step's text and highlights the panel it names; the "drill complete" card. SCENES.md gets the scene.
- **Steps (content):** 1 the room (log, alerts, meters, dock, terminal, cheat sheet); 2 the scan (an alert opens: read it, find the address in the top talkers, flag it); 3 the block (block that address: it comes back from another, so blocking alone is not the end); 4 the password guessing (the failed-login burst: the login rate limit); 5 the loud dump (search errors: switch search off, then the deploy console: a patch is what closes a hole); 6 evidence and the report (snapshot before changing more; what the report will grade). About five real minutes at the scripted pace.
- Tests: the script plays in order on a seeded run, each step waits for its predicate and advances on it or on the timeout; a do-nothing player reaches "drill complete" in under seven minutes; no quiet variant, minion, tap or foothold move ever plays in training; the training run never produces a shift verdict or a report.

### UI-11: The dock, floating windows and the "Now:" strip (screens, the teammate)
- `SCENES.md` §5 gains: a dock along one edge listing every tool (logs, alerts, terminal, WAF, flags, accounts, sessions, deploy, backups, comms, the plug, Kiro, the briefing files, the three detection tools); each opens as a floating, draggable window with a close control at the top right; several may be open; no nested menus. A one-line "Now:" strip shows the judge's playbook phase in plain words (Identify: find out who and how; Contain; Eradicate; Recover), never a move or a gate. During the freeze, the tutorial text points at panels in order and the dock highlights the one it names. The freeze shows as locked controls with the reason text, not hidden controls. Alerts show route and symptom only; a confirmed attacker (DEF-21) may be shown on the gate it used.
- **The difficulty dial made real (SYS-08, screens).** Today the terminal is the only way to investigate on every level, so Easy plays like Hard. The screens make SYS-08's table true:
  - Easy: no typing needed. Every investigate action is a click: log-panel filters (address, status, path), an accounts table with lock / delete / force-reset buttons, an uploads list with delete, "block this address" and "flag" on any log line or top-talkers row. Kiro drafts commands and the Easy "apply it" button runs them (KIRO-04).
  - Medium: the same buttons plus the terminal; Kiro drafts commands the player pastes; hints when stuck (KIRO-03).
  - Hard: terminal first; buttons only on the consoles (WAF, flags, accounts, sessions, deploy, backups, comms, the plug); no investigation buttons, no autocomplete.
  - All levels: a **cheat-sheet window** on the dock: the 31 commands with one real example each, generated from the shell's `help` and `man` data so it can never drift from the real shell.
  - No engine change: every button sends the same `engine.act` the shell would.
- **The difficulty pick says what each level switches on (UI-02).** Under each difficulty on the menu, a short list in plain words: what help is on (buttons, autocomplete, Kiro's hints and "apply it", highlighted log lines with explanations, pausing), how long the briefing timer and the opening wait are, and how fast Death moves. The lists are generated from `config.ts` and SYS-08's table (one source), so the menu never promises something the level doesn't do. Identical at every level and said once above the list: the attacks, their consequences and the report's verdict.
- The look, the layout and the motion are hers.


## Calls made after the builder check (the reviewer's seven questions)

1. **WAF bandage scope.** Every DEF-12 rule and the DEF-07 rate limit are bandages, on every move they match (ATK-01, 03, 04, 08, 15, 16, 17, MIN-02): never only the soul doors. A rule placed **before** a move no longer makes the move unpickable: Death attempts it, the rule cuts it (a `move-cut` by the rule), and that attempt marks the door **attempted**. Winning and `clean-handover` need the code patch on every **attempted or entered** soul door (D-117 amended that way); a rough handover is the best a WAF-only player can get. Evasion after the breather needs a quiet variant of the move: ATK-08 has them (.d–.g); **ATK-03 and ATK-04 get one quiet recording each** (ATK-03.b: the login injection with a tamper that the SQLi rule set misses; ATK-04.b: slow password spraying under the rate limit, one try per account per minute); until those land, the builder logs a KI per move and the rule holds against that move, with the door still counted unfixed. A move with no patch (ATK-17) keeps its stoppers; it is not a soul door and never blocks the win by itself. An evaded rule stays evaded for that move; a second, different rule earns one more breather.
2. **Alerts open on a threshold, not at move start.** An alert opens when the detection data (SYS-20) crosses a per-route threshold: 404 burst, failed-login burst, 5xx burst on search, a new admin row, a new file in uploads, a scraper's pace; the symptom is built from that count. This moves the freeze-lift later by seconds, gives a sharp player the chance to flag the scanner before any alert, and changes KI-216 and the alert tests; D-43's pacing keeps counting open alerts.
3. **The calm runs on the desk.** The engine gains `engine.beginShift()`; the first-move delay counts from that call, not from game ms 0. The prologue's alarm becomes an in-shift beat on the desk (the first alert). The teammate's `night/director.ts` calls `beginShift()` when the desk shows; the ENGINE_API documents it.
4. **The "Now:" strip reads a new non-assessor field,** `world.playbook.phase`: `watch` during the freeze, `identify` once the incident is declared, `contain` after the first correct flag, `eradicate` once no Death move is active for one breather, `recover` after a patch deploys or a backup restores; it moves back to `contain` when a new move lands. Driven by the player's own acts and visible events, never by assessor state, so D-114 rule 6 stands.
5. **False positives need real lines.** CUST.a/b hold no quoted searches, so a small third customer recording, **CUST.c** (about 2 recorded minutes: searches like `O'Brien`, `Dad's juice`, feedback with quotes), is recorded on the rig and looped with the others; the SQLi rule set answers those requests `403`. No recorded line is rewritten. Fallback if the rig can't run in time: a content-blind share, logged as a KI.
6. **Flag edges.** A tap's scraper address and any address a minion wave used in this run are correct flags (they are attackers). A correct flag of a harvest address after souls were taken confirms the breach and starts the 72 h clock (D-116 gains the flag).
7. **Flags are suspicions until confirmed by behaviour.** `flag` records a suspicion; it becomes `confirmed` only when the engine next sees a hostile request from that address (a Death move, a wave, a tap drip) after the flag. Customers never confirm. The screens show "flagged" and then "confirmed"; the judge's discovery is the confirmation time. Flag-spamming the top talkers confirms the loud scanner (which the list already gives away) and leaves every other flag a false lead; "chased false leads" at N ≥ 2 costs the detect grade a letter. The exploit suite gets a flag-spam cheater that must end with a worse detect grade than the playbook player, not a win. Logged as a KI for the playtest: if spam still feels free, add a cooldown.

## Decisions to record
- D-230 the shift start, `beginShift()` and the change freeze; D-231 the WAF as a bandage and D-117 amended to patch-only; D-232 threshold-opened IDS-style alerts; D-233 DEF-21 flagging and what counts as a declaration; D-234 the dock, floating windows, the difficulty dial made real and the difficulty pick's lists (UI-11, SYS-08, UI-02); D-235 Easy names the gate; D-236 the training shift (SYS-24, UI-12).

## Left to the builder
- Exact wording of the refusal, the alerts' symptoms and the tutorial steps (within the rules above).
- How the quiet variant is chosen when a move has only one recorded variant (fall back to a fresh address and a delay; log a KI naming the moves that need a quiet recording).
- Where the false-positive share is applied in `customers.ts`.
- Test names and fixture shapes.

## Open questions for the team
- None blocking. The tune numbers (delays, false-positive share, breather counts) are starting values for the next playtest.

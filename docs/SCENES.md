# The scenes

> For the screens' designer. Written 2026-11-21.
>
> Each scene below says **what it's for**, **what it must contain** (fixed by the PRD) and **how it should feel**. **Everything else is your call**: layout, where things sit, sizes, colours, type, motion, transitions, sound. Where this doc gives an idea, it's an idea, not a spec.
>
> How to read the engine from a scene: `docs/ENGINE_API.md`. The bigger picture: `docs/GAME_PLAN.md` (§3 the playthrough, §11 the look).

---

## 0. Rules that hold everywhere (the only non-negotiables)

1. **Readable data stays crisp text.** Logs, alerts, the terminal, consoles and the report are real text in a mono font. The dot-matrix effect is for the atmosphere (Death, minions, the room, charts), never for text the player has to read (GAME_PLAN §11.4).
2. **The dot world bleeds into the screens.** Death's hand reaching over a panel, a panel glitching when a move lands: the room and the data should feel like one place, not panels pasted on a background.
3. **Desktop only**, 1024 px wide and up; keyboard first. The terminal must always be one keypress away.
4. **No spoilers on screen.** Never show internal ids (`ATK-08`, `MIN-02`) or which move an alert is "about". The player only learns what a real defender would see: logs, alerts, meters. The engine's live assessment (`world.assess`: grades, phase statuses, gaps; SYS-21, D-114) is **never shown as a score or a checklist during the run**: it feeds Kiro's hints and the report at the end, nothing else.
5. **Our own or free-licence assets only** (images, fonts, sounds). The demo video can't contain copyrighted material (SUB-03).
6. **Flashes:** impact frames and glitches flash at most 3 times per second (photosensitive seizure safety, WCAG 2.3.1).
7. **Difficulty changes what the screens help with, never what's true:**

| | Easy | Medium | Hard |
|---|---|---|---|
| Suspicious log lines | Highlighted; hover = plain-words explanation | Highlighted | Raw, no highlight |
| Terminal actions | No typing needed: every investigation is a click (UI-11, D-234) | The same buttons plus the terminal | Terminal first; buttons only on the consoles |
| Alerts | Route, symptom and the gate sentence (D-235) | Route and symptom | Route and symptom |
| Kiro | Explains alerts, suggests a next move, "Kiro, apply it" button | Hints after you're stuck a while | Silent unless asked, except one suggestion in the terminal when you're struggling (SYS-13, D-114) |
| Pause | Allowed | No | No |

---

## 1. Desktop gate (UI-01)

- **For:** stopping phones and small windows.
- **Contains:** a short "play on a computer" message, with the title.
- **Feels:** in-world, not an error page. Death turning someone away at the door works.

## 2. Title and menu (UI-02)

- **For:** the first impression, then picking a scenario and difficulty.
- **Contains:** the title, **BLACKOUT.exe** (D-210; it comes from App's `TITLE` constant, so it stays one edit); the scenario (one for now: *the Juice Shop breach*, so the menu shows no list until there is a second, D-188); difficulty pick with one line each:
  - **Easy:** never seen a server log. Kiro explains everything.
  - **Medium:** you know your way around. Kiro hints when you're stuck.
  - **Hard:** a real shift. Raw logs, Kiro stays quiet.
- **Under each difficulty, what it switches on (D-234):** a short list in plain words, generated from `game/src/engine/config.ts` (`CONFIG[level]`) and §0's table, never typed by hand, so the menu can't promise what the level doesn't do. One list per level, for example:
  - the help: buttons for every investigation (Easy, Medium), autocomplete (Easy), Kiro's hints and "apply it" (Easy; Medium hints when stuck), highlighted log lines with explanations (Easy; Medium without the explanations), pausing (`pausable`, Easy only);
  - the calm before the first sign of trouble (`firstMoveDelayRealMs`, SYS-22, D-252: Easy 8–10 s, Medium 6–9 s, Hard 5–8 s);
  - how long Death rests between moves (`breatherGameMs`, shown in real seconds: 45–60, 30–45, 20–35);
  - how long the shift is (`shiftGameMs`, in real minutes: about 20, 16, 13).
  - above the three lists, once: **identical at every level: the attacks, their consequences and the report's verdict.** The briefing has no timer on any level (D-183), so it isn't a dial.
- **Training shift (UI-12):** a menu entry beside Start; see scene 10.
- **Feels:** the horror-game promise. This is the "expecting a horror game" half of the pitch; the trailer opens here.

## 3. The briefing (UI-03)

- **For:** the calm before. The player reads what a real defender would have before a shift.
- **Contains:**
  - the four briefing files' facts (content CON-01: system map, who's a legit admin, what normal traffic looks like, the company playbook), told by Kiro in a 60-second cinematic (D-189): the shop at 3 AM, a tactical map, the unguarded gate, the logs, the unknown admin and Death, narrated aloud with no music, with an optional three-question check afterwards, in front of a cabin in a dark forest with eyes in its doorway
  - no countdown (D-183): a "Start" button
  - the files stay reachable later from the dashboard
- **Feels:** quiet, slightly too quiet. A clock ticking. Something in the dark you can almost see.

## 4. Death arrives: the night-shift prologue (UI-10, D-223)

- **For:** the moment the briefing ends and the incident starts (GAME_PLAN §3.3).
- **Contains:** Death's eyes in the dark; the first-person office in the rain; Kiro's welcome and handshake; the walk to the desk; sitting down; the login and a first, unscored check; the first alarm. The dashboard then lives on the office's monitors.
- **Feels:** the room goes cold, the live data starts flowing. Death's first appearance.

## 5. The SOC dashboard (UI-04): the main scene

Where the whole game is played. The busiest screen; the one judges will see most.

**Must contain:**

| Part | What it shows / does | From |
|---|---|---|
| Live logs | Web server log and app log, scrolling; filterable; on Easy, suspicious lines highlighted with hover explanations | `engine.accessLog()`, `engine.appLog()` |
| The three tools (UI-09) | Top talkers (the busiest addresses in the last real minute, with request and error counts), an error-rate strip (requests, 4xx and 5xx per real minute, the last few minutes) and the log lines coloured by status class. Real counts over the real lines, on every level; none of them says who an address is | `engine.topTalkers()`, `engine.errorRate()`, `statusClass(line.status)` (SYS-20, D-110) |
| Alerts | Open alerts, newest first; closing when the cause is dealt with. Each shows its `route` and `symptom` only ("unusual activity on `/rest/user/login`: 40 failed logins in 30 s"), never `about` (D-232). On **Easy** add the gate sentence ("this looks like an attack on the login gate", from the alert's `route`) and light that gate's console on the dock (D-235) | `world.alerts` |
| 💀 Souls meter | Customers' data left / taken | `world.souls` |
| 🫀 Heartbeat meter | The business's health, 0–100; should *feel* like a heartbeat (faster and weaker as it drops) | `world.heartbeat` |
| Game clock | In-game time of the incident | `world.clock.gameMs` |
| Terminal | Where the player types real commands (`grep`, `iptables`, `sqlite3`, …). It renders the shell's `output` as text, never as HTML (D-106): file content and typed arguments can hold `<`; it empties the screen when `clear` is true and may ignore `exitCode` (D-95) | Shell interface, ENGINE_API §5 |
| Consoles | **WAF** (rules, rate limits) · **Feature flags** (search, registration, password reset, uploads, `/ftp`, feedback CAPTCHA) · **Accounts** (lock, delete, force reset) · **Sessions** (revoke all) · **Deploy** (review the vulnerable code and its fix, then deploy; shows progress) · **Backups** (list by time, restore) · **Comms** (escalate, notify legal / customers, the breach-notification countdown from `engine.notificationClock()`, SYS-14) · the **big red button** (pull the plug / bring it back) | `engine.act(...)`, ENGINE_API §3 |
| Kiro panel | Chat, hints, "explain this line", drafted commands the player copies into the terminal; a visible "Kiro is reading the logs…" wait while the game keeps running; "Kiro (offline)" label when offline | Kiro interface, ENGINE_API §5 |
| Briefing files | Reachable at any time | CON-01 |
| Death and minions | Present in the scene, reacting to events (scene 6) | `world.events` |

### 5.1 The dock, floating windows and the "Now:" strip (UI-11, D-234)

Playtest round 1 found too much on screen at once, tools behind menus in the top right, and no sense of what to do next. So:

- **The dock.** Along one edge, one entry per tool: logs, alerts, terminal, WAF, feature flags, address flags (DEF-21), accounts, sessions, deploy, backups and evidence, comms, the plug, Kiro, the briefing files, the three detection tools (UI-09) and the cheat sheet. **One click opens a tool; no nested menus anywhere.**
- **Floating windows.** Each tool opens as a window: draggable, a close control at its **top right**, several open at once. The player never has to hide the logs to act.
- **The "Now:" strip.** One line, always visible, from `world.playbook.phase` in plain words: `watch` "Look around", `identify` "Identify: find out who and how", `contain` "Contain", `eradicate` "Eradicate", `recover` "Recover". Never a move, a gate or anything from `world.assess` (rule 4 above).
- **The change freeze** (SYS-22). Until `world.incident.declaredAt` is set, change actions are refused. Show their controls **locked, with the reason as text** (`No incident declared. Change control forbids production changes outside an incident.`), never hidden: the player learns that change control exists. Reads, and flagging an address, still work.
- **The opening's tutorial** (CON-03, `OPENING_TUTORIAL[difficulty]` in `game/src/content/kiro-fallback.ts`). On the player's first shift only (D-252: then not again in this browser; Kiro's panel can bring it back; Skip ends it), the Kiro panel shows the steps in order while the night's clock waits; each step names its `panels`, and the dock lights the one it names (Easy: the log, the alerts, the meters, the terminal with one safe command, the dock; Medium three lines; Hard one).
- **Flags.** "Flag" sits next to "block" on every log line and top-talkers row (where the level has those buttons); a flagged address shows *flagged*, then *confirmed* once the engine confirms it. A confirmed attacker may be drawn on the gate it used.
- **The difficulty dial on screen** (§0's table, SYS-08). Easy: no typing needed. Log-panel filters (address, status, path), an accounts table with lock / delete / force-reset buttons, an uploads list with delete, "block this address" and "flag" on any log line or top-talkers row; Kiro's "apply it" runs its drafts. Medium: the same buttons plus the terminal; Kiro's drafts are pasted; hints when stuck. Hard: terminal first; buttons only on the consoles (WAF, feature flags, address flags, accounts, sessions, deploy, backups, comms, the plug); no investigation buttons, no autocomplete. Every button sends the same `engine.act` (or shell line) the terminal would.
- **The cheat sheet** (every level): every shell command with its summary, usage and one real example, generated from `COMMANDS` in `game/src/shell/registry.ts` (the data `help` and `man` print), never typed by hand.

The look, the layout and the motion are yours.

**Feels:** a real security operations room at 3 a.m. with something wrong in it. Dense but readable. The player should always know where the meters are and how to reach the terminal. Pressure comes from the data moving, not from clutter.

## 6. Death and his minions (UI-05)

- **For:** making the attack feel alive and personal. Death reacts to the player.
- **Contains:** Death (at least 5 poses) and four minions, all as dot-matrix figures built from still images moved by code (GAME_PLAN §11.2):
  - **Crawlers:** rats (web scanners)
  - **Wraith swarm:** wisps (password-guessing bots)
  - **Gnawer:** a fat grub (a scraper)
  - **Poltergeist:** a flicker (a spam bot)
- **Reacts to:** the events in ENGINE_API §4 (moves starting, landing and being cut; souls stolen; waves; the return). Which reaction for which event is your call; the table there has ideas.
- **Taunts:** Death's lines (CON-04) can appear as text when moves start, land or are cut.
- **Feels:** Death is the face of the attacker, not a mascot. Minions are pests: "ugh, these again".

## 7. The endings (UI-06)

Four, each its own short sequence, then on to the report; and a fifth screen for the shift's end:

| Ending | When | Feels |
|---|---|---|
| **Banished** | Every route closed and every foothold removed | Relief, earned. Death dissolves |
| **Souls lost** | Death took every customer's data | Defeat. He feeds |
| **Flatline** | The heartbeat hit 0, often from the player's own overreaction | Self-inflicted. The business dies quietly |
| **The return** | The player "won", but a missed backdoor let him back in | The twist. The biggest scare in the game |

And one more screen, **the shift ends** (D-118), for the three verdicts when the clock runs out (`ending` is `clean-handover`, `rough-handover` or `walked-away`): the next shift takes over and the judge's word is on the screen. One layout, the verdict as its headline: *Clean handover* (relief, tired), *Rough handover* (uneasy: something was left for the next shift), *Walked away* (a loss: the door was open when you left). The report follows and shows the verdict first.

## 8. The post-incident report (UI-07)

- **For:** the learning payoff, the "leaves knowing how to respond" half of the pitch.
- **Contains:** the facts (time to notice, time to contain, souls lost, downtime caused); grades per phase (detect, contain, eradicate, recover); mistakes, each with its real-world reason; what was missed; Kiro's debrief; a "download" button (Markdown); back to the menu.
- **Feels:** after the horror, a calm, clear, professional document, like the real report a security team writes. The contrast is the point.

## 9. Sound (UI-08, should)

Ambience, a heartbeat that speeds up as it weakens, impact hits, Death's stings. Your call on all of it; own or free-licence only.

## 10. The training shift (UI-12, D-236, D-238)

- **For:** about five minutes in which a newcomer learns the room and the tools before the real night shift. The player does every step; the game only points.
- **Contains:**
  - the "Training shift" entry on the menu (scene 2); it runs `new Engine({ scenario: 'training' })` (SYS-24);
  - the same desk, dock and windows as scene 5, with an **overlay** that shows the current step's text and highlights the panels it names. The text is `TRAINING_STEPS` in `game/src/content/kiro-fallback.ts` (each step's `lines`, its `panels`, and a `done` line once the step's action is done), or the live Kiro's rephrasing of it. Six steps: the room; the scan (read the alert, find the address in the top talkers, flag it); the block (it comes back from another address); the password guessing (the login rate limit); the loud dump (switch search off, then the deploy console: a patch closes a hole); evidence (snapshot before changing more);
  - the change freeze on the first step, lifted by the first alert, as in the real game;
  - the **"drill complete" card** (`DRILL_COMPLETE`: a title, what was learned, one line on what a real shift grades) with "Play the night shift" and "Main menu". Never a verdict, a grade or the report.
- **The intruder is a drill**, the company's own security team testing the shop: no Death, no taunts, no horror beats, no endings. Death stays a surprise for the real shift.
- **Feels:** a calm walkthrough on a quiet evening; the lights are on. The contrast makes the night shift land harder.

---

## Order that helps the rest of the team

1. **The dashboard skeleton (scene 5)** with the real engine running: meters, clock, logs, alerts. This is the first playable version.
2. Menu and briefing (scenes 2, 3), and the terminal window with the stub shell.
3. Consoles wired to `engine.act`.
4. Death and minions (scene 6) with the renderer; the endings; the report.
5. Gate, transition, sound, polish.

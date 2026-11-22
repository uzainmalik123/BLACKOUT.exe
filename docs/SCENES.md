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
4. **No spoilers on screen.** Never show internal ids (`ATK-08`, `MIN-02`) or which move an alert is "about". The player only learns what a real defender would see: logs, alerts, meters.
5. **Our own or free-licence assets only** (images, fonts, sounds). The demo video can't contain copyrighted material (SUB-03).
6. **Flashes:** impact frames and glitches flash at most 3 times per second (photosensitive seizure safety, WCAG 2.3.1).
7. **Difficulty changes what the screens help with, never what's true:**

| | Easy | Medium | Hard |
|---|---|---|---|
| Suspicious log lines | Highlighted; hover = plain-words explanation | Highlighted | Raw, no highlight |
| Terminal actions | Also available as console buttons | Terminal | Terminal |
| Kiro | Explains alerts, suggests a next move, "Kiro, apply it" button | Hints after you're stuck a while | Silent unless asked |
| Pause | Allowed | No | No |

---

## 1. Desktop gate (UI-01)

- **For:** stopping phones and small windows.
- **Contains:** a short "play on a computer" message, with the title.
- **Feels:** in-world, not an error page. Death turning someone away at the door works.

## 2. Title and menu (UI-02)

- **For:** the first impression, then picking a scenario and difficulty.
- **Contains:** the title (the name is still open, KI-01: make it easy to swap); the scenario list (one for now: *the Juice Shop breach*); difficulty pick with one line each:
  - **Easy:** never seen a server log. Kiro explains everything.
  - **Medium:** you know your way around. Kiro hints when you're stuck.
  - **Hard:** a real shift. Raw logs, Kiro stays quiet.
- **Feels:** the horror-game promise. This is the "expecting a horror game" half of the pitch; the trailer opens here.

## 3. The briefing (UI-03)

- **For:** the calm before. The player reads what a real defender would have before a shift.
- **Contains:**
  - the four briefing files (content CON-01: system map, who's a legit admin, what normal traffic looks like, the company playbook)
  - a countdown: **Easy none, Medium 3 min, Hard 90 s**
  - a "Start now" button
  - the files stay reachable later from the dashboard
- **Feels:** quiet, slightly too quiet. A clock ticking. Something in the dark you can almost see.

## 4. Death arrives (transition)

- **For:** the moment the briefing ends and the incident starts (GAME_PLAN §3.3).
- **Contains:** nothing to read; a few seconds at most.
- **Feels:** the room goes cold, the live data starts flowing. Death's first appearance.

## 5. The SOC dashboard (UI-04): the main scene

Where the whole game is played. The busiest screen; the one judges will see most.

**Must contain:**

| Part | What it shows / does | From |
|---|---|---|
| Live logs | Web server log and app log, scrolling; filterable; on Easy, suspicious lines highlighted with hover explanations | `engine.accessLog()`, `engine.appLog()` |
| The three tools (UI-09) | Top talkers (the busiest addresses in the last real minute, with request and error counts), an error-rate strip (requests, 4xx and 5xx per real minute, the last few minutes) and the log lines coloured by status class. Real counts over the real lines, on every level; none of them says who an address is | `engine.topTalkers()`, `engine.errorRate()`, `statusClass(line.status)` (SYS-20, D-110) |
| Alerts | Open alerts, newest first; closing when the cause is dealt with | `world.alerts` |
| 💀 Souls meter | Customers' data left / taken | `world.souls` |
| 🫀 Heartbeat meter | The business's health, 0–100; should *feel* like a heartbeat (faster and weaker as it drops) | `world.heartbeat` |
| Game clock | In-game time of the incident | `world.clock.gameMs` |
| Terminal | Where the player types real commands (`grep`, `iptables`, `sqlite3`, …) | Shell interface, ENGINE_API §5 |
| Consoles | **WAF** (rules, rate limits) · **Feature flags** (search, registration, password reset, uploads, `/ftp`, feedback CAPTCHA) · **Accounts** (lock, delete, force reset) · **Sessions** (revoke all) · **Deploy** (review the vulnerable code and its fix, then deploy; shows progress) · **Backups** (list by time, restore) · **Comms** (escalate, notify legal / customers, the breach-notification countdown from `engine.notificationClock()`, SYS-14) · the **big red button** (pull the plug / bring it back) | `engine.act(...)`, ENGINE_API §3 |
| Kiro panel | Chat, hints, "explain this line", drafted commands the player copies into the terminal; a visible "Kiro is reading the logs…" wait while the game keeps running; "Kiro (offline)" label when offline | Kiro interface, ENGINE_API §5 |
| Briefing files | Reachable at any time | CON-01 |
| Death and minions | Present in the scene, reacting to events (scene 6) | `world.events` |

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

Four, each its own short sequence, then on to the report:

| Ending | When | Feels |
|---|---|---|
| **Banished** | Every route closed and every foothold removed | Relief, earned. Death dissolves |
| **Souls lost** | Death took every customer's data | Defeat. He feeds |
| **Flatline** | The heartbeat hit 0, often from the player's own overreaction | Self-inflicted. The business dies quietly |
| **The return** | The player "won", but a missed backdoor let him back in | The twist. The biggest scare in the game |

## 8. The post-incident report (UI-07)

- **For:** the learning payoff, the "leaves knowing how to respond" half of the pitch.
- **Contains:** the facts (time to notice, time to contain, souls lost, downtime caused); grades per phase (detect, contain, eradicate, recover); mistakes, each with its real-world reason; what was missed; Kiro's debrief; a "download" button (Markdown); back to the menu.
- **Feels:** after the horror, a calm, clear, professional document, like the real report a security team writes. The contrast is the point.

## 9. Sound (UI-08, should)

Ambience, a heartbeat that speeds up as it weakens, impact hits, Death's stings. Your call on all of it; own or free-licence only.

---

## Order that helps the rest of the team

1. **The dashboard skeleton (scene 5)** with the real engine running: meters, clock, logs, alerts. This is the first playable version.
2. Menu and briefing (scenes 2, 3), and the terminal window with the stub shell.
3. Consoles wired to `engine.act`.
4. Death and minions (scene 6) with the renderer; the endings; the report.
5. Gate, transition, sound, polish.

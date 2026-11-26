# The engine, from the screens' side

> For whoever builds the screens of **BLACKOUT.exe** (`docs/SCENES.md`). Written 2026-11-21 against `main`.
>
> The game's brain is **already running headless** in `game/src/engine/`. You don't need fake data: create a real `Engine`, call `advance()` every frame, and draw what's in `engine.world`. The parts that don't exist yet (the shell, Kiro, the report) have a small agreed interface below; build against a stub of it until the real one lands.

---

## 1. Running a game

```ts
import { Engine } from './engine/engine';

const engine = new Engine({ seed: 42, difficulty: 'medium' });   // 'easy' | 'medium' | 'hard'

// The game loop: hand the engine the real milliseconds since the last frame.
let last = performance.now();
function frame(now: number) {
  engine.advance(now - last);
  last = now;
  if (!engine.world.ending) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Redraw whenever the world changes (after every advance() and act()).
const unsubscribe = engine.subscribe((world) => render(world));
```

- **Time:** the engine converts real time to game time itself (1 real s = 30 game s). Show `world.clock.gameMs` as the in-game clock (a 6-hour incident in about 12 minutes).
- **Pause:** `engine.pause()` returns `false` when pausing isn't allowed (Medium and Hard). Only Easy can pause.
- **Same seed = same game.** Useful for the trailer and for testing a screen against the exact same run.
- **The `world` object is the engine's own.** Read it; never change it. All changes go through `engine.act(...)`.

### 1.1 The shift start and the change freeze (SYS-22, D-230)

```ts
engine.beginShift();   // call it when the desk (the dashboard) is in view; idempotent
```

- **Nothing of Death's happens before `beginShift()`.** Customers flow from the first `advance()`, so the logs show what normal looks like. His first move waits a seeded 25–30 (Easy), 20–30 (Medium) or 15–25 (Hard) real seconds from the call; the minion waves and the leaky taps wait for that first move. `runOn()` in `night/run.ts` calls it today (KI-230): move the call to wherever the desk becomes visible.
- **The change freeze.** From `beginShift()` until the incident is **declared**, every change action (DEF-05..DEF-20 except DEF-19) answers `{ ok: false, message: 'No incident declared. Change control forbids production changes outside an incident.' }` (`FREEZE_MESSAGE` in `engine/actions.ts`); the shell prints that message for `iptables`, `systemctl`, `rm`, `tar czf /evidence/…` and `sqlite3` locks and deletes. Reads (DEF-01..04) and flags (DEF-21) always work. Show the freeze as **locked controls with that reason**, never as hidden ones.
- **Declared** by the first alert, an escalation (DEF-19) or a confirmed flag (DEF-21): `world.incident = { declaredAt, by: 'alert' | 'escalation' | 'flag' }` and the event `incident-declared`. The freeze never returns.
- **The "Now:" strip** reads `world.playbook.phase` (D-233), never the assessor: `watch` (freeze on: look around), `identify` (find out who and how), `contain` (after the first confirmed flag, and again whenever a new Death move starts), `eradicate` (no Death move for one breather), `recover` (a patch deployed or a backup restored). `world.playbook.since` is when it changed (game ms).

## 2. What to read (all on `engine.world`)

| What | Field | Notes |
|---|---|---|
| 💀 Souls | `souls.total`, `souls.stolen.length` | Stolen never goes back down |
| 🫀 Heartbeat | `heartbeat`, `heartbeatMax` | 0–`heartbeatMax`. 0 = flatline (an ending). The maximum starts at 100 and drops for good as customers give up (churn, D-65): draw the lost part of the meter as dead |
| Game clock | `clock.gameMs`, `clock.paused` | |
| Difficulty | `difficulty` | Decides which helpers the screens show (SCENES.md §0) |
| Alerts | `alerts` (`route`, `symptom`, `gate`, `openedAt`, `closedAt?`; `about` internal) | D-232: an alert opens when a detector crosses its threshold, never at move start. **Show `symptom` (one plain sentence, e.g. "unusual activity on /rest/user/login: 5 failed logins in 30 s from one address") and `route` (the path family)**; `gate` is the player-facing gate name (front door, login, passwords, sign-up, search, admin API, products, uploads, feedback, or a leaky tap's name): **show it on Easy only** (D-235). Open = no `closedAt`. `about` is the move, minion or tap: **never show it**, it's a spoiler |
| Flags | `flags` (`ip`, `at`, `note?`, `confirmedAt?`) | DEF-21 (D-233): the player's suspicions. Show "flagged" until `confirmedAt` is set, then "confirmed" (and, if you like, on the gate the address's alert named). There is no correct/wrong field on purpose: an unconfirmed flag may be a customer, or an attacker who has not come back yet |
| Incident / freeze | `incident` (`declaredAt?`, `by?`), `shift` (`beganAt?`, `firstMoveAt?`) | §1.1: frozen while `shift.beganAt` is set and `incident.declaredAt` is not |
| Playbook phase | `playbook.phase`, `playbook.since` | §1.1: the "Now:" strip |
| Bandages | `bandages` (`rule`, `at`, `evadesAt`; `move` internal) | SYS-23 (D-231): a WAF rule or the rate limit that cut one of his moves; after `evadesAt` his quiet variants slip it. Don't show `move`; a WAF console may say "this rule stopped something at HH:MM" |
| Leaky taps | `taps.open` (`id`, `openedAt`) | Small exposures dripping customer data (PRD §4.1, D-42). Each is closed by one WAF path block: `TAP_BY_ID[id].closedBy.rule` in `src/rules/taps.ts` gives the exact `DEF-12` rule a console button should send |
| Detection data | `engine.topTalkers(n?)`, `engine.errorRate()`, `statusClass(status)` | SYS-20 (D-110), for the three tools (UI-09): see §2.1 |
| Logs | `engine.accessLog()`, `engine.appLog()` | Ready-made text, one line per entry (real nginx `combined` lines and real Juice Shop log lines). Also `world.logs.access` / `.app` as structured lines if you want to colour or filter them. Most access lines are ordinary customers (`by: 'CUST'`, SYS-19): **never colour by `by`**, it's a spoiler; what the player did to customers shows as their `503`/`429`/`403` lines |
| Accounts | `accounts` (`email`, `role`, `lockedAt?`, `createdBy`) | For the Accounts console. `createdBy` is a spoiler too: show `role` and `email` only |
| Sessions | `sessions` | For the Sessions console (count, kinds) |
| Feature flags | `features` | `search`, `registration`, `password-reset`, `uploads`, `ftp`, `feedback-captcha` |
| Firewall / WAF | `firewall.blocked`, `waf` | |
| Web server | `nginx` | `'running'` or `'stopped'` (the plug) |
| Patches | `patches.applied`, `patches.pending` (`readyAt`) | A patch takes game time to deploy: show progress |
| Backups | `backups` (`id`, `takenAt`) | For the Backups console |
| Evidence | `engine.evidence()` | Snapshots taken |
| Uploads | `engine.files()` | Files in `uploads/`, incl. planted ones |
| Notification clock | `engine.notificationClock()` | SYS-14 (D-113), for the comms console: `state` (`idle` until a breach is confirmed, `running`, `notified`, `overdue`), `label` a 72-hour face counting down (`HH:MM:SS`, `--:--:--` while idle), `deadline` and `remainingGameMs` |
| Struggle | `struggle.suggestions`, `struggle.lastSuggestionAt` | SYS-13 (D-113, D-114): how many suggestions the rules have unlocked so far (Medium and Hard only; always 0 on Easy, where Kiro helps anyway). The terminal shows that one is available (on Hard too); the Kiro panel's `hint()` answers only while the count is above the hints it has given, aimed at the gap the `suggestion` event names (§2.2) |
| Comms | `comms`, `tickets` | Escalated / notified times. `tickets`: customers' support tickets (`t`, `ip`, `userAgent`, `about` what they were doing, `status` what they got: `503`, `429`, `403` or `'blocked'`, `text`), newest last; list them in the comms console (D-65) |
| Customers | `customers.served`, `.failed`, `.lost` | How many customer requests went through, how many the player's actions failed, how many shoppers gave up (for the report) |
| The ending | `ending` | `'banished'`, `'souls-lost'`, `'flatline'`, `'return'`, or the shift's verdict `'clean-handover'`, `'rough-handover'`, `'walked-away'` (D-118); undefined while playing |
| The shift | `clock.shiftEndsAt` | Game ms when the shift ends (Easy ~20, Medium ~16, Hard ~13 real min): a countdown the dashboard may show; at the limit the run ends with a verdict |
| Everything that happened | `events` | See §4. The source for animations and the report |

### 2.1 Detection data (SYS-20, D-110)

Three read-only selectors over the access log, per real minute, for the dashboard's three tools (UI-09). Every number is counted from the real lines; nothing is invented and nothing says who an address belongs to.

```ts
engine.topTalkers(n = 10)   // Talker[]: { ip, requests, errors }, the busiest addresses in the LAST REAL MINUTE, busiest first (errors = 4xx + 5xx)
engine.errorRate()          // ErrorRatePoint[]: one per real minute since the start, { minute, from, to, requests, clientErrors, serverErrors }; the last point is the current, partial minute; quiet minutes are zeros
statusClass(line.status)    // '1xx' | '2xx' | '3xx' | '4xx' | '5xx', for colouring a line of world.logs.access (import { statusClass } from './engine/engine')
```

Both selectors are cheap enough to call every frame (the rate is counted incrementally), but once a second is plenty: they change per real minute. The talkers' window and the rate's buckets are real minutes (60 real s = 30 game min). Show them as any log viewer would, on every level: a top-talkers list, a small 4xx/5xx strip, coloured lines. Don't look up who a talker is in `world.logs.access[].by`: that's the spoiler the tools exist to replace.

### 2.2 The judging engine (SYS-21, D-114): for the hint layer only

`world.assess` is the engine's live assessment of the player, refreshed once a real second and at the ending (verdicts on actions land the tick they happen). **Never show any of it during the run**: a grade, a status, a gap or its evidence tells the player what they haven't found yet. It exists for the hint/Kiro layer (KIRO-03, CON-03) and for the report, which is its final snapshot.

```ts
world.assess.lastRelevantActionAt   // game ms of the last RELEVANT action (D-115: a focused read that showed his lines, or an action that hurt him; ls/pwd/an unfocused cat are not)
world.assess.gap                    // { type, since }: the biggest gap standing, e.g. 'door-uninvestigated', 'foothold-unqueried', 'eradicated-without-evidence'; undefined when none
world.assess.gaps                   // every gap standing now, biggest first (the types are GAP_TYPES in engine/assess.ts)
world.assess.phases                 // per phase (detect, contain, eradicate, recover): { status, evidence: string[] } for Kiro's reasoning, not the screen
world.assess.grades / facts / mistakes / missed   // the report as it would read now
```

A hint built on it names the *kind* of gap in the defender's own words ("have you looked at who that address is?"), never the move, the door or the foothold it is about. The `suggestion` event (§4) carries the gap's type for the same purpose.

## 3. What the player can do: `engine.act(action)`

Every button, console and (later) shell command sends one of these. It returns `{ ok, message }`: show `message` to the player (e.g. in a console's status line or a toast).

| Console / place | Action | Example |
|---|---|---|
| WAF console | `DEF-07` login rate limit | `{ type: 'DEF-07' }` |
| | `DEF-12` add a rule | `{ type: 'DEF-12', rule: { kind: 'sqli' } }` · `{ kind: 'block-user-agent', pattern: 'sqlmap' }` · `{ kind: 'block-path', method: 'PUT', path: '/api/Products' }` · `{ kind: 'rate-limit', path: '/api/*' }` |
| Feature flags | `DEF-10` | `{ type: 'DEF-10', feature: 'search', enabled: false }` |
| Accounts | `DEF-08` lock · `DEF-14` delete · `DEF-16` force reset | `{ type: 'DEF-14', email: '…' }` |
| Sessions | `DEF-09` revoke all + rotate key | `{ type: 'DEF-09' }` |
| Deploy | `DEF-13` deploy a patch | `{ type: 'DEF-13', patch: 'search' }` (patches: `login`, `registration`, `search`, `basket-ownership`, `change-password`, `token-verify`, `product-update`) |
| Backups | `DEF-17` restore | `{ type: 'DEF-17', backupId: 3 }` |
| The big red button | `DEF-11` pull the plug · `DEF-18` bring back | `{ type: 'DEF-11' }` · `{ type: 'DEF-18', what: 'nginx' }` |
| Comms | `DEF-19` escalate · `DEF-20` notify | `{ type: 'DEF-20', to: 'customers' }` |
| Flag an address (a log line, a top-talkers row, the terminal) | `DEF-21` | `{ type: 'DEF-21', ip: '203.0.113.9', note?: 'scanner' }`: a suspicion, confirmed by the next hostile request from it; allowed during the freeze; a second flag of the same address is refused. Two or more flags on addresses that never turn out hostile cost the report's detect grade a letter ("chased false leads") |
| Terminal (via the shell) | `DEF-01`–`06`, `08`, `11`, `14`, `15`, `18`, `21` | The shell sends these for you (§5). On **Easy**, the consoles also get buttons for them |

**What a read showed (D-115, D-122).** A `DEF-01`, `DEF-02` or `DEF-03` may carry `shown: string[]`, the lines the shell or console printed (at most 200: pass the first 200 and set `shownTotal` to the real count; the engine cuts longer lists). The judging engine decides from those lines whether the read was relevant (it showed something of Death's, and was focused): an accidental `tail` that shows his lines counts, a `cat` of the whole log does not. A read with no `shown` is never relevant. Pass the lines exactly as printed (access-log lines in `combined` format, SQL rows as the shell renders them, file names as listed). **What the shell passes (D-160):** it sends `DEF-01`/`02`/`03` when the Command_Line finishes, with `shown` = the first 200 lines of the line's final screen output (stdout, not stderr; `[]` for a `>` redirect) and `shownTotal` = that output's line count. **The text is never stored:** the logged action keeps only `shownCount`, `shownHis` (lines of his), `shownAbout` and `shownTotal`.

## 4. Events: what to animate

`world.events` only grows. Keep the index of the last one you've drawn; on each update, react to the new ones.

| Event `kind` | Means | Suggested reaction (your call) |
|---|---|---|
| `move-started` | Death begins a move | He stirs, the room cools, a panel flickers |
| `move-landed` | A move succeeded | Death's hand lunges, impact frame, screen shake |
| `move-cut` | The player stopped a move (a fix held for 10 real s, or an IP block at once; a visit to a soul door is only paused, D-45) | He recoils; a hiss |
| `souls-stolen` | `count` souls just taken (`stolen`/`total` so far) | Souls meter drains, wisps fly out |
| `wave-started` / `wave-ended` | A minion wave arrives / leaves (`closedBy` if the player closed it) | Rats skitter in / scatter |
| `alert-opened` / `alert-closed` | An alert appears (`route`, `symptom`; D-232) / clears | Alert panel: the symptom, never `about` |
| `shift-begun` | `beginShift()` was called (D-230) | The calm begins |
| `incident-declared` | The freeze lifts (`by`: `alert`, `escalation` or `flag`) | Unlock the consoles |
| `flag-confirmed` | A flagged address (`ip`) made a hostile request after the flag (D-233); `about` is a spoiler | "flagged" → "confirmed" |
| `rule-evaded` | A WAF rule (`rule`) that held one of his moves is slipped by its quiet variant now (D-231); `move` is a spoiler | The WAF console's rule flickers; he grins |
| `tap-opened` / `tap-closed` | A leaky tap starts dripping / stops (`by: 'DEF-12'` if the player closed it, no `by` if it ran dry) | A small leak animation, then a seal |
| `door-shut` | One of Death's soul doors (`move`) is shut (`by` the fix that holds now); he stays away while it holds (D-44) | He recoils from it. Don't name the move on screen |
| `door-reopened` | That fix lapsed (a flag back on before its patch, a new session after a revoke): the door is his again (D-44) | He turns back toward it |
| `proxies` | After three IP blocks in a row Death plays from rotating proxies for the rest of the run: blocking addresses no longer cuts him (D-46) | He splits into many shadows |
| `ticket` | A customer complained (`ticket` is its id in `world.tickets`, `about`, `status`): something the player did failed them (D-65) | A new ticket in the comms console; a phone ringing |
| `customer-lost` | A customer gave up for good; the heartbeat's maximum is now `max` (D-65) | The top of the heartbeat meter dies a little |
| `suggestion` | The player is struggling (`reason`: `idle` 90 real s without a relevant action, `souls` down over 10 % in 2 real min, or `gap` the same biggest gap standing 3 real min); suggestion `n` is unlocked, `gap` is the type it should target (SYS-13, D-113, D-114; Medium and Hard only) | The terminal shows that one suggestion is available, on Hard too; the hint's words come from Kiro or CON-03 and never name the move, door or foothold |
| `breach-confirmed` | After souls were taken, an escalation or a relevant action on a harvest move or on Users (D-116; `by` is the action kind, never DEF-05): the notification clock starts (SYS-14) | The comms console's clock starts counting down from 72:00:00 |
| `notification-overdue` | The window passed with legal not notified (SYS-14) | The clock face reads 00:00:00; the report will say late or missing |
| `tip-off` | The player tipped Death off: a lock (DEF-08), or an active lookup (`ping`/`nmap`/`curl`) of an address he or his proxies have used (D-111; any other address does nothing, and the action's answer never says which) | He turns toward the player. Subtle |
| `patch-applied` | A deploy finished | Small "sealed" beat |
| `banished` | Every door is closed (soul doors by their real fix, taps included) and no foothold is left, or provisionally with a foothold left (D-44, D-45) | The calm before the ending |
| `return` | He came back through a missed foothold | The worst jump-scare of the game |
| `ending` | The run is over (`ending`, final `souls`, `heartbeat`) | Go to the ending scene |
| `action` | Something the player did (`ok`, `note`) | Usually nothing; the console already answered |
| `kiro` | A Kiro call happened | Nothing; the Kiro panel handles it |

## 5. Coming soon (build against these stubs)

These parts are being built on the brain side. Their shape is agreed now so the screens never wait.

**The shell** (SYS-09): built, in `game/src/shell/` (entry point `game/src/shell/index.ts`).
```ts
import { createShell, COMMAND_LIST, checkCommandLine } from '../shell';   // game/src/shell/index.ts

const shell = createShell(engine, { onInternalError: (e) => console.error(e) });   // opts optional

interface Shell {
  run(line: string): Promise<{ output: string; exitCode?: number; clear?: true }>;   // one command line, incl. pipes
  complete?(partial: string): string[];               // Easy only: absent (undefined) on Medium and Hard
}
```
- `run(line)` always resolves, never rejects. `exitCode` is always set by the shell: 0 success, 1 command failure, 2 usage or parse error, 127 command not found. `clear: true` is set only by the `clear` command, and its `output` is empty. The terminal empties the screen first when `clear` is `true`.
- `output` is **plain text**. The terminal window must render it as text (e.g. a React text node), never as HTML (D-106).
- `onInternalError` receives anything the shell's catch-alls swallowed. It never reaches `output`.
- `COMMAND_LIST` (the 32 commands, in steering order; `flag` since D-233) and `checkCommandLine(line): boolean` are exported for KIRO-08 and KDEV-01. Both are pure and need no Engine. `checkCommandLine` never throws; an empty line, a parse error or an unknown command name gives `false`.
- A read's `DEF-01`/`02`/`03` is sent when the Command_Line finishes, not at the moment of the read, with `shown` = the first 200 lines of the line's final screen output (stdout, not stderr; `[]` for a `>` redirect) and `shownTotal` = its line count (D-160).
- The shell reads logs, uploads and the database through the Engine, and sends DEF actions through `engine.act` itself, so the world updates by itself. It never calls `advance`, `pause` or `resume`; the screen owns the clock.

| Shell command | Sends |
|---|---|
| any command reading the two log files (`cat`, `head`, `tail`, `grep`, `awk`, `sort`, …) | `DEF-01` (first read per line) |
| `sqlite3` `SELECT`, `.tables`, `.schema` | `DEF-02` (first SQL text per line) |
| any command reading a file under uploads (`cat`, `ls`, `file`, `sha256sum`, `cp`, `grep`, …) | `DEF-03` (first path per line). `tar czf` sources are not counted as reads |
| `whois`, `ping`, `nmap`, `curl` on an IPv4 target | `DEF-04` (`mode`: `passive` or `active`) |
| `flag <ip> [note…]` | `DEF-21` (D-233; the 32nd command) |
| `tar czf /evidence/<name>.tgz …` (only this form; `cp` never sends it) | `DEF-05` |
| `iptables` add / delete | `DEF-06` |
| `sqlite3` locking / deleting an account | `DEF-08` / `DEF-14` |
| `rm` in uploads | `DEF-15` |
| `systemctl stop` / `start` / `restart` | `DEF-11` / `DEF-18` (`restart` sends both) |

**Kiro** (SYS-12, KIRO-01..10, D-190): **built**, in `game/src/kiro/` (entry point `client.ts`); the server is `game/server/` (`npm run server`, see `game/server/README.md`).
```ts
import { createKiro, type Kiro, type KiroReply, type KiroDraft } from '../kiro/client';   // game/src/kiro/client.ts

const kiro = createKiro(engine);   // one per run; { baseUrl, timeoutMs } optional

interface Kiro {
  ask(question: string): Promise<KiroReply>;        // chat (KIRO-01); 5–15 s on purpose, the game keeps running
  hint(): Promise<KiroReply | null>;                // the rules decide when (KIRO-03, SYS-13): null = no hint now
  explain(line: string): Promise<KiroReply>;        // "explain this log line" (KIRO-05)
  draft(goal: string): Promise<KiroDraft>;          // a script the player runs themselves (KIRO-02)
  debrief(report: Report): Promise<KiroReply>;      // the write-up around SYS-11's report, on the ending (KIRO-06)
  applyDraft(shell: Shell, draft: KiroDraft): Promise<{ ok: boolean; outputs: string[]; message?: string }>;   // KIRO-04, Easy only
  readonly online: boolean;                         // false once a call failed: label the panel "Kiro (offline)"
  readonly calls: number;                           // calls accepted this run (the cap is 60, KIRO-10)
}
interface KiroReply { text: string; offline: boolean }                   // offline: the rule-written CON-03 text
interface KiroDraft { title: string; why: string; lines: string[]; stripped: number; offline: boolean }
```
- Every call sends the server a **spoiler-free snapshot** of `engine.world` (`src/kiro/snapshot.ts`): no move ids, no `by`, no `createdBy`; a test proves it. The server runs the real Kiro on rails and the client checks the text again (`src/kiro/rails.ts`) before handing it over. Never show a `KiroReply` that did not come from this interface.
- Show "Kiro is reading the logs…" for the whole wait; never `await` it inside the frame loop. When `offline` is true, label the answer "Kiro (offline)". `ask`, `explain`, `draft` and `debrief` always resolve (never reject, never null): the fallback is built in.
- **`hint()`**: call it whenever the panel could show a hint (once a second is fine). On **Easy** it answers once per open alert (CON-03's `volunteered` policy); on **Medium/Hard** only while `world.struggle.suggestions` is above the hints already given (the `suggestion` event, §4). The text names the kind of gap, never the move. `null` means nothing to show.
- **`draft()`**: `lines` are command lines that parse in our shell (every unsupported line Kiro wrote is stripped; `stripped` counts them). Placeholders look like `<ip>`; the player fills them in. Show the lines as text the player copies or types; **never run them** except through `applyDraft` on Easy (the "Kiro, apply it" button, KIRO-04), which refuses on Medium/Hard, refuses a draft with a placeholder left in, and runs each line through `shell.run`.
- **`debrief(report)`**: call it once on the ending with `buildReport`'s result and put the text in `report.debrief` (the report's own `debrief` is the offline placeholder until then).
- Without the server (or with it down), every call answers in well under a second with `offline: true` and the CON-03 text; the panel must look right either way (KIRO-09).

**The report** (SYS-11, KIRO-06):
```ts
interface Report {
  facts: Array<{ label: string; value: string }>;          // time to notice, souls lost, downtime…
  grades: Record<'detect' | 'contain' | 'eradicate' | 'recover', 'A' | 'B' | 'C' | 'D' | 'F'>;
  mistakes: Array<{ title: string; why: string }>;          // each with its real-world reason
  missed: string[];                                          // footholds left behind
  debrief: { text: string; offline: boolean };               // Kiro's write-up
  markdown: string;                                          // the downloadable version
}
function buildReport(world: World): Promise<Report>;
```
**Built** (SYS-11, D-112, D-114): `import { buildReport } from './engine/report'`. It is the judging engine's final snapshot (§2.2), so call it on the ending; before that it is a spoiler, not a preview. `grades` are letters per phase; `mistakes` come in phase order (detect, contain, eradicate, recover), each with the real-world reason to show under its title; `missed` are the footholds left behind, in words; `debrief` is a fixed placeholder with `offline: true` until Kiro writes it (KIRO-06), so label it "Kiro (offline)"; `markdown` is the whole report for the download button. Times in `facts` are game time, as the player's clock showed them.

---

Questions or something missing → `docs/KNOWN_ISSUES.md`, and tell Uzain. If a screen needs a field that isn't here, ask instead of reaching into engine internals: those can change.

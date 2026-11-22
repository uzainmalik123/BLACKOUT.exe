# The engine, from the screens' side

> For whoever builds the screens (`docs/SCENES.md`). Written 2026-11-21 against `main`.
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

## 2. What to read (all on `engine.world`)

| What | Field | Notes |
|---|---|---|
| 💀 Souls | `souls.total`, `souls.stolen.length` | Stolen never goes back down |
| 🫀 Heartbeat | `heartbeat`, `heartbeatMax` | 0–`heartbeatMax`. 0 = flatline (an ending). The maximum starts at 100 and drops for good as customers give up (churn, D-65): draw the lost part of the meter as dead |
| Game clock | `clock.gameMs`, `clock.paused` | |
| Difficulty | `difficulty` | Decides which helpers the screens show (SCENES.md §0) |
| Alerts | `alerts` (`about`, `openedAt`, `closedAt?`) | Open = no `closedAt`. `about` is the move, minion or leaky tap (`TAP-01`…) it's about; **don't show that id to the player**, it's a spoiler. Show what the logs show |
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
| Comms | `comms`, `tickets` | Escalated / notified times. `tickets`: customers' support tickets (`t`, `ip`, `userAgent`, `about` what they were doing, `status` what they got: `503`, `429`, `403` or `'blocked'`, `text`), newest last; list them in the comms console (D-65) |
| Customers | `customers.served`, `.failed`, `.lost` | How many customer requests went through, how many the player's actions failed, how many shoppers gave up (for the report) |
| The ending | `ending` | `'banished'`, `'souls-lost'`, `'flatline'`, `'return'`; undefined while playing |
| Everything that happened | `events` | See §4. The source for animations and the report |

### 2.1 Detection data (SYS-20, D-110)

Three read-only selectors over the access log, per real minute, for the dashboard's three tools (UI-09). Every number is counted from the real lines; nothing is invented and nothing says who an address belongs to.

```ts
engine.topTalkers(n = 10)   // Talker[]: { ip, requests, errors }, the busiest addresses in the LAST REAL MINUTE, busiest first (errors = 4xx + 5xx)
engine.errorRate()          // ErrorRatePoint[]: one per real minute since the start, { minute, from, to, requests, clientErrors, serverErrors }; the last point is the current, partial minute; quiet minutes are zeros
statusClass(line.status)    // '1xx' | '2xx' | '3xx' | '4xx' | '5xx', for colouring a line of world.logs.access (import { statusClass } from './engine/engine')
```

Both selectors are cheap enough to call every frame (the rate is counted incrementally), but once a second is plenty: they change per real minute. The talkers' window and the rate's buckets are real minutes (60 real s = 30 game min). Show them as any log viewer would, on every level: a top-talkers list, a small 4xx/5xx strip, coloured lines. Don't look up who a talker is in `world.logs.access[].by`: that's the spoiler the tools exist to replace.

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
| Terminal (via the shell) | `DEF-01`–`06`, `08`, `11`, `14`, `15`, `18` | The shell sends these for you (§5). On **Easy**, the consoles also get buttons for them |

## 4. Events: what to animate

`world.events` only grows. Keep the index of the last one you've drawn; on each update, react to the new ones.

| Event `kind` | Means | Suggested reaction (your call) |
|---|---|---|
| `move-started` | Death begins a move | He stirs, the room cools, a panel flickers |
| `move-landed` | A move succeeded | Death's hand lunges, impact frame, screen shake |
| `move-cut` | The player stopped a move (a fix held for 10 real s, or an IP block at once; a visit to a soul door is only paused, D-45) | He recoils; a hiss |
| `souls-stolen` | `count` souls just taken (`stolen`/`total` so far) | Souls meter drains, wisps fly out |
| `wave-started` / `wave-ended` | A minion wave arrives / leaves (`closedBy` if the player closed it) | Rats skitter in / scatter |
| `alert-opened` / `alert-closed` | An alert appears / clears | Alert panel |
| `tap-opened` / `tap-closed` | A leaky tap starts dripping / stops (`by: 'DEF-12'` if the player closed it, no `by` if it ran dry) | A small leak animation, then a seal |
| `door-shut` | One of Death's soul doors (`move`) is shut (`by` the fix that holds now); he stays away while it holds (D-44) | He recoils from it. Don't name the move on screen |
| `door-reopened` | That fix lapsed (a flag back on before its patch, a new session after a revoke): the door is his again (D-44) | He turns back toward it |
| `proxies` | After three IP blocks in a row Death plays from rotating proxies for the rest of the run: blocking addresses no longer cuts him (D-46) | He splits into many shadows |
| `ticket` | A customer complained (`ticket` is its id in `world.tickets`, `about`, `status`): something the player did failed them (D-65) | A new ticket in the comms console; a phone ringing |
| `customer-lost` | A customer gave up for good; the heartbeat's maximum is now `max` (D-65) | The top of the heartbeat meter dies a little |
| `tip-off` | The player tipped Death off: a lock (DEF-08), or an active lookup (`ping`/`nmap`/`curl`) of an address he or his proxies have used (D-111; any other address does nothing, and the action's answer never says which) | He turns toward the player. Subtle |
| `patch-applied` | A deploy finished | Small "sealed" beat |
| `banished` | Every door is closed (soul doors by their real fix, taps included) and no foothold is left, or provisionally with a foothold left (D-44, D-45) | The calm before the ending |
| `return` | He came back through a missed foothold | The worst jump-scare of the game |
| `ending` | The run is over (`ending`, final `souls`, `heartbeat`) | Go to the ending scene |
| `action` | Something the player did (`ok`, `note`) | Usually nothing; the console already answered |
| `kiro` | A Kiro call happened | Nothing; the Kiro panel handles it |

## 5. Coming soon (build against these stubs)

These parts are being built on the brain side. Their shape is agreed now so the screens never wait.

**The shell** (SYS-09):
```ts
interface Shell {
  run(line: string): Promise<{ output: string }>;   // one command line, incl. pipes; output is plain text
  complete?(partial: string): string[];               // Easy only: autocomplete suggestions
}
```
The terminal window sends each typed line to `run` and prints `output`. Commands that change things (`iptables`, `rm`, `systemctl`, …) call `engine.act` inside the shell, so the world updates by itself. **Stub:** echo `command not found` for everything.

**Kiro** (SYS-12, KIRO-*):
```ts
interface Kiro {
  ask(question: string): Promise<{ text: string; offline: boolean }>;   // chat; takes 5–20 s on purpose
  hint(): Promise<{ text: string; offline: boolean } | null>;           // rules decide when (null = none now)
  explain(line: string): Promise<{ text: string; offline: boolean }>;   // "explain this log line"
}
```
Show a "Kiro is reading the logs…" state for the whole wait; the game keeps running. When `offline` is true, label the answer "Kiro (offline)". **Stub:** reply after 3 s with fixed text and `offline: true`.

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
**Built** (SYS-11, D-112): `import { buildReport } from './engine/report'`. It reads only `world.events`, so call it on the ending (or any time for a live preview). `grades` are letters per phase; `mistakes` come in phase order (detect, contain, eradicate, recover), each with the real-world reason to show under its title; `missed` are the footholds left behind, in words; `debrief` is a fixed placeholder with `offline: true` until Kiro writes it (KIRO-06), so label it "Kiro (offline)"; `markdown` is the whole report for the download button. Times in `facts` are game time, as the player's clock showed them.

---

Questions or something missing → `docs/KNOWN_ISSUES.md`, and tell Uzain. If a screen needs a field that isn't here, ask instead of reaching into engine internals: those can change.

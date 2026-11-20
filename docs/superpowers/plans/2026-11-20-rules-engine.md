# Rules engine (Track A, headless) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game's brain with no UI: a typed world state (SYS-04), the PRD tables as data with consistency and property tests (SYS-17), clock/souls/heartbeat (SYS-01/05/06), the event log (SYS-10), a replay engine that plays ATK-03.a and ATK-08.a into virtual logs/DB/files (SYS-03), banishment and the return (SYS-07), the seeded Director with stage order (SYS-02), and the §10 playthrough sims (SYS-16).

**Architecture:** `game/src/rules/` holds the PRD tables as plain data (moves, actions, minions) plus the vocabulary they share. `game/src/engine/` holds one JSON-serialisable `World` object and pure functions that mutate it in place (`applyAction`, `advance`), with a seeded PRNG inside the world so every run is deterministic. Gains and footholds are **derived** from the data they rest on (an admin account exists, a file exists, a session exists), so restoring a backup or deleting an account changes them for free. Recordings are injected as a `RecordingLibrary`, so the sims run on made-up recordings in test files while the game runs on the committed ones. sql.js is kept out of the core: a thin `Engine` class owns the world, the library and the sql.js DB that the shell's `sqlite3` reads.

**Tech Stack:** TypeScript 5.9 (strict), Vitest 4, fast-check 4.10.3 (new dev dependency), sql.js 1.16 (already present). No new runtime dependencies.

**Spec:** `docs/PRD.md` §3 (ATK), §4 (MIN), §5 (DEF), §7 (SYS-01…SYS-07, SYS-10, SYS-16, SYS-17), §10 (sims), §16 (status); `docs/DECISIONS.md` D-08, D-09, D-15, D-18, D-19; `docs/KNOWN_ISSUES.md` KI-03; `docs/TEAMMATE_TASKS.md` (the shell's `World` contract); `AGENTS.md`.

## Global Constraints

- Build only PRD rows: SYS-01, SYS-02, SYS-03, SYS-04, SYS-05, SYS-06, SYS-07, SYS-10, SYS-16, SYS-17. Numbers the PRD doesn't give are listed once in a new decision **D-24** (Task 1) and live in `game/src/engine/config.ts`; nothing is improvised elsewhere.
- Every PR updates PRD §16 for the rows it moves (D-16) and ends `npm run health` green in `game/`. CI runs on Node 22; local is Node 26.
- Fresh code only: nothing from `../reanimator` or `../poltergeist-old`.
- Re-check `origin/main` before committing docs (parallel sessions). Expected next free numbers today: **D-24**, **KI-15**.
- The engine never performs an attack: it replays committed recordings (D-07). Attacker IPs stay inside `203.0.113.0/24`.
- Engine files stay in `game/src/engine/` and `game/src/rules/` (D-21). The shell's `game/src/shell/world.ts` belongs to the teammate; Task 14 implements it, never edits it.
- 1 real second = 30 game seconds (SYS-01). All engine times are **game milliseconds** since the scenario start; config values the PRD gives in real seconds are converted once in `config.ts`.
- Kiro is not used in this work; the fast-check suites are written by Claude and KDEV-04 is **not** claimed (say so in each PR).

## Review Focus

1. **An action on something that doesn't exist** (block an IP twice, lock an unknown email, delete a file that isn't there, restore a backup id that doesn't exist): the engine must answer `ok: false` with a message and leave the world unchanged, never throw. Pinned in Task 6 (`rejects unknown targets without changing the world`) and by the fast-check suite in Task 7.
2. **Souls creeping back**: a restore from backup, a replay cut, or a second exfil of the same row must never reduce `souls.stolen` or count a row twice. Pinned in Task 4 (`counts a row stolen twice once`) and Task 6 (`DEF-17 restore never changes souls`).
3. **Heartbeat leaving 0–100** through a dip on an already-low meter, or recovery past 100. Pinned in Task 4 (`never goes below 0 or above 100`) and Task 7.
4. **A replay that outlives its stopper**: a WAF rule, feature flag, patch or plug pulled mid-move must cut the move on the same tick, not only an IP block. Pinned in Task 10 (`cuts the active move when any of its stoppers starts to hold`).
5. **The return never firing or firing forever**: with a foothold left and no playable move, the return must fire exactly once at the configured delay, and removing the last foothold during the quiet period must turn it into a real win. Pinned in Task 11 (`removing the foothold during the quiet period banishes him for good`).

---

## File structure

```
game/src/rules/
  vocabulary.ts        the ids and tokens every table shares (Stage, Gain, Foothold, Feature, Patch, Need, Stopper …)
  moves.ts             MOVES: PRD §3, one entry per ATK row
  actions.ts           ACTIONS: PRD §5, one entry per DEF row (phase, place, tip-off, dip, duration, what it removes)
  minions.ts           MINIONS: PRD §4, one entry per MIN row
  consistency.test.ts  SYS-17's table checks
game/src/engine/
  config.ts            EngineConfig per difficulty: every number from the PRD and D-24
  state.ts             World and its parts, initialWorld(seed, difficulty), Ending
  seed.ts              SEED_ACCOUNTS: the 25 Users rows of juiceshop.sqlite (id, email, role, lockedAt)
  rng.ts               mulberry32 over world.rng
  clock.ts             SYS-01
  log.ts               SYS-10: GameEvent, emit()
  souls.ts             SYS-05
  heartbeat.ts         SYS-06
  facts.ts             derived facts: gains(), footholds(), needHolds(), stopperHolds(), variantPlayable()
  actions.ts           applyAction(world, action): DEF effects
  library.ts           RecordingLibrary: recordings grouped by move, variant traits
  replay.ts            SYS-03: start/step/cut replays, combined-line rendering, log rendering
  sqldb.ts             sql.js side: open the baseline, apply db events, lock/delete accounts
  director.ts          SYS-07 (playable moves, banishment, the return) and SYS-02 (pick, pacing, tip-off)
  minions.ts           minion waves
  engine.ts            Engine: owns a World, a library and the sql.js DB; advance(realMs), act(action)
  sim.ts               runSim(): the headless driver the sims and property tests use
  test-fixtures/recordings.ts   a made-up library covering every ATK and MIN row (test-only, never in src/recordings/)
  *.test.ts, properties.test.ts, sims.test.ts
```

Dependencies: `rules/*` imports nothing from `engine/`. `engine/state.ts` imports only `rules/vocabulary.ts` and `engine/config.ts`. `engine/engine.ts` is the only file that imports sql.js and the committed recordings.

---

### Task 1: Vocabulary and the world state (SYS-04) — PR 1, on main first

**Files:**
- Create: `game/src/rules/vocabulary.ts`, `game/src/engine/config.ts`, `game/src/engine/state.ts`, `game/src/engine/seed.ts`, `game/src/engine/state.test.ts`, `game/src/engine/seed.test.ts`
- Modify: `docs/PRD.md` §16 (SYS-04 → building), `docs/DECISIONS.md` (D-24), `docs/KNOWN_ISSUES.md` (KI-15), `AGENTS.md` tree (`game/src/engine/`, `game/src/rules/`)

**Interfaces:**
- Produces, in `rules/vocabulary.ts`:
  ```ts
  export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
  export type Difficulty = 'easy' | 'medium' | 'hard';
  export type MoveId = 'ATK-01' | … | 'ATK-17';  export type ActionId = 'DEF-01' | … | 'DEF-20';  export type MinionId = 'MIN-01' | … | 'MIN-04';
  export type Gain = 'map' | 'secrets-leaked' | 'admin-session' | 'admin-password' | 'user-session' | 'own-admin' | 'souls' | 'defaced' | 'xss-live' | 'ransom';
  export type Foothold = 'hidden-admin' | 'hijacked-user' | 'planted-file' | 'forged-token';
  export type Feature = 'search' | 'registration' | 'password-reset' | 'uploads' | 'ftp' | 'feedback-captcha';
  export type Patch = 'login' | 'registration' | 'search' | 'basket-ownership' | 'change-password' | 'token-verify' | 'product-update';
  export type WafRule = { kind: 'sqli' } | { kind: 'block-user-agent'; pattern: string } | { kind: 'block-path'; method: string; path: string } | { kind: 'rate-limit'; path: string };
  export type Need =
    | { gain: Gain } | { anyOf: Need[] } | { anySession: true } | { anyFoothold: true } | { anyAdmin: true }
    | { stageGain: Stage } | { featureOn: Feature } | { loginNotRateLimited: true };
  export type Stopper =
    | { action: 'DEF-06' }                       // every variant's IP blocked
    | { action: 'DEF-07' }                       // login rate-limited
    | { action: 'DEF-08'; account: 'used' | 'target' }
    | { action: 'DEF-09' } | { action: 'DEF-10'; feature: Feature } | { action: 'DEF-12'; rule: WafRule }
    | { action: 'DEF-13'; patch: Patch } | { action: 'DEF-14'; account: 'used' } | { action: 'DEF-16'; account: 'admin' | 'target' }
    | { action: 'DEF-15' | 'DEF-17' | 'DEF-20'; undo: true };   // closes the move after it lands (recovery), never pre-empts it
  export const FEATURE_DEFAULTS: Record<Feature, boolean>;   // all true except 'feedback-captcha': false
  export const SOUL_TABLES = ['Users'] as const;             // D-24: a soul is one Users row
  ```
- Produces, in `engine/config.ts`: `export interface EngineConfig` and `export const CONFIG: Record<Difficulty, EngineConfig>` with these fields (values for `medium`; `easy`/`hard` differ only where the PRD says so, else copy medium):

  | Field | medium | Source |
  |---|---|---|
  | `gameMsPerRealMs` | 30 | SYS-01 |
  | `pausable` | false (easy: true) | SYS-01 |
  | `tickGameMs` | 3000 (= 100 real ms) | D-24 |
  | `directorPeriodGameMs` | 90 000 (3 real s) | SYS-02 |
  | `moveGapGameMs` | 1 200 000 (40 real s; easy 60 s, hard 25 s) | D-24 |
  | `cutRetryGameMs` | 300 000 (10 real s) | D-24 |
  | `pacing.delayAboveOpenAlerts` | 3 | SYS-02 |
  | `pacing.bringForwardAfterQuietGameMs` | 1 800 000 (60 real s) | SYS-02 |
  | `returnDelayGameMs` | 3 600 000 (2 real min) | SYS-07 |
  | `patchDurationGameMs` | 1 200 000 (20 game min) | DEF-13 |
  | `leakyWaf` | true (easy: false) | DEF-12 |
  | `heartbeat.drainPerGameMin` | `{ openDoor: 1, minion: 0.5, plug: 4, defaced: 3, recover: 1 }` | SYS-06 |
  | `heartbeat.featureWeight` | `{ search: 1, registration: 0.5, 'password-reset': 0.25, uploads: 0.25, ftp: 0.1, 'feedback-captcha': 0.1 }` | D-24 |
  | `heartbeat.dip` | `{ 'DEF-07': 2, 'DEF-09': 10, 'DEF-13': 3, 'DEF-14': 10, 'DEF-16': 1 }` | D-24 |
  | `minions.periodGameMs` | `{ 'MIN-01': 3 600 000, 'MIN-02': 5 400 000, 'MIN-03': 7 200 000, 'MIN-04': 9 000 000 }` (2/3/4/5 real min) | MIN table |
  | `minions.firstWaveGameMs` | `{ 'MIN-01': 900 000, 'MIN-02': 1 800 000, 'MIN-03': 2 700 000, 'MIN-04': 3 600 000 }` (30/60/90/120 real s) | D-24 |
  | `minions.waveDurationGameMs` | 1 800 000 (60 real s) | D-24 |
  | `minions.min02SuccessesPerWave` | 1 | D-24 |
  | `backupEveryGameMs` | 3 600 000 (one game hour) | DEF-17 |
  | `scenarioStartIso` | `'2026-10-31T22:00:00Z'` | D-24 |

- Produces, in `engine/state.ts`:
  ```ts
  export interface Account { id: number; email: string; role: 'admin' | 'customer' | 'deluxe' | 'accounting'; lockedAt?: number; createdBy: 'seed' | MoveId; hijackedBy?: MoveId; passwordResetAt?: number; }
  export interface Session { id: number; email: string; kind: 'admin' | 'user'; issuedBy: MoveId | MinionId; keyVersion: number; }
  export interface VFile { path: string; size: number; sha256: string; contentBase64?: string; plantedBy?: MoveId; }
  export interface Defacement { productId: number; kind: 'deface' | 'xss'; by: MoveId; }
  export interface DbChange { t: number; op: 'insert' | 'update' | 'delete'; table: string; key: Record<string, string | number>; before?: Row; after?: Row; }   // Row from recordings/format.ts
  export interface AccessLine { t: number; ip: string; method: string; target: string; protocol: string; status: number; bytes: number; referer: string; userAgent: string; by: MoveId | MinionId; }
  export interface AppLine { t: number; text: string; by: MoveId | MinionId; }
  export interface Replay { id: number; owner: 'death' | MinionId; move: MoveId | MinionId; variant: string; ip: string; startedAt: number; cursor: number; }
  export interface Wave { id: number; minion: MinionId; n: number; ips: string[]; startedAt: number; endsAt: number; successesDone: number; }
  export interface Alert { id: number; about: MoveId | MinionId; openedAt: number; closedAt?: number; }
  export interface Backup { id: number; takenAt: number; accounts: Account[]; files: VFile[]; defacements: Defacement[]; bannerDefacedBy?: MoveId; }
  export interface Evidence { name: string; takenAt: number; accessLines: number; appLines: number; }
  export type Ending = 'banished' | 'souls-lost' | 'flatline' | 'return';
  export interface World {
    seed: number; rng: number; difficulty: Difficulty;
    clock: { gameMs: number; paused: boolean; lastDirectorTick: number; lastBackupAt: number };
    souls: { total: number; stolen: Array<{ table: string; key: number }> };
    heartbeat: number;
    accounts: Account[]; sessions: Session[]; signingKey: { version: number; rotatedAt?: number };
    files: VFile[]; defacements: Defacement[]; bannerDefacedBy?: MoveId;
    features: Record<Feature, boolean>; firewall: { blocked: string[] }; waf: WafRule[]; nginx: 'running' | 'stopped';
    patches: { applied: Patch[]; pending: Array<{ patch: Patch; readyAt: number }> };
    backups: Backup[]; evidence: Evidence[];
    comms: { escalatedAt?: number; notifiedAt: { legal?: number; customers?: number }; breachConfirmedAt?: number };
    death: { knowledge: Array<'map' | 'secrets-leaked' | 'admin-password'>; forgedToken: boolean; played: Array<{ move: MoveId; variant: string; outcome: 'landed' | 'cut' }>;
             nextMoveAt: number; stageSkips: number; quietSince?: number; returnedThrough?: Foothold; nextId: number };
    replays: Replay[]; waves: Wave[]; nextWaveAt: Record<MinionId, number>; alerts: Alert[]; quietAlertsSince: number;
    logs: { access: AccessLine[]; app: AppLine[]; dbChanges: DbChange[] };
    events: GameEvent[];      // SYS-10, type from engine/log.ts (Task 3 adds it; until then `unknown[]`)
    ending?: Ending;
  }
  export function initialWorld(seed: number, difficulty: Difficulty): World;
  ```
  `initialWorld` copies `SEED_ACCOUNTS`, sets `souls.total = SEED_ACCOUNTS.length`, `heartbeat = 100`, `features = { ...FEATURE_DEFAULTS }`, `signingKey.version = 1`, `nginx = 'running'`, `death.nextMoveAt = 0`, `nextWaveAt` from `CONFIG[difficulty].minions.firstWaveGameMs`, one backup `id 0` at `takenAt 0`, `rng = seed >>> 0`, everything else empty.
- Produces, in `engine/seed.ts`: `export const SEED_ACCOUNTS: readonly Account[]` — the 25 rows of `juiceshop.sqlite` (`id`, `email`, `role`, `createdBy: 'seed'`; row 14 `chris.pike@juice-sh.op` has `lockedAt: 0` because its `deletedAt` is set in the baseline). Also `export const SEED_PRODUCT_COUNT = 56`.

- [ ] **Step 1: Write the failing tests**

`game/src/engine/state.test.ts`:
```ts
describe('initialWorld', () => {
  it('starts with 100 heartbeat, no souls stolen and one Users row per soul', () => {
    const w = initialWorld(1, 'medium');
    expect(w.heartbeat).toBe(100);
    expect(w.souls).toEqual({ total: 25, stolen: [] });
    expect(w.accounts).toHaveLength(25);
  });
  it('has the PRD defaults: every feature on except the feedback CAPTCHA, nginx running, nothing blocked', () => {
    const w = initialWorld(1, 'medium');
    expect(w.features).toEqual({ search: true, registration: true, 'password-reset': true, uploads: true, ftp: true, 'feedback-captcha': false });
    expect(w.nginx).toBe('running');
    expect(w.firewall.blocked).toEqual([]); expect(w.waf).toEqual([]); expect(w.sessions).toEqual([]);
  });
  it('is plain JSON: a structuredClone round-trip is deep-equal', () => {
    const w = initialWorld(7, 'hard');
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });
  it('is deterministic for a seed and differs between seeds only in rng', () => {
    expect(initialWorld(3, 'easy')).toEqual(initialWorld(3, 'easy'));
    expect({ ...initialWorld(3, 'easy'), rng: 0 }).toEqual({ ...initialWorld(4, 'easy'), rng: 0 });
  });
});
```
`game/src/engine/seed.test.ts` (sql.js, like `recordings.test.ts`):
```ts
it('SEED_ACCOUNTS matches id, email, role and deletedAt of every Users row in juiceshop.sqlite', async () => { /* SELECT id,email,role,deletedAt FROM Users ORDER BY id; compare to SEED_ACCOUNTS mapped to {id,email,role,locked: lockedAt !== undefined} */ });
it('SEED_PRODUCT_COUNT matches the Products table', …);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd game && npx vitest run src/engine` — Expected: FAIL, modules not found.

- [ ] **Step 3: Write `rules/vocabulary.ts`, `engine/config.ts`, `engine/seed.ts`, `engine/state.ts` as specified above**

`SEED_ACCOUNTS` is written by hand from the query in Step 1 (25 rows; ids 1–25; roles as in the DB: admins 1, 4, 6, 9, 10, 12, 22, 23; deluxe 5, 13, 20, 21; accounting 15; the rest customer).

- [ ] **Step 4: Run the tests and `npm run health`** — Expected: PASS, lint and typecheck clean.

- [ ] **Step 5: Docs.** PRD §16: add `SYS-04 | building | Types and initialWorld in game/src/engine/state.ts; the shell and dashboard build against them`. DECISIONS: add D-24 to the table and a section **"D-24: Engine constants and interpretations the PRD leaves open"** (context: Track A needs numbers the rows mark "small"/"tiny"/"≈" or don't give; decision: the table of values in `config.ts` above, plus: a soul is one `Users` row and the total is the seed's row count; recorded event offsets are real milliseconds and are stretched ×30 into game time when replayed; a variant is *quiet* when its recording label starts with `quiet`; leaky WAF applies to pattern rules (`sqli`, `block-user-agent`) on Medium/Hard, never to `block-path` or `rate-limit`; one alert opens per Death move and per minion wave and closes when it lands, is cut or ends; the return grants `hidden-admin → own-admin`, `hijacked-user → user-session`, `forged-token → admin-session`, `planted-file → map`, and the return is itself an ending (UI-06); backups are hourly game-time snapshots of accounts, files, defacements and the banner; consequences: all values are `(tune)` and change through this entry). KNOWN_ISSUES: `KI-15 | SYS-05 counts only Users rows as souls (D-24); ATK-10's "orders, addresses" souls have no table mapping until it is recorded | Minor | Open`. AGENTS.md tree: add the two engine folders.

- [ ] **Step 6: Commit and open PR 1**

```bash
git add game/src/rules/vocabulary.ts game/src/engine docs AGENTS.md
git commit -m "Add the world state types and initial world (SYS-04), engine constants (D-24)"
```
PR title: `World state types for the engine (SYS-04 building, D-24)`. Body: PRD §16 line, D-24, KI-15, "no Kiro session". Merge as soon as CI is green so the teammate can build against the types; later tasks branch from the merged main.

---

### Task 2: The PRD tables as data and their consistency tests (SYS-17 part 1) — PR 2

**Files:**
- Create: `game/src/rules/moves.ts`, `game/src/rules/actions.ts`, `game/src/rules/minions.ts`, `game/src/rules/consistency.test.ts`
- Modify: `docs/PRD.md` §16 (SYS-17 → building)

**Interfaces:**
- Produces:
  ```ts
  // moves.ts
  export interface Move { id: MoveId; stage: Stage; name: string; needs: Need[]; gains: Gain[]; foothold?: Foothold; stoppedBy: Stopper[]; pri: 'M' | 'S'; attack: string; }  // attack = ATT&CK ids, informational
  export const MOVES: readonly Move[];  export const MOVE_BY_ID: Record<MoveId, Move>;
  // actions.ts
  export interface ActionRow { id: ActionId; phase: 'investigate' | 'preserve' | 'contain' | 'eradicate' | 'recover' | 'communicate'; name: string; where: 'terminal' | 'console' | 'both'; tipsOff: boolean; dip: number; durationGameMs: number; removes: Foothold[]; pri: 'M' | 'S'; }
  export const ACTIONS: readonly ActionRow[];  export const ACTION_BY_ID: Record<ActionId, ActionRow>;
  // minions.ts
  export interface MinionRow { id: MinionId; name: string; look: string; closedBy: Stopper[]; damage: { heartbeat: boolean; soulsPerSuccess: number; givesDeath?: 'user-session' }; pri: 'M' | 'S'; }
  export const MINIONS: readonly MinionRow[];  export const MINION_BY_ID: Record<MinionId, MinionRow>;
  ```
- Rows, copied from the PRD (every entry; the ones with a judgement call spelled out):
  - ATK-01 needs `[]`, gains `['map']`, stoppedBy `[{DEF-06}, {DEF-12, rule:{kind:'block-user-agent', pattern:'Fuzz Faster U Fool'}}]`.
  - ATK-02 needs `[{gain:'map'}, {featureOn:'ftp'}]`, gains `['secrets-leaked']`, stoppedBy `[{DEF-10, feature:'ftp'}]`.
  - ATK-03 needs `[{gain:'map'}]`, gains `['admin-session']`, stoppedBy `[{DEF-12, rule:{kind:'sqli'}}, {DEF-13, patch:'login'}]`.
  - ATK-04 needs `[{gain:'map'}, {loginNotRateLimited:true}]`, gains `['admin-session','admin-password']`, stoppedBy `[{DEF-07}, {DEF-16, account:'admin'}]`.
  - ATK-05 needs `[{gain:'map'}, {featureOn:'password-reset'}]`, gains `['user-session']`, stoppedBy `[{DEF-10, feature:'password-reset'}, {DEF-08, account:'target'}]`.
  - ATK-06 needs `[{anyOf:[{anyFoothold:true},{gain:'map'}]}]`, gains `['own-admin']`, stoppedBy `[{DEF-10, feature:'registration'}, {DEF-13, patch:'registration'}, {DEF-14, account:'used'}]`.
  - ATK-07 needs `[{gain:'admin-session'}]`, gains `[]`, stoppedBy `[{DEF-09}]`.
  - ATK-08 needs `[{gain:'map'}]`, gains `['souls']`, stoppedBy `[{DEF-10, feature:'search'}, {DEF-12, rule:{kind:'sqli'}}, {DEF-13, patch:'search'}]`.
  - ATK-09 needs `[{anyOf:[{gain:'admin-session'},{gain:'own-admin'}]}]`, gains `['souls']`, stoppedBy `[{DEF-08, account:'used'}, {DEF-14, account:'used'}, {DEF-09}]`.
  - ATK-10 needs `[{anyOf:[{gain:'user-session'},{anySession:true}]}]`, gains `['souls']`, stoppedBy `[{DEF-13, patch:'basket-ownership'}, {DEF-08, account:'used'}]`.
  - ATK-11 needs `[{anyOf:[{gain:'admin-session'},{gain:'own-admin'}]}]`, gains `[]`, foothold `'hidden-admin'`, stoppedBy `[{DEF-14, account:'used'}]`.
  - ATK-12 needs `[{gain:'user-session'}]` (D-18), gains `[]`, foothold `'hijacked-user'`, stoppedBy `[{DEF-16, account:'target'}, {DEF-13, patch:'change-password'}]`.
  - ATK-13 needs `[{anySession:true}]`, gains `[]`, foothold `'planted-file'`, stoppedBy `[{DEF-15, undo:true}, {DEF-10, feature:'uploads'}]`.
  - ATK-14 needs `[{gain:'map'}, {anyOf:[{gain:'secrets-leaked'},{stageGain:3}]}]`, gains `[]`, foothold `'forged-token'`, stoppedBy `[{DEF-13, patch:'token-verify'}]`.
  - ATK-15 needs `[{gain:'map'}]` (D-18), gains `['defaced']`, stoppedBy `[{DEF-17, undo:true}, {DEF-12, rule:{kind:'block-path', method:'PUT', path:'/api/Products'}}, {DEF-13, patch:'product-update'}]`.
  - ATK-16 needs `[{gain:'map'}]` (D-18), gains `['xss-live']`, stoppedBy `[{DEF-17, undo:true}, {DEF-12, rule:{kind:'block-path', method:'PUT', path:'/api/Products'}} (D-19), {DEF-13, patch:'product-update'}]`.
  - ATK-17 needs `[{anyAdmin:true}]`, gains `['ransom']`, stoppedBy `[{DEF-17, undo:true}, {DEF-15, undo:true}, {DEF-20, undo:true}]`.
  - ACTIONS: `tipsOff` true for DEF-04 and DEF-08; `dip` from `CONFIG.medium.heartbeat.dip` (0 elsewhere); `durationGameMs` = `patchDurationGameMs` for DEF-13, 0 elsewhere; `removes`: DEF-13 `['forged-token']`, DEF-14 `['hidden-admin']`, DEF-15 `['planted-file']`, DEF-16 `['hijacked-user']`, DEF-17 `['hidden-admin','planted-file']`; `where`: terminal for DEF-01…06, 11, 14, 15, 18; console for 07, 09, 10, 12, 13, 16, 17, 19, 20; both for DEF-08.
  - MINIONS: MIN-01 closedBy `[{DEF-12, rule:{kind:'block-user-agent', pattern:'scanner'}}, {DEF-06}]`, heartbeat drain, 0 souls; MIN-02 closedBy `[{DEF-07}]`, souls 1 per success, `givesDeath:'user-session'`; MIN-03 closedBy `[{DEF-12, rule:{kind:'rate-limit', path:'/api/*'}}]`; MIN-04 closedBy `[{DEF-10, feature:'feedback-captcha'}]`.

- [ ] **Step 1: Write `consistency.test.ts`** (fails: modules missing)

```ts
it('has the PRD counts: 17 moves (10 must, 7 should), 20 actions (18 must, 2 should), 4 minions', …);
it('every ATK has at least one stopper and every stopper names a DEF that exists', …);
it('every Need is produced by some move or by the start state', …);   // gains: some MOVES[].gains includes it; featureOn: FEATURE_DEFAULTS[f] === true; loginNotRateLimited / anySession / anyFoothold / anyAdmin / stageGain: a move with that gain/foothold/stage exists
it('every foothold has a DEF that removes it', …);                      // for each Foothold, some ACTIONS[].removes includes it
it('every MIN has its closing DEF', …);
it('keeps D-18 and D-19: ATK-15/16 need only map and are stopped by the PUT /api/Products rule; ATK-12 needs user-session; MIN-02 hands Death a user-session', …);
it('stage 1 moves need nothing Death must first gain', …);              // ATK-01 needs []
it('ids are unique and MOVE_BY_ID/ACTION_BY_ID/MINION_BY_ID cover every row', …);
```

- [ ] **Step 2: Run** `npx vitest run src/rules` — Expected: FAIL.
- [ ] **Step 3: Write the three data files exactly as listed.**
- [ ] **Step 4: Run the tests and health** — Expected: PASS.
- [ ] **Step 5: Docs:** PRD §16 `SYS-17 | building | Tables in game/src/rules/, consistency tests; the stage-order and fast-check tests follow with SYS-02`.
- [ ] **Step 6: Commit, PR 2** `git commit -m "Add the PRD tables as data with consistency tests (SYS-17)"`.

---

### Task 3: Clock, PRNG and the event log (SYS-01, SYS-10) — PR 3 starts

**Files:**
- Create: `game/src/engine/rng.ts`, `game/src/engine/clock.ts`, `game/src/engine/log.ts`, `game/src/engine/clock.test.ts`, `game/src/engine/log.test.ts`
- Modify: `game/src/engine/state.ts` (`events: GameEvent[]`)

**Interfaces:**
- Produces:
  ```ts
  // rng.ts
  export function nextRandom(world: World): number;            // mulberry32 step on world.rng, returns [0, 1)
  export function pick<T>(world: World, items: readonly T[]): T;
  // clock.ts
  export function realToGameMs(world: World, realMs: number): number;   // realMs * CONFIG[d].gameMsPerRealMs
  export function pause(world: World): boolean;                 // true only when CONFIG[d].pausable; sets clock.paused
  export function resume(world: World): void;
  export function gameTimeIso(world: World, gameMs?: number): string;   // scenarioStartIso + gameMs
  export function gameClockLabel(world: World): string;        // "HH:MM" of game time, for UI
  // log.ts
  export type GameEvent = { t: number; id: number } & (
    | { kind: 'move-started'; move: MoveId; variant: string; stage: Stage; ip: string }
    | { kind: 'move-landed'; move: MoveId; variant: string }
    | { kind: 'move-cut'; move: MoveId; variant: string; by: ActionId }
    | { kind: 'wave-started'; minion: MinionId; wave: number; ips: string[] }
    | { kind: 'wave-ended'; minion: MinionId; wave: number; closedBy?: ActionId }
    | { kind: 'action'; action: PlayerAction; ok: boolean; note?: string }     // PlayerAction from engine/actions.ts (Task 6); declare the type in log.ts to avoid a cycle
    | { kind: 'kiro'; call: 'chat' | 'draft' | 'hint' | 'explain' | 'debrief'; credits?: number }
    | { kind: 'souls-stolen'; by: MoveId | MinionId; count: number; stolen: number; total: number }
    | { kind: 'tip-off'; by: ActionId }
    | { kind: 'alert-opened' | 'alert-closed'; alert: number; about: MoveId | MinionId }
    | { kind: 'patch-applied'; patch: Patch }
    | { kind: 'banished' } | { kind: 'return'; through: Foothold }
    | { kind: 'ending'; ending: Ending; souls: number; heartbeat: number });
  export function emit(world: World, e: Omit<GameEvent, 't' | 'id'>): GameEvent;   // stamps clock.gameMs and a running id
  export function eventsOfKind<K extends GameEvent['kind']>(world: World, kind: K): Extract<GameEvent, { kind: K }>[];
  ```

- [ ] **Step 1: Tests**

```ts
// clock.test.ts
it('converts 1 real second to 30 game seconds on every difficulty', …);
it('pause works on Easy and is a no-op on Medium and Hard', () => { expect(pause(initialWorld(1,'easy'))).toBe(true); expect(pause(initialWorld(1,'medium'))).toBe(false); expect(initialWorld(1,'medium').clock.paused).toBe(false); });
it('stamps game time from the scenario start: 90 000 game ms is 22:01:30 on 31 Oct 2026', …);
it('rng is deterministic for a seed and uniform-ish in [0,1)', …);   // same seed → same 100 numbers; all in range
// log.test.ts
it('emit stamps the current game time and increasing ids', …);
it('eventsOfKind filters by kind with the narrowed type', …);
```

- [ ] **Step 2: Run, expect FAIL.**  - [ ] **Step 3: Implement.**  - [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "Add the game clock, seeded PRNG and event log (SYS-01, SYS-10)"`.

---

### Task 4: Souls and heartbeat (SYS-05, SYS-06) — PR 3

**Files:**
- Create: `game/src/engine/souls.ts`, `game/src/engine/heartbeat.ts`, `game/src/engine/souls.test.ts`, `game/src/engine/heartbeat.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // souls.ts
  export function steal(world: World, by: MoveId | MinionId, table: string, keys: number[]): number;   // adds unseen (table,key) pairs for tables in SOUL_TABLES; emits 'souls-stolen' when count > 0; returns count
  export function soulsStolen(world: World): number;   export function soulsLeft(world: World): number;
  export function stealOneUnstolenCustomer(world: World, by: MinionId): Account | undefined;   // MIN-02: a random seed account not yet stolen, via pick()
  // heartbeat.ts
  export function drainPerGameMinute(world: World): number;   // SYS-06 sum: openDoor × (death replays active), minion × (waves active), featureWeight per feature not at its default, plug while nginx stopped, defaced while defacements or banner defaced
  export function integrateHeartbeat(world: World, dtGameMs: number): void;   // drain if > 0 else recover; clamp 0..100
  export function dip(world: World, amount: number): void;                   // one-off, clamp at 0
  ```

- [ ] **Step 1: Tests**

```ts
// souls.test.ts
it('the number shown equals the stolen rows replayed so far', () => { steal(w,'ATK-08','Users',[1,2,3]); expect(soulsStolen(w)).toBe(3); expect(soulsLeft(w)).toBe(22); });
it('counts a row stolen twice once and ignores tables that are not souls', …);   // keys [1,1] then [1] → 1; table 'Baskets' → 0
it('emits one souls-stolen event per steal with count, stolen and total', …);
it('MIN-02 steals one customer not stolen before and returns undefined when none is left', …);
// heartbeat.test.ts — the SYS-06 Done-when first
it('with only the plug pulled, flatlines at game minute 25', () => { w.nginx='stopped'; for (let m=0; m<24; m++) integrateHeartbeat(w, 60_000); expect(w.heartbeat).toBe(4); integrateHeartbeat(w, 60_000); expect(w.heartbeat).toBe(0); });
it('drains 1 per open door, 0.5 per minion, the feature weight per disabled feature, 3 while defaced', …);
it('recovers +1 per game minute while nothing drains and never above 100', …);
it('never goes below 0 or above 100 through a dip', …);
it('integrates fractionally: 30 s at −4/min is −2', …);
```

- [ ] **Step 2–4: fail, implement, pass.**
- [ ] **Step 5: Commit** `git commit -m "Add souls and heartbeat (SYS-05, SYS-06)"`.

---

### Task 5: Derived facts: gains, footholds, needs, stoppers — PR 3

**Files:**
- Create: `game/src/engine/facts.ts`, `game/src/engine/facts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function gains(world: World): Set<Gain>;
  // map / secrets-leaked / admin-password ⇐ death.knowledge; admin-session ⇐ a session with kind 'admin' whose keyVersion === signingKey.version;
  // user-session ⇐ a 'user' session with the current keyVersion or an account with hijackedBy; own-admin ⇐ an account createdBy 'ATK-06' not locked;
  // souls ⇐ souls.stolen.length > 0; defaced ⇐ a 'deface' defacement or bannerDefacedBy; xss-live ⇐ an 'xss' defacement; ransom ⇐ a file named READ_ME_MORTAL.txt plantedBy 'ATK-17'
  export function footholds(world: World): Set<Foothold>;
  // hidden-admin ⇐ an account createdBy 'ATK-11'; hijacked-user ⇐ an account with hijackedBy and no passwordResetAt after it; planted-file ⇐ a file plantedBy 'ATK-13'; forged-token ⇐ death.forgedToken && !patches.applied.includes('token-verify')
  export function needHolds(world: World, need: Need): boolean;
  export function needsHold(world: World, move: Move): boolean;
  export function usedAccountEmails(world: World): string[];          // emails of Death's sessions plus his own accounts (ATK-06, ATK-11)
  export function stopperHolds(world: World, stopper: Stopper, variant?: VariantInfo): boolean;   // VariantInfo from library.ts (Task 9): { ip, quiet, targets }
  // DEF-06: variant ? its ip is blocked : true only if the move has no variant (handled by caller); DEF-07: a waf rate-limit on '/rest/user/login'; DEF-08 used: every used account locked; DEF-08 target: variant.targets every locked;
  // DEF-09: signingKey.version > 1 and no session with the current version; DEF-10: features[f] !== FEATURE_DEFAULTS[f]; DEF-12: a waf rule deep-equal (block-user-agent: pattern included case-insensitively) and NOT (leakyWaf && variant?.quiet && rule.kind in {sqli, block-user-agent});
  // DEF-13: patch applied; DEF-14 used: no used account exists; DEF-16 admin: an admin seed account with passwordResetAt; DEF-16 target: every variant.targets reset; undo stoppers: false
  export function anyStopperHolds(world: World, move: Move, variant?: VariantInfo): boolean;
  ```
  Put `VariantInfo` in `facts.ts` for now (`{ ip: string; quiet: boolean; targets: string[] }`); Task 9 re-exports it.

- [ ] **Step 1: Tests** (each builds a world by hand)

```ts
it('derives own-admin from an ATK-06 account and loses it when the account is locked or gone', …);
it('derives hidden-admin, planted-file and forged-token from accounts, files and the token flag; the token-verify patch removes forged-token', …);
it('admin-session needs a session signed with the current key: rotating the key drops it', …);
it('needHolds: anyOf, anySession, anyFoothold, anyAdmin, stageGain 3 (own-admin), featureOn, loginNotRateLimited', …);
it('stopperHolds: a sqli WAF rule stops a loud variant but not a quiet one on Medium (leaky), and stops both on Easy', …);
it('stopperHolds: block-path is never leaky', …);
it('undo stoppers (DEF-15/17/20) never pre-empt a move', …);
```

- [ ] **Step 2–4: fail, implement, pass.**  - [ ] **Step 5: Commit** `git commit -m "Derive Death's gains and footholds from the world state"`.

---

### Task 6: Player actions (every DEF row's effect) — PR 3

**Files:**
- Create: `game/src/engine/actions.ts`, `game/src/engine/actions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PlayerAction =
    | { type: 'DEF-01'; query: string } | { type: 'DEF-02'; sql: string } | { type: 'DEF-03'; path: string }
    | { type: 'DEF-04'; ip: string; mode: 'passive' | 'active' }
    | { type: 'DEF-05'; name: string }
    | { type: 'DEF-06'; ip: string; op: 'add' | 'delete' }
    | { type: 'DEF-07' }
    | { type: 'DEF-08'; email: string }
    | { type: 'DEF-09' }
    | { type: 'DEF-10'; feature: Feature; enabled: boolean }
    | { type: 'DEF-11' }
    | { type: 'DEF-12'; rule: WafRule }
    | { type: 'DEF-13'; patch: Patch }
    | { type: 'DEF-14'; email: string }
    | { type: 'DEF-15'; path: string }
    | { type: 'DEF-16'; email: string }
    | { type: 'DEF-17'; backupId: number }
    | { type: 'DEF-18'; what: 'nginx' | Feature }
    | { type: 'DEF-19' }
    | { type: 'DEF-20'; to: 'legal' | 'customers' };
  export interface ActionResult { ok: boolean; message: string }
  export function applyAction(world: World, action: PlayerAction): ActionResult;   // always emits an 'action' event with ok; refuses everything with ok:false when world.ending is set
  export function applyPendingPatches(world: World): Patch[];   // called by advance(): moves patches whose readyAt ≤ now into applied, emits 'patch-applied', dips CONFIG.heartbeat.dip['DEF-13']
  export function takeBackupIfDue(world: World): void;         // every backupEveryGameMs: push a Backup (deep copies)
  ```
  Effects (exact):
  - DEF-01/02/03: log only (`ok: true`).
  - DEF-04 passive: log only. Active: `ok:true`, emit `tip-off`, `death.stageSkips += 1`, `death.nextMoveAt = now`.
  - DEF-05: push `{name, takenAt, accessLines, appLines}`; if `soulsStolen > 0` and `comms.breachConfirmedAt` unset, set it. Duplicate name → `ok:false`.
  - DEF-06 add: already blocked → `ok:false`; invalid IPv4 → `ok:false`; else push. delete: not present → `ok:false`.
  - DEF-07: push `{kind:'rate-limit', path:'/rest/user/login'}` if absent (else `ok:false`), `dip(dip['DEF-07'])`.
  - DEF-08: unknown email or already locked → `ok:false`; else `lockedAt = now`, emit `tip-off`, stageSkips/nextMoveAt as DEF-04 active.
  - DEF-09: `signingKey = {version+1, rotatedAt: now}`, `sessions = []`, `dip(dip['DEF-09'])`.
  - DEF-10: `features[f] === enabled` already → `ok:false`; else set.
  - DEF-11: already stopped → `ok:false`; else `nginx = 'stopped'`.
  - DEF-12: deep-equal rule present → `ok:false`; else push.
  - DEF-13: applied or pending → `ok:false`; else push pending with `readyAt = now + patchDurationGameMs`.
  - DEF-14: unknown → `ok:false`; else remove the account and its sessions; if `createdBy === 'seed'` → `dip(dip['DEF-14'])` and message says a real account was deleted.
  - DEF-15: no such file → `ok:false`; else remove it.
  - DEF-16: unknown → `ok:false`; else `passwordResetAt = now`; if the account is `admin@juice-sh.op` drop `'admin-password'` from knowledge; `dip(dip['DEF-16'])`.
  - DEF-17: unknown id → `ok:false`; else replace `accounts`, `files`, `defacements`, `bannerDefacedBy` with deep copies of the backup; drop sessions whose email no longer exists. Souls untouched.
  - DEF-18 nginx: not stopped → `ok:false`; else running. DEF-18 feature: at default → `ok:false`; else reset to default.
  - DEF-19: `escalatedAt = now` (second time `ok:false`); confirms breach like DEF-05. DEF-20: `notifiedAt[to] = now` (second time `ok:false`).

- [ ] **Step 1: Tests** (one `it` per DEF row plus):

```ts
it('rejects unknown targets without changing the world', () => { for (const a of [{type:'DEF-06',ip:'nope',op:'add'},{type:'DEF-08',email:'x@y'},{type:'DEF-14',email:'x@y'},{type:'DEF-15',path:'/nope'},{type:'DEF-16',email:'x@y'},{type:'DEF-17',backupId:99}] as PlayerAction[]) { const before = structuredClone(w); const r = applyAction(w, a); expect(r.ok).toBe(false); expect({...w, events: []}).toEqual({...before, events: []}); } });
it('DEF-17 restore never changes souls and brings back an ATK-11 admin from a later backup', …);
it('DEF-09 drops admin-session (ATK-07 stopped) but leaves forged-token', …);
it('DEF-14 on a seed account costs heartbeat; on Death\'s ATK-06 account removes own-admin', …);
it('DEF-13 is pending for 20 game minutes, then applied with a 3-point dip', …);
it('refuses every action after an ending', …);
it('DEF-04 active and DEF-08 tip Death off: next move now and one stage skip', …);
```

- [ ] **Step 2–4: fail, implement, pass.**  - [ ] **Step 5: Commit** `git commit -m "Add the player actions: every DEF row's effect on the world"`.

---

### Task 7: The fast-check property suite (SYS-17 part 2) — PR 3 ends

**Files:**
- Create: `game/src/engine/advance.ts`, `game/src/engine/properties.test.ts`
- Modify: `game/package.json` (`fast-check` `4.10.3` in devDependencies), `docs/PRD.md` §16 (SYS-01, SYS-05, SYS-06 → done; SYS-10 → done; SYS-17 note)

**Interfaces:**
- Produces, in `advance.ts`: `export function advance(world: World, library: RecordingLibrary, realMs: number): void` — the one time-step function. Loops in `tickGameMs` sub-steps while not paused and no ending; each sub-step, **in this order**: `applyPendingPatches`, `takeBackupIfDue`, `stepReplays` (Task 10), `stepWaves` (Task 12), `integrateHeartbeat`, `directorTick` when `directorPeriodGameMs` has elapsed since `lastDirectorTick` (Task 12), then `checkEndings`. `checkEndings(world)`: `souls-lost` when `soulsLeft === 0`, `flatline` when `heartbeat === 0`; emits `ending` with souls and heartbeat and sets `world.ending`. In this task `stepReplays`, `stepWaves`, `directorTick` are imported from stub modules that export no-op functions with the final signatures (`replay.ts`, `minions.ts`, `director.ts` created here with `TODO SYS-03` / `SYS-02` bodies); Tasks 10–12 fill them.
- Produces, in `properties.test.ts`, the arbitraries other tests reuse: `export const arbAction: fc.Arbitrary<PlayerAction>` (every DEF type; ips from a small pool incl. `203.0.113.23` and `203.0.113.81`; emails from `SEED_ACCOUNTS` plus `death@juice-sh.op`, `support-ops@juice-sh.op`, an unknown one; paths from a small pool; backup ids 0–5).

- [ ] **Step 1: Tests**

```ts
fc.assert(fc.property(fc.integer(), fc.array(fc.tuple(arbAction, fc.integer({min:0, max:5000})), {maxLength: 60}), (seed, steps) => {
  const w = initialWorld(seed, 'medium'); let stolen = 0;
  for (const [a, realMs] of steps) { applyAction(w, a); advance(w, EMPTY_LIBRARY, realMs);   // never throws
    expect(soulsStolen(w)).toBeGreaterThanOrEqual(stolen); stolen = soulsStolen(w);          // never back up
    expect(w.heartbeat).toBeGreaterThanOrEqual(0); expect(w.heartbeat).toBeLessThanOrEqual(100); }
}), { numRuns: 300 });
it('the world stays JSON-serialisable after any action sequence', …);
it('two runs with the same seed and script produce identical event logs', …);
```
(The same property runs again with the fixture library in Task 13, where Death actually plays.)

- [ ] **Step 2: `npm i -D fast-check@4.10.3`; run, expect FAIL** (advance missing).
- [ ] **Step 3: Implement `advance.ts` and the three stubs.**
- [ ] **Step 4: Run all tests and health — PASS.**
- [ ] **Step 5: Docs:** PRD §16: `SYS-01 | done | clock.ts; pause only on Easy`, `SYS-05 | done | souls.ts; one Users row per soul (D-24, KI-15)`, `SYS-06 | done | heartbeat.ts; plug-only run flatlines at game minute 25`, `SYS-10 | done | log.ts; sims and the report read only world.events`, update SYS-17's note (`fast-check suite in engine/properties.test.ts; stage-order test with SYS-02`).
- [ ] **Step 6: Commit and open PR 3** `git commit -m "Add the fast-check property suite and the time step (SYS-17, SYS-01/05/06/10 done)"`. PR body lists the four rows moved and says KDEV-04 is not claimed.

---

### Task 8: The recording library and the test fixtures — PR 4 starts

**Files:**
- Create: `game/src/engine/library.ts`, `game/src/engine/library.test.ts`, `game/src/engine/test-fixtures/recordings.ts`

**Interfaces:**
- Produces:
  ```ts
  // library.ts
  export interface Variant { move: MoveId | MinionId; variant: string; recording: Recording; info: VariantInfo }   // info.quiet = label starts with 'quiet' (D-24); info.targets = emails of Users rows touched by db events (from after.email / before.email)
  export interface RecordingLibrary { variantsOf(move: MoveId | MinionId): Variant[] }
  export function libraryFrom(recordings: Recording[]): RecordingLibrary;   // validates each with validateRecording, throws on errors; variants sorted by variant name
  export const EMPTY_LIBRARY: RecordingLibrary;
  // test-fixtures/recordings.ts  (comment at the top: test-only; made-up; never put in src/recordings/)
  export function fakeRecording(move: MoveId | MinionId, variant: string, opts: { ip: string; quiet?: boolean; events?: RecEvent[]; durationMs?: number }): Recording;
  export const FIXTURE_LIBRARY: RecordingLibrary;   // every ATK and MIN row with variants a, b, c on ips 203.0.113.1xx/2xx/3xx; quiet 'c' variants; events per move:
  //  ATK-01: 30 access 404s; ATK-02: 2 access 200s on /ftp; ATK-03/04: one 200 POST /rest/user/login (ATK-04 preceded by 5 401s);
  //  ATK-05: db update Users key 2 (jim) password; ATK-06: db insert Users {id:26,email:'death@juice-sh.op',role:'admin'}; ATK-07: 3 admin GETs;
  //  ATK-08: 10 access + exfil Users keys 1..25 columns email,password in 5 events; ATK-09: 3 access + exfil Users 1..25; ATK-10: 3 access + exfil Baskets (no souls, KI-15);
  //  ATK-11: db insert Users {id:27,email:'support-ops@juice-sh.op',role:'admin'}; ATK-12: db update Users key 7 (morty) password;
  //  ATK-13: file add uploads/complaints/invoice.zip; ATK-14: 2 access with a forged token; ATK-15: db update Products key 1 description; ATK-16: db update Products key 2 description '<script>';
  //  ATK-17: file add uploads/READ_ME_MORTAL.txt + db update Products key 3; MIN-01: 20 access 404s on /wp-admin etc.; MIN-02: 10 POST /rest/user/login (401s and one 200); MIN-03: 20 GET /api/Products; MIN-04: 5 POST /api/Feedbacks
  ```
  `fakeRecording` fills the header (`format: 1`, `label: (quiet ? 'quiet: ' : 'loud: ') + move`, `recordedAt`, `juiceShop: 'test'`, `tool: 'test'`, `attackerIp: ip`, `durationMs` ≥ last `t`) and spaces events 100 ms apart.

- [ ] **Step 1: Tests**

```ts
it('groups the committed recordings by move: ATK-03 has variant a on 203.0.113.23, ATK-08 variant a on 203.0.113.81', …);   // libraryFrom([ATK03a, ATK08a]) with JSON imports
it('reads quiet from the label and targets from db events', …);
it('refuses an invalid recording with its validation errors', …);
it('every fixture recording passes validateRecording and every move and minion has 3 variants', …);
```

- [ ] **Step 2–4: fail, implement, pass.**  - [ ] **Step 5: Commit** `git commit -m "Add the recording library and a made-up fixture library for the sims"`.

---

### Task 9: The replay engine (SYS-03) — PR 4

**Files:**
- Create: `game/src/engine/replay.test.ts`
- Modify: `game/src/engine/replay.ts` (replace the stub)

**Interfaces:**
- Produces:
  ```ts
  export function startReplay(world: World, v: Variant, owner: 'death' | MinionId): Replay;   // pushes Replay{startedAt: now, cursor: 0}, opens an alert, emits move-started (death) — waves emit their own event in Task 12
  export function stepReplays(world: World, library: RecordingLibrary): void;
  // for each replay: first cutIfStopped(); then apply every event with startedAt + e.t * gameMsPerRealMs ≤ now, in order; when cursor reaches the end → land()
  export function cutReplay(world: World, replay: Replay, by: ActionId): void;   // removes it, records played {outcome:'cut'}, emits move-cut, closes the alert, sets death.nextMoveAt = now + cutRetryGameMs (death only)
  export function activeDeathReplay(world: World): Replay | undefined;
  export function renderCombined(world: World, line: AccessLine): string;   // nginx combined: `${ip} - - [DD/Mon/YYYY:HH:MM:SS +0000] "${method} ${target} ${protocol}" ${status} ${bytes} "${referer || '-'}" "${userAgent || '-'}"`, date from gameTimeIso(line.t)
  export function renderAccessLog(world: World): string;   export function renderAppLog(world: World): string;   // '\n'-joined, trailing newline when non-empty
  ```
  Event application: `access` → push `AccessLine` (t = now, `by` = move); `app` → `AppLine`; `db` → push `DbChange` and, for table `Users`: insert → `accounts.push({id, email, role, createdBy: move})`; update with `after.password` → the account gets `hijackedBy: move` when move is ATK-12, or (ATK-05) a `Session{kind:'user', email, issuedBy: move}`; delete → remove; for `Products` update → `defacements.push({productId, kind: after.description includes '<script' || '<iframe' ? 'xss' : 'deface', by: move})` (ATK-17's product update sets `bannerDefacedBy` instead); `file` → add/change/remove in `files` with `plantedBy: move` on add; `exfil` → `steal(world, move, table, keys)`.
  Landing (`land`): `played.push({outcome:'landed'})`, apply `MOVE_BY_ID[move].gains` that are stored knowledge (`map`, `secrets-leaked`, `admin-password`), `admin-session` → push `Session{kind:'admin', email:'admin@juice-sh.op', issuedBy: move, keyVersion: current}`, ATK-14 → `forgedToken = true`; emit `move-landed`, close the alert, `nextMoveAt = now + moveGapGameMs`.
  `cutIfStopped`: cut with `'DEF-11'` when nginx is stopped; with `'DEF-06'` when `firewall.blocked` includes the replay's ip; else with the action of the first pre-emptive stopper of the move that holds (`stopperHolds` with the variant info). Minion replays are cut on nginx stop / ip block / their `closedBy`.

- [ ] **Step 1: Tests** (use the committed JSON for the SYS-03 Done-when, fixtures for the rest)

```ts
it('plays ATK-03.a: one access line at game time 220 × 30 ms, rendered as an nginx combined line, then lands with an admin session', …);   // expect renderAccessLog(w) to match /^203\.0\.113\.23 - - \[31\/Oct\/2026:22:00:06 \+0000\] "POST \/rest\/user\/login HTTP\/1\.1" 200 784 "-" "curl\/8\.23\.0"$/m
it('plays ATK-08.a to the end: 102 access lines, 242 app lines, 25 souls stolen, souls-stolen events sum to 25', …);
it('blocking the IP mid-ATK-08 stops new lines from that IP within one tick', () => { startReplay(ATK08a); advance 1000 real ms → some lines; applyAction DEF-06 add 203.0.113.81; const n = w.logs.access.length; advance(w, lib, 100); expect(w.logs.access.length).toBe(n); expect(eventsOfKind(w,'move-cut')[0]).toMatchObject({ move:'ATK-08', by:'DEF-06' }); expect(w.death.nextMoveAt).toBe(w.clock.gameMs + CONFIG.medium.cutRetryGameMs - …); });
it('cuts the active move when any of its stoppers starts to hold (feature off, WAF rule, patch applied, plug pulled)', …);   // four sub-cases on fixture ATK-08/ATK-01
it('a quiet variant keeps playing through a leaky sqli rule on Medium and is cut on Easy', …);
it('db events shape accounts and defacements: ATK-06 adds death@juice-sh.op (own-admin), ATK-11 adds the hidden admin (foothold), ATK-16 makes xss-live, ATK-13 plants a file', …);
it('a cut move counts as played with outcome cut and its alert closes', …);
```

- [ ] **Step 2–4: fail, implement, pass.**  - [ ] **Step 5: Commit** `git commit -m "Add the replay engine (SYS-03): recordings into virtual logs, DB changes and files"`.

---

### Task 10: The sql.js side (SYS-03's DB) — PR 4 ends

**Files:**
- Create: `game/src/engine/sqldb.ts`, `game/src/engine/sqldb.test.ts`
- Modify: `docs/PRD.md` §16 (SYS-03 → done; ATK-03/ATK-08 notes → "plays headless in the engine")

**Interfaces:**
- Produces:
  ```ts
  export interface GameDb { db: Database; applied: number }        // Database from sql.js
  export async function openBaseline(bytes: Uint8Array): Promise<GameDb>;
  export function applyDbChange(g: GameDb, c: DbChange): void;     // insert: INSERT with every after column; update: UPDATE SET changed columns WHERE key; delete: DELETE WHERE key; 'base64:' values become BLOBs
  export function syncDb(g: GameDb, world: World): void;           // applies world.logs.dbChanges[g.applied..]; then mirrors engine-side account changes: UPDATE Users SET deletedAt for locked accounts, DELETE for accounts no longer in world.accounts (seed ids only), re-INSERT seed accounts a restore brought back
  ```

- [ ] **Step 1: Tests** (`openBaseline(readFileSync(juiceshop.sqlite))`)

```ts
it('applies an insert, an update and a delete from a DbChange to the real tables', …);
it('syncDb mirrors a DEF-08 lock as deletedAt and a DEF-14 delete as a missing row', …);
it('syncDb is idempotent: calling it twice changes nothing', …);
```

- [ ] **Step 2–4: fail, implement, pass.**
- [ ] **Step 5: Docs:** PRD §16 `SYS-03 | done | replay.ts + sqldb.ts; blocking the IP mid-ATK-08 stops its lines within one tick`; ATK-03/ATK-08 notes: `Recorded (…); plays headless in the engine; no UI yet`.
- [ ] **Step 6: Commit and open PR 4** `git commit -m "Mirror replayed DB changes into sql.js (SYS-03 done)"`.

---

### Task 11: Playable moves, banishment and the return (SYS-07) — PR 5 starts

**Files:**
- Create: `game/src/engine/director.test.ts`
- Modify: `game/src/engine/director.ts` (replace the stub with the SYS-07 half; the pick logic comes in Task 12)

**Interfaces:**
- Produces:
  ```ts
  export function playableVariants(world: World, library: RecordingLibrary, move: Move): Variant[];
  // move not landed; needsHold(world, move); for each variant: ip not blocked, !anyStopperHolds(world, move, v.info)
  export function playableMoves(world: World, library: RecordingLibrary): Move[];    // MOVES with ≥ 1 playable variant (no stage filter here)
  export function returnGrants(foothold: Foothold): Gain;   // D-24 table
  export function checkBanishment(world: World, library: RecordingLibrary): void;
  // called by directorTick when no death replay is active and playableMoves is empty:
  //  footholds empty → ending 'banished' (emit 'banished' then 'ending');
  //  else if quietSince unset → quietSince = now, emit 'banished' (provisional);
  //  else if now − quietSince ≥ returnDelayGameMs → the first foothold in Foothold order: grant returnGrants() into knowledge/sessions, returnedThrough = it, emit 'return', ending 'return'
  //  if playableMoves is non-empty again while quiet (the player reopened a route) → quietSince cleared
  ```
  With the return as an ending (D-24), "returns through it" is the `return` event naming the foothold; the gains it grants are what the report and UI-06 show.

- [ ] **Step 1: Tests**

```ts
it('win when no move\'s Needs hold and no foothold is left', …);                      // every move landed or stopped, no footholds → ending banished
it('leaving ATK-11\'s admin in place always triggers the return', () => { … land ATK-11 via fixtures, stop everything else; tick → provisional banished; advance 2 real min → eventsOfKind('return')[0].through === 'hidden-admin'; ending 'return' });
it('removing the foothold during the quiet period banishes him for good', …);          // DEF-14 support-ops@juice-sh.op before the delay → ending banished, no return event
it('the return fires once and never before the delay', …);
it('a rotated key does not remove the forged token: the return comes through it (SIM-7 shape)', …);
```

- [ ] **Step 2–4: fail, implement, pass.**  - [ ] **Step 5: Commit** `git commit -m "Add banishment and the return (SYS-07)"`.

---

### Task 12: The Director, minion waves and the stage-order test (SYS-02, SYS-17 part 3) — PR 5 ends

**Files:**
- Create: `game/src/engine/minions.test.ts`, `game/src/engine/stage-order.test.ts`
- Modify: `game/src/engine/director.ts`, `game/src/engine/minions.ts` (replace the stub), `docs/PRD.md` §16 (SYS-02, SYS-07, SYS-17, SYS-04 → done), `docs/KNOWN_ISSUES.md` (KI-16)

**Interfaces:**
- Produces, in `director.ts`:
  ```ts
  export function highestStagePlayed(world: World): number;           // 0 when nothing landed
  export function stageAllowed(world: World, stage: Stage): boolean;  // stage ≤ highestStagePlayed + 1 + death.stageSkips, or returnedThrough is set (D-19)
  export function openAlerts(world: World): number;
  export function directorTick(world: World, library: RecordingLibrary): void;
  // 1. if ending or activeDeathReplay() → return.  2. pacing: if openAlerts() > delayAboveOpenAlerts → nextMoveAt = max(nextMoveAt, now + moveGapGameMs) once per quiet-less period (flag in world.death); if openAlerts() === 0 for ≥ bringForwardAfterQuietGameMs (world.quietAlertsSince) → nextMoveAt = now.
  // 3. candidates = playableMoves().filter(stageAllowed).  4. none → checkBanishment(); return.  5. if now < nextMoveAt → return.
  // 6. pick: max stage among candidates; ties by pick(world, …); variant = first never-tried playable variant else first playable.  7. if the pick's stage > highestStagePlayed + 1 → stageSkips -= 1. 8. startReplay(…, 'death'); quietSince cleared.
  ```
- Produces, in `minions.ts`:
  ```ts
  export function minionClosed(world: World, id: MinionId): boolean;     // any MINION_BY_ID[id].closedBy holds (DEF-06 for MIN-01: every ip of its active wave blocked)
  export function stepWaves(world: World, library: RecordingLibrary): void;
  // start: for each minion with nextWaveAt ≤ now, nginx running and !minionClosed → Wave{n, ips: 3 fresh 203.0.113.x via pick}, open an alert, emit wave-started, nextWaveAt += periodGameMs; if the library has variants for it → startReplay(variant, minion) with the wave's first ip
  // during: MIN-02 wave at startedAt + waveDurationGameMs/2 (once per success, up to min02SuccessesPerWave): stealOneUnstolenCustomer → also sessions.push({kind:'user', email, issuedBy:'MIN-02'})
  // end: endsAt ≤ now, or minionClosed(), or nginx stopped → remove, close the alert, emit wave-ended with closedBy when closed
  export function activeWaves(world: World): Wave[];
  ```

- [ ] **Step 1: Tests**

```ts
// director.test.ts (extend)
it('a seeded run produces the same move sequence every time', …);        // run advance() 10 real min on FIXTURE_LIBRARY, seeds 1 and 1 → equal move-started lists; seeds 1 and 2 may differ
it('prefers later stages among allowed candidates and ties deterministically', …);
it('skips a move whose variants are all blocked and uses another variant after a cut (Death switches IP)', …);
it('pacing: more than 3 open alerts delays the next move; no open alert for 60 real s brings it forward', …);
it('a tip-off lets him skip one stage and play at once', …);
// minions.test.ts
it('waves start at the configured times and repeat with their period', …);
it('MIN-02 steals one soul per success and hands Death a user-session; DEF-07 closes the wave', …);
it('MIN-01 is closed by the scanner user-agent rule or by blocking every IP of the wave', …);
it('a closed minion type stays closed while the closer holds', …);
it('minions drain 0.5 heartbeat per game minute each while active', …);
// stage-order.test.ts (SYS-17)
it('no seeded run plays a stage-N move before a stage-(N-1) move, except during the return or after a tip-off', () => { for (const seed of range(20)) { run 12 real min, no player; for each move-started in order assert stage ≤ max(previous stages) + 1 }  then one run with DEF-04 active at 60 s → exactly one skip of one stage allowed after the tip-off event; one run reaching the return → moves after the return event are exempt });
```

- [ ] **Step 2–4: fail, implement, pass. Run the whole suite; the Task 7 property still holds with `EMPTY_LIBRARY`.**
- [ ] **Step 5: Docs:** PRD §16: `SYS-02 | done | director.ts; seeded, stage order (D-19), pacing, tip-off`, `SYS-07 | done | director.ts; the return is an ending (D-24)`, `SYS-17 | done | consistency, stage-order and fast-check tests`, `SYS-04 | done | every DEF and ATK effect goes through engine/actions.ts and engine/replay.ts`. KNOWN_ISSUES: `KI-16 | Stage order (D-19) means Death can't start without a stage-1 recording: until REC-03 records ATK-01, the committed library only plays in tests; the game's first Director tick banishes him | Major | Open`.
- [ ] **Step 6: Commit and open PR 5** `git commit -m "Add the Director with stage order, minion waves and the stage-order test (SYS-02, SYS-07, SYS-17 done)"`.

---

### Task 13: Engine, sim driver and the playthrough sims (SYS-16) — PR 6

**Files:**
- Create: `game/src/engine/engine.ts`, `game/src/engine/sim.ts`, `game/src/engine/engine.test.ts`, `game/src/engine/sims.test.ts`
- Modify: `game/src/engine/properties.test.ts` (second run with `FIXTURE_LIBRARY`), `docs/PRD.md` §16 (SYS-16 → building)

**Interfaces:**
- Produces:
  ```ts
  // engine.ts
  export interface EngineOptions { seed: number; difficulty: Difficulty; library?: RecordingLibrary; baseline?: Uint8Array }   // library defaults to COMMITTED_LIBRARY (ATK-03.a, ATK-08.a via JSON imports); baseline is required for db()
  export class Engine {
    constructor(opts: EngineOptions);
    readonly world: World;
    advance(realMs: number): void;  act(action: PlayerAction): ActionResult;  pause(): boolean;  resume(): void;
    db(): Promise<GameDb>;             // opens the baseline once, then syncDb() on every call
    accessLog(): string;  appLog(): string;  files(): VFile[];  evidence(): Evidence[];
    subscribe(fn: (world: World) => void): () => void;   // called after every advance/act
  }
  export const COMMITTED_LIBRARY: RecordingLibrary;
  // sim.ts
  export type ScriptedPlayer = (world: World, realElapsedMs: number) => PlayerAction[];
  export interface SimResult { world: World; events: GameEvent[]; realMs: number }
  export function runSim(opts: { seed: number; difficulty?: Difficulty; library?: RecordingLibrary; player: ScriptedPlayer; maxRealMs?: number }): SimResult;   // 100 real ms steps, stops at an ending or maxRealMs (default 12 real min)
  ```
- The sims assert **only from `events`** (SYS-10), with `FIXTURE_LIBRARY`, seed 1, Medium. Scripted players (each a small function in `sims.test.ts`):
  - SIM-1 `() => []`.
  - SIM-2: on every `move-started`/`wave-started` ip not yet blocked → `DEF-06 add`.
  - SIM-3: first `alert-opened` → `DEF-11` once.
  - SIM-4: after each `move-started`, apply the move's first non-undo stopper (sqli rule, DEF-07, feature off, patch…) but never DEF-14/DEF-15/DEF-16 and never DEF-02.
  - SIM-5: the playbook: at the first alert `DEF-05 'initial'`; after each `move-started`, apply its first non-undo stopper; after `move-landed` of ATK-06/11 → `DEF-14` the account from `world.accounts` with `createdBy` that move; ATK-13 → `DEF-15` the planted path; ATK-12 → `DEF-16` the hijacked email; ATK-14 → `DEF-13 token-verify`; after any defacement → `DEF-17` the latest backup taken before the move started; `DEF-18` for anything turned off once its patch is applied; `DEF-19` at the first souls-stolen event, `DEF-20 legal` right after.
  - SIM-6: SIM-5's Death handling, never DEF-07, never the scanner rule, never the `/api/*` rate limit, never the CAPTCHA.
  - SIM-7: SIM-5 but `DEF-09` instead of `DEF-13 token-verify` after ATK-14 lands.

- [ ] **Step 1: Tests**

```ts
// engine.test.ts
it('runs the committed library with the real baseline: db() reflects replayed changes and a DEF-08 lock', …);
it('subscribe fires after advance and act; unsubscribe stops it', …);
// sims.test.ts
it('SIM-1: a player who does nothing loses every soul before the 10th real minute', ({events, realMs}) => { ending 'souls-lost'; realMs < 600_000 });
it('SIM-2: blocking every IP loses souls anyway and blocks Death\'s IPs at least 3 times (whack-a-mole)', …);   // souls-stolen events with by: ATK-* exist; count DEF-06 actions whose ip equals a move-started ip ≥ 3 — SYS-11's rule; the report line itself waits for SYS-11
it('SIM-3: pulling the plug at the first alert and leaving it flatlines', …);
it('SIM-4: containing well but never looking for footholds ends in "Banished" then the return through ATK-11', …);   // events contain banished, then return {through:'hidden-admin'}, ending 'return'
it('SIM-5: the playbook banishes Death with no return', …);   // ending banished, no return event; grade ≥ B waits for SYS-11
it('SIM-6: ignoring minions loses noticeable heartbeat and some souls to MIN-02 but can still win', …);   // souls-stolen by MIN-02 ≥ 1; heartbeat at ending ≤ 90; ending banished
it('SIM-7: rotating the key but never patching token verification returns through the forged token', …);
// properties.test.ts: the Task 7 property again with FIXTURE_LIBRARY and numRuns 200
```

- [ ] **Step 2–4: fail, implement, pass.** If a sim fails because a rule is wrong rather than the sim, fix the rule where the PRD decides it; if the PRD is silent, write a KI and keep the sim red-flagged with `it.todo` naming the KI (never a loosened assertion).
- [ ] **Step 5: Docs:** PRD §16 `SYS-16 | building | SIM-1…7 run headless in engine/sims.test.ts on a made-up library; SIM-2's and SIM-5's report lines wait for SYS-11`.
- [ ] **Step 6: Commit and open PR 6** `git commit -m "Add the Engine, the sim driver and the seven playthrough sims (SYS-16)"`.

---

### Task 14: The shell's `World` interface — PR 7, when `game/src/shell/world.ts` lands

**Files:**
- Create: `game/src/engine/shell-world.ts`, `game/src/engine/shell-world.test.ts`

**Interfaces:**
- Consumes: whatever `game/src/shell/world.ts` exports (the teammate's draft; expected: a VFS read side and one method per terminal DEF row: DEF-01…06, 08, 11, 14, 15, 18).
- Produces: `export function shellWorld(engine: Engine): ShellWorld` mapping each method to `engine.act(...)` and each read to `engine.accessLog()`, `engine.appLog()`, `engine.files()`, `engine.evidence()`, `engine.db()`; virtual paths `/var/log/nginx/access.log`, `/var/log/juice-shop/app.log`, `/srv/juice-shop/uploads/<path>`, `/srv/juice-shop/data/juiceshop.sqlite`, `/evidence/<name>.tgz`.

- [ ] **Step 1:** Read the landed interface; write one test per method (`blockIp` → `DEF-06` event; `rm` on a planted file → `DEF-15` event; reading the access log after ATK-03.a returns the combined line).
- [ ] **Step 2–4: fail, implement, pass.**
- [ ] **Step 5: Commit, PR 7** `git commit -m "Implement the shell's World interface on the engine"`. If the interface hasn't landed when Task 13 is done, stop here and say so.

---

## Self-review notes

- **Spec coverage:** SYS-04 T1; SYS-17 T2 (tables, consistency), T7 (fast-check), T12 (stage order); SYS-01 T3; SYS-10 T3; SYS-05/06 T4; every DEF row T6; SYS-03 T9+T10 (Done-when test in T9); SYS-07 T11; SYS-02 incl. pacing, tip-off, determinism T12; MIN rows T12; SYS-16 T13 (SIM-2/5 report lines explicitly deferred to SYS-11). ATK rows: data in T2, effects in T9. D-18/D-19 in T2 and T12.
- **Types:** `Variant`/`VariantInfo` defined in T5/T8 and used by T9, T11, T12; `GameEvent` in T3 used everywhere; `PlayerAction` in T6 (declared type-only in `log.ts`); `RecordingLibrary` T8 used by `advance` (T7 stub signature already takes it).
- **Not in this plan:** SYS-08 dials (only the difficulty-specific values the PRD names are in `config.ts`), SYS-11 grading, SYS-13, SYS-14, SYS-15, taunts, Kiro calls (`kiro` events exist for SYS-12 to emit).

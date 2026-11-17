# Known issues

| ID | Issue | Severity | Status |
|---|---|---|---|
| KI-01 | The game has no name yet; the title screen still says "RE:Animator" | Minor | Open |
| KI-02 | Kiro's credit cost per call is unknown, so the per-run cap (KIRO-10) can't be set yet; measure it with the first SYS-12 prototype | Major | Open |
| KI-03 | Some Juice Shop behaviours in PRD §3/§5 are unconfirmed or need a team ruling; per-fact status below (checked 2026-11-17 against v20.4.0) | Major | Open |
| KI-04 | No host picked for the page and the Kiro server (SYS-18); the rules require a working URL | Major | Open |
| KI-05 | Recording timing assumes the host and the containers share one clock: `record.sh` stamps start/end with the host's `date`, while nginx and `docker logs` stamp with the containers' clocks. True on Linux Docker; Docker Desktop's VM can drift. `date +%s%3N` is GNU-only too, so re-recording is Linux-only | Minor | Open |
| KI-06 | nginx has no healthcheck (`up --wait` only waits on the shop's), and `record.sh` throws away the output of `compose down`/`up`, so a broken rig shows up only as an isolation-check failure | Minor | Open |
| KI-07 | The "no rig address" test reads the recording as text, so an address inside an embedded file (`contentBase64`) would get past it | Minor | Open |
| KI-08 | Only the tools container's address (`10.66.0.66`) is rewritten into TEST-NET-3. nginx's own address (`10.66.0.10`, the shop's view of every client) is not; it appears in no recording yet, and the test above would fail if it did | Minor | Open |
| KI-09 | `record.sh` writes `run.json` with a heredoc, unescaped: a `# tool:` or `# label:` line containing `"` or `\` breaks the JSON. The converter then refuses the run rather than saving bad data | Minor | Open |
| KI-10 | Each recording has a few hundred ms of idle time at the start and end (container start-up before the first request, the exit after the last) | Minor | Open |
| KI-11 | Juice Shop seeds its DB on start with the current time, so a re-recorded run's `before.sqlite` differs from the committed baseline in timestamp columns; a `db` event's `before` may not match the baseline exactly | Minor | Open |

### KI-03: Juice Shop facts (v20.4.0, checked 2026-11-17)

**recording** = seen in a recording in `game/src/recordings/`. **source** = read in Juice Shop's own code inside the image; nothing was run against it. Source-only facts still need a recording before their row is built.

| Row | Fact in the PRD | Status | What's true |
|---|---|---|---|
| ATK-03 | Login SQLi with `' OR 1=1--` gives an admin session | confirmed (recording) | One `POST /rest/user/login`, `200`, token for `admin@juice-sh.op` (ATK-03.a) |
| ATK-03 | "the app log shows the odd email" | **disproved** (recording) | Juice Shop logs nothing for the login except scoreboard lines (filtered, D-15). PRD fixed (D-17) |
| ATK-08 | sqlmap UNION dump through search | confirmed (recording) | Needs `--prefix="'))" --suffix='--'` (the query wraps `q` in two brackets) and `--no-cast` (Juice Shop cuts `q` to 200 chars). All 25 users' emails and hashes leak, one row per request (ATK-08.a) |
| ATK-08 | "hundreds of requests, huge response sizes" | **disproved** (recording) | 102 requests, responses ≤ 1 KB; 62 `500`s: 42 `SQLITE_ERROR`s and 20 `Unexpected path` errors, each with a stack trace in the app log. PRD fixed (D-17) |
| ATK-05 | Reset a password via a guessable security answer | confirmed (source) | `POST /rest/user/reset-password` with `email`, `answer`, `new`, `repeat`; guessable answers exist (e.g. Jim's) |
| ATK-12 | Change a customer's password with no current password, from any session | **partly disproved** (source) | `current` is optional, but the change applies to the user whose token is sent. Taking over a *customer* needs that customer's token. **Team to rule on Needs** |
| ATK-13 | Upload with a type-check bypass leaves a file in uploads | **disproved** (source) | The type check never rejects anything (it only scores a challenge). `/file-upload` keeps files in memory; only a `.zip`'s entries are written to `uploads/complaints/`. No session needed. PRD fixed (D-17) |
| ATK-14 | An unsigned JWT (`alg: none`) is accepted | confirmed (source) | Auth uses `express-jwt` 0.1.3 / `jsonwebtoken` 0.4.0, and Juice Shop checks for a `none` token in its own challenge code |
| ATK-15 | Defacing products needs an admin session | **disproved** (source) | `PUT /api/Products/:id` has its auth line commented out: no token needed. **Team to rule on Needs** |
| ATK-16 | Stored XSS through the products API | confirmed (source) | The description is only sanitized when the XSS challenge is disabled; by default it's stored raw. Same no-auth route as ATK-15 |
| DEF-08 | `UPDATE Users SET isActive=0` locks an account | **disproved** (source) | The column exists (also in the baseline DB), but no code reads it. Login refuses rows with `deletedAt` set; tokens already issued keep working. PRD fixed (D-17) |


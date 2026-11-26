# Recording rig (PRD REC-01 to REC-05)

Death's moves are real attacks, recorded once here and replayed by the game (BLACKOUT.exe). Players
never trigger a real attack (AGENTS.md).

- **Target:** OWASP Juice Shop `v20.4.0` behind nginx, on the Docker-internal network `10.66.0.0/24`
  (no route out, no published ports). nginx writes the real `combined` access log plus a JSON copy
  with millisecond times.
- **Attacker:** the `tools` container (`10.66.0.66`: curl, sqlmap 1.10.11, ffuf 2.1, Hydra 9.6, zip,
  SecLists' `common.txt`), started only by `record.sh`. A move from many addresses (MIN-02) names each
  in `X-Forwarded-For`, which nginx trusts from this container only (D-27).
- **Customers:** every run seeds 300 fake customers (`attacks/lib/customers.py`, deterministic,
  `example.*` addresses) through the shop's own sign-up API before the recording window (D-26).
- **Isolation:** `check-isolation.sh` proves the network is internal, the shop answers through nginx,
  and the outside world doesn't. `record.sh` refuses to attack if it fails.

## Record a move variant

```bash
recording/record.sh ATK-03 a 203.0.113.23      # raw run -> recording/runs/ATK-03.a/ (gitignored)
cd game && npm run recording:convert -- ../recording/runs/ATK-03.a   # -> src/recordings/ATK-03.a.json
```

Each run starts from a fresh Juice Shop (`down -v`, then up), so every script is re-runnable.
Before the window opens, `record.sh` seeds the customers and runs `attacks/<MOVE>.<variant>.setup.sh`
if there is one: what the move assumes Death already holds (e.g. an admin token from
`attacks/lib/admin-session.sh`). Neither is in the recording. Scripts for moves that take souls send
every request through `req` from `attacks/lib/capture.sh`, which keeps the responses so the
converter can tell which customers left (D-25).
The format of the JSON is decision D-15 in `docs/DECISIONS.md`. The third argument is the public
address the attacker gets in the recording (always inside `203.0.113.0/24`).

| Variant | Script | Public IP | What it is |
|---|---|---|---|
| ATK-01.a | `attacks/ATK-01.a.sh` | 203.0.113.11 | ffuf root scan with `common.txt` and auto-calibration, ffuf's own user agent |
| ATK-01.b | `attacks/ATK-01.b.sh` | 203.0.113.13 | The quiet scan (D-46, KI-77): the same ffuf scan and list with a browser user agent, 2 threads at 40 requests a second, ~2 min; same hits as .a |
| ATK-03.a | `attacks/ATK-03.a.sh` | 203.0.113.23 | Login SQLi, one request, curl's own user agent (its `before.sqlite` is the baseline) |
| ATK-03.b | `attacks/ATK-03.b.sh` | 203.0.113.26 | **Quiet** login SQLi (D-237): the quote and the comment as JSON unicode escapes, so a SQLi rule set reading the body misses it; browser user agent and headers, one request |
| ATK-04.a | `attacks/ATK-04.a.sh` | 203.0.113.44 | Hydra against the admin login, 30 passwords, 4 tasks, Hydra's own user agent |
| ATK-04.b | `attacks/ATK-04.b.sh` | 203.0.113.45 | **Quiet** password spraying (D-237): 3 passwords over 6 staff accounts, one try every 10–12 s (under the login rate limit), browser user agent, stops at `admin123`; 18 requests, ~3 min |
| ATK-06.a | `attacks/ATK-06.a.sh` | 203.0.113.61 | Admin sign-up by mass assignment, then its login and the admin page's data |
| ATK-08.a | `attacks/ATK-08.a.sh` | 203.0.113.81 | sqlmap UNION dump of Users through search, sqlmap's own user agent, full speed (test-only, D-32) |
| ATK-08.b | `attacks/ATK-08.b.sh` | 203.0.113.82 | Low and slow, quiet: the same dump with `--random-agent`, `--tamper=randomcase`, `--delay=0.36`, ~2.5 min (D-35) |
| ATK-08.c | `attacks/ATK-08.c.sh` | 203.0.113.83 | Loud: probing only with `--delay=1.2` (~90 s), then a fast `--dump` from the saved session |
| ATK-08.d / .e | `attacks/ATK-08.d.sh`, `.e.sh` | 203.0.113.85 / .86 | .b's quiet dump of half of Users each (rows 1–163 / 164–325, `--start/--stop`), `--delay=0.7`, 2–3 min (D-63) |
| ATK-08.f / .g | `attacks/ATK-08.f.sh`, `.g.sh` | 203.0.113.88 / .90 | .c's loud shape (~90 s probing, then a fast dump) for half of Users each (rows 1–163 / 164–325, D-63) |
| ATK-09.b / .c | `attacks/ATK-09.b.sh`, `.c.sh` | 203.0.113.96 / .97 | `GET /api/Users/<id>` one by one for ids 1–163 / 164–325 with the admin token (setup), 0.9 s apart, responses captured (`lib/scrape-users.sh`, D-63) |
| ATK-11.a | `attacks/ATK-11.a.sh` | 203.0.113.111 | Staff-looking admin sign-up with the admin token (setup), browser user agent |
| ATK-13.a | `attacks/ATK-13.a.sh` | 203.0.113.131 | Zipped PHP web shell through `/file-upload` |
| ATK-15.a | `attacks/ATK-15.a.sh` | 203.0.113.151 | Three product descriptions rewritten, no login |
| ATK-17.a | `attacks/ATK-17.a.sh` | 203.0.113.171 | `READ_ME_MORTAL.txt` upload and the first product renamed to the demand |
| MIN-01.a | `attacks/MIN-01.a.sh` | 203.0.113.201 | 24 PHP/WordPress/config probes, zgrab user agent |
| MIN-02.a | `attacks/MIN-02.a.sh` | 203.0.113.128 to .250 | Credential stuffing, one botnet address per attempt, responses captured |
| TAP-01.a | `attacks/TAP-01.a.sh` (+ `.setup.sh`) | 203.0.113.174 | **Leaky tap** (PRD §4.1, D-130, D-135): after CUST.b's shoppers ran in the setup, the `/support/logs` listing, then today's access log fetched 10 times, python-requests user agent, responses captured |
| TAP-02.a | `attacks/TAP-02.a.sh` | 203.0.113.175 | **Leaky tap:** `GET /rest/memories` polled 10 times, python-requests user agent, responses captured |
| TAP-03.a | `attacks/TAP-03.a.sh` | 203.0.113.176 | **Leaky tap:** reviews of products 1 to 56 walked, python-requests user agent, responses captured; converted to `game/src/recordings/taps/` (D-130) |
| MIN-03.a | `attacks/MIN-03.a.sh` | 203.0.113.177 | Scraper wave: `GET /api/Products` 30 times, 2 a second, Scrapy user agent (D-132) |
| MIN-04.a | `attacks/MIN-04.a.sh` | 203.0.113.187 | Spam wave: 10 link-spam feedbacks, each through the CAPTCHA the shop answers for it, python-requests user agent (D-132) |
| CUST.b | `attacks/CUST.b.sh` (+ `.setup.sh`) | 20 addresses in 203.0.113.2 to .127, none an attacker's | **Not an attack:** ~3.5 min of customers incl. 5 forgot-password flows and 5 `/ftp` visits (KI-82, D-131); setup gives the 5 resetters a security answer; converted to `traffic/CUST.b.json` |
| CUST.c | `attacks/CUST.c.sh` | 12 addresses in 203.0.113.2 to .127, none an attacker's | **Not an attack:** ~2 min of customers whose searches and feedback hold quotes (D-237): the false positives of a SQLi rule; an apostrophe search answers `500` (the shop's search is injectable) and the shopper retries without it; converted to `traffic/CUST.c.json` |
| CUST.a | `attacks/CUST.a.sh` | 64 addresses in 203.0.113.2 to .127, none an attacker's | **Not an attack:** ~10 min of ordinary customers (REC-06, D-61), `lib/shoppers.py`; converted to `game/src/recordings/traffic/CUST.a.json` (D-62) |

Customer traffic is recorded the same way: `recording/record.sh CUST a 203.0.113.1` (or `CUST b`, `CUST c`) (the third argument is
only the header's `attackerIp`; every request names its own customer address). `CUST_SCALE=0.05` in the tools
container's environment runs the same visits 20 times faster, for a quick check of the script.

Stop the rig with `docker compose -f recording/compose.yaml down -v`.

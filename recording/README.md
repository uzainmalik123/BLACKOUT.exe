# Recording rig (PRD REC-01 to REC-05)

Death's moves are real attacks, recorded once here and replayed by the game. Players never trigger
a real attack (AGENTS.md).

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
| ATK-03.a | `attacks/ATK-03.a.sh` | 203.0.113.23 | Login SQLi, one request, curl's own user agent (its `before.sqlite` is the baseline) |
| ATK-04.a | `attacks/ATK-04.a.sh` | 203.0.113.44 | Hydra against the admin login, 30 passwords, 4 tasks, Hydra's own user agent |
| ATK-06.a | `attacks/ATK-06.a.sh` | 203.0.113.61 | Admin sign-up by mass assignment, then its login and the admin page's data |
| ATK-08.a | `attacks/ATK-08.a.sh` | 203.0.113.81 | sqlmap UNION dump of Users through search, sqlmap's own user agent, full speed (test-only, D-32) |
| ATK-08.b | `attacks/ATK-08.b.sh` | 203.0.113.82 | Low and slow, quiet: the same dump with `--random-agent`, `--tamper=randomcase`, `--delay=0.36`, ~2.5 min (D-35) |
| ATK-08.c | `attacks/ATK-08.c.sh` | 203.0.113.83 | Loud: probing only with `--delay=1.2` (~90 s), then a fast `--dump` from the saved session |
| ATK-09.a | `attacks/ATK-09.a.sh` | 203.0.113.91 | One `GET /api/Users` with the admin token (setup), responses captured |
| ATK-11.a | `attacks/ATK-11.a.sh` | 203.0.113.111 | Staff-looking admin sign-up with the admin token (setup), browser user agent |
| ATK-13.a | `attacks/ATK-13.a.sh` | 203.0.113.131 | Zipped PHP web shell through `/file-upload` |
| ATK-15.a | `attacks/ATK-15.a.sh` | 203.0.113.151 | Three product descriptions rewritten, no login |
| ATK-17.a | `attacks/ATK-17.a.sh` | 203.0.113.171 | `READ_ME_MORTAL.txt` upload and the first product renamed to the demand |
| MIN-01.a | `attacks/MIN-01.a.sh` | 203.0.113.201 | 24 PHP/WordPress/config probes, zgrab user agent |
| MIN-02.a | `attacks/MIN-02.a.sh` | 203.0.113.128 to .250 | Credential stuffing, one botnet address per attempt, responses captured |

Stop the rig with `docker compose -f recording/compose.yaml down -v`.

# Recording rig (PRD REC-01 to REC-03)

Death's moves are real attacks, recorded once here and replayed by the game. Players never trigger
a real attack (AGENTS.md).

- **Target:** OWASP Juice Shop `v20.4.0` behind nginx, on the Docker-internal network `10.66.0.0/24`
  (no route out, no published ports). nginx writes the real `combined` access log plus a JSON copy
  with millisecond times.
- **Attacker:** the `tools` container (`10.66.0.66`: curl + sqlmap 1.10.11), started only by `record.sh`.
- **Isolation:** `check-isolation.sh` proves the network is internal, the shop answers through nginx,
  and the outside world doesn't. `record.sh` refuses to attack if it fails.

## Record a move variant

```bash
recording/record.sh ATK-03 a 203.0.113.23      # raw run -> recording/runs/ATK-03.a/ (gitignored)
cd game && npm run recording:convert -- ../recording/runs/ATK-03.a   # -> src/recordings/ATK-03.a.json
```

Each run starts from a fresh Juice Shop (`down -v`, then up), so every script is re-runnable.
The format of the JSON is decision D-15 in `docs/DECISIONS.md`. The third argument is the public
address the attacker gets in the recording (always inside `203.0.113.0/24`).

| Variant | Script | Public IP | What it is |
|---|---|---|---|
| ATK-03.a | `attacks/ATK-03.a.sh` | 203.0.113.23 | Login SQLi, one request, curl's own user agent |
| ATK-08.a | `attacks/ATK-08.a.sh` | 203.0.113.81 | sqlmap UNION dump of Users through search, sqlmap's own user agent |

Stop the rig with `docker compose -f recording/compose.yaml down -v`.

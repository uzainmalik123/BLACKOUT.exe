# Kiro usage log

Every Kiro session goes here (AGENTS.md, D-13). The hackathon write-up (PRD SUB-07) is built **only** from this log, so it never claims anything Kiro didn't do.

Credit budget: about 1500 for development, 2500 for in-game use, judges and the demo (PRD §12).

| Date | Kiro app (IDE / CLI) | Feature (spec, hook, steering, MCP, custom agent, PBT, power, chat) | What it built or did | PRD rows | Credits |
|---|---|---|---|---|---|
| 2026-11-09 | — | Steering | `.kiro/steering/project.md` and `game-shell.md` written (by Claude, not yet loaded in Kiro) | KDEV-01 | 0 |
| 2026-11-20 | CLI (2.37.1) | Chat, steering | Latency and drift test for the in-game assistant: 5 in-game-style prompts. Steering loaded (listed the exact 29 shell commands); read a real sqlmap log line correctly; drafts stayed in the command set except `systemctl restart` (KI-14); used its Grep tool despite `--trust-tools=` and leaked PRD mechanics (KI-13) | KI-02, KIRO-08, KDEV-01 | ≈ 1 (all five) |

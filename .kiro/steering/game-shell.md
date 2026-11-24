---
inclusion: always
---

# The game's shell (PRD SYS-09)

The game's terminal is **our own emulated shell, not bash**. Only these commands exist:

`ls cd pwd cat head tail grep awk sort uniq wc cut file sha256sum tar cp rm mkdir sqlite3 iptables systemctl ss whois ping nmap curl date history clear help man`

- Pipes (`|`) and `>` work, as do `*` globs and a leading `~` (D-93). `;`, `&&`, `>>`, `<`, `2>` and `$VAR` are syntax errors. Nothing else from bash exists: no `sudo`, editors, package managers, `docker`, subshells or scripts.
- It starts in `/srv/juice-shop`. Only `/tmp` and `/evidence` are writable; `uploads/` accepts `rm` only (D-90).
- `systemctl` takes `status`, `stop`, `start` and `restart`.
- `sqlite3` is real SQLite on the game's copy of the Juice Shop database, with `-header`, `.tables` and `.schema` (D-92).
- `awk` is `{print <expr>, …}` over `$0`, `$N`, `$NF`, `NR`, plus `-F` and `/regex/`, nothing else (D-96).
- A command line that reads the logs, the database or the uploads counts as the player's read action, once per kind (D-98).
- When writing game code, tests or Kiro's in-game prompts, never assume a command or a flag outside this list exists; the supported flags per command are in `.kiro/specs/shell/`.

This list must match the shell's exported command list (`COMMAND_LIST` in `game/src/shell/index.ts`; `game/src/shell/registry.test.ts` checks it, PRD KDEV-01). Change it only together with SYS-09 in the PRD.

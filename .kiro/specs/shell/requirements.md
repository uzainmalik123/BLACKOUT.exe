# Requirements Document

## Introduction

This spec covers PRD row SYS-09, the game's terminal shell, built in `game/src/shell/`. The Shell is our own emulated shell, not bash. It accepts one command line at a time, runs it against a virtual file system, the Engine's logs and files, and the real SQLite copy of the recorded Juice Shop database, and returns plain text. Commands that change the incident (DEF-04, 05, 06, 08, 11, 14, 15, 18) call `Engine.act`, so the world updates by itself. A Command_Line that reads a log, the database or an uploaded file also calls `Engine.act` (DEF-01, 02, 03), once per kind of resource read, so the report can grade time-to-notice.

Sources: `docs/PRD.md` (SYS-09, DEF-01 to DEF-18, KIRO-08, KDEV-01, KDEV-02, KDEV-04), `docs/ENGINE_API.md` §5, `docs/DECISIONS.md` (D-22, D-90 to D-109), `docs/KNOWN_ISSUES.md` (KI-90, KI-91), `.kiro/steering/game-shell.md`, `game/src/engine/engine.ts`, `game/src/engine/actions.ts`, `game/src/engine/sqldb.ts`.

Out of scope: the terminal window UI (SCENES.md), Kiro's server-side command guard (KIRO-08, which only consumes this spec's exported command list and parser), and any command or behavior with no PRD row. There are no open questions; every earlier one is answered in the last section.

## Glossary

- **Shell**: the emulated shell in `game/src/shell/` exposing `run` and, on Easy only, `complete`. The result of `run` is `{ output, exitCode?, clear? }`.
- **Engine**: the `Engine` class in `game/src/engine/engine.ts`, which owns the World and exposes `act`, `accessLog`, `appLog`, `files`, `evidence` and `db`.
- **World**: the Engine's game state (`engine.world`). The Shell reads it and changes it only through `Engine.act`.
- **Command_Line**: one string passed to `run`, possibly containing pipes, a redirection, globs and quoted arguments.
- **Command_List**: the 31 supported command names: `ls cd pwd cat head tail grep awk sort uniq wc cut file sha256sum tar cp rm mkdir sqlite3 iptables systemctl ss whois ping nmap curl date history clear help man`.
- **Parser**: the component that turns a Command_Line into a parsed structure (commands, arguments, pipes, redirection) or a parse error.
- **Pretty_Printer**: the component that turns a parsed structure back into a canonical Command_Line.
- **Virtual_FS**: the Shell's in-memory file system. It holds the log files, the Juice Shop `uploads/` files, the database file, `/tmp`, `/evidence` and the directories above them.
- **Writable_Area**: the part of the Virtual_FS the player may create or change files in: `/tmp` and `/evidence` only (D-90). `uploads/` is not part of it; `rm` alone may change `uploads/`.
- **Game_DB**: the sql.js database returned by `Engine.db()`, a real SQLite copy of `juiceshop.sqlite`.
- **Uploaded_File**: a file under `/srv/juice-shop/uploads/`, as listed by `Engine.files()`.
- **Tip_Off**: the Engine's `tip-off` event, raised by the Engine on a DEF-04 active action when the Engine decides so, or by an account lock (DEF-08). The Shell never decides a Tip_Off.
- **Output**: the plain-text `output` string returned by `run`.
- **Exit_Code**: the optional integer `exitCode` returned by `run`: 0 on success, 1 for a failed command or a `grep` with no match, 2 for a syntax error, 127 for a command not found (D-95).
- **Glob**: a word containing `*`, expanded by the Shell against the Virtual_FS at execution time (D-93).
- **Steering_List**: the command list in `.kiro/steering/game-shell.md`.

## Requirements

### Requirement 1: Shell interface

**User Story:** As a screen builder, I want a stable `Shell` interface, so that the terminal window can send lines and print results without knowing the internals.

#### Acceptance Criteria

1. THE Shell SHALL expose `run(line: string): Promise<{ output: string; exitCode?: number; clear?: true }>` (D-95).
2. WHERE the difficulty is Easy, THE Shell SHALL expose `complete(partial: string): string[]` with the behavior defined in Requirement 13 (D-94).
3. THE Shell SHALL be constructed from an Engine instance and use that Engine for logs, files, the database and actions.
4. WHEN `run` is called, THE Shell SHALL resolve with a plain-text Output in which the Shell adds no markup (no HTML tags and no ANSI escape sequences), every control character below U+0020 other than newline and tab, and U+007F, is shown in caret notation (for example `^[` for ESC), and all other content, including file content and echoed arguments, is left untouched (D-106).
5. WHEN `run` is called with an empty or whitespace-only Command_Line, THE Shell SHALL resolve with an Output of zero characters and SHALL NOT add an entry to the history list.
6. WHEN `run` is called with a Command_Line that contains at least one non-whitespace character, THE Shell SHALL append that Command_Line, unmodified, to the history list read by `history`, in call order, subject to the retention limit in Requirement 12.3.
7. WHERE the difficulty is Medium or Hard, THE Shell SHALL omit `complete`, so that `shell.complete` is `undefined` (D-94).
8. IF `run` is called with a Command_Line whose command is not in the Command_List, THEN THE Shell SHALL resolve, without rejecting, with the Output `<name>: command not found` and an `exitCode` of 127, and SHALL leave the Engine state unchanged (D-94).
9. IF a command in the Command_List fails during `run`, THEN THE Shell SHALL resolve, without rejecting, with an Output that names the command and indicates the failure, and SHALL keep the Command_Line in the history list.
10. WHEN `run` resolves, THE Shell SHALL set `exitCode` to 0 on success, 1 for a failed command or a `grep` with no match, 2 for a syntax error, and 127 for a command not found (D-95); the result of `clear` has an `exitCode` of 0 (Requirement 12.4).

### Requirement 2: Command set and exported list

**User Story:** As a developer of Kiro's command guard, I want the supported command list exported, so that drafts and steering stay in sync with the real shell.

#### Acceptance Criteria

1. THE Shell module SHALL export the Command_List as a constant array containing exactly the names in the glossary, each name appearing once and no other entries.
2. WHEN the exported checking function is called with a Command_Line, THE Shell module SHALL return true if the Command_Line parses and every command name in it, including each side of every pipe, is in the Command_List, and SHALL return false otherwise.
3. WHEN the exported checking function is called, THE Shell module SHALL leave the World unchanged and execute no command.
4. WHEN a command name is not in the Command_List, THE Shell SHALL print `<name>: command not found`, return that text as Output with an `exitCode` of 127, and change nothing in the World for that command (D-94).
5. WHEN a command name is in the Command_List, THE Shell SHALL execute that command and SHALL NOT print `command not found` for it.
6. IF the set of names in the Command_List differs from the set of names in the Steering_List in `.kiro/steering/game-shell.md`, THEN THE Shell test suite SHALL fail and report each name present in only one of the two lists (KDEV-01).
7. IF a Command_Line uses `sudo`, `vim`, `docker`, a package manager (such as `apt`, `npm` or `pip`), `&&`, a subshell (`$(...)`, backticks or parentheses), or a script (a `.sh` file or a `./` path), THEN THE Shell SHALL print `<name>: command not found` (exitCode 127) for an unlisted command name or an error message indicating a syntax error (exitCode 2) for an unsupported construct, SHALL run none of the Command_Line, and SHALL change nothing in the World.

### Requirement 3: Parsing, pipes, redirection, quoting, globs and `~`

**User Story:** As a player, I want pipes and `>` to work as in a real shell, so that I can search logs with `grep ... | sort | uniq -c`.

#### Acceptance Criteria

1. WHEN a Command_Line contains `|` outside quotes, THE Shell SHALL pass the Output of each command as standard input to the next command, run the commands left to right, and return the Output of the last command.
2. WHEN a Command_Line ends with `> <path>`, the path lies in the Writable_Area, and every stage of the pipeline exits with code 0, THE Shell SHALL replace the contents of the file at that path with the final Output (creating the file if it does not exist) and return an empty Output; WHEN any stage exits with a non-zero code (including a `grep` with no match), THE Shell SHALL write nothing and leave the target unchanged.
3. IF a redirection target lies outside the Writable_Area, THEN THE Shell SHALL print an error indicating permission denied, write nothing, and leave every existing file unchanged.
4. IF a redirection target is an existing directory or its parent directory does not exist, THEN THE Shell SHALL print an error indicating the target cannot be written, write nothing, and leave every existing file unchanged.
5. WHEN an argument is wrapped in matching single or double quotes, THE Shell SHALL treat the quoted text as one argument, including spaces, `|`, `>` and `*` characters inside the quotes, and SHALL omit the enclosing quote characters from the argument value (D-104).
6. IF a Command_Line has an unterminated quote, a leading `|`, a trailing `|`, an empty command between two `|` characters, or a `>` with no target path, THEN THE Shell SHALL print an error indicating a syntax error with an `exitCode` of 2, run no command, and change nothing in the World.
7. IF a Command_Line contains `;`, `&&`, `>>`, `<`, `2>`, `$VAR`, `$(` or a backtick outside quotes, THEN THE Shell SHALL print an error indicating a syntax error with an `exitCode` of 2, run no command, and change nothing in the World (D-93).
8. THE Pretty_Printer SHALL format a parsed structure back into a Command_Line, adding quotes around any argument that contains whitespace, `|` or `>`, and around any argument that was quoted in the source and contains `*` or begins with `~`.
9. FOR ALL valid parsed structures, parsing, then printing, then parsing SHALL produce a structure equal to the first parse (round-trip property), including structures that contain globs and `~` words.
10. WHEN an unquoted word contains `*`, THE Shell SHALL expand it at execution time to the matching paths, where `*` matches any run of characters within one path segment, a name beginning with `.` matches only when the pattern also begins with `.`, the expanded paths are in ascending byte order, and the word stays literal when no path matches (D-93).
11. WHEN a quoted word contains `*`, THE Shell SHALL keep the word literal and SHALL NOT expand it (D-93).
12. WHEN an unquoted word is `~` or begins with `~/`, THE Shell SHALL expand the leading `~` to `/srv/juice-shop` at execution time (D-93).
13. THE Parser SHALL keep globs and `~` words unexpanded in the parsed structure, so that expansion happens only when the Shell executes the command (D-93).
14. WHEN a quoted piece and an unquoted piece of a Command_Line touch without whitespace, THE Parser SHALL join them into one word, and THE Parser SHALL treat every character inside single or double quotes, including `$` and `\`, as literal, with no backslash escape sequences anywhere (D-104).
15. WHEN the target of a redirection contains `*` or begins with `~/`, THE Shell SHALL expand only the leading `~` and SHALL NOT expand `*` in the target (D-104).
16. IF a Command_Line contains `&`, `(`, `)` or a lone `$` outside quotes, THEN THE Shell SHALL print an error indicating a syntax error with an `exitCode` of 2, run no command, and change nothing in the World (D-104).

### Requirement 4: Virtual file system and navigation

**User Story:** As a player, I want to move around a believable Linux file tree, so that the server feels real.

#### Acceptance Criteria

1. THE Virtual_FS SHALL contain the files `/var/log/nginx/access.log`, `/var/log/juice-shop/app.log` and `/srv/juice-shop/data/juiceshop.sqlite`, and the directories `/srv/juice-shop/uploads/`, `/tmp` and `/evidence`, from the start of every game session.
2. WHEN any Shell command reads `/var/log/nginx/access.log`, THE Shell SHALL supply the text returned by `Engine.accessLog()` at the moment of that read, so that two reads separated by an engine tick can return different text.
3. WHEN any Shell command reads `/var/log/juice-shop/app.log`, THE Shell SHALL supply the text returned by `Engine.appLog()` at the moment of that read, so that two reads separated by an engine tick can return different text.
4. WHEN `ls` lists `/srv/juice-shop/uploads/`, THE Shell SHALL list exactly the entries whose paths are returned by `Engine.files()` and lie directly in that directory, and no other entries.
5. WHEN `ls` lists `/evidence`, THE Shell SHALL list every snapshot name returned by `Engine.evidence()` as `<name>.tgz` plus every file the player has written there, with no duplicate names (D-101).
6. THE Shell SHALL keep a current working directory, starting at `/srv/juice-shop` at the start of every game session (D-94).
7. WHEN `cd <path>` names an existing directory, THE Shell SHALL change the working directory to that directory, and WHEN `pwd` runs, THE Shell SHALL print the absolute path of the working directory.
8. IF `cd` or any other command names a path that does not exist, THEN THE Shell SHALL print `<path>: No such file or directory`, where `<path>` is the path exactly as the player typed it, and leave the working directory and the Virtual_FS unchanged.
9. WHEN a path is relative, THE Shell SHALL resolve it against the working directory, including `.` and `..` segments, and WHEN `..` is applied at `/`, THE Shell SHALL stay at `/`.
10. WHEN `mkdir <dir>` names a directory that does not yet exist in the Writable_Area, THE Shell SHALL create it.
11. WHEN `cp <src> <dst>` names a readable source and a destination in the Writable_Area, THE Shell SHALL copy the content so that reading `<dst>` returns content byte-identical to `<src>` at the time of the copy.
12. IF `mkdir`, `cp` or a redirection targets a path outside `/tmp` and `/evidence`, THEN THE Shell SHALL print `Permission denied` and change nothing in the Virtual_FS, including when the path lies in `uploads/`; `rm` is the only command that may change `uploads/` (D-90).
13. IF `cd <path>` names an existing path that is a file, THEN THE Shell SHALL print `<path>: Not a directory` and leave the working directory unchanged.
14. IF `mkdir <dir>` names a path that already exists, THEN THE Shell SHALL print `<dir>: File exists` and leave the Virtual_FS unchanged.
15. WHEN `cat`, `head`, `tail`, `grep`, `cp`, `tar`, `sha256sum` or `file` reads `/srv/juice-shop/data/juiceshop.sqlite`, THE Shell SHALL supply the bytes of `Engine.db()`'s database as exported at that moment, SHALL send no DEF-02 action for that raw read, and, for `cat`, `head`, `tail` and `grep`, SHALL print the bytes decoded as text (D-102).
16. IF `rm`, `cp` (as destination) or a redirection targets `/srv/juice-shop/data/juiceshop.sqlite`, THEN THE Shell SHALL print `Permission denied` and change nothing (D-102).
17. IF `rm`, `cp` (as destination) or a redirection targets a file in `/evidence` that corresponds to an entry of `Engine.evidence()`, THEN THE Shell SHALL print `Operation not permitted`, call `Engine.act` zero times, and change nothing (D-101).
18. WHEN `/evidence/<name>.tgz` corresponds to an Engine evidence entry that the Shell did not create, THE Shell SHALL list it, read it, and hash it using content synthesized from the first `accessLines` and `appLines` lines of the logs recorded in that entry (D-101).
19. WHEN `mkdir -p <dir>` runs in the Writable_Area, THE Shell SHALL create the directory and any missing parent directories in the Writable_Area, and SHALL print nothing when the directory already exists (D-107).
20. WHEN `Engine.files()` returns a file whose `contentBase64` is absent, THE Shell SHALL list it with its recorded size, print its recorded `sha256` for `sha256sum`, and print `Input/output error` when a command reads its bytes (D-100).

### Requirement 5: File and text commands

**User Story:** As a responder, I want the usual read and filter commands, so that I can investigate logs and files (DEF-01, DEF-03).

#### Acceptance Criteria

1. WHEN `ls [<path>...]` runs, THE Shell SHALL support the flags `-l`, `-a` and `-la`, and print the entries of each directory in ascending byte order of name, one entry per line.
2. WHEN `ls` runs without `-a`, THE Shell SHALL omit entries whose names begin with `.`.
3. WHEN `ls -l` runs, THE Shell SHALL print one line per entry that shows the entry type, size in bytes and name.
4. WHEN `cat <file>...` runs, THE Shell SHALL print the content of each file in the order given, with no separator inserted between files.
5. WHEN `head` or `tail` runs, THE Shell SHALL support `-n <count>` and `-<count>`, where `<count>` is an integer from 0 to 2,147,483,647, default to 10 lines, and read from the named file or from standard input when no file is named.
6. WHEN `head` or `tail` runs on input with fewer lines than `<count>`, THE Shell SHALL print all of the lines.
7. WHEN `grep <pattern> [<file>...]` runs, THE Shell SHALL support the flags `-i`, `-v`, `-c`, `-n`, `-E` and `-e`, and read from the named files or from standard input when no file is named. Without `-E`, the pattern is a basic regular expression in which `. * ^ $ [ ]` are special and `+ ? | ( ) { }` are literal; with `-E` those characters are special (D-105).
8. WHEN `grep` runs and no line matches, THE Shell SHALL print no matching lines (or `0` with `-c`) and finish with an `exitCode` of 1.
9. WHEN `awk` runs, THE Shell SHALL support the form `awk [-F<sep>] '[/regex/] {print <expr>[, <expr>...]}'`, where each `<expr>` is one of `$0` (the whole line), `$N` (N an integer from 1 to 99), `$NF` (the last field) or `NR` (the line number), joining several expressions with one space and splitting fields on runs of whitespace when `-F` is absent; the `/regex/` is an extended regular expression (D-96, D-105).
10. WHEN `awk` runs and a requested field does not exist on a line, THE Shell SHALL print an empty string in place of that field, so that a line whose fields are all missing prints an empty line.
11. WHEN `sort` runs, THE Shell SHALL support `-r`, `-n` and `-k <field>`, where `<field>` is an integer from 1 to 99 and fields are split on runs of whitespace, and read from the named files or from standard input.
12. WHEN `uniq` runs, THE Shell SHALL support `-c`, collapse adjacent identical lines only, and with `-c` prefix each output line with its repeat count.
13. WHEN `wc` runs, THE Shell SHALL support `-l`, `-w` and `-c`, and print the count for the selected flag, or lines, words and bytes in that order when no flag is given.
14. WHEN `cut` runs, THE Shell SHALL support `-d <sep>` with `-f <list>`, where `<sep>` is a single character and `<list>` is comma-separated field numbers from 1 to 99.
15. WHEN `file <path>` runs, THE Shell SHALL print the path followed by a file type description derived from the file's name and content.
16. WHEN `sha256sum <path>` runs, THE Shell SHALL print the 64-character lowercase hexadecimal SHA-256 digest of the file content, two spaces, then the path.
17. THE `sha256sum` command SHALL return the same digest for the same content on every call.
18. IF a command named in this requirement is given a path that does not exist or is a directory where a file is required, THEN THE Shell SHALL print one error line naming the path and the reason, leave all files unchanged, continue processing any remaining paths, and finish with an `exitCode` of 1.
19. IF a command named in this requirement is given a flag that is not in that command's supported list, THEN THE Shell SHALL print one usage or error line naming the unsupported flag, produce no other output from that command, and finish with an `exitCode` of 1.
20. IF `awk` is given a program that is not of the form defined in criterion 9, THEN THE Shell SHALL print `awk: unsupported program` and finish with an `exitCode` of 1 (D-96).
21. IF a `grep` pattern or an `awk` regex is longer than 256 characters, uses a back-reference, quantifies a group that itself contains a quantifier, or has a counted repeat above 255, THEN THE Shell SHALL print `<command>: unsupported pattern`, read no input, and finish with an `exitCode` of 1 (D-105).
22. WHEN `file`, `sha256sum` or `cp` runs, THE Shell SHALL accept no flags, and WHEN `cp` runs, THE Shell SHALL require exactly two operands, so that any flag is an unsupported flag as defined in criterion 19 (D-107).

### Requirement 6: Investigation commands (DEF-01 to DEF-04)

**User Story:** As a responder, I want to search logs, inspect accounts and files, and look up an IP, so that I can find what Death did.

#### Acceptance Criteria

1. WHEN `grep`, `tail`, `awk`, `sort` or `uniq` runs on `/var/log/nginx/access.log` or `/var/log/juice-shop/app.log`, THE Shell SHALL operate on the text returned by `Engine.accessLog()` or `Engine.appLog()` without filtering it, because the Engine appends a line to its logs only when that line is due; therefore every line the Shell reads has a recorded time at or before the Engine's current game time, and an empty log is an empty file. The Shell test suite SHALL keep this guarantee as a test: no rendered nginx line is stamped later than the game time. The DEF-01 action for such a read is defined in Requirement 14.5, once per Command_Line however many commands read a log.
2. WHEN `ls -la`, `cat`, `file` or `sha256sum` runs in `/srv/juice-shop/uploads`, THE Shell SHALL show each planted file with the exact file name and byte-for-byte content defined in the scenario data, and `sha256sum` SHALL print the SHA-256 digest of that content. The DEF-03 action for such a read is defined in Requirement 14.5, once per Command_Line however many commands read `uploads/`.
3. WHEN `whois <ip>` runs with a valid IPv4 address, THE Shell SHALL print owner text and an ASN for the address, SHALL call `Engine.act` exactly once with `{ type: 'DEF-04', ip, mode: 'passive' }`, and SHALL NOT raise a Tip_Off.
4. WHEN `ping`, `nmap` or `curl` runs with a valid IPv4 target, THE Shell SHALL call `Engine.act` exactly once with `{ type: 'DEF-04', ip, mode: 'active' }`, SHALL print output in the format of the real tool that contains the target address, and SHALL leave the Tip_Off decision to the Engine (D-91, KI-90).
5. WHEN `ping`, `nmap` or `curl` runs with a valid hostname (for example `localhost`), THE Shell SHALL print output in the format of the real tool that contains the target, and SHALL NOT call `Engine.act` (D-91).
6. WHILE `world.nginx` is `running`, THE Shell SHALL list sockets for both nginx and Juice Shop when `ss` runs.
7. WHILE `world.nginx` is not `running`, THE Shell SHALL list sockets for Juice Shop only, with no nginx socket, when `ss` runs.
8. IF `whois`, `ping`, `nmap` or `curl` receives no target, an IPv4 address that is not four dot-separated decimal octets each 0 to 255, or a host that is not a valid hostname, THEN THE Shell SHALL print a usage error naming the command, SHALL call `Engine.act` zero times, and SHALL leave the world state unchanged.
9. WHEN `ping -c <count>` runs with a count from 1 to 20, THE Shell SHALL print that many replies, and WHEN `ping` runs without `-c`, THE Shell SHALL print 4 replies; IF the count is outside 1 to 20, THEN THE Shell SHALL print a usage error and call `Engine.act` zero times (D-107).
10. THE Shell SHALL accept `nmap -p <ports>` and `-sV`, `curl -I` and `-s`, and `ss -t`, `-l` and `-n` (alone or bundled), and no other flags for `ping`, `nmap`, `curl`, `ss` and `whois` (D-107).

### Requirement 7: Database access (DEF-02, DEF-08, DEF-14)

**User Story:** As a responder, I want real SQLite on the recorded database, so that I can find rogue admins and lock or delete accounts.

#### Acceptance Criteria

1. WHEN `sqlite3 <db-path> "<sql>"` runs with a valid SELECT, THE Shell SHALL execute the SQL on the Game_DB obtained from `Engine.db()` (the database file of D-102) and print the result rows, one row per line, with columns separated by `|` and NULL values printed as an empty string.
2. WHEN the SQL is a `SELECT`, THE Shell SHALL read the Game_DB, call `Engine.act` with `{ type: 'DEF-02', sql }` (where `sql` is the first SQL text read in the Command_Line) at most once per Command_Line as defined in Requirement 14.5, and leave the Game_DB unchanged.
3. WHEN the SQL is `UPDATE Users SET deletedAt=...` and the statement's WHERE clause matches one or more accounts, THE Shell SHALL call `Engine.act` once with `{ type: 'DEF-08', email }` for each matched account whose `deletedAt` is NULL or empty before the statement, skip each matched account that already has a non-empty `deletedAt`, and use the Game_DB state returned by `Engine.db()` for all later `sqlite3` statements.
4. WHEN the SQL is `DELETE FROM Users ...` and the statement's WHERE clause matches one or more accounts, THE Shell SHALL call `Engine.act` once with `{ type: 'DEF-14', email }` for each matched account, and use the Game_DB state returned by `Engine.db()` for all later `sqlite3` statements.
5. THE Shell SHALL decide which accounts a lock or delete affects by evaluating the statement's WHERE clause (or all rows of `Users` when there is no WHERE clause) in a SELECT on the Game_DB, so that the actions match the rows SQLite would change, and SHALL send no DEF-02 action for that internal SELECT.
6. IF a write statement (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER` or `CREATE`) targets a table other than `Users`, or is an `UPDATE` on `Users` that does not set `deletedAt`, or is any other write on `Users` that is not a `DELETE`, THEN THE Shell SHALL print an error message indicating the database is read-only for that statement, call `Engine.act` zero times, and leave the Game_DB unchanged (D-92).
7. IF the SQL is invalid, THEN THE Shell SHALL print the SQLite error text, call `Engine.act` zero times, and leave the Game_DB unchanged.
8. IF the database path is not `/srv/juice-shop/data/juiceshop.sqlite`, THEN THE Shell SHALL print `unable to open database file`, call `Engine.act` zero times, and not execute the SQL.
9. IF `Engine.db()` rejects because no baseline database was supplied, THEN THE Shell SHALL print an error message indicating the database is unavailable, call `Engine.act` zero times, and not throw an exception.
10. IF a `DEF-08` or `DEF-14` action returns `ok: false`, THEN THE Shell SHALL print that action's `message`, and continue with the remaining matched accounts of the same statement.
11. WHEN every `DEF-08` or `DEF-14` action issued for a statement returns `ok: true`, or a write statement matches zero accounts, THE Shell SHALL print nothing for that statement, as `sqlite3` does after a write.
12. WHEN `sqlite3 -header <db-path> "<sql>"` runs with a valid SELECT, THE Shell SHALL print the column names, separated by `|`, as the first row, followed by the result rows as defined in criterion 1 (D-92).
13. WHEN `sqlite3 <db-path> .tables` runs, THE Shell SHALL print the names of the tables of the Game_DB in ascending order, separated by two spaces, on one line (D-92).
14. WHEN `sqlite3 <db-path> .schema [<table>]` runs, THE Shell SHALL print the CREATE statements of the named table, or of every table when no table is named, each ending with `;`, and SHALL print empty output for an unknown table (D-92).
15. IF `sqlite3` receives a dot-command other than `.tables` and `.schema`, or no SQL argument, THEN THE Shell SHALL print an error message, call `Engine.act` zero times, and finish with an `exitCode` of 1 (D-92).
16. WHEN `.tables` or `.schema` runs on the Game_DB, THE Shell SHALL count it as a DEF-02 read, sent at most once per Command_Line, as defined in Requirement 14.5 (D-98).
17. WHEN the SQL argument holds several statements separated by `;` outside quotes, comments and parentheses, THE Shell SHALL run them in order and, IF a statement fails or is refused, THEN THE Shell SHALL print its error and skip the remaining statements (D-103).
18. THE Shell SHALL treat as read statements only `SELECT`, `WITH` without a write keyword, `VALUES`, and `PRAGMA table_info`, `table_xinfo`, `index_list`, `foreign_key_list` and `database_list` (D-103).
19. THE Shell SHALL recognise a write only in the forms `UPDATE Users SET deletedAt = <expr> [WHERE <w>]` and `DELETE FROM Users [WHERE <w>]`, and IF the statement has `OR`, `RETURNING`, `ORDER BY`, `LIMIT`, `FROM`, a second assigned column or an alias, THEN THE Shell SHALL print `Error: attempt to write a readonly database` and call `Engine.act` zero times (D-103).
20. IF the `<expr>` of an `UPDATE Users SET deletedAt` evaluates to NULL or an empty string for a matched row, THEN THE Shell SHALL print `Error: attempt to write a readonly database` and call `Engine.act` zero times, because no action unlocks an account (D-103).
21. IF the SQL is invalid, THEN THE Shell SHALL print `Error: <SQLite message>`; IF `Engine.db()` rejects, THEN THE Shell SHALL print `Error: database is unavailable` (D-103).

### Requirement 8: Evidence snapshot (DEF-05)

**User Story:** As a responder, I want to archive logs before I change anything, so that evidence is preserved and graded.

#### Acceptance Criteria

1. WHEN `tar` runs with `czf /evidence/<name>.tgz <path>...` with 1 to 16 source paths, every source path exists, and `<name>` is 1 to 64 characters from letters, digits, `.`, `_` and `-` (D-101), THE Shell SHALL call `Engine.act` exactly once with `{ type: 'DEF-05', name }`, and WHEN the Engine returns `ok: true`, THE Shell SHALL create `/evidence/<name>.tgz` in the Virtual_FS containing every source path (directories included recursively) and print nothing to stdout.
2. WHEN `tar` runs with `tzf <archive>` on an archive the Shell created, THE Shell SHALL print one archived path per line as defined in criterion 13, and finish with an `exitCode` of 0.
3. IF any `tar czf` source path does not exist, THEN THE Shell SHALL print one line holding `No such file or directory` and the first missing path, in the form `tar: <path>: No such file or directory`, finish with an `exitCode` of 1, call no action, and create no archive.
4. IF the archive path of `tar czf` is under `/tmp`, THEN THE Shell SHALL create the archive there without calling `DEF-05` (D-90).
5. IF the archive path of `tar czf` is outside `/evidence` and `/tmp`, THEN THE Shell SHALL print `Permission denied`, create nothing, and call no action (D-90).
6. IF the Engine returns `ok: false` for DEF-05 (for example a duplicate name), THEN THE Shell SHALL print the action's `message`, finish with an `exitCode` of 1, and create no archive, leaving any existing archive of the same name unchanged.
7. WHEN `sha256sum /evidence/<name>.tgz` runs after a successful snapshot, THE Shell SHALL print 64 lowercase hexadecimal characters, two spaces, and the archive path, and the digest SHALL be identical on repeated runs and differ when the archived content differs.
8. IF `tar` receives a flag other than `c`, `z`, `t`, `f` or `v`, or does not receive exactly one of `c` or `t`, THEN THE Shell SHALL print a usage error, finish with an `exitCode` of 1, call no action, and create no archive.
9. IF `tar tzf` names a path that does not exist or is not an archive the Shell created (including evidence made outside the Shell, D-101), THEN THE Shell SHALL print an error indicating the archive cannot be read and finish with an `exitCode` of 1.
10. IF `<name>` in `czf /evidence/<name>.tgz` is empty, longer than 64 characters, or contains a character outside the allowed set, THEN THE Shell SHALL print an error indicating an invalid archive name, finish with an `exitCode` of 1, call no action, and create no archive.
11. IF the archive path of `tar czf` under `/evidence` is nested (`/evidence/<dir>/<name>.tgz`) or does not end in `.tgz`, THEN THE Shell SHALL print an error indicating an invalid archive name, finish with an `exitCode` of 1, call no action, and create no archive (D-101).
12. THE Shell SHALL represent an archive as a deterministic byte string that starts with the gzip magic `1f 8b 08 00` followed by a canonical record of each entry (path, type, length, bytes), so that `file` reports `gzip compressed data` and `sha256sum` hashes those bytes (D-109).
13. WHEN `tar tzf` lists an archive, THE Shell SHALL print each source path in the order given to `czf`, each followed by its descendants in ascending order, with directories ending in `/` and the leading `/` removed (D-109).

### Requirement 9: Firewall (DEF-06)

**User Story:** As a responder, I want `iptables` to block and unblock an IP, so that I can cut a thread of the attack (and feel the cost).

#### Acceptance Criteria

1. WHEN `iptables -A INPUT -s <ip> -j DROP` runs, where `<ip>` is an IPv4 address of four decimal octets from 0 to 255 separated by dots, THE Shell SHALL call `Engine.act` exactly once with `{ type: 'DEF-06', op: 'add', ip }`.
2. WHEN `iptables -D INPUT -s <ip> -j DROP` runs, where `<ip>` is an IPv4 address of four decimal octets from 0 to 255 separated by dots, THE Shell SHALL call `Engine.act` exactly once with `{ type: 'DEF-06', op: 'delete', ip }` (D-99).
3. WHEN `iptables -L` runs, THE Shell SHALL call no action and print one header line for the INPUT chain (`Chain INPUT (policy ACCEPT)`) followed by one DROP rule line for each entry in `world.firewall.blocked`, in blocking order (earliest blocked first), with no rule lines when `world.firewall.blocked` is empty, and SHALL omit the column-title line that the real tool prints.
4. IF a `DEF-06` action returns `ok: false`, THEN THE Shell SHALL print the action's `message` and no other output, and the next `iptables -L` listing SHALL be identical to the listing before the failed command.
5. WHEN a `DEF-06` action returns `ok: true`, THE Shell SHALL print nothing (zero characters on standard output and standard error), as `iptables` does after a change.
6. IF the arguments of `iptables` do not match one of the three forms above (including a missing, extra or unknown argument, or an `<ip>` that is not a valid IPv4 address as defined in criteria 1 and 2), THEN THE Shell SHALL print a usage error and call no action.
7. FOR ALL sequences of a valid add (`-A`) followed by a valid delete (`-D`, op `'delete'`) on the same IP, where both actions return `ok: true`, THE `iptables -L` listing after the delete SHALL equal the listing before the add (round-trip property).

### Requirement 10: Service control (DEF-11, DEF-18, D-22, D-97)

**User Story:** As a responder, I want `systemctl` to stop and start nginx, so that I can pull the plug and bring service back.

#### Acceptance Criteria

1. WHEN `systemctl stop nginx` runs, THE Shell SHALL call `Engine.act` exactly once with `{ type: 'DEF-11' }`.
2. WHEN `systemctl start nginx` runs, THE Shell SHALL call `Engine.act` exactly once with `{ type: 'DEF-18', what: 'nginx' }`.
3. WHEN `systemctl restart nginx` runs, THE Shell SHALL always attempt the stop and then the start: it calls `Engine.act` with `{ type: 'DEF-11' }` and then, whatever that call returns, with `{ type: 'DEF-18', what: 'nginx' }`, in that order and with no other Engine actions, producing the same heartbeat effects as the two separate commands (D-22, D-97).
4. WHILE `world.nginx` is `stopped`, WHEN `systemctl restart nginx` runs, THE Shell SHALL attempt the `stop`, print the `message` of its `ok: false` result, and still attempt the `start` (D-97).
5. WHILE `world.nginx` is `running`, WHEN `systemctl status nginx` runs, THE Shell SHALL print `active (running)` and call no action.
6. WHILE `world.nginx` is `stopped`, WHEN `systemctl status nginx` runs, THE Shell SHALL print `inactive (dead)` and call no action.
7. WHEN an action called by `systemctl` returns `ok: false`, THE Shell SHALL print that action's `message` and leave `world` as the Engine left it.
8. WHEN every action called by a `systemctl stop`, `start` or `restart` command returns `ok: true`, THE Shell SHALL print no output for that command.
9. IF `systemctl` receives no verb, or a verb other than `status`, `stop`, `start` or `restart`, THEN THE Shell SHALL print a usage error and call no action.
10. IF `systemctl` receives a valid verb and no unit name, THEN THE Shell SHALL print a usage error and call no action.
11. IF `systemctl` names a unit other than `nginx`, THEN THE Shell SHALL print `Unit <name>.service could not be found.` and call no action (D-97).

### Requirement 11: File removal (DEF-15)

**User Story:** As a responder, I want to delete a planted file, so that the foothold is removed.

#### Acceptance Criteria

1. WHEN `rm <path>` names an existing Uploaded_File, THE Shell SHALL resolve `<path>` against the current working directory to an absolute path under `/srv/juice-shop/uploads/` and call `Engine.act` exactly once with `{ type: 'DEF-15', path }`, where `path` is that absolute path with the prefix `/srv/juice-shop/uploads/` removed (the form `Engine.files()` and the Engine match, for example `complaints/rip.php`), and no other action (D-100). The path of a DEF-03 action stays absolute (Requirement 14.5).
2. WHEN `rm <path>` names an existing file in the Writable_Area, THE Shell SHALL remove it from the Virtual_FS, call `Engine.act` zero times, and print nothing.
3. IF `rm` names an existing directory without `-r`, THEN THE Shell SHALL print `cannot remove '<path>': Is a directory` and leave the Virtual_FS unchanged.
4. IF `rm` names a path that does not exist, THEN THE Shell SHALL print `cannot remove '<path>': No such file or directory`, call `Engine.act` zero times, and leave the Virtual_FS unchanged.
5. WHEN a `DEF-15` action returns `ok: false`, THE Shell SHALL print the action's `message` and leave the file listed by `ls`; the `path` sent to the Engine is the path relative to `/srv/juice-shop/uploads/` as defined in criterion 1 (D-100).
6. IF `rm` names a log file, the database file, or any path outside both the Writable_Area and `uploads/`, THEN THE Shell SHALL print `Permission denied`, call `Engine.act` zero times, and leave the Virtual_FS unchanged. `rm` is the only command allowed to change `uploads/` (D-90).
7. WHEN a `DEF-15` action returns `ok: true`, THE Shell SHALL make every later `ls` of `uploads/` omit that file, starting with the next `ls` call.
8. WHEN `rm -r <path>` names an existing directory in the Writable_Area, THE Shell SHALL remove the directory and all its contents from the Virtual_FS and call `Engine.act` zero times.
9. IF `rm` is given no path operand, THEN THE Shell SHALL print `missing operand`, call `Engine.act` zero times, and leave the Virtual_FS unchanged.
10. WHEN `rm -r <dir>` names an existing directory inside `uploads/`, THE Shell SHALL call `Engine.act` once with `{ type: 'DEF-15', path }` for each file beneath that directory, in ascending path order, continue after an `ok: false` answer, and let the directory disappear when its last file is removed (D-108).
11. WHEN `rm` is given several operands (including an expanded glob), THE Shell SHALL handle them left to right, call `Engine.act` once per Uploaded_File, and finish with an `exitCode` of 1 if any operand failed (D-108).
12. IF `rm` names an Engine evidence file under `/evidence`, THEN THE Shell SHALL print `Operation not permitted`, call `Engine.act` zero times, and leave the Virtual_FS unchanged (D-101).
13. THE Shell SHALL accept `-r` as the only flag of `rm` (no `-f`, no `-R`) (D-107, D-108).

### Requirement 12: Session helpers

**User Story:** As a player, I want `date`, `history`, `clear`, `help` and `man`, so that the terminal behaves like one.

#### Acceptance Criteria

1. WHEN `date` runs with no arguments, THE Shell SHALL print one line holding the in-game time derived from `world.clock.gameMs`, and the output SHALL be identical on every call that sees the same `world.clock.gameMs`, regardless of the machine's real time.
2. WHEN `history` runs with no arguments, THE Shell SHALL print the Command_Lines entered in the current session, one per line, numbered from 1 in the order entered, with the `history` Command_Line itself as the last entry.
3. WHEN more than 500 Command_Lines have been entered, THE Shell SHALL keep only the most recent 500 for `history`, and numbering SHALL continue from the session's running count rather than restarting at 1.
4. WHEN `clear` runs, THE Shell SHALL resolve with `{ output: '', exitCode: 0, clear: true }` (D-95).
5. WHEN `help` runs with no arguments, THE Shell SHALL print one line for each name in the Command_List, in alphabetical order, each holding the command name and a description of at most 80 characters.
6. WHEN `man <command>` runs for a command in the Command_List, THE Shell SHALL print that command's supported flags, each with a one-line description, and at least one example Command_Line.
7. IF `man` names a command outside the Command_List, THEN THE Shell SHALL print `No manual entry for <name>`, return a non-zero `exitCode` of 1, and leave the session state unchanged.
8. IF `man` runs with no argument, THEN THE Shell SHALL print a usage line for `man`, return a non-zero `exitCode` of 1, and leave the session state unchanged.
9. IF `date`, `history`, `clear` or `help` runs with an argument or flag that the command's per-command data does not list (`whois`, `date`, `history` and `help` list none, D-107), THEN THE Shell SHALL print an error line naming the unsupported argument, return a non-zero `exitCode` of 1, and leave the session state unchanged.
10. THE text printed by `help` and `man` SHALL be generated from the same per-command data that the Shell uses to validate flags, so that the documentation cannot list an unsupported flag.

### Requirement 13: Autocomplete (Easy only)

**User Story:** As an Easy-level player, I want tab suggestions, so that I can find commands and paths.

#### Acceptance Criteria

1. WHEN `complete(partial)` is called and `partial` contains no space character, THE Shell SHALL return an array of every Command_List name that starts with `partial`, matched case-sensitively, in ascending code-point order with no duplicates.
2. WHEN `complete(partial)` is called and `partial` contains at least one space character, THE Shell SHALL treat the text after the last space as the path prefix and return an array of the names of the Virtual_FS entries whose names start with that prefix, matched case-sensitively, in ascending code-point order with no duplicates.
3. WHEN `complete(partial)` is called and the path prefix includes a directory part (for example `/var/log/a`), THE Shell SHALL look up entries in that directory, and WHEN the path prefix has no directory part, THE Shell SHALL look up entries in the current working directory.
4. WHEN `complete(partial)` is called and no Command_List name or Virtual_FS entry matches, THE Shell SHALL return an empty array and leave the Virtual_FS and the current working directory unchanged.
5. THE `complete` function SHALL return only names that exist in the Command_List or the Virtual_FS at the time of the call.

### Requirement 14: Time and cost

**User Story:** As a designer, I want terminal actions to cost game time only as the Engine defines, so that the Shell adds no hidden rules.

#### Acceptance Criteria

1. THE Shell SHALL change the World only through `Engine.act`, so that a World compared before and after a command differs only by changes made by `Engine.act` calls.
2. THE Shell SHALL NOT write to `world.clock` and SHALL NOT call `Engine.advance`, so that the Engine is the only source of game-time change.
3. THE Shell SHALL add no artificial delay or timer to `run`; `run` resolves when the command's own work, including awaited Engine calls such as `Engine.db()`, is done (D-99).
4. WHEN a command produces an effect described in this document, including a read described in criterion 5, THE Shell SHALL make exactly one `Engine.act` call for that effect, so that the Engine's event log shows exactly one `action` event per effect; a read effect is one per kind of resource read in the Command_Line (criterion 5).
5. THE Shell SHALL give commands no game time of their own, but each Command_Line that reads a log file, the database (`sqlite3` SELECT, `.tables`, `.schema`) or a file under `uploads/` SHALL call `Engine.act` once per kind of resource read, each at most once per Command_Line regardless of how many commands in a pipeline read that kind, at the moment the resource is first read in the line: `{ type: 'DEF-01', query: <the whole Command_Line> }` for a log, `{ type: 'DEF-02', sql: <the first SQL text read> }` for the database, and `{ type: 'DEF-03', path: <the first uploads path read, absolute> }` for `uploads/`. A Command_Line that mixes kinds SHALL send one action of each kind, so a pipeline sends at most three such actions (D-98).
6. IF an `Engine.act` call fails or is rejected, THEN THE Shell SHALL print an error message indicating the failed effect, SHALL make no further `Engine.act` calls for that command, and SHALL leave the World as the Engine left it, with no Shell-side rollback or retry.
7. WHEN a Command_Line fails before reading anything, an unknown command runs, a command is rejected for invalid arguments, or a Command_Line runs only read-only commands that read no log, database or `uploads/` resource, THE Shell SHALL make zero `Engine.act` calls for the line; `tar czf` SHALL send DEF-05 only, and `cp` from `uploads/` SHALL send DEF-03 (D-98).

### Requirement 15: Robustness (property-based)

**User Story:** As a developer, I want proof that no input crashes the shell, so that the terminal never freezes the game.

#### Acceptance Criteria

1. FOR ALL random strings of 0 to 500 characters, including control characters, unicode, whitespace-only input and unbalanced quotes, over at least 200 generated cases per property, `run` SHALL resolve within 5,000 ms with an Output and never reject or throw (fast-check property, KDEV-04; D-99).
2. FOR ALL random sequences of Command_Lines built from the Command_List and random flags and arguments, over at least 200 generated sequences, each of 1 to 20 Command_Lines, `run` SHALL resolve each Command_Line within 5,000 ms without throwing.
3. FOR ALL random strings that are non-empty after trimming whitespace and whose first token is not a Command_List name, THE Output SHALL contain `command not found` or a syntax error message.
4. IF an internal error occurs while a command runs, THEN THE Shell SHALL print one generic error line for that command, SHALL NOT print a stack trace or internal error detail, SHALL resolve `run` normally, and SHALL leave the World deeply equal to its state before that command, provided the error is raised before the first `Engine.act` call of the command; THE Shell cannot undo an action already sent to the Engine, and SHALL NOT retry or roll back (R14.6).
5. FOR ALL random Command_Lines that contain no write command (`iptables -A` or `-D`, `systemctl stop`, `start` or `restart`, `rm`, `tar czf`, `sqlite3` UPDATE or DELETE, `whois`, `ping`, `nmap`, `curl`), THE World SHALL remain deeply equal to its state before the call, except for the DEF-01, DEF-02 and DEF-03 `action` events that Requirement 14.5 requires (at most one of each kind per Command_Line).
6. FOR ALL valid Command_Lines run twice with the same World, same Virtual_FS and same history, THE Output SHALL be identical (determinism property, excluding `date` and `history`, and excluding any output of the `deletedAt` of a locked account, whose value uses the real clock until KI-91 is fixed).
7. WHEN the Shell runs with a given Engine seed, THE Shell SHALL use no source of randomness other than that seed, so that two runs with the same seed and the same Command_Lines produce identical Outputs and the property tests pass with the platform's random number generator replaced by a function that throws.

### Requirement 16: Test coverage and health

**User Story:** As a maintainer, I want per-command tests and a green health check, so that the shell stays correct as the game changes.

#### Acceptance Criteria

1. THE Shell test suite SHALL contain, for each command in the Shell's exported command list, at least one test for each supported flag listed in this document and in the registry of per-command flags (D-107), and at least one test that passes an unsupported flag and asserts the Shell's documented unsupported-flag error indication.
2. THE Shell test suite SHALL contain at least one test for each of the 15 rows of the command-to-action table, and each test SHALL assert the resulting Engine action or World state change: `iptables -A`, `-D`, `-L` (DEF-06); `systemctl stop`, `start`, `restart`, `status` (DEF-11, DEF-18); `rm` of an Uploaded_File (DEF-15); `tar czf` (DEF-05); `sqlite3` UPDATE and DELETE (DEF-08, DEF-14); `whois` (DEF-04 passive); `ping`, `nmap` and `curl` (DEF-04 active). THE Shell test suite SHALL also contain tests for the three read actions DEF-01, DEF-02 and DEF-03, including a pipeline of two log readers that sends exactly one DEF-01 and a line mixing a log and `uploads/` that sends one DEF-01 and one DEF-03, and for `clear`, `exitCode`, globs and `~`, `sqlite3 .tables`, `sqlite3 .schema` and `sqlite3 -header`.
3. THE Shell test suite SHALL include the fast-check properties of Requirements 3, 9 and 15, and each property SHALL run at least 100 iterations.
4. IF any fast-check property fails on any iteration, THEN THE Shell test suite SHALL report the failing test and the failing input, and `npm test` SHALL exit with a non-zero code.
5. WHEN `npm test` runs in `game/`, THE Shell test suite SHALL execute under Vitest and exit with code 0 only if every test passes.
6. WHEN `npm run health` runs in `game/`, THE Shell code and tests SHALL pass lint with zero errors, type-check with zero errors and tests with zero failures, and `npm run health` SHALL exit with a non-zero code if any of the three fails.
7. THE Shell tests SHALL run the Engine with a seeded World and a committed baseline database, and SHALL open zero network connections and send zero real attack traffic.

## Decisions Applied

Every earlier open question is answered; each answer is recorded in `docs/DECISIONS.md`.

- Tar targets outside `/evidence` -> D-90
- Writing to `uploads/` -> D-90
- Which `ping`/`nmap`/`curl` targets send DEF-04 -> D-91
- Other SQL writes -> D-92
- `sqlite3` flags and dot-commands -> D-92
- Syntax outside the PRD (`>>`, `<`, `2>`, `$VAR`, globs, `~`, `;`) -> D-93
- Medium and Hard completion -> D-94
- Initial directory -> D-94
- Command-not-found text -> D-94
- `clear` signal -> D-95
- Exit status -> D-95
- `awk` subset -> D-96
- Restart on a stopped service -> D-97
- Other units -> D-97
- Time cost of commands and DEF-01 to DEF-03 calls -> D-98
- Real-time limit on `run`, robustness property size, DEF-06 `delete` op -> D-99
- `awk` print list (`{print $1, $7}`) -> D-96
- One action per resource kind for a pipeline that reads several sources -> D-98
- Tip-off on harmless IPs -> KI-90 (stays open for the Engine team; the Shell keeps sending DEF-04 active, D-91)
- `locked account deletedAt` uses the real clock -> KI-91 (stays open for the Engine team; Shell determinism tests avoid printing it)
- DEF-15 path form, file with no recorded bytes -> D-100
- Evidence naming and immutability -> D-101
- The database file as a file -> D-102
- SQL execution rules -> D-103
- Quoting grammar -> D-104
- Regex dialect and pattern guard -> D-105
- Output markup and control characters -> D-106
- Flags for commands with no listed flags -> D-107
- `rm -r` in `uploads/` and several operands -> D-108
- Archive format and `tar tzf` -> D-109

All shell decisions D-100 to D-109 are accepted and recorded in `docs/DECISIONS.md`.

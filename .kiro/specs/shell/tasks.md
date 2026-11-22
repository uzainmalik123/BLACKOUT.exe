# Implementation Plan: Shell (PRD SYS-09)

## Overview

The Shell is built in `game/src/shell/` in TypeScript (the design is in TypeScript, so no language question applies). The plan has two parts with a checkpoint between them.

- **Part (a), the MVP (tasks 1 to 13):** scaffolding, parser and printer, expansion, VFS reads, session/tracker/exec/`createShell`/`run`, then `cd ls pwd`, the text commands, `iptables`, `systemctl`, `sqlite3` (reads, then lock and delete), and `rm` with DEF-15. Checkpoint (a) proves the shell runs an investigation-and-containment session end to end.
- **Part (b) (tasks 14 to 23):** archive format, VFS writes and redirection, `tar`, `cp mkdir file sha256sum`, the network tools, session commands, `complete`, the remaining properties, the R16 coverage test, docs, and a final checkpoint.

Build only what has a requirement row. Shell commands, handlers and tests may assume only the 31 commands in `.kiro/steering/game-shell.md`. All paths below are under `game/src/shell/` unless they start with `docs/`.

Rules that apply to every task:

- Every top-level task ends with a sub-task "Run `npm run health` in `game/` and fix until green" (CI relies on it; `AGENTS.md`).
- Every test that builds an Engine, runs `Engine.db()` or runs a whole-run sim passes an explicit `30_000` ms timeout (KI-81). This includes property tests (`it(name, fn, 30_000)`).
- `numRuns`: properties whose generated cases build an Engine with the database or call `Engine.db()` use `numRuns: 50`. Pure properties (no Engine) keep the design's 200. Properties on an Engine without a database keep the design's floor of 100. Property 5 has a 200-run variant on an Engine without a baseline and a 50-run variant with the baseline.
- Each property-based test is its own optional sub-task (`*`), named `Property N: <title>`, tagged `// Feature: shell, Property N: <title>`, with `Validates: Requirements X.Y` from the design's Correctness Properties.
- Fixtures reuse `game/src/engine/test-fixtures/` (baseline loading, planting, replay helpers). Tests open no network connection (R16.7).
- Outputs in tests never print the `deletedAt` of a locked account (KI-91).

## Tasks

- [ ] 1. Scaffolding: types, path, text, output, sha256, registry skeleton, fixtures
  - [ ] 1.1 Create `types.ts`, `path.ts`, `text.ts` and `output.ts`
    - `types.ts`: `Shell`, `RunResult`, `Word`, `Stage`, `Pipeline`, `CommandSpec`, `FlagSpec`, `CommandContext`, `CommandResult`, `Handler`, `DeepReadonly<World>` alias, `Overlay` types, `VfsLister`, `ReadSink`.
    - `path.ts`: `resolvePath` (`.`, `..`, `..` at `/` stays at `/`, trailing `/` removed), `dirname`, `basename`, `byteCompare`.
    - `text.ts`: `splitLines`, `joinLines`, `decodeUtf8`, `encodeUtf8`, `compareCodePoints` (no locale APIs).
    - `output.ts`: `sanitize` (caret notation for control characters except `\n` and `\t`, and U+007F), `finish` (drop one final `\n`), `ok`, `fail`, `usage`, `notFound`, and the message catalog strings.
    - _Requirements: 1.4, 4.8, 4.9, 15.7_
    - _Design: Components and Interfaces (public surface, VFS path handling), Error Handling (message catalog), D-106_
  - [ ] 1.2 Create `sha256.ts`
    - Synchronous `sha256Hex(bytes: Uint8Array): string`, lowercase hex, no dependency.
    - _Requirements: 5.16, 5.17_
    - _Design: Design decisions summary (SHA-256)_
  - [ ] 1.3 Create the registry skeleton, `argparse.ts` and the `index.ts` exports
    - `registry.ts`: `COMMAND_NAMES` as a `const` tuple of the full 31 names in the steering order; `COMMANDS satisfies Record<CommandName, CommandSpec>` with the per-command `summary`, `usage`, `flags` (D-107 list), `forms`, `examples`, `operands`, `readsStdin` and a placeholder handler that returns a fixed "not implemented" failure until its task replaces it.
    - `argparse.ts`: `parseArgs(spec, argv)` (bundled short flags, whole-token multi-letter flags such as `-header`, attached or separate values, `--`, `-<digits>` when `numericCount`) and `parseForms(forms, argv)`. The unsupported-flag error is `<cmd>: unsupported flag '<flag>'` plus the usage line.
    - `index.ts`: export `COMMAND_LIST` (equal to `COMMAND_NAMES`) and the types.
    - _Requirements: 2.1, 5.19, 5.22, 12.10_
    - _Design: Registry (registry.ts, argparse.ts) and R12.10, D-107_
  - [ ] 1.4 Create the test fixtures
    - `test-fixtures/fixture.ts`: `makeFixture(opts)` builds an `Engine` with `new Engine({ seed, difficulty, baseline })` (baseline read once at module scope from the committed `recordings/juiceshop.sqlite`), exposes `actions()`, `actsOfType()`, `worldWithoutReads()` and `internalErrors`. The `shell` field is wired in task 5.4.
    - `test-fixtures/generators.ts`: the shared `fc` arbitraries that later tasks fill in (start with `arbWord`, `arbLines`).
    - Reuse the Engine's fixtures; copy nothing.
    - _Requirements: 16.7_
    - _Design: Testing Strategy (fixtures and generators)_
  - [ ] 1.5 Write example tests for the scaffolding helpers
    - `path.test.ts` (resolve, `..` at `/`, trailing slash), `text.test.ts` (split/join, code-point order), `output.test.ts` (caret notation, `\n` and `\t` kept, `finish`), `sha256.test.ts` (known vectors, empty input, a 1 MB input, and a cross-check of random byte strings against `node:crypto`, with `/// <reference types="node" />`).
    - _Requirements: 1.4, 4.9, 5.16, 5.17_
    - _Design: Testing Strategy (test files table: path, sha256)_
  - [ ] 1.6 Write the registry tests
    - `registry.test.ts`: `COMMAND_LIST` is the literal 31 names with no duplicates; the steering-list test reads `.kiro/steering/game-shell.md` and fails naming each command that is in only one list (R2.6); `parseArgs` accepts every flag in each command's `flags`, rejects others, handles `-la`, `-header`, `-n 5`, `-5`, `--`.
    - _Requirements: 2.1, 2.6, 5.19_
    - _Design: Registry (registry.ts, argparse.ts), Testing Strategy (registry.test.ts)_
  - [ ] 1.7 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 2. Parser, printer and the checking function
  - [ ] 2.1 Implement `parser.ts`
    - `parseLine(line): ParseResult`, one pass with unquoted, single-quoted and double-quoted modes; `Word.literal` computed as `quotedAnywhere && (text.includes('*') || text.startsWith('~'))`; adjacent quoted and unquoted pieces join into one word; no backslash escapes; globs and `~` stay unexpanded.
    - Syntax errors (fixed `sh: syntax error: ...` messages): unterminated quote, leading, trailing or doubled `|`, `>` with no target or extra words, and, outside quotes, `;`, `&`, `&&`, `||`, `>>`, `<`, `2>`, `$`, backtick, `(`, `)`.
    - _Requirements: 3.5, 3.6, 3.7, 3.13, 3.14, 3.16, 2.7_
    - _Design: Parser (parser.ts) and Pretty_Printer (printer.ts), D-104_
  - [ ] 2.2 Implement `printer.ts`
    - `printLine(pipeline)`: a word is unquoted only if non-empty, not `literal`, and made of the safe set `A-Z a-z 0-9 _ @ % + = : , . / ~ * -`; otherwise single-quoted with `'` written as `"'"`. Stages joined by ` | `, redirect as ` > <target>`.
    - _Requirements: 3.8, 3.9_
    - _Design: Parser (parser.ts) and Pretty_Printer (printer.ts)_
  - [ ] 2.3 Implement `checkCommandLine` in `index.ts`
    - Runs `parseLine`, then checks every stage name against `COMMAND_LIST`. Needs no Engine, wrapped in `try/catch` returning `false`, never throws.
    - _Requirements: 2.2, 2.3_
    - _Design: Public surface (index.ts, types.ts)_
  - [ ] 2.4 Write parser and printer example tests
    - `parser.test.ts`: quote forms (`a"b c"d` is one word, `$` and `\` literal inside quotes), each unsupported operator inside and outside quotes, `~` and `*` kept unexpanded in the structure, redirect target rules, printer quoting of spaces, `|`, `>`, quoted `*` and quoted `~`.
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 3.13, 3.14, 3.15, 3.16_
    - _Design: Testing Strategy (parser.test.ts)_
  - [ ]* 2.5 Write property test for the parse, print, parse round trip
    - **Property 1: Parse, print, parse round trip** (`numRuns: 200`, pure, with `arbPipeline` in `generators.ts`)
    - **Validates: Requirements 3.5, 3.8, 3.9, 3.13**
  - [ ]* 2.6 Write property test for the checking function
    - **Property 3: The checking function agrees with the parser and the command list** (`numRuns: 200`, pure)
    - **Validates: Requirements 2.2, 2.3**
  - [ ] 2.7 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 3. Glob and tilde expansion
  - [ ] 3.1 Implement `expand.ts`
    - `expandTilde`, `globExpand` (segment-wise walk, `*` within one segment, leading-dot rule, results kept in the typed prefix form, sorted with `compareCodePoints`, literal word when nothing matches), `expandWord` (skips `literal` words; command name and redirect target never glob-expanded; redirect target gets `~` only). Uses a `VfsLister`, not the Engine.
    - _Requirements: 3.10, 3.11, 3.12, 3.15_
    - _Design: Expansion (expand.ts), D-93, D-104_
  - [ ] 3.2 Write expansion example tests
    - `expand.test.ts` with a fake lister: `*` matches, dot-file rule, no-match stays literal, quoted star unchanged, `~` and `~/x`, quoted `~` unchanged, redirect-target `~` only.
    - _Requirements: 3.10, 3.11, 3.12, 3.15_
    - _Design: Testing Strategy (expand.test.ts)_
  - [ ]* 3.3 Write property test for glob expansion
    - **Property 6: Glob expansion is sorted, literal when empty, and quote-aware** (`numRuns: 200`, pure, against a reference matcher)
    - **Validates: Requirements 3.10, 3.11, 3.12, 3.13**
  - [ ] 3.4 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 4. Virtual file system reads
  - [ ] 4.1 Implement the read side of `vfs.ts`
    - `VirtualFs` with `FsError`, `Stat`, `Area`; the skeleton directories; `stat`, `list` (sorted by code point), `areaOf`, `canWrite` (area rule only for now), `size`, `readBytes`, taking an optional `ReadSink`.
    - Live files computed on every call: access and app logs from `engine.accessLog()` / `appLog()` (read once per command invocation, G15); uploads derived from `engine.files()` (directories from path prefixes, base64 decode, absent `contentBase64` lists the size, `sha256sum` prints `VFile.sha256`, byte reads fail with `Input/output error`); `/evidence` listing as the union of the overlay and `<name>.tgz` for each `engine.evidence()` entry, de-duplicated; synthesized content for Engine evidence from the first `accessLines` and `appLines` log lines; the `.sqlite` file bytes from `(await engine.db()).db.export()` on demand, no DEF-02 for raw reads, `Input/output error` when `engine.db()` rejects.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.15, 4.18, 4.20, 6.1_
    - _Design: Virtual file system (vfs.ts, path.ts, archive-format.ts), Gaps G1 to G5, G15, D-100, D-101, D-102_
  - [ ] 4.2 Extend the fixtures for planted files and evidence
    - `makeFixture` options `plant`, `evidence`, `advanceMs` using a committed-scenario Engine (planting by pushing `VFile` values or `startReplay` as `actions.test.ts` does), including a planted file without `contentBase64`.
    - _Requirements: 6.2, 16.7_
    - _Design: Fixtures and generators (test-fixtures/)_
  - [ ] 4.3 Write VFS read example tests
    - `vfs.test.ts` (30_000 ms timeout where an Engine is built): initial layout (R4.1), two log reads separated by an engine advance differ and equal the Engine text, no rendered nginx line is stamped later than `gameTimeIso(world)` (R6.1), uploads listing equals `Engine.files()` direct children, evidence listing with `.tgz` names and no duplicates, synthesized evidence content, `.sqlite` bytes equal `export()`, absent `contentBase64` behavior, no baseline gives `Input/output error`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.15, 4.18, 4.20, 6.1_
    - _Design: Testing Strategy (vfs.test.ts)_
  - [ ] 4.4 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 5. Session, tracker, pipeline executor, `createShell` and `run`
  - [ ] 5.1 Implement `session.ts`
    - `Session { cwd = '/srv/juice-shop', history (last 500), runCount, overlay }`, `createSession(engine)`, the history numbering rule (`runCount - n + 1 + i`), no module-level state.
    - _Requirements: 1.5, 1.6, 4.6, 12.3_
    - _Design: Session and run queue (session.ts, index.ts)_
  - [ ] 5.2 Implement `tracker.ts`
    - `ReadTracker(engine, line)` with `log()`, `db(sql)`, `uploads(absPath)` and `sent`; each kind is marked sent before `act`; an `ok: false` answer returns a `<cmd>: <message>` notice and is not retried. `VirtualFs` read paths accept the tracker as `ReadSink`.
    - _Requirements: 14.4, 14.5, 14.6, 14.7, 7.2, 7.16_
    - _Design: Read tracking (tracker.ts) and DEF-01/02/03, D-98_
  - [ ] 5.3 Implement `exec.ts`
    - `runPipeline`: name check first (first unknown stage gives `<name>: command not found`, exit 127, nothing runs); per stage `expandWord`, `parseArgs`, handler inside the stage catch-all (`<cmd>: internal error`, hook `onInternalError`); stdout flows to the next stage; stderr of all stages shown first; exit code of the last stage; `clear` honored only for a single-stage line; `sanitize` and `finish` applied. Leave a clearly marked seam for redirection (implemented in task 14.4); until then a line with `>` runs its stages and writes nothing.
    - _Requirements: 1.8, 1.9, 1.10, 2.4, 2.5, 2.7, 3.1, 15.4_
    - _Design: Pipeline executor (exec.ts), Error Handling (strategy for run never throws)_
  - [ ] 5.4 Implement `createShell` in `index.ts` and wire the fixture
    - `createShell(engine, opts?: { onInternalError })`: the promise-chain run queue, blank line returns empty output and is not stored, history stores the unmodified line before parsing, line-level catch-all (`sh: internal error`, exit 1), `exitCode` always set, the Shell reads the Engine only through the listed members, never calls `advance`, `pause` or `resume`. Wire `makeFixture().shell` and `internalErrors`.
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.9, 1.10, 14.1, 14.2, 14.3_
    - _Design: Public surface (index.ts, types.ts), Session and run queue, Strategy for "run never throws"_
  - [ ] 5.5 Write tracker and shell example tests
    - `tracker.test.ts`: one DEF-01 / DEF-02 / DEF-03 per kind per line, the marked-before-act rule, the `ok: false` notice after an ending, no retry.
    - `shell.test.ts` (30_000 ms where an Engine is built): `exitCode` per class (127, 2), whitespace-only line, history stored for blank-free lines, `clear` not yet needed, `Engine.advance` never called, the Engine unchanged for an unknown command. The R15.4 internal-error test comes with task 7.6, when `cat` exists.
    - _Requirements: 1.5, 1.8, 1.10, 14.2, 14.4, 14.5, 14.7_
    - _Design: Testing Strategy (tracker.test.ts, shell.test.ts)_
  - [ ]* 5.6 Write property test for unlisted commands
    - **Property 4: Unlisted commands fail with 127 and change nothing** (`numRuns: 200`, one shared Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 1.8, 2.4, 2.5, 2.7, 15.3**
  - [ ]* 5.7 Write property test for unsupported syntax
    - **Property 2: Unsupported syntax runs nothing** (`numRuns: 200`, one shared Engine without baseline, 30_000 ms timeout; `arbForbiddenSyntaxLine`)
    - **Validates: Requirements 2.7, 3.6, 3.7**
  - [ ] 5.8 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 6. Navigation: `cd`, `ls`, `pwd`
  - [ ] 6.1 Implement `commands/navigation.ts`
    - `ls [-l] [-a]` (and `-la`): code-point order, `.` names hidden without `-a`, `-l` prints `<mode> <size> <name>` with no times, several operands print `path:` headings; `ls` on `uploads/` goes through `ReadTracker.uploads`, on logs sends nothing. `cd` (no argument goes to `/srv/juice-shop`; `Not a directory` for a file; `No such file or directory` with the path as typed), `pwd`. Register in `registry.ts`.
    - _Requirements: 4.6, 4.7, 4.8, 4.9, 4.13, 5.1, 5.2, 5.3, 5.18, 5.19_
    - _Design: Command groups (navigation.ts)_
  - [ ] 6.2 Write navigation example tests
    - `navigation.test.ts` (30_000 ms timeout): each flag (`-l`, `-a`, `-la`), an unsupported flag, `cd` into a file, `cd ..` at `/`, missing path leaves cwd unchanged, `ls` of uploads sends one DEF-03, `ls` of a log sends none.
    - _Requirements: 4.7, 4.8, 4.9, 4.13, 5.1, 5.2, 5.3, 5.19_
    - _Design: Testing Strategy (path.test.ts)_
  - [ ]* 6.3 Write property test for path resolution
    - **Property 7: Path resolution** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 4.6, 4.7, 4.8, 4.9, 4.13**
  - [ ] 6.4 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 7. Text commands: `cat head tail grep awk sort uniq wc cut` and `regex.ts`
  - [ ] 7.1 Implement `regex.ts`
    - `compilePattern(dialect, source, flags)`: BRE (`. * ^ $ [ ]` special; `+ ? | ( ) { }` literal) and ERE; rejects a pattern longer than 256 characters, with a back-reference, quantifying a group that holds a quantifier, or with a counted repeat above 255; `RegExp` construction wrapped so it never throws.
    - _Requirements: 5.7, 5.21_
    - _Design: Components (regex.ts), D-105_
  - [ ] 7.2 Write regex tests
    - `regex.test.ts`: BRE versus ERE specials, `-i`, each rejection rule, a catastrophic pattern such as `(a+)+` is rejected, not run.
    - _Requirements: 5.7, 5.21_
    - _Design: Testing Strategy (textproc.test.ts), D-105_
  - [ ] 7.3 Implement `cat`, `head` and `tail` in `commands/textproc.ts`
    - Read through `vfs.readBytes` with the tracker (logs DEF-01, uploads DEF-03), UTF-8 decode, `-n <count>` and `-<count>` from 0 to 2,147,483,647 with default 10, stdin when no file operand, a missing path prints one error line and processing continues with code 1. Register in `registry.ts`.
    - _Requirements: 5.4, 5.5, 5.6, 5.18, 5.19, 6.1, 6.2, 4.15_
    - _Design: Command groups (textproc.ts)_
  - [ ] 7.4 Implement `grep` and `awk` in `commands/textproc.ts`
    - `grep [-i -v -c -n -E] [-e <pattern>]... <pattern> [files]` with `name:` prefixes for several files, code 1 and `0` with `-c` on no match, `grep: unsupported pattern`. `awk [-F<sep>] '[/regex/] {print <expr>[, <expr>...]}'` with `$0`, `$N` (1 to 99), `$NF`, `NR`, empty string for a missing field, `awk: unsupported program` outside the subset. Register in `registry.ts`.
    - _Requirements: 5.7, 5.8, 5.9, 5.10, 5.20, 5.21, 5.19, 6.1_
    - _Design: Command groups (textproc.ts), D-96, D-105_
  - [ ] 7.5 Implement `sort`, `uniq`, `wc` and `cut` in `commands/textproc.ts`
    - `sort [-r -n -k N]` stable with code-point comparison, `uniq [-c]` adjacent only, `wc [-l -w -c]` (all three when no flag), `cut -d <sep> -f <list>`. Register in `registry.ts`.
    - _Requirements: 5.11, 5.12, 5.13, 5.14, 5.19, 6.1_
    - _Design: Command groups (textproc.ts)_
  - [ ] 7.6 Write text command example tests
    - `textproc.test.ts` (30_000 ms timeout): every supported flag of each of the nine commands and one unsupported-flag test each (R16.1); `awk` unsupported programs, missing fields; `sort -k`; `cut` errors; `head -5`; stdin from a pipe; missing path continues with code 1; a pipeline of two log readers sends exactly one DEF-01 and a line mixing a log and `uploads/` sends one DEF-01 and one DEF-03 (R16.2); `cat` on the `.sqlite` file prints decoded bytes with no DEF-02; the R15.4 internal-error test (inject a failing `engine.accessLog` and a failing `engine.files`, assert the generic `<cmd>: internal error` line and the World unchanged); the G15 performance check running `grep` over a whole-run access log (loop played to its end) and asserting it resolves well inside 5,000 ms.
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.18, 5.19, 5.20, 5.21, 6.1, 14.5, 15.1, 15.4, 16.1, 16.2_
    - _Design: Testing Strategy (textproc.test.ts), Gaps G15_
  - [ ]* 7.7 Write property test for pipeline composition
    - **Property 10: A pipeline equals the composition of its stages** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 3.1, 5.4**
  - [ ]* 7.8 Write property test for the text command models
    - **Property 11: Text commands match their reference models** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 5.1, 5.2, 5.5, 5.6, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14**
  - [ ]* 7.9 Write property test for `grep`
    - **Property 12: `grep` partition and exit status** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 5.7, 5.8**
  - [ ] 7.10 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 8. Firewall: `iptables`
  - [ ] 8.1 Implement `iptables` in `commands/ops.ts` and `isIPv4` in `netdata.ts`
    - `isIPv4` has the same grammar as the Engine's private `IPV4` (four decimal octets 0 to 255, no leading zeros). `forms`: `-A INPUT -s <ip> -j DROP`, `-D INPUT -s <ip> -j DROP`, `-L`; `-A` and `-D` call `act({ type: 'DEF-06', op: 'add' | 'delete', ip })` once after validating; success prints nothing, failure prints the `message` only; `-L` calls no action and prints `Chain INPUT (policy ACCEPT)` plus one `DROP       all  --  <ip>  anywhere` line per `world.firewall.blocked` in order, with no column-title line; any other form prints `iptables: usage: ...`. Register in `registry.ts`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
    - _Design: Command groups (ops.ts), Gaps G8, D-99_
  - [ ] 8.2 Write `iptables` example tests
    - `ops.test.ts` (30_000 ms timeout): `-A`, `-D`, `-L` each asserting the `Engine.act` call (spy) and World change (R16.2); empty listing; `ok: false` message only and unchanged listing; bad IPs, extra arguments, wrong order; an unsupported flag.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 16.1, 16.2_
    - _Design: Testing Strategy (ops.test.ts)_
  - [ ]* 8.3 Write property test for add then delete
    - **Property 19: `iptables` add then delete is the identity on the listing** (`numRuns: 100`, new Engine per iteration without baseline, 30_000 ms timeout)
    - **Validates: Requirements 9.3, 9.4, 9.5, 9.7**
  - [ ] 8.4 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 9. Service control: `systemctl`
  - [ ] 9.1 Implement `systemctl` in `commands/ops.ts`
    - `forms`: `<status|stop|start|restart> <unit>`. `stop` sends `{ type: 'DEF-11' }`, `start` sends `{ type: 'DEF-18', what: 'nginx' }`, `restart` sends DEF-11 then, whatever it answered, DEF-18; `status` prints `active (running)` or `inactive (dead)` from `world.nginx` with no action; each `ok: false` message is printed in order; silent when all are `ok`; usage errors for a missing or unknown verb or a missing unit; `Unit <name>.service could not be found.` for another unit. Register in `registry.ts`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_
    - _Design: Command groups (ops.ts), D-22, D-97_
  - [ ] 9.2 Write `systemctl` example tests
    - `ops.test.ts` (30_000 ms timeout): a table of verb by unit by `nginx` state; `stop`, `start`, `restart`, `status` each asserting the action and the World (R16.2); `restart` on a stopped service attempts both and prints the stop message; each usage error; an unsupported flag.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 16.1, 16.2_
    - _Design: Testing Strategy (ops.test.ts)_
  - [ ] 9.3 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 10. `sqlite3` reads
  - [ ] 10.1 Implement the read side of `sqlprobe.ts`
    - Pure `splitStatements` (cut on `;` outside quotes, comments and parentheses, drop empty pieces) and `classifyStatement` (tokenizer tracking `'`, `"`, backtick, `[ ]`, `--`, `/* */` and parenthesis depth; keywords only at depth 0) returning `read`, `lock`, `delete` or `refused`; the read set is `SELECT`, `WITH` without a write keyword, `VALUES`, and `PRAGMA table_info | table_xinfo | index_list | foreign_key_list | database_list`.
    - _Requirements: 7.17, 7.18_
    - _Design: SQLite handling (sqlprobe.ts), D-103_
  - [ ] 10.2 Write `sqlprobe.ts` read-side tests
    - `sqlprobe.test.ts`: statement splitting with `;` inside quotes, comments and parentheses, classification of each read form, and of a write keyword hidden in a string or comment.
    - _Requirements: 7.17, 7.18_
    - _Design: Testing Strategy (database.test.ts), D-103_
  - [ ] 10.3 Implement `sqlite3` reads in `commands/database.ts`
    - `sqlite3 [-header] <db-path> <sql-or-dot-command>`: path check (`unable to open database file`), missing SQL argument or a dot-command other than `.tables` and `.schema` is an error with code 1, `await engine.db()` for each statement (`Error: database is unavailable` on rejection, no throw), `|`-joined rows with NULL as empty, `-header` column row, `.tables` (names in ascending order joined by two spaces), `.schema [table]` (CREATE statements ending with `;`, empty for an unknown table), several statements run in order and the first error stops the rest, SQLite errors as `Error: <message>`, DEF-02 once per line through the tracker after a successful read. Writes are not handled yet and print the read-only error. Register in `registry.ts`.
    - _Requirements: 7.1, 7.2, 7.7, 7.8, 7.9, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.21_
    - _Design: SQLite handling (commands/database.ts, sqlprobe.ts), D-92, D-103_
  - [ ] 10.4 Write `sqlite3` read example tests
    - `database.test.ts` (30_000 ms timeout): SELECT output format, `-header`, `.tables`, `.schema` with and without a table, an unknown table, DEF-02 sent once per line (including for `.tables`), invalid SQL prints `Error: <message>` with no action, a wrong path, no SQL argument, an unsupported dot-command, multiple statements stop at the first error, an Engine built without a baseline prints `Error: database is unavailable`, an unsupported flag.
    - _Requirements: 7.1, 7.2, 7.7, 7.8, 7.9, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17, 7.21, 16.1, 16.2_
    - _Design: Testing Strategy (database.test.ts)_
  - [ ] 10.5 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 11. `sqlite3` lock and delete writes with the WHERE probe
  - [ ] 11.1 Implement `parseWrite` and `buildProbe` in `sqlprobe.ts`
    - Recognize only `UPDATE Users SET deletedAt = <expr> [WHERE <w>]` and `DELETE FROM Users [WHERE <w>]` (case-insensitive, table optionally quoted); cut `<expr>` and `<w>` at depth 0 on `WHERE`, `RETURNING`, `ORDER`, `LIMIT`; require balanced parentheses and no unterminated quote or comment; refuse `OR`, `RETURNING`, `ORDER BY`, `LIMIT`, `FROM`, a second assigned column or an alias. `buildProbe` yields `SELECT id, email, deletedAt, (<expr>) FROM Users [WHERE (<w>)]` (no expression column for DELETE).
    - _Requirements: 7.5, 7.6, 7.19_
    - _Design: SQLite handling (write recognition, the probe), D-103_
  - [ ] 11.2 Implement lock and delete in `commands/database.ts`
    - Plan then commit: run the probe through `db.exec` with no tracker call; an expression that is NULL or `''` for a matched row, or any refused form or other write or DDL, prints `Error: attempt to write a readonly database` with no action; `UPDATE` sends `DEF-08` per matched row whose `deletedAt` is NULL or empty and skips rows with a non-empty `deletedAt`; `DELETE` sends `DEF-14` per matched row; print each `ok: false` message and continue; silent otherwise; never execute the write on the Game_DB; later statements use a fresh `Engine.db()`.
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.10, 7.11, 7.19, 7.20_
    - _Design: SQLite handling (flow chart, lock, delete), Gaps G9, G10, D-92, D-103_
  - [ ] 11.3 Write lock, delete and refusal example tests
    - `sqlprobe.test.ts` for `parseWrite`; `database.test.ts` (30_000 ms timeout): UPDATE and DELETE each asserting the DEF-08 / DEF-14 action and the World (R16.2), a statement with no WHERE matches all rows, an already locked row is skipped, a row the world lacks answers `ok: false` and the loop goes on, silent success, zero matches prints nothing, `INSERT`, `DROP`, `ALTER`, `CREATE`, another table, another column, NULL and `''` expressions, `RETURNING`, `LIMIT`, an alias are all refused with zero actions and an unchanged Game_DB; the probe sends no DEF-02. Never print a locked account's `deletedAt` (KI-91).
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.10, 7.11, 7.19, 7.20, 16.2_
    - _Design: Testing Strategy (database.test.ts)_
  - [ ]* 11.4 Write property test for lock and delete
    - **Property 21: SQL lock and delete act on the rows SQLite would change** (`numRuns: 50`, new Engine with baseline per iteration, 30_000 ms timeout; `arbWhere`)
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.10, 7.11**
  - [ ]* 11.5 Write property test for refused and invalid SQL
    - **Property 22: Refused and invalid SQL changes nothing** (`numRuns: 50`, Engine with baseline, 30_000 ms timeout)
    - **Validates: Requirements 7.6, 7.7, 7.8, 7.9, 7.15**
  - [ ] 11.6 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 12. `rm` with DEF-15
  - [ ] 12.1 Implement `rm` in `commands/filesys.ts`
    - Classify every operand before the first `act`. An Uploaded_File sends `{ type: 'DEF-15', path }` with the path relative to `/srv/juice-shop/uploads/` (D-100); `rm -r <dir in uploads>` sends one DEF-15 per file beneath it in ascending order and continues after a refusal (D-108); several operands and expanded globs are handled left to right with exit 1 if any failed; an Engine evidence file prints `Operation not permitted` with no action (D-101); a directory without `-r` prints `cannot remove '<path>': Is a directory`; a missing path prints `cannot remove '<path>': No such file or directory`; a log, the database file or any other path prints `Permission denied`; no operand prints `missing operand`; `-r` is the only flag. Removal inside `/tmp` and `/evidence` comes with task 14.5. Register in `registry.ts`.
    - _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9, 11.10, 11.11, 11.12, 11.13, 4.16, 4.17_
    - _Design: Command groups (filesys.ts, rm), D-100, D-101, D-107, D-108_
  - [ ] 12.2 Write `rm` example tests
    - `filesys.test.ts` (30_000 ms timeout): `rm` of an Uploaded_File asserts exactly one DEF-15 with the relative path and that the next `ls` omits it (R16.2); absolute, relative and glob operands; `ok: false` keeps the file listed; `rm -r` of an uploads directory; several operands with one failure; each error text; evidence immutability; `-f` and `-R` are unsupported flags.
    - _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9, 11.10, 11.11, 11.12, 11.13, 16.1, 16.2_
    - _Design: Testing Strategy (filesys.test.ts)_
  - [ ]* 12.3 Write property test for `rm` of uploads
    - **Property 24: `rm` of uploads sends one relative-path action** (`numRuns: 100`, new Engine per iteration without baseline, 30_000 ms timeout)
    - **Validates: Requirements 11.1, 11.5, 11.6, 11.7**
  - [ ]* 12.4 Write property test for the VFS following the Engine
    - **Property 13: The VFS shows the Engine as it is now** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 6.1, 6.2, 11.7**
  - [ ] 12.5 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 13. Checkpoint (a): the MVP shell runs end to end
  - [ ] 13.1 Write the MVP integration test
    - `mvp-session.test.ts` (30_000 ms timeout): on a committed-scenario Engine with the baseline, play a short session through `run`: `pwd`, `ls /var/log/nginx`, `grep` of the attacker's IP in `access.log` piped to `sort | uniq -c`, `sqlite3` SELECT of the admin accounts, `ls -la` and `cat` of a planted upload, `iptables -A INPUT -s <attacker ip> -j DROP`, `systemctl stop nginx`, `sqlite3` UPDATE locking the rogue admin, `rm` of the planted file. Assert the exact action events in order (DEF-01, DEF-02, DEF-03, DEF-06, DEF-11, DEF-08, DEF-15; one read action per kind per line), the World changes (firewall, nginx stopped, account locked, file gone from `ls`), exit codes, and that `Engine.advance` was never called by the Shell.
    - _Requirements: 3.1, 6.1, 6.2, 7.3, 9.1, 10.1, 11.1, 14.4, 14.5_
    - _Design: Component and data flow, Sequence of one line, Testing Strategy_
  - [ ] 13.2 Log this Kiro session in `docs/KIRO_USAGE.md`
    - Add an entry with the date, the Kiro feature used, what it built (part (a) of the shell), the PRD rows (SYS-09, DEF-01 to DEF-04, DEF-06, DEF-08, DEF-11, DEF-14, DEF-15, DEF-18), and the credits used, read from the Kiro session (write `not measured` if unavailable). Claim only what happened (D-13).
    - _Requirements: 16.6_
  - [ ] 13.3 Run `npm run health` in `game/` and fix until green
    - Run the full health (type-check, lint, all tests), and ensure all tests pass, ask the user if questions arise.
    - _Requirements: 16.5, 16.6_

- [ ] 14. Archive format, VFS writes, redirection
  - [ ] 14.1 Implement the write side of `vfs.ts`
    - Overlay writes under `/tmp` and `/evidence` only: `writeFile`, `mkdir` (with `parents`), `copy`, `remove` (with `recursive`), `putArchive`; `canWrite` is true only inside the Writable_Area and false for an Engine evidence file; `FsError` codes `EACCES`, `EISDIR`, `ENOTDIR`, `EEXIST`, `EPERM`, `ENOENT`. Writes to `uploads/`, logs and the `.sqlite` file are refused (`Permission denied`); Engine evidence is `Operation not permitted`. Uploads removal is never a VFS operation.
    - _Requirements: 3.3, 3.4, 4.10, 4.11, 4.12, 4.16, 4.17, 4.19_
    - _Design: Virtual file system (write boundaries, overlay), D-90, D-101, D-102_
  - [ ] 14.2 Implement `archive-format.ts`
    - Pure and deterministic: `ArchiveEntry`, `encodeArchive` (gzip magic `1f 8b 08 00`, then length-prefixed records of path, type, length, bytes, no compression), `decodeArchive`, `listArchive` (source paths in the order given, each followed by its descendants in ascending order, directories ending in `/`, leading `/` removed).
    - _Requirements: 8.12, 8.13_
    - _Design: Archives (archive-format.ts), D-109_
  - [ ] 14.3 Write archive format tests
    - `archive-format.test.ts`: magic bytes, round trip through `decodeArchive`, determinism, a one-byte change gives different bytes, listing order and trailing `/`.
    - _Requirements: 8.7, 8.12, 8.13_
    - _Design: Testing Strategy (archive.test.ts), D-109_
  - [ ] 14.4 Implement redirection in `exec.ts`
    - Replace the seam from task 5.3: with `>` and every stage at exit 0, write the last stdout (UTF-8) with `vfs.writeFile`, expand `~` only in the target, return empty output; a non-zero stage writes nothing and leaves the target unchanged; outside the Writable_Area prints a permission-denied error; a directory target or a missing parent prints a cannot-be-written error.
    - _Requirements: 3.2, 3.3, 3.4, 3.15, 4.12, 4.16, 4.17_
    - _Design: Pipeline executor (algorithm step 4)_
  - [ ] 14.5 Extend `rm` for the Writable_Area
    - `rm` of a file in `/tmp` or `/evidence` removes it from the overlay with no action and no output; `rm -r` of a directory there removes it and its contents with no action.
    - _Requirements: 11.2, 11.8_
    - _Design: Command groups (filesys.ts, rm)_
  - [ ] 14.6 Write tests for VFS writes, redirection and writable `rm`
    - `vfs.test.ts` and `shell.test.ts` (30_000 ms timeout): `>` creates and replaces a file, a failed stage and a `grep` with no match write nothing, `>` on a directory, a missing parent, `/etc`, `uploads/`, a log file, the `.sqlite` file and an Engine evidence file; `rm` and `rm -r` in `/tmp`.
    - _Requirements: 3.2, 3.3, 3.4, 3.15, 4.12, 4.16, 4.17, 11.2, 11.8_
    - _Design: Testing Strategy (vfs.test.ts, shell.test.ts)_
  - [ ] 14.7 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 15. `tar` and evidence snapshots (DEF-05)
  - [ ] 15.1 Implement `tar` in `commands/archive.ts`
    - `forms`: `czf <archive> <path>...` and `tzf <archive>`; `v` accepted, leading `-` optional; any other flag, or not exactly one of `c` and `t`, is a usage error. `czf` order: 1 to 16 sources; archive path (`/tmp/...` free-form without DEF-05; `/evidence/<name>.tgz` with `<name>` 1 to 64 of `A-Za-z0-9._-`, otherwise `tar: invalid archive name '<name>'`; nested or non-`.tgz` evidence paths invalid; anywhere else `Permission denied`); the first missing source prints `tar: <path>: No such file or directory`; build frozen entries with no tracker sink; then, for `/evidence`, `act({ type: 'DEF-05', name })`; on `ok: false` print the message and create nothing; on `ok: true` `putArchive` and print nothing. `tzf` lists a Shell-made archive and errors on a missing path or a foreign archive (exit 1). Register in `registry.ts`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9, 8.10, 8.11, 8.13, 14.7_
    - _Design: Command groups (archive.ts), D-101, D-109_
  - [ ] 15.2 Write `tar` example tests
    - `archive.test.ts` (30_000 ms timeout): `czf` asserts exactly one DEF-05 and `/evidence/<name>.tgz` in `ls` (R16.2); `tzf` listing; `sha256sum` of the archive is stable and differs when content differs; a `/tmp` archive sends no action; every invalid name, nested path, wrong extension, missing source, bad flag set, outside path, duplicate name (`ok: false`, existing archive unchanged), `tzf` of a foreign file and of Engine evidence; a later change to a source does not change an existing archive; `v` bundling.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 16.1, 16.2_
    - _Design: Testing Strategy (archive.test.ts)_
  - [ ]* 15.3 Write property test for evidence snapshots
    - **Property 23: Evidence snapshots** (`numRuns: 50` because sources may include the database file, new Engine with baseline per iteration, 30_000 ms timeout; `arbArchiveName`, `arbBadArchiveName`)
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10**
  - [ ] 15.4 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 16. `cp`, `mkdir`, `file`, `sha256sum`
  - [ ] 16.1 Implement the four commands in `commands/filesys.ts`
    - `file` (type from name and first bytes: directory, empty, gzip, SQLite 3, ZIP, PHP, UTF-8 text, otherwise `data`; output `<path>: <description>`; no flags). `sha256sum` (digest, two spaces, path as typed; `VFile.sha256` for an upload with no bytes; stdin prints `  -`; no flags). `cp <src> <dst>` (exactly two operands, no flags, byte-exact, copy into an existing writable directory, `-r not specified` message for a directory source, `Permission denied` outside the Writable_Area, reads through the tracker so `uploads/` sends DEF-03 and a log sends DEF-01). `mkdir [-p] <dir>` (`File exists`, `Permission denied` outside the area, silent when `-p` finds the directory). Register in `registry.ts`.
    - _Requirements: 4.10, 4.11, 4.12, 4.14, 4.15, 4.16, 4.17, 4.19, 5.15, 5.16, 5.17, 5.22, 14.7_
    - _Design: Command groups (filesys.ts), D-100, D-102, D-107_
  - [ ] 16.2 Write tests for the four commands
    - `filesys.test.ts` (30_000 ms timeout): `mkdir` and `mkdir -p`, `File exists`, `Permission denied`; `cp` byte-exactness, into a directory, from `uploads/` sends one DEF-03, destination on `uploads/`, a log, the `.sqlite` file or Engine evidence is refused, wrong operand count, any flag is unsupported; `file` signatures; `sha256sum` of an upload equals the scenario content digest, of a file with no bytes, of stdin, repeated runs identical; `file` and `sha256sum` flags rejected; `file` and `sha256sum` and `cp` on the `.sqlite` file send no DEF-02.
    - _Requirements: 4.10, 4.11, 4.12, 4.14, 4.15, 4.16, 4.17, 4.19, 5.15, 5.16, 5.17, 5.22, 6.2, 16.1_
    - _Design: Testing Strategy (filesys.test.ts)_
  - [ ]* 16.3 Write property test for copy and hash
    - **Property 9: Copy and hash preserve bytes** (`numRuns: 100`, Engine without baseline, `node:crypto` as the reference, 30_000 ms timeout)
    - **Validates: Requirements 4.11, 5.16, 5.17**
  - [ ] 16.4 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 17. Network tools with `netdata.ts`: `whois ping nmap curl ss`
  - [ ] 17.1 Extend `netdata.ts`
    - Hostname grammar validator (labels of 1 to 63 letters, digits or `-`, total up to 253, at least one letter; all-digits-and-dots must pass `isIPv4`), `whoisFor(ip)`, `pingLines`, `nmapLines`, `curlLines`, `ssLines`: pure, deterministic templates in the real tools' formats with numbers derived from `sha256Hex(target)`, no HTML, no randomness.
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 15.7_
    - _Design: Command groups (network.ts), D-91_
  - [ ] 17.2 Implement `commands/network.ts`
    - `whois <ip>` sends one `{ type: 'DEF-04', ip, mode: 'passive' }`; `ping [-c n]` (default 4, 1 to 20), `nmap [-p ports] [-sV]`, `curl [-I] [-s]` with an IPv4 target send one `{ type: 'DEF-04', ip, mode: 'active' }` and with a hostname send nothing; `curl` reads the host from `scheme://host[:port]/...` or a bare host; a missing or invalid target, or a count outside 1 to 20, prints a usage error with no action; the Tip_Off decision is left to the Engine; `ss [-t -l -n]` lists Juice Shop (`:3000`) and, only while `world.nginx === 'running'`, nginx (`:80`). Register in `registry.ts`.
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_
    - _Design: Command groups (network.ts), D-91, D-107, KI-90_
  - [ ] 17.3 Write network example tests
    - `netdata.test.ts` and `network.test.ts` (30_000 ms timeout): `whois`, `ping`, `nmap`, `curl` each asserting the exact DEF-04 action (R16.2); hostname targets (`localhost`) send nothing; every supported flag and an unsupported flag for each of the five commands; `ping -c 1`, `-c 20`, `-c 0`, `-c 21`; `ss` with nginx running and stopped; outputs identical on repeated calls.
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 16.1, 16.2_
    - _Design: Testing Strategy (network.test.ts)_
  - [ ] 17.4 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 18. Session commands: `date history clear help man`
  - [ ] 18.1 Implement `commands/session-cmds.ts`
    - `date` prints `gameTimeIso(world)` as `Sat Oct 31 22:00:15 UTC 2026` from `world.clock.gameMs` only; `history` prints `"%5d  %s"` lines with running-count numbering and the current line last; `clear` returns `{ stdout: '', stderr: '', code: 0, clear: true }`; `help` prints one `<name>  <summary>` line per command in alphabetical order (at most 80 characters of description); `man <command>` prints NAME, USAGE, one line per flag or form, and the examples, all read from `COMMANDS`; `No manual entry for <name>` and `man: usage: man <command>` with code 1; extra arguments for `date`, `history`, `clear`, `help` print `<cmd>: unsupported argument '<arg>'`, code 1, session unchanged. Register in `registry.ts`.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10_
    - _Design: Command groups (session-cmds.ts), Registry (help and man)_
  - [ ] 18.2 Write session command example tests
    - `session-cmds.test.ts` (30_000 ms timeout): `date` for two game times, `clear` result, `history` numbering and the 500-line retention with continuing numbers, `help` lines, `man` for every command including examples, `man` errors, unsupported arguments for each of the four commands.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 16.1_
    - _Design: Testing Strategy (session-cmds.test.ts)_
  - [ ]* 18.3 Write property test for unsupported flags
    - **Property 14: Unsupported flags are rejected uniformly** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 5.19, 12.9, 16.1**
  - [ ]* 18.4 Write property test for `help` and `man`
    - **Property 15: `help` and `man` come from the registry** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 12.5, 12.6, 12.7, 12.10**
  - [ ]* 18.5 Write property test for history
    - **Property 16: History keeps non-blank lines in order** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 1.5, 1.6, 1.9, 12.2, 12.3**
  - [ ] 18.6 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 19. Autocomplete (Easy only)
  - [ ] 19.1 Implement `complete.ts` and wire it into `createShell`
    - Synchronous and pure over `(session.cwd, vfs.list, COMMAND_LIST)`: no space gives the `COMMAND_LIST` names with that prefix; with a space it takes the text after the last space, splits at the last `/`, lists that directory (cwd when there is no directory part, `~` expanded), returns case-sensitive prefix matches sorted and unique, hides dot names unless the prefix starts with `.`, returns `[]` for an unknown directory or no match; never calls `readBytes`. `createShell` adds `complete` with a conditional spread only when `engine.world.difficulty === 'easy'`.
    - _Requirements: 1.2, 1.7, 13.1, 13.2, 13.3, 13.4, 13.5_
    - _Design: Autocomplete (complete.ts), Gaps G13, D-94_
  - [ ] 19.2 Write autocomplete example tests
    - `complete.test.ts` (30_000 ms timeout): `shell.complete` is `undefined` and `'complete' in shell` is false on Medium and Hard; command and path completion; directory part; dot-name rule; no match; state unchanged and no action sent.
    - _Requirements: 1.2, 1.7, 13.1, 13.2, 13.3, 13.4, 13.5_
    - _Design: Testing Strategy (complete.test.ts)_
  - [ ]* 19.3 Write property test for autocomplete
    - **Property 26: Autocomplete** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout)
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5**
  - [ ] 19.4 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 20. Remaining properties and source-scan tests
  - [ ] 20.1 Write `actions-surface.test.ts` and `determinism-source.test.ts`
    - `actions-surface.test.ts` (30_000 ms timeout): over the Shell's tests, only the action types in the design's table (DEF-01 to DEF-06, DEF-08, DEF-11, DEF-14, DEF-15, DEF-18) ever appear as `action` events. `determinism-source.test.ts`: reads every non-test file in `game/src/shell/` and fails on `Math.random`, `Date.now`, `new Date()` with no argument, `performance.now`, `getRandomValues`, `randomUUID`, `toLocale` or `localeCompare`; also fails if any file imports `applyAction`, `advance` or a mutator from `engine/`.
    - _Requirements: 14.1, 14.2, 15.7_
    - _Design: Testing Strategy (actions-surface.test.ts, determinism-source.test.ts)_
  - [ ]* 20.2 Write property test for `run` never throwing (no baseline)
    - **Property 5: `run` always resolves with clean text** (200-run variant: `numRuns: 200`, Engine without baseline so `sqlite3` answers `Error: database is unavailable`, `onInternalError` never called, 30_000 ms timeout)
    - **Validates: Requirements 1.1, 1.4, 1.5, 1.9, 1.10, 15.1, 15.2**
  - [ ]* 20.3 Write property test for `run` never throwing (with baseline)
    - **Property 5: `run` always resolves with clean text** (50-run variant: `numRuns: 50`, Engine with baseline, `sqlite3`-heavy lines, 30_000 ms timeout)
    - **Validates: Requirements 1.1, 1.4, 1.5, 1.9, 1.10, 15.1, 15.2**
  - [ ]* 20.4 Write property test for write boundaries
    - **Property 8: Write boundaries** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout; `arbWritablePath`, `arbForbiddenPath`)
    - **Validates: Requirements 3.2, 3.3, 3.4, 4.10, 4.12, 4.14, 11.2, 11.6**
  - [ ]* 20.5 Write property test for read-only lines
    - **Property 17: Read-only lines leave the World as it was** (`numRuns: 50`, Engine with baseline because lines may run `sqlite3` SELECT, 30_000 ms timeout)
    - **Validates: Requirements 14.1, 14.2, 15.5**
  - [ ]* 20.6 Write property test for one read action per kind
    - **Property 18: One read action per kind per line** (`numRuns: 50`, Engine with baseline because a kind is the database, 30_000 ms timeout; `arbReadPlan`)
    - **Validates: Requirements 7.2, 7.5, 7.16, 14.4, 14.5, 14.7**
  - [ ]* 20.7 Write property test for IPv4 agreement with the Engine
    - **Property 20: Network and firewall targets are validated once and consistently** (`numRuns: 100`, Engine without baseline, 30_000 ms timeout; `arbIPv4`, `arbHostname`, `arbBadTarget`; `isIPv4(s)` equals "DEF-06 add does not answer `... is not an IPv4 address`")
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.8, 9.1, 9.2, 9.6**
  - [ ]* 20.8 Write property test for determinism
    - **Property 25: Determinism and no randomness** (`numRuns: 50`, two Engines with baseline and the same seed, `Math.random`, `crypto.getRandomValues` and `Date.now` replaced by throwing functions in `beforeEach`, restored after, 30_000 ms timeout)
    - **Validates: Requirements 12.1, 15.6, 15.7**
  - [ ]* 20.9 Write property test for the command list
    - **Property 27: The exported command list equals the steering list** (set-equality test over the 31 names, reports each name present in only one list)
    - **Validates: Requirements 2.1, 2.6**
  - [ ] 20.10 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 21. R16 coverage test
  - [ ] 21.1 Write the table-driven coverage test
    - `coverage.test.ts` (30_000 ms timeout): iterate `COMMANDS` and for every command and every flag in its `flags` run a line and assert the flag is accepted (no `unsupported flag`), and for every command run one unsupported flag and assert `<cmd>: unsupported flag '<flag>'`, exit code 1, zero `Engine.act` calls (R16.1; grammar commands iterate their `forms` and one malformed form). Assert the 15 command-to-action rows each produce the expected `Engine.act` call and World change: `iptables -A`, `-D`, `-L`; `systemctl stop`, `start`, `restart`, `status`; `rm` of an Uploaded_File; `tar czf`; `sqlite3` UPDATE and DELETE; `whois`; `ping`, `nmap`, `curl` (R16.2). Assert the three read actions DEF-01, DEF-02 and DEF-03, and the examples for `clear`, `exitCode`, globs, `~`, `sqlite3 .tables`, `.schema` and `-header` exist and pass.
    - _Requirements: 16.1, 16.2, 16.3, 16.5_
    - _Design: Testing Strategy (approach, R16.2 mapping)_
  - [ ] 21.2 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 22. Documentation updates
  - [ ] 22.1 Update `docs/PRD.md`
    - Set the SYS-09 status in section 16 to its true status after this work (state what is built and what is not; do not overclaim), in the same PR as the code (AGENTS.md rule).
    - _Requirements: 16.5, 16.6_
    - _Design: Overview_
  - [ ] 22.2 Update `docs/ENGINE_API.md`
    - In section 5, replace the Shell stub note with a pointer to the real `createShell`, `COMMAND_LIST`, `checkCommandLine` and `RunResult` in `game/src/shell/`.
    - _Requirements: 1.1, 1.2, 2.1, 2.2_
    - _Design: Public surface (index.ts, types.ts)_
  - [ ] 22.3 Update `docs/DECISIONS.md` and `docs/KNOWN_ISSUES.md` only if something new came up
    - Add a decision for any choice made during the build that is not in D-90 to D-109, and an issue for any problem found (KI-90 and KI-91 already exist; do not duplicate them). If nothing is new, leave both files unchanged.
    - _Requirements: 16.6_
    - _Design: Decisions D-100 to D-109_
  - [ ] 22.4 Run `npm run health` in `game/` and fix until green
    - _Requirements: 16.6_

- [ ] 23. Final checkpoint
  - [ ] 23.1 Log this Kiro session in `docs/KIRO_USAGE.md`
    - Add an entry with the date, the Kiro feature used, what it built (part (b) of the shell: archive format, writes and redirection, `tar`, `cp mkdir file sha256sum`, network tools, session commands, `complete`, remaining properties, coverage test, docs), the PRD rows (SYS-09, DEF-01 to DEF-18 as touched, KIRO-08, KDEV-01, KDEV-02, KDEV-04), and the credits used, read from the Kiro session (write `not measured` if unavailable). Claim only what happened (D-13).
    - _Requirements: 16.6_
  - [ ] 23.2 Run `npm run health` in `game/` and fix until green
    - Ensure all tests pass, ask the user if questions arise.
    - _Requirements: 16.5, 16.6_

## Notes

- Tasks marked with `*` are optional property-based tests; each property of the design (1 to 27) appears exactly once, except Property 5, which has two variants (200 runs without a baseline, 50 with it). The example and unit tests are not optional because R16.1 and R16.2 require them and `npm run health` must prove the shell.
- Part (a) leaves two seams that part (b) closes: redirection (`>` writes nothing until 14.4) and `rm` in `/tmp` and `/evidence` (14.5). Both are named in the part (a) tasks.
- Property 17, 18 and 25 use the database, so they run 50 cases. Property 21 and 22 run 50. Property 23 runs 50 because sources may include the `.sqlite` file.
- Property 27 is a set-equality test; the steering-list example test (task 1.6) already enforces it from the start.
- Every test that builds an Engine, runs `Engine.db()` or runs a whole-run sim has an explicit `30_000` ms timeout (KI-81).
- No new dependency is added: Vitest, fast-check, sql.js and `node:crypto` (tests only) already exist.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "1.6"] },
    { "id": 3, "tasks": ["1.7"] },
    { "id": 4, "tasks": ["2.1", "2.2"] },
    { "id": 5, "tasks": ["2.3"] },
    { "id": 6, "tasks": ["2.4", "2.6"] },
    { "id": 7, "tasks": ["2.5"] },
    { "id": 8, "tasks": ["2.7"] },
    { "id": 9, "tasks": ["3.1"] },
    { "id": 10, "tasks": ["3.2"] },
    { "id": 11, "tasks": ["3.3"] },
    { "id": 12, "tasks": ["3.4"] },
    { "id": 13, "tasks": ["4.1"] },
    { "id": 14, "tasks": ["4.2"] },
    { "id": 15, "tasks": ["4.3"] },
    { "id": 16, "tasks": ["4.4"] },
    { "id": 17, "tasks": ["5.1", "5.2"] },
    { "id": 18, "tasks": ["5.3"] },
    { "id": 19, "tasks": ["5.4"] },
    { "id": 20, "tasks": ["5.5"] },
    { "id": 21, "tasks": ["5.6", "5.7"] },
    { "id": 22, "tasks": ["5.8"] },
    { "id": 23, "tasks": ["6.1"] },
    { "id": 24, "tasks": ["6.2", "6.3"] },
    { "id": 25, "tasks": ["6.4"] },
    { "id": 26, "tasks": ["7.1", "7.3"] },
    { "id": 27, "tasks": ["7.2", "7.4"] },
    { "id": 28, "tasks": ["7.5"] },
    { "id": 29, "tasks": ["7.6"] },
    { "id": 30, "tasks": ["7.7"] },
    { "id": 31, "tasks": ["7.8"] },
    { "id": 32, "tasks": ["7.9"] },
    { "id": 33, "tasks": ["7.10"] },
    { "id": 34, "tasks": ["8.1"] },
    { "id": 35, "tasks": ["8.2"] },
    { "id": 36, "tasks": ["8.3"] },
    { "id": 37, "tasks": ["8.4"] },
    { "id": 38, "tasks": ["9.1"] },
    { "id": 39, "tasks": ["9.2"] },
    { "id": 40, "tasks": ["9.3"] },
    { "id": 41, "tasks": ["10.1"] },
    { "id": 42, "tasks": ["10.2", "10.3"] },
    { "id": 43, "tasks": ["10.4"] },
    { "id": 44, "tasks": ["10.5"] },
    { "id": 45, "tasks": ["11.1"] },
    { "id": 46, "tasks": ["11.2"] },
    { "id": 47, "tasks": ["11.3"] },
    { "id": 48, "tasks": ["11.4"] },
    { "id": 49, "tasks": ["11.5"] },
    { "id": 50, "tasks": ["11.6"] },
    { "id": 51, "tasks": ["12.1"] },
    { "id": 52, "tasks": ["12.2"] },
    { "id": 53, "tasks": ["12.3", "12.4"] },
    { "id": 54, "tasks": ["12.5"] },
    { "id": 55, "tasks": ["13.1"] },
    { "id": 56, "tasks": ["13.2"] },
    { "id": 57, "tasks": ["13.3"] },
    { "id": 58, "tasks": ["14.1", "14.2"] },
    { "id": 59, "tasks": ["14.3", "14.4"] },
    { "id": 60, "tasks": ["14.5"] },
    { "id": 61, "tasks": ["14.6"] },
    { "id": 62, "tasks": ["14.7"] },
    { "id": 63, "tasks": ["15.1"] },
    { "id": 64, "tasks": ["15.2"] },
    { "id": 65, "tasks": ["15.3"] },
    { "id": 66, "tasks": ["15.4"] },
    { "id": 67, "tasks": ["16.1"] },
    { "id": 68, "tasks": ["16.2"] },
    { "id": 69, "tasks": ["16.3"] },
    { "id": 70, "tasks": ["16.4"] },
    { "id": 71, "tasks": ["17.1"] },
    { "id": 72, "tasks": ["17.2"] },
    { "id": 73, "tasks": ["17.3"] },
    { "id": 74, "tasks": ["17.4"] },
    { "id": 75, "tasks": ["18.1"] },
    { "id": 76, "tasks": ["18.2"] },
    { "id": 77, "tasks": ["18.3", "18.5"] },
    { "id": 78, "tasks": ["18.4"] },
    { "id": 79, "tasks": ["18.6"] },
    { "id": 80, "tasks": ["19.1"] },
    { "id": 81, "tasks": ["19.2"] },
    { "id": 82, "tasks": ["19.3"] },
    { "id": 83, "tasks": ["19.4"] },
    { "id": 84, "tasks": ["20.1", "20.4", "20.6", "20.7", "20.9"] },
    { "id": 85, "tasks": ["20.2"] },
    { "id": 86, "tasks": ["20.3"] },
    { "id": 87, "tasks": ["20.5"] },
    { "id": 88, "tasks": ["20.8"] },
    { "id": 89, "tasks": ["20.10"] },
    { "id": 90, "tasks": ["21.1"] },
    { "id": 91, "tasks": ["21.2"] },
    { "id": 92, "tasks": ["22.1", "22.2", "22.3"] },
    { "id": 93, "tasks": ["22.4"] },
    { "id": 94, "tasks": ["23.1"] },
    { "id": 95, "tasks": ["23.2"] }
  ]
}
```

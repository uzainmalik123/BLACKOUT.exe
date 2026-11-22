// Shared types for the Shell (PRD SYS-09). Types only; no runtime code.

import type { Engine } from '../engine/engine';
import type { World } from '../engine/state';

/** The 31 commands of .kiro/steering/game-shell.md, in that order. `registry.ts` owns the runtime tuple. */
export type CommandName =
  | 'ls' | 'cd' | 'pwd' | 'cat' | 'head' | 'tail' | 'grep' | 'awk' | 'sort' | 'uniq' | 'wc' | 'cut'
  | 'file' | 'sha256sum' | 'tar' | 'cp' | 'rm' | 'mkdir' | 'sqlite3' | 'iptables' | 'systemctl'
  | 'ss' | 'whois' | 'ping' | 'nmap' | 'curl' | 'date' | 'history' | 'clear' | 'help' | 'man';

export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends ReadonlyMap<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlySet<infer U>
      ? ReadonlySet<DeepReadonly<U>>
      : T extends (...args: never[]) => unknown
        ? T
        : T extends object
          ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
          : T;

/** The Shell sees the World through this alias only (R14.1, G11). */
export type ReadonlyWorld = DeepReadonly<World>;

// ---- Public surface (D-95) ----

export interface RunResult {
  output: string;
  exitCode?: number;
  clear?: true;
}

export interface Shell {
  run(line: string): Promise<RunResult>;
  /** Present only on Easy (D-94). */
  complete?(partial: string): string[];
}

// ---- Parsed structures ----

/** `literal`: quoted somewhere in the source AND (contains '*' or starts with '~'). */
export interface Word {
  text: string;
  literal: boolean;
}

export interface Stage {
  name: Word;
  args: Word[];
}

export interface Pipeline {
  stages: Stage[];
  redirect?: { target: Word };
}

// ---- Virtual_FS ----

export type Area = 'system' | 'log-access' | 'log-app' | 'db' | 'uploads' | 'tmp' | 'evidence';

export interface Stat {
  kind: 'dir' | 'file';
  area: Area;
  readonly: boolean;
}

export interface ArchiveEntry {
  path: string;
  type: 'file' | 'dir';
  bytes: Uint8Array;
}

export type OverlayNode =
  | { kind: 'dir' }
  | { kind: 'file'; bytes: Uint8Array }
  | { kind: 'archive'; entries: ArchiveEntry[]; bytes: Uint8Array };

/** Files and directories the player made under /tmp and /evidence. Key: absolute path. */
export type Overlay = Map<string, OverlayNode>;

/** Synchronous, names-only view of the Virtual_FS, used for globs, `cd` and `complete`. */
export interface VfsLister {
  stat(abs: string): Stat | undefined;
  /** Sorted by code point, no `.` or `..`; undefined when `abs` is not a directory. */
  list(abs: string): string[] | undefined;
}

/** Receives content reads so the ReadTracker can send DEF-01/02/03 (R14.4, R14.5). */
export interface ReadSink {
  /** Called when a log's content is read. Returns a notice when the Engine refused the action. */
  log(): string | undefined;
  /** Called when an uploads file is read; `absPath` is absolute. */
  uploads(absPath: string): string | undefined;
}

export interface ReadTrackerLike extends ReadSink {
  db(sql: string): string | undefined;
  readonly sent: ReadonlySet<'log' | 'db' | 'uploads'>;
}

export interface VirtualFsLike extends VfsLister {
  areaOf(abs: string): Area;
  canWrite(abs: string): boolean;
  size(abs: string): Promise<number>;
  /** Log text is rendered at most once between these calls (G15). */
  beginInvocation(): void;
  endInvocation(): void;
  /** `VFile.sha256` of an uploaded file whose content is not stored; otherwise undefined. */
  recordedSha256(abs: string): string | undefined;
  readBytes(abs: string, sink?: ReadSink): Promise<Uint8Array>;
  writeFile(abs: string, bytes: Uint8Array): void;
  mkdir(abs: string, opts?: { parents?: boolean }): void;
  copy(srcAbs: string, dstAbs: string, sink?: ReadSink): Promise<void>;
  remove(abs: string, opts?: { recursive?: boolean }): void;
  /** `bytes` is the encoded archive (`encodeArchive`, D-109); the caller encodes. */
  putArchive(abs: string, entries: ArchiveEntry[], bytes?: Uint8Array): void;
}

export interface Session {
  cwd: string;
  history: string[];
  runCount: number;
  overlay: Overlay;
}

// ---- Registry and handlers ----

export interface FlagSpec {
  /** '-l', '-n', '-F', '-header' */
  name: string;
  /** One line, shown by `man`. */
  summary: string;
  /** Takes an argument: '-F:' (attached), '-F :' (separate) or either. */
  value?: 'attached' | 'separate' | 'either';
  /** For `man`: '<count>'. */
  valueName?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
  clear?: true;
}

export interface CommandContext {
  engine: Engine;
  world: ReadonlyWorld;
  vfs: VirtualFsLike;
  session: Session;
  reads: ReadTrackerLike;
  name: CommandName;
  spec: CommandSpec;
}

export type Handler = (
  ctx: CommandContext,
  args: string[],
  stdin: string,
) => CommandResult | Promise<CommandResult>;

export interface CommandSpec {
  name: CommandName;
  /** At most 80 characters, shown by `help` (R12.5). */
  summary: string;
  /** Shown by `man` and by usage errors. */
  usage: string;
  /** The only list flag validation uses. */
  flags: FlagSpec[];
  /** Grammar for iptables, systemctl, tar, sqlite3, awk. */
  forms?: string[];
  /** At least one (R12.6). */
  examples: string[];
  operands: { min: number; max: number };
  /** `head` and `tail` accept -<count>. */
  numericCount?: boolean;
  readsStdin: boolean;
  handler: Handler;
}

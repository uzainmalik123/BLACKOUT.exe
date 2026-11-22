// Public surface of the Shell (PRD SYS-09). `checkCommandLine` and `createShell` arrive in tasks 2.3 and 5.4.

import type { Engine } from '../engine/engine';
import { complete } from './complete';
import { runPipeline, type ShellInternals } from './exec';
import { MSG, fail } from './output';
import { parseLine } from './parser';
import { COMMAND_NAMES } from './registry';
import { createSession, recordLine } from './session';
import type { CommandName, RunResult, Shell } from './types';
import { VirtualFs } from './vfs';

/** Exactly the 31 commands of the steering list, in that order (R2.1). */
export const COMMAND_LIST: readonly CommandName[] = COMMAND_NAMES;

const KNOWN_NAMES: ReadonlySet<string> = new Set<string>(COMMAND_LIST);

/**
 * True when the line parses and every stage names a listed command (R2.2, R2.3).
 * Pure: needs no Engine. Never throws; an empty line, a parse error or an unknown name gives false.
 */
export function checkCommandLine(line: string): boolean {
  try {
    const parsed = parseLine(line);
    if (!parsed.ok) return false;
    const { stages } = parsed.pipeline;
    if (stages.length === 0) return false;
    return stages.every((stage) => KNOWN_NAMES.has(stage.name.text));
  } catch {
    return false;
  }
}

export interface ShellOptions {
  /** Receives anything a catch-all swallowed. Never reaches the output (R15.4). */
  onInternalError?: (e: unknown) => void;
}

/**
 * One Shell per Engine (R1.1). Lines run one at a time through a promise queue (R1.3).
 * The Shell reads the Engine only through act, accessLog, appLog, files, evidence, db and world;
 * it never calls advance, pause or resume (R14.2).
 */
export function createShell(engine: Engine, opts: ShellOptions = {}): Shell {
  const session = createSession(engine);
  const vfs = new VirtualFs(engine, session.overlay);
  const internals: ShellInternals = { engine, vfs, session, onInternalError: opts.onInternalError };
  let queue: Promise<unknown> = Promise.resolve();

  const execute = async (line: string): Promise<RunResult> => {
    try {
      if (line.trim() === '') return { output: '', exitCode: 0 };
      recordLine(session, line);
      const parsed = parseLine(line);
      if (!parsed.ok) return { output: parsed.error, exitCode: 2 };
      return await runPipeline(internals, parsed.pipeline, line);
    } catch (e) {
      try {
        opts.onInternalError?.(e);
      } catch {
        // a failing hook must not break the line
      }
      return { output: fail('sh', MSG.internalError).stderr.trimEnd(), exitCode: 1 };
    }
  };

  const run = (line: string): Promise<RunResult> => {
    const result = queue.then(() => execute(line));
    queue = result.catch(() => undefined);
    return result;
  };

  const shell: Shell = {
    run,
    ...(engine.world.difficulty === 'easy'
      ? { complete: (partial: string): string[] => complete(session, vfs, partial) }
      : {}),
  };
  return shell;
}

export type {
  CommandName,
  CommandSpec,
  CommandContext,
  CommandResult,
  FlagSpec,
  Handler,
  Pipeline,
  RunResult,
  Shell,
  Stage,
  Word,
} from './types';

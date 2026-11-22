// Pipeline executor (design: Pipeline executor, Error Handling; R1.8-1.10, R2.4, R2.5, R2.7, R3.1, R15.4).

import type { Engine } from '../engine/engine';
import { parseArgs } from './argparse';
import { expandWord } from './expand';
import { commandNotFound, fail, finish, sanitize, unsupportedFlag, usage, MSG } from './output';
import { dirname, resolvePath } from './path';
import { COMMANDS } from './registry';
import { encodeUtf8 } from './text';
import { ReadTracker } from './tracker';
import type {
  CommandResult,
  CommandSpec,
  Pipeline,
  ReadonlyWorld,
  RunResult,
  Session,
  VirtualFsLike,
} from './types';
import { FsError } from './vfs';

/** What the executor needs from the shell. `commands` defaults to the registry; tests inject their own. */
export interface ShellInternals {
  engine: Engine;
  vfs: VirtualFsLike;
  session: Session;
  commands?: Readonly<Record<string, CommandSpec>>;
  /** Receives the value caught by a stage catch-all. Never reaches the output (R15.4). */
  onInternalError?: (e: unknown) => void;
}

function lookup(commands: Readonly<Record<string, CommandSpec>>, name: string): CommandSpec | undefined {
  return Object.prototype.hasOwnProperty.call(commands, name) ? commands[name] : undefined;
}

/** The refusal text for a redirect target, or undefined when a write would be accepted. */
function checkRedirectTarget(vfs: VirtualFsLike, abs: string): string | undefined {
  if (!vfs.canWrite(abs)) {
    // An Engine evidence file is refused differently from the rest of the read-only area (D-101).
    return vfs.areaOf(abs) === 'evidence' && vfs.stat(abs) !== undefined ? 'Operation not permitted' : 'Permission denied';
  }
  const existing = vfs.stat(abs);
  if (existing?.kind === 'dir') return 'Is a directory';
  const parent = vfs.stat(dirname(abs));
  if (!parent) return 'No such file or directory';
  if (parent.kind !== 'dir') return 'Not a directory';
  return undefined;
}

export async function runPipeline(sh: ShellInternals, pipeline: Pipeline, rawLine: string): Promise<RunResult> {
  const commands = sh.commands ?? COMMANDS;

  // 1. Names first: the first unknown stage wins, nothing runs, no action is called (R1.8, R2.4, R2.7).
  for (const stage of pipeline.stages) {
    if (!lookup(commands, stage.name.text)) {
      return { output: sanitize(commandNotFound(stage.name.text)), exitCode: 127 };
    }
  }

  // Redirect target (R3.2-3.4, D-90, D-101, D-104): `~` only, resolved against cwd. Validate-first:
  // a refused redirect (outside the Writable_Area, an Engine evidence file, a directory, a missing
  // or non-directory parent) runs no stage at all, so nothing changes in the world. This differs
  // from bash, which would run the stages; we choose it so "write nothing" (R3.3) is also "do nothing".
  let redirectAbs: string | undefined;
  let redirectTyped = '';
  if (pipeline.redirect) {
    const word = pipeline.redirect.target;
    redirectTyped = word.text;
    redirectAbs = resolvePath(sh.session.cwd, expandWord(word, sh.session, sh.vfs, 'redirect')[0] ?? '');
    const refusal = checkRedirectTarget(sh.vfs, redirectAbs);
    if (refusal !== undefined) {
      return { output: sanitize(finish(`${redirectTyped}: ${refusal}`)), exitCode: 1 };
    }
  }

  const reads = new ReadTracker(sh.engine, rawLine);
  const stderrs: string[] = [];
  let stdin = '';
  let last: CommandResult = { stdout: '', stderr: '', code: 0 };
  let allOk = true;

  // 2. Stages left to right; stdout of one is stdin of the next.
  for (const stage of pipeline.stages) {
    const spec = lookup(commands, stage.name.text) as CommandSpec;
    const noticesBefore = reads.notices.length;
    let result: CommandResult;

    try {
      const args = stage.args.flatMap((w) => expandWord(w, sh.session, sh.vfs, 'arg'));
      const parsed = parseArgs(spec, args);
      if (!parsed.ok) {
        result = parsed.kind === 'unsupported' ? unsupportedFlag(spec, parsed.flag) : fail(spec.name, parsed.error);
      } else if (parsed.operands.length < spec.operands.min || parsed.operands.length > spec.operands.max) {
        result = usage(spec);
      } else {
        sh.vfs.beginInvocation();
        try {
          result = await spec.handler(
            {
              engine: sh.engine,
              world: sh.engine.world as ReadonlyWorld,
              vfs: sh.vfs,
              session: sh.session,
              reads,
              name: spec.name,
              spec,
            },
            args,
            stdin,
          );
        } finally {
          sh.vfs.endInvocation();
        }
      }
    } catch (e) {
      // Stage catch-all (R15.4): fixed text, the caught value goes to the hook only.
      try {
        sh.onInternalError?.(e);
      } catch {
        // a failing hook must not break the line
      }
      result = fail(spec.name, MSG.internalError);
    }

    // Failed read notices (R14.6): `<cmd>: <message>`; the read itself still counts.
    let stderr = result.stderr;
    for (const message of reads.notices.slice(noticesBefore)) stderr += `${spec.name}: ${message}\n`;
    if (stderr !== '') stderrs.push(stderr);

    if (result.code !== 0) allOk = false;
    last = result;
    stdin = result.stdout;
  }

  // 3. `clear` is honored only for a single-stage line.
  const clear = pipeline.stages.length === 1 && last.clear === true;

  // 4. Redirect: write the final stdout only when every stage exited 0 (R3.3); a failing stage
  //    shows its stderr and writes nothing. The line then prints no stdout (R3.2).
  let exitCode = last.code;
  const redirected = redirectAbs !== undefined && allOk;
  if (redirected) {
    try {
      sh.vfs.writeFile(redirectAbs as string, encodeUtf8(last.stdout));
    } catch (e) {
      // Validated above, so this is a race at most; still answer, never throw.
      if (!(e instanceof FsError)) throw e;
      stderrs.push(`${redirectTyped}: ${e.message}\n`);
      exitCode = 1;
    }
  }
  const shownStdout = pipeline.redirect !== undefined ? '' : last.stdout;

  // 5. stderr of all stages first, then the last stdout.
  const output = finish(sanitize(stderrs.join('') + shownStdout));
  return clear ? { output: '', exitCode, clear: true } : { output, exitCode };
}

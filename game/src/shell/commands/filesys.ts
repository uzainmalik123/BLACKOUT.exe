// File-system commands: rm, file, sha256sum, cp, mkdir (PRD SYS-09; R4.10-4.14, R5.15-5.19, R6.2, R8.7, R8.11-8.13, R11, D-98, D-100, D-101, D-108, D-109).

import { decodeArchive } from '../archive-format';
import { parseArgs } from '../argparse';
import { MSG, cannotRemove, unsupportedFlag, usage } from '../output';
import { basename, resolvePath } from '../path';
import { sha256Hex } from '../sha256';
import { compareCodePoints, encodeUtf8 } from '../text';
import type { CommandContext, CommandResult, Handler, VfsLister } from '../types';
import { FsError } from '../vfs';

const UPLOADS_PREFIX = '/srv/juice-shop/uploads/';

/** One thing `rm` will do, decided before the first `act`: print a refusal, or send DEF-15 for a relative path. */
type Step =
  | { kind: 'refuse'; typed: string; reason: string }
  | { kind: 'def15'; rel: string }
  | { kind: 'remove'; typed: string; abs: string; recursive: boolean };

/** Absolute paths of every file below `dir`, in ascending path order (D-108). */
function filesBeneath(vfs: VfsLister, dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of vfs.list(d) ?? []) {
      const child = `${d}/${name}`;
      const st = vfs.stat(child);
      if (st?.kind === 'dir') walk(child);
      else if (st) out.push(child);
    }
  };
  walk(dir);
  return out.sort(compareCodePoints);
}

/** Classifies one operand into steps. Pure: sends nothing. */
function classify(ctx: CommandContext, typed: string, recursive: boolean): Step[] {
  const abs = resolvePath(ctx.session.cwd, typed);
  const st = ctx.vfs.stat(abs);
  const refuse = (reason: string): Step[] => [{ kind: 'refuse', typed, reason }];

  if (!st) return refuse(MSG.noSuchFile);
  // The writable roots themselves are never removed (R11.8).
  if (abs === '/tmp' || abs === '/evidence') return refuse(MSG.permissionDenied);
  if (st.kind === 'dir' && !recursive) return refuse(MSG.isADirectory);

  if (st.area === 'uploads') {
    const files = st.kind === 'dir' ? filesBeneath(ctx.vfs, abs) : [abs];
    return files.map((f): Step => ({ kind: 'def15', rel: f.slice(UPLOADS_PREFIX.length) }));
  }

  // An Engine evidence file is immutable (D-101); a player-made /tmp or /evidence path is not an Engine record.
  if (st.area === 'evidence' && st.kind === 'file' && !ctx.vfs.canWrite(abs)) return refuse(MSG.notPermitted);

  // A player-created /tmp or /evidence path is removed from the overlay; no Engine action (R11.2, R11.10).
  if ((st.area === 'tmp' || st.area === 'evidence') && ctx.vfs.canWrite(abs)) {
    return [{ kind: 'remove', typed, abs, recursive: st.kind === 'dir' }];
  }

  // Logs, the database file, system directories and everything else.
  return refuse(MSG.permissionDenied);
}

export const rm: Handler = async (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return parsed.kind === 'unsupported' ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);
  if (parsed.operands.length === 0) return { stdout: '', stderr: `rm: ${MSG.missingOperand}\n`, code: 1 };

  const recursive = parsed.flags.has('-r');
  // Classify every operand before the first act (R11).
  const steps = parsed.operands.flatMap((typed) => classify(ctx, typed, recursive));

  let stderr = '';
  let code = 0;
  for (const step of steps) {
    if (step.kind === 'refuse') {
      stderr += cannotRemove(step.typed, step.reason).stderr;
      code = 1;
      continue;
    }
    if (step.kind === 'remove') {
      try {
        ctx.vfs.remove(step.abs, { recursive: step.recursive });
      } catch {
        // Classification already checked the path; a failure here means it vanished, so report it as missing.
        stderr += cannotRemove(step.typed, MSG.noSuchFile).stderr;
        code = 1;
      }
      continue;
    }
    const result = await ctx.engine.act({ type: 'DEF-15', path: step.rel });
    if (!result.ok) {
      stderr += `${result.message}\n`;
      code = 1;
    }
  }
  return { stdout: '', stderr, code };
};

// ---- shared helpers for file, sha256sum, cp, mkdir ----

/** The message of a file-system error. Anything else is an internal error and propagates to the stage catch-all. */
function reason(e: unknown): string {
  if (e instanceof FsError) return e.message;
  throw e;
}

function badArgs(ctx: CommandContext, parsed: { ok: false; kind: string; flag?: string }): CommandResult {
  return parsed.kind === 'unsupported' && parsed.flag !== undefined ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);
}

// ---- file ----

/** A small deterministic table: name and content to description. */
function describe(typed: string, bytes: Uint8Array): string {
  if (bytes.length === 0) return 'empty';
  if (decodeArchive(bytes) !== undefined || (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)) {
    return 'gzip compressed data';
  }
  const head = String.fromCharCode(...bytes.subarray(0, 15));
  if (head === 'SQLite format 3') return 'SQLite 3.x database';
  let text = true;
  for (const b of bytes) {
    if (b > 0x7e || (b < 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09)) {
      text = false;
      break;
    }
  }
  if (!text) return 'data';
  const first = String.fromCharCode(...bytes.subarray(0, 64)).trimStart();
  if (first.startsWith('<?php') || typed.toLowerCase().endsWith('.php')) return 'PHP script, ASCII text';
  if (first.startsWith('#!')) return 'script, ASCII text executable';
  return 'ASCII text';
}

export const file: Handler = async (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  if (parsed.operands.length === 0) return usage(ctx.spec);
  let stdout = '';
  let stderr = '';
  let code = 0;
  for (const typed of parsed.operands) {
    const abs = resolvePath(ctx.session.cwd, typed);
    const st = ctx.vfs.stat(abs);
    if (!st) {
      stderr += `file: ${typed}: ${MSG.noSuchFile}\n`;
      code = 1;
    } else if (st.kind === 'dir') {
      stdout += `${typed}: directory\n`;
    } else {
      try {
        stdout += `${typed}: ${describe(typed, await ctx.vfs.readBytes(abs, ctx.reads))}\n`;
      } catch (e) {
        stderr += `file: ${typed}: ${reason(e)}\n`;
        code = 1;
      }
    }
  }
  return { stdout, stderr, code };
};

// ---- sha256sum ----

export const sha256sum: Handler = async (ctx, args, stdin) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  if (parsed.operands.length === 0) return { stdout: `${sha256Hex(encodeUtf8(stdin))}  -\n`, stderr: '', code: 0 };
  let stdout = '';
  let stderr = '';
  let code = 0;
  for (const typed of parsed.operands) {
    const abs = resolvePath(ctx.session.cwd, typed);
    const st = ctx.vfs.stat(abs);
    let problem: string | undefined;
    if (!st) problem = MSG.noSuchFile;
    else if (st.kind === 'dir') problem = MSG.isADirectory;
    else {
      const recorded = ctx.vfs.recordedSha256(abs);
      if (recorded !== undefined) {
        stdout += `${recorded}  ${typed}\n`;
      } else {
        try {
          stdout += `${sha256Hex(await ctx.vfs.readBytes(abs, ctx.reads))}  ${typed}\n`;
        } catch (e) {
          problem = reason(e);
        }
      }
    }
    if (problem !== undefined) {
      stderr += `sha256sum: ${typed}: ${problem}\n`;
      code = 1;
    }
  }
  return { stdout, stderr, code };
};

// ---- cp ----

export const cp: Handler = async (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  if (parsed.operands.length !== 2) return usage(ctx.spec);
  const [srcTyped = '', dstTyped = ''] = parsed.operands;
  const fail1 = (typed: string, why: string): CommandResult => ({ stdout: '', stderr: `cp: ${typed}: ${why}\n`, code: 1 });

  const src = resolvePath(ctx.session.cwd, srcTyped);
  const srcStat = ctx.vfs.stat(src);
  if (!srcStat) return fail1(srcTyped, MSG.noSuchFile);
  if (srcStat.kind === 'dir') return fail1(srcTyped, MSG.isADirectory);

  let dst = resolvePath(ctx.session.cwd, dstTyped);
  if (ctx.vfs.stat(dst)?.kind === 'dir') dst = `${dst === '/' ? '' : dst}/${basename(src)}`;

  try {
    await ctx.vfs.copy(src, dst, ctx.reads);
  } catch (e) {
    const why = reason(e);
    // A failed read of the source (stored content missing) is the source's problem; every other refusal is the destination's.
    return fail1(why === MSG.ioError ? srcTyped : dstTyped, why);
  }
  return { stdout: '', stderr: '', code: 0 };
};

// ---- mkdir ----

export const mkdir: Handler = (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  if (parsed.operands.length === 0) return { stdout: '', stderr: `mkdir: ${MSG.missingOperand}\n`, code: 1 };
  const parents = parsed.flags.has('-p');
  let stderr = '';
  let code = 0;
  for (const typed of parsed.operands) {
    try {
      ctx.vfs.mkdir(resolvePath(ctx.session.cwd, typed), { parents });
    } catch (e) {
      stderr += `mkdir: ${typed}: ${reason(e)}\n`;
      code = 1;
    }
  }
  return { stdout: '', stderr, code };
};

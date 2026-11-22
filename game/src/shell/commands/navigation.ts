// Navigation commands: ls, cd, pwd (PRD SYS-09; R4.6-4.9, R4.13, R5.1-5.3, R5.18, R5.19).

import { parseArgs } from '../argparse';
import { fail, MSG, ok, usage } from '../output';
import { resolvePath } from '../path';
import { compareCodePoints } from '../text';
import type { CommandContext, CommandResult, Handler } from '../types';
import { FsError, UPLOADS } from '../vfs';

const HOME = '/srv/juice-shop';

/** Operands of a handler call, or the error result the executor would have printed. */
function operandsOf(ctx: CommandContext, args: string[]): string[] | CommandResult {
  const parsed = parseArgs(ctx.spec, args);
  // The executor already validated flags and operand counts; this only guards a direct call.
  if (!parsed.ok) return usage(ctx.spec);
  return parsed.operands;
}

function isUploadsPath(abs: string): boolean {
  return abs === UPLOADS || abs.startsWith(`${UPLOADS}/`);
}

function reason(e: unknown): string {
  return e instanceof FsError ? e.message : MSG.ioError;
}

export const ls: Handler = async (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return usage(ctx.spec);
  const long = parsed.flags.has('-l');
  const all = parsed.flags.has('-a');
  const typedOperands = parsed.operands.length === 0 ? ['.'] : parsed.operands;
  const { vfs, session, reads } = ctx;

  let stderr = '';
  let code = 0;

  async function line(abs: string, name: string): Promise<string> {
    if (!long) return name;
    const st = vfs.stat(abs);
    const mode = st?.kind === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
    let size: string;
    try {
      size = String(await vfs.size(abs));
    } catch (e) {
      // e.g. the .sqlite file when Engine.db() is unavailable: keep the line, report the reason.
      size = '?';
      stderr += `ls: ${name}: ${reason(e)}\n`;
      code = 1;
    }
    return `${mode} ${size} ${name}`;
  }

  const files: { typed: string; abs: string }[] = [];
  const dirs: { typed: string; abs: string }[] = [];
  for (const typed of typedOperands) {
    const abs = resolvePath(session.cwd, typed);
    const st = vfs.stat(abs);
    if (!st) {
      stderr += `ls: ${typed}: ${MSG.noSuchFile}\n`;
      code = 1;
    } else if (st.kind === 'dir') {
      dirs.push({ typed, abs });
    } else {
      files.push({ typed, abs });
    }
  }
  files.sort((a, b) => compareCodePoints(a.typed, b.typed));
  dirs.sort((a, b) => compareCodePoints(a.typed, b.typed));

  const sections: string[] = [];

  if (files.length > 0) {
    const lines: string[] = [];
    for (const f of files) {
      if (isUploadsPath(f.abs)) reads.uploads(f.abs); // DEF-03 once per line (the tracker dedupes)
      lines.push(await line(f.abs, f.typed));
    }
    sections.push(lines.join('\n'));
  }

  const headings = typedOperands.length > 1;
  for (const d of dirs) {
    if (isUploadsPath(d.abs)) reads.uploads(d.abs);
    const names = (vfs.list(d.abs) ?? []).filter((n) => all || !n.startsWith('.'));
    const lines: string[] = [];
    for (const n of names) lines.push(await line(d.abs === '/' ? `/${n}` : `${d.abs}/${n}`, n));
    const body = lines.join('\n');
    sections.push(headings ? (body === '' ? `${d.typed}:` : `${d.typed}:\n${body}`) : body);
  }

  const nonEmpty = sections.filter((s) => s !== '');
  const stdout = nonEmpty.length === 0 ? '' : `${nonEmpty.join('\n\n')}\n`;
  return { stdout, stderr, code };
};

export const cd: Handler = (ctx, args) => {
  const operands = operandsOf(ctx, args);
  if (!Array.isArray(operands)) return operands;
  if (operands.length > 1) return usage(ctx.spec);
  const typed = operands[0];
  const target = typed === undefined ? HOME : resolvePath(ctx.session.cwd, typed);
  const st = ctx.vfs.stat(target);
  const shown = typed ?? HOME;
  if (!st) return fail('cd', `${shown}: ${MSG.noSuchFile}`);
  if (st.kind !== 'dir') return fail('cd', `${shown}: ${MSG.notADirectory}`);
  ctx.session.cwd = target;
  return ok();
};

export const pwd: Handler = (ctx) => ok(`${ctx.session.cwd}\n`);

// Text commands: cat, head, tail (and, in later tasks, grep awk sort uniq wc cut) (PRD SYS-09; R5.4-5.6, R5.18, R5.19, R6.1, R6.2, R4.15).

import { parseArgs } from '../argparse';
import { MSG, fail, unsupportedFlag, usage } from '../output';
import { resolvePath } from '../path';
import { compilePattern } from '../regex';
import { compareCodePoints, decodeUtf8, encodeUtf8, joinLines, splitLines } from '../text';
import type { CommandContext, CommandResult, Handler } from '../types';
import { FsError } from '../vfs';

const MAX_COUNT = 2_147_483_647;
const DEFAULT_COUNT = 10;

/** The message of a file-system error. Anything else is an internal error and propagates to the stage catch-all (R15.4). */
function reason(e: unknown): string {
  if (e instanceof FsError) return e.message;
  throw e;
}

/**
 * Reads every operand (or stdin when there is none) through the Virtual_FS with the tracker as sink.
 * `onText` gets each input's decoded text in order. A missing path, a directory or a read error prints
 * one `<cmd>: <path>: <reason>` line, and processing continues with the next operand (R5.18).
 */
async function readInputs(
  ctx: CommandContext,
  operands: string[],
  stdin: string,
  onText: (text: string, typed: string) => void,
): Promise<{ stderr: string; code: number }> {
  if (operands.length === 0) {
    onText(stdin, '(standard input)');
    return { stderr: '', code: 0 };
  }
  let stderr = '';
  let code = 0;
  for (const typed of operands) {
    const abs = resolvePath(ctx.session.cwd, typed);
    const st = ctx.vfs.stat(abs);
    let problem: string | undefined;
    if (!st) problem = MSG.noSuchFile;
    else if (st.kind === 'dir') problem = MSG.isADirectory;
    else {
      try {
        onText(decodeUtf8(await ctx.vfs.readBytes(abs, ctx.reads)), typed);
      } catch (e) {
        problem = reason(e);
      }
    }
    if (problem !== undefined) {
      stderr += `${ctx.name}: ${typed}: ${problem}\n`;
      code = 1;
    }
  }
  return { stderr, code };
}

export const cat: Handler = async (ctx, args, stdin) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  let stdout = '';
  const { stderr, code } = await readInputs(ctx, parsed.operands, stdin, (t) => {
    stdout += t;
  });
  return { stdout, stderr, code };
};

/** The line count from `-n <count>` or `-<count>`, or an error result. */
function lineCount(ctx: CommandContext, args: string[]): { count: number; operands: string[] } | CommandResult {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  const values = parsed.flags.get('-n');
  const raw = values && values.length > 0 ? values[values.length - 1] : parsed.count;
  let count = DEFAULT_COUNT;
  if (raw !== undefined) {
    if (!/^\d+$/.test(raw)) return usage(ctx.spec);
    count = Number(raw);
    if (!Number.isSafeInteger(count) || count > MAX_COUNT) return usage(ctx.spec);
  }
  return { count, operands: parsed.operands };
}

function selectLines(pick: (lines: string[], count: number) => string[]): Handler {
  return async (ctx, args, stdin) => {
    const opts = lineCount(ctx, args);
    if (!('count' in opts)) return opts;
    let stdout = '';
    const { stderr, code } = await readInputs(ctx, opts.operands, stdin, (t) => {
      stdout += joinLines(pick(splitLines(t), opts.count));
    });
    return { stdout, stderr, code };
  };
}

export const head: Handler = selectLines((lines, n) => lines.slice(0, n));

export const tail: Handler = selectLines((lines, n) => lines.slice(Math.max(0, lines.length - n)));

/** The result for a failed `parseArgs`: an unsupported flag names itself, a missing value prints the usage line. */
function badArgs(ctx: CommandContext, parsed: { kind: 'unsupported' | 'missing-value'; flag: string }): CommandResult {
  return parsed.kind === 'unsupported' ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);
}

export const grep: Handler = async (ctx, args, stdin) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  const operands = [...parsed.operands];
  const sources = [...(parsed.flags.get('-e') ?? [])];
  if (sources.length === 0) {
    const first = operands.shift();
    if (first === undefined) return usage(ctx.spec);
    sources.push(first);
  }
  const dialect = parsed.flags.has('-E') ? 'ere' : 'bre';
  const regexes: RegExp[] = [];
  for (const source of sources) {
    const compiled = compilePattern(dialect, source, parsed.flags.has('-i') ? 'i' : '');
    if (!compiled.ok) return fail(ctx.name, compiled.error);
    regexes.push(compiled.regex);
  }
  const invert = parsed.flags.has('-v');
  const countOnly = parsed.flags.has('-c');
  const numbered = parsed.flags.has('-n');
  const prefixed = operands.length > 1;

  let stdout = '';
  let selected = 0;
  const { stderr, code } = await readInputs(ctx, operands, stdin, (text, typed) => {
    const lines = splitLines(text);
    let count = 0;
    lines.forEach((line, i) => {
      if (regexes.some((r) => r.test(line)) === invert) return;
      count++;
      if (countOnly) return;
      stdout += `${prefixed ? `${typed}:` : ''}${numbered ? `${i + 1}:` : ''}${line}\n`;
    });
    selected += count;
    if (countOnly) stdout += `${prefixed ? `${typed}:` : ''}${count}\n`;
  });
  return { stdout, stderr, code: code !== 0 || selected === 0 ? 1 : 0 };
};

const AWK_PROGRAM = /^\s*(?:\/((?:[^/\\]|\\.)*)\/)?\s*\{\s*print\s+(.+?)\s*\}\s*$/;
const AWK_EXPR = /^(?:\$0|\$[1-9]\d?|\$NF|NR)$/;

export const awk: Handler = async (ctx, args, stdin) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  const unsupported = fail(ctx.name, MSG.unsupportedProgram);
  const [program, ...files] = parsed.operands;
  if (program === undefined) return usage(ctx.spec);

  const sepValues = parsed.flags.get('-F');
  const sep = sepValues && sepValues.length > 0 ? (sepValues[sepValues.length - 1] as string) : ' ';
  if ([...sep].length !== 1) return unsupported;

  const m = AWK_PROGRAM.exec(program);
  if (!m) return unsupported;
  const exprs = (m[2] as string).split(',').map((e) => e.trim());
  if (!exprs.every((e) => AWK_EXPR.test(e))) return unsupported;
  let filter: RegExp | undefined;
  if (m[1] !== undefined) {
    const compiled = compilePattern('ere', m[1]);
    if (!compiled.ok) return unsupported;
    filter = compiled.regex;
  }

  const split = (line: string): string[] => {
    if (sep === ' ') return line.split(/[ \t]+/).filter((f) => f !== '');
    return line === '' ? [] : line.split(sep);
  };
  const value = (expr: string, line: string, fields: string[], nr: number): string => {
    if (expr === '$0') return line;
    if (expr === 'NR') return String(nr);
    if (expr === '$NF') return fields[fields.length - 1] ?? '';
    return fields[Number(expr.slice(1)) - 1] ?? '';
  };

  let stdout = '';
  let nr = 0;
  const { stderr, code } = await readInputs(ctx, files, stdin, (text) => {
    for (const line of splitLines(text)) {
      nr++;
      if (filter && !filter.test(line)) continue;
      const fields = split(line);
      stdout += `${exprs.map((e) => value(e, line, fields, nr)).join(' ')}\n`;
    }
  });
  return { stdout, stderr, code };
};

/** The last value given to a flag, if any. */
function lastValue(flags: Map<string, string[]>, name: string): string | undefined {
  const values = flags.get(name);
  return values && values.length > 0 ? values[values.length - 1] : undefined;
}

/** An integer 1 to 99 written in plain digits, or undefined. */
function fieldNumber(text: string): number | undefined {
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= 1 && n <= 99 ? n : undefined;
}

/** The leading number of a string (`-n` compare), or 0 when it has none. */
function leadingNumber(text: string): number {
  const m = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/.exec(text);
  return m ? Number(m[0]) : 0;
}

export const sort: Handler = async (ctx, args, stdin) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  const reverse = parsed.flags.has('-r');
  const numeric = parsed.flags.has('-n');
  let field: number | undefined;
  const rawField = lastValue(parsed.flags, '-k');
  if (rawField !== undefined) {
    field = fieldNumber(rawField);
    if (field === undefined) return usage(ctx.spec);
  }

  const lines: string[] = [];
  const { stderr, code } = await readInputs(ctx, parsed.operands, stdin, (text) => {
    lines.push(...splitLines(text));
  });

  const keyOf = (line: string): string => {
    if (field === undefined) return line;
    const fields = line.split(/\s+/).filter((f) => f !== '');
    return fields[field - 1] ?? '';
  };
  const keyed = lines.map((line) => ({ line, key: keyOf(line) }));
  const direction = reverse ? -1 : 1;
  keyed.sort((a, b) => {
    const c = numeric ? leadingNumber(a.key) - leadingNumber(b.key) : compareCodePoints(a.key, b.key);
    return c === 0 ? 0 : c < 0 ? -direction : direction;
  });
  return { stdout: joinLines(keyed.map((k) => k.line)), stderr, code };
};

export const uniq: Handler = async (ctx, args, stdin) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  const counted = parsed.flags.has('-c');
  const groups: { line: string; n: number }[] = [];
  const { stderr, code } = await readInputs(ctx, parsed.operands, stdin, (text) => {
    for (const line of splitLines(text)) {
      const last = groups[groups.length - 1];
      if (last && last.line === line) last.n++;
      else groups.push({ line, n: 1 });
    }
  });
  const stdout = groups.map((g) => `${counted ? `${String(g.n).padStart(7)} ` : ''}${g.line}\n`).join('');
  return { stdout, stderr, code };
};

export const wc: Handler = async (ctx, args, stdin) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  const wantLines = parsed.flags.has('-l');
  const wantWords = parsed.flags.has('-w');
  const wantBytes = parsed.flags.has('-c');
  const all = !wantLines && !wantWords && !wantBytes;
  const columns = [all || wantLines, all || wantWords, all || wantBytes];

  const rows: { counts: number[]; name?: string }[] = [];
  const { stderr, code } = await readInputs(ctx, parsed.operands, stdin, (text, typed) => {
    let newlines = 0;
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) newlines++;
    const words = text.split(/\s+/).filter((w) => w !== '').length;
    const all3 = [newlines, words, encodeUtf8(text).length];
    rows.push({ counts: all3.filter((_, i) => columns[i]), name: parsed.operands.length > 0 ? typed : undefined });
  });
  if (parsed.operands.length > 1 && rows.length > 0) {
    const sums = (rows[0] as { counts: number[] }).counts.map((_, i) => rows.reduce((s, r) => s + (r.counts[i] as number), 0));
    rows.push({ counts: sums, name: 'total' });
  }

  const width = rows.length > 1 || (rows[0]?.counts.length ?? 0) > 1 ? Math.max(1, ...rows.flatMap((r) => r.counts.map((c) => String(c).length))) : 0;
  const stdout = rows
    .map((r) => `${[...r.counts.map((c) => String(c).padStart(width)), ...(r.name !== undefined ? [r.name] : [])].join(' ')}\n`)
    .join('');
  return { stdout, stderr, code };
};

export const cut: Handler = async (ctx, args, stdin) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return badArgs(ctx, parsed);
  const sep = lastValue(parsed.flags, '-d');
  const list = lastValue(parsed.flags, '-f');
  if (sep === undefined || list === undefined || [...sep].length !== 1) return usage(ctx.spec);
  const wanted = new Set<number>();
  for (const part of list.split(',')) {
    const n = fieldNumber(part);
    if (n === undefined) return usage(ctx.spec);
    wanted.add(n);
  }
  const order = [...wanted].sort((a, b) => a - b);

  let stdout = '';
  const { stderr, code } = await readInputs(ctx, parsed.operands, stdin, (text) => {
    for (const line of splitLines(text)) {
      if (!line.includes(sep)) {
        stdout += `${line}\n`;
        continue;
      }
      const fields = line.split(sep);
      stdout += `${order.filter((n) => n <= fields.length).map((n) => fields[n - 1]).join(sep)}\n`;
    }
  });
  return { stdout, stderr, code };
};

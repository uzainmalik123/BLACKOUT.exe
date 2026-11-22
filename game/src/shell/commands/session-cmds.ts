// Session commands: date, history, clear, help, man (R12).
// Handlers are function declarations (hoisted) because registry.ts and this file import each other;
// COMMANDS and COMMAND_NAMES are only read when a handler runs, never at module load.

import { gameTimeIso } from '../../engine/clock';
import type { World } from '../../engine/state';
import { COMMANDS, COMMAND_NAMES } from '../registry';
import { fail, noManualEntry, ok, unsupportedArgument, usage } from '../output';
import { historyEntries } from '../session';
import type { CommandContext, CommandName, CommandResult, CommandSpec } from '../types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HELP_SUMMARY_MAX = 80;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `Sun Nov  8 00:03:12 UTC 2026` from the in-game time; never reads the real clock (R12.1). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, ' ');
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${day} ${time} UTC ${d.getUTCFullYear()}`;
}

/** The error for the first argument of a command that takes none (R12.9), or undefined. */
function rejectArgs(ctx: { name: CommandName }, args: string[]): CommandResult | undefined {
  const first = args[0];
  return first !== undefined ? unsupportedArgument(ctx.name, first) : undefined;
}

export function date(ctx: CommandContext, args: string[]): CommandResult {
  return rejectArgs(ctx, args) ?? ok(`${formatDate(gameTimeIso(ctx.world as unknown as World))}\n`);
}

export function history(ctx: CommandContext, args: string[]): CommandResult {
  const bad = rejectArgs(ctx, args);
  if (bad) return bad;
  const lines = historyEntries(ctx.session).map((e) => `${String(e.n).padStart(5, ' ')}  ${e.line}`);
  return ok(lines.length > 0 ? `${lines.join('\n')}\n` : '');
}

export function clear(ctx: CommandContext, args: string[]): CommandResult {
  return rejectArgs(ctx, args) ?? { stdout: '', stderr: '', code: 0, clear: true };
}

export function help(ctx: CommandContext, args: string[]): CommandResult {
  const bad = rejectArgs(ctx, args);
  if (bad) return bad;
  const names = [...COMMAND_NAMES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ok(names.map((n) => `${n}  ${COMMANDS[n].summary.slice(0, HELP_SUMMARY_MAX)}`).join('\n') + '\n');
}

function manPage(spec: CommandSpec): string {
  const out: string[] = [`NAME`, `  ${spec.name} - ${spec.summary}`, '', 'USAGE', `  ${spec.usage}`];
  if (spec.forms && spec.forms.length > 0) {
    out.push('', 'FORMS');
    for (const f of spec.forms) out.push(`  ${spec.name} ${f}`);
  }
  out.push('', 'FLAGS');
  if (spec.flags.length === 0) out.push('  (none)');
  for (const f of spec.flags) {
    const label = f.valueName ? `${f.name} ${f.valueName}` : f.name;
    out.push(`  ${label}  ${f.summary}`);
  }
  out.push('', 'EXAMPLES');
  for (const e of spec.examples) out.push(`  ${e}`);
  return `${out.join('\n')}\n`;
}

export function man(ctx: CommandContext, args: string[]): CommandResult {
  const target = args[0];
  if (target === undefined) return usage(ctx.spec);
  const extra = args[1];
  if (extra !== undefined) return fail(ctx.name, `unsupported argument '${extra}'`);
  if (!(COMMAND_NAMES as readonly string[]).includes(target)) return noManualEntry(target);
  return ok(manPage(COMMANDS[target as CommandName]));
}

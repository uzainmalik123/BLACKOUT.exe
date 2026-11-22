// Output helpers and the message catalog (design: Error Handling, D-106).

import type { CommandResult, CommandSpec } from './types';

/**
 * Shows control characters in caret notation (`^[` for ESC, `^@` for NUL, `^?` for U+007F),
 * as `cat -v` does. `\n` and `\t` are kept. Nothing else is changed (D-106).
 */
export function sanitize(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a || c === 0x09) out += text[i];
    else if (c < 0x20) out += `^${String.fromCharCode(c + 64)}`;
    else if (c === 0x7f) out += '^?';
    else out += text[i];
  }
  return out;
}

/** Drops one final `\n`, so the terminal shows no blank last line. */
export function finish(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

export function ok(stdout = ''): CommandResult {
  return { stdout, stderr: '', code: 0 };
}

/** One error line `<cmd>: <message>` on stderr. */
export function fail(cmd: string, message: string, code = 1): CommandResult {
  return { stdout: '', stderr: `${cmd}: ${message}\n`, code };
}

/** `<cmd>: usage: <usage line from the registry>`, exit 1. */
export function usage(spec: Pick<CommandSpec, 'name' | 'usage'>): CommandResult {
  return fail(spec.name, `usage: ${spec.usage}`);
}

/** `<cmd>: <path as typed>: No such file or directory`, exit 1 (R4.8). */
export function notFound(cmd: string, typedPath: string): CommandResult {
  return fail(cmd, `${typedPath}: ${MSG.noSuchFile}`);
}

// ---- Message catalog ----

export const MSG = {
  noSuchFile: 'No such file or directory',
  notADirectory: 'Not a directory',
  isADirectory: 'Is a directory',
  permissionDenied: 'Permission denied',
  notPermitted: 'Operation not permitted',
  fileExists: 'File exists',
  ioError: 'Input/output error',
  internalError: 'internal error',
  missingOperand: 'missing operand',
  unsupportedProgram: 'unsupported program',
  unsupportedPattern: 'unsupported pattern',
  sqlReadonly: 'Error: attempt to write a readonly database',
  sqlUnavailable: 'Error: database is unavailable',
  sqlCannotOpen: 'unable to open database file',
} as const;

/** `<name>: command not found`, exit 127 (R1.8, R2.4). No prefix. */
export function commandNotFound(name: string): string {
  return `${name}: command not found`;
}

/** `sh: syntax error: <reason>`, exit 2 (R3.6, R3.7). */
export function syntaxError(reason: string): string {
  return `sh: syntax error: ${reason}`;
}

export const SYNTAX = {
  unterminatedQuote: 'unterminated quote',
  missingRedirectTarget: 'missing redirect target',
  unexpectedPipe: "unexpected '|'",
  unsupportedOperator: (op: string): string => `unsupported operator '${op}'`,
} as const;

/** `<cmd>: unsupported flag '<flag>'`, then the usage line; nothing else (R5.19, R12.9). */
export function unsupportedFlag(spec: Pick<CommandSpec, 'name' | 'usage'>, flag: string): CommandResult {
  return {
    stdout: '',
    stderr: `${spec.name}: unsupported flag '${flag}'\n${spec.name}: usage: ${spec.usage}\n`,
    code: 1,
  };
}

/** `<cmd>: unsupported argument '<arg>'` for date, history, clear, help (R12.9). */
export function unsupportedArgument(cmd: string, arg: string): CommandResult {
  return fail(cmd, `unsupported argument '${arg}'`);
}

/** `rm: cannot remove '<path>': <reason>` (R11). */
export function cannotRemove(typedPath: string, reason: string): CommandResult {
  return fail('rm', `cannot remove '${typedPath}': ${reason}`);
}

export function unitNotFound(name: string): CommandResult {
  return { stdout: '', stderr: `Unit ${name}.service could not be found.\n`, code: 1 };
}

export function tarNoSuchFile(path: string): CommandResult {
  return fail('tar', `${path}: ${MSG.noSuchFile}`);
}

export function tarInvalidName(name: string): CommandResult {
  return fail('tar', `invalid archive name '${name}'`);
}

export function noManualEntry(name: string): CommandResult {
  return { stdout: '', stderr: `No manual entry for ${name}\n`, code: 1 };
}

export const MAN_USAGE = 'man: usage: man <command>';

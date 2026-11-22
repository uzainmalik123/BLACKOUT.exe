// Flag and form parsing driven by the registry data (design: Registry and R12.10, D-107).

import type { CommandSpec, FlagSpec } from './types';

export interface ParsedArgs {
  /** Flag name (for example '-l', '-n') to the values it received, in order. Valueless flags map to []. */
  flags: Map<string, string[]>;
  /** `-<digits>` when `numericCount` is set, as a number-like string (for example '5'). */
  count?: string;
  operands: string[];
}

export type ParseArgsResult =
  | ({ ok: true } & ParsedArgs)
  | {
      ok: false;
      /** 'unsupported': the flag is not in `spec.flags`. 'missing-value': a flag that needs a value got none. */
      kind: 'unsupported' | 'missing-value';
      /** The flag as named in the error line, for example '-z'. */
      flag: string;
      /** `unsupported flag -z` or `flag -n needs a value`. */
      error: string;
    };

function unsupported(flag: string): ParseArgsResult {
  return { ok: false, kind: 'unsupported', flag, error: `unsupported flag ${flag}` };
}

function missingValue(flag: string): ParseArgsResult {
  return { ok: false, kind: 'missing-value', flag, error: `flag ${flag} needs a value` };
}

function addFlag(flags: Map<string, string[]>, name: string, value?: string): void {
  const list = flags.get(name) ?? [];
  if (value !== undefined) list.push(value);
  flags.set(name, list);
}

/**
 * Parses argv against `spec.flags`.
 * - Bundled short flags (`-la`).
 * - A multi-letter flag only when the whole token equals a flag name (`-header`, `-sV`).
 * - Values attached (`-F:`) or separate (`-n 5`) per `FlagSpec.value`.
 * - `--` ends the flags; a lone `-` is an operand.
 * - `-<digits>` when `numericCount` is set.
 */
export function parseArgs(spec: Pick<CommandSpec, 'flags' | 'numericCount'>, argv: readonly string[]): ParseArgsResult {
  const byName = new Map<string, FlagSpec>(spec.flags.map((f) => [f.name, f]));
  const flags = new Map<string, string[]>();
  const operands: string[] = [];
  let count: string | undefined;
  let flagsEnded = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (flagsEnded || token === '-' || !token.startsWith('-')) {
      operands.push(token);
      continue;
    }
    if (token === '--') {
      flagsEnded = true;
      continue;
    }
    if (spec.numericCount && /^-\d+$/.test(token)) {
      count = token.slice(1);
      continue;
    }

    // Whole-token match: any flag name, including multi-letter ones.
    const whole = byName.get(token);
    if (whole) {
      if (whole.value === 'separate' || whole.value === 'either') {
        if (i + 1 >= argv.length) return missingValue(token);
        addFlag(flags, token, argv[++i] as string);
      } else if (whole.value === 'attached') {
        return missingValue(token);
      } else {
        addFlag(flags, token);
      }
      continue;
    }

    // `--word` forms are never bundles.
    if (token.startsWith('--')) return unsupported(token);

    // Bundled short flags: -la, -F:, -n5.
    for (let j = 1; j < token.length; j++) {
      const name = `-${token.charAt(j)}`;
      const flag = byName.get(name);
      if (!flag) return unsupported(name);
      if (!flag.value) {
        addFlag(flags, name);
        continue;
      }
      const rest = token.slice(j + 1);
      if (rest !== '') {
        if (flag.value === 'separate') return unsupported(name);
        addFlag(flags, name, rest);
      } else if (flag.value === 'attached') {
        return missingValue(name);
      } else {
        if (i + 1 >= argv.length) return missingValue(name);
        addFlag(flags, name, argv[++i] as string);
      }
      break;
    }
  }

  return { ok: true, flags, count, operands };
}

export interface FormMatch {
  /** Index into the `forms` array. */
  index: number;
  /** Captured placeholders by name (`<ip>` is `ip`). A trailing `<x>...` captures a string[] (1 or more). */
  values: Record<string, string | string[]>;
}

/**
 * Matches argv against grammar forms such as `-A INPUT -s <ip> -j DROP` or
 * `<status|stop|start|restart> <unit>`. Literal tokens must be equal; `<a|b>` accepts only the listed
 * words and is captured as `choice`; `<name>` accepts any one token; `<name>...` at the end takes one or more tokens.
 * The matcher is structural; handlers validate values (for example IPv4).
 * Returns the first form that matches, or undefined.
 */
export function parseForms(forms: readonly string[], argv: readonly string[]): FormMatch | undefined {
  for (let index = 0; index < forms.length; index++) {
    const values = matchForm((forms[index] as string).split(/\s+/).filter((t) => t !== ''), argv);
    if (values) return { index, values };
  }
  return undefined;
}

function matchForm(tokens: string[], argv: readonly string[]): Record<string, string | string[]> | undefined {
  const values: Record<string, string | string[]> = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const argvToken = argv[i] as string;
    const rest = /^<([^<>]+)>\.\.\.$/.exec(token);
    if (rest) {
      if (i !== tokens.length - 1 || argv.length - i < 1) return undefined;
      values[rest[1] as string] = argv.slice(i);
      return values;
    }
    if (i >= argv.length) return undefined;
    const placeholder = /^<([^<>]+)>$/.exec(token);
    if (placeholder) {
      const body = placeholder[1] as string;
      if (body.includes('|')) {
        if (!body.split('|').includes(argvToken)) return undefined;
        values.choice = argvToken;
      } else {
        values[body] = argvToken;
      }
    } else if (token !== argvToken) {
      return undefined;
    }
  }
  return argv.length === tokens.length ? values : undefined;
}

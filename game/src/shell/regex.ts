// Pattern compiler for `grep` and `awk` (D-105, R5.7, R5.21). Pure: no Engine imports, never throws.
//
// BRE (`grep` without -E): `. * ^ $ [ ]` are special; `+ ? | ( ) { }` are literal.
// ERE (`grep -E`, `awk /re/`): the extended operators are special (a JavaScript RegExp).
// Bracket expressions follow POSIX in both dialects (a backslash inside `[ ]` is literal).
//
// A pattern is rejected as unsupported if it is longer than 256 characters, has a back-reference,
// quantifies a group that itself holds a quantifier (`(a+)+`), or has a counted repeat above 255.

export type RegexDialect = 'bre' | 'ere';

export type CompileResult =
  | { ok: true; regex: RegExp }
  | { ok: false; reason: 'unsupported' | 'invalid'; error: string };

export const MAX_PATTERN_LENGTH = 256;
export const MAX_REPEAT = 255;

const UNSUPPORTED: CompileResult = { ok: false, reason: 'unsupported', error: 'unsupported pattern' };
const INVALID: CompileResult = { ok: false, reason: 'invalid', error: 'invalid pattern' };

const POSIX_CLASSES: Readonly<Record<string, string>> = {
  alpha: 'a-zA-Z',
  digit: '0-9',
  alnum: 'a-zA-Z0-9',
  upper: 'A-Z',
  lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v',
  blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~',
  xdigit: '0-9A-Fa-f',
};

function escapeLiteral(c: string): string {
  return /[\\^$.*+?()[\]{}|/]/.test(c) ? `\\${c}` : c;
}

function escapeInClass(c: string): string {
  return c === '\\' || c === ']' || c === '[' || c === '^' ? `\\${c}` : c;
}

/**
 * Translates a bracket expression starting at `src[start] === '['`.
 * Returns the JavaScript class text and the index after the closing `]`, or undefined when invalid.
 */
function translateClass(src: string, start: number): { text: string; next: number } | undefined {
  let j = start + 1;
  let out = '[';
  if (src.charAt(j) === '^') {
    out += '^';
    j++;
  }
  let first = true;
  for (;;) {
    if (j >= src.length) return undefined;
    const c = src.charAt(j);
    if (c === ']' && !first) return { text: `${out}]`, next: j + 1 };
    first = false;
    if (c === '[' && (src.charAt(j + 1) === ':' || src.charAt(j + 1) === '.' || src.charAt(j + 1) === '=')) {
      if (src.charAt(j + 1) !== ':') return undefined;
      const end = src.indexOf(':]', j + 2);
      if (end < 0) return undefined;
      const body = POSIX_CLASSES[src.slice(j + 2, end)] as string | undefined;
      if (body === undefined) return undefined;
      out += body;
      j = end + 2;
      continue;
    }
    out += c === '-' ? '-' : escapeInClass(c);
    j++;
  }
}

type Last = 'none' | 'atom' | 'group' | 'quant';

interface Frame {
  hasQuant: boolean;
}

function translate(dialect: RegexDialect, src: string): { js: string } | { fail: CompileResult } {
  const ere = dialect === 'ere';
  const stack: Frame[] = [{ hasQuant: false }];
  let out = '';
  let last = 'none' as Last;
  let lastGroupHad = false;

  const top = (): Frame => stack[stack.length - 1] as Frame;

  const quantify = (text: string): CompileResult | undefined => {
    if (last === 'none') return INVALID;
    if (last === 'quant') {
      // A `?` right after a quantifier is JavaScript's lazy marker; anything else is left to RegExp to judge.
      out += text;
      return undefined;
    }
    if (last === 'group' && lastGroupHad) return UNSUPPORTED;
    out += text;
    top().hasQuant = true;
    last = 'quant';
    return undefined;
  };

  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);

    if (c === '\\') {
      const n = src.charAt(i + 1);
      if (n === '') return { fail: INVALID };
      if ((n >= '1' && n <= '9') || (ere && n === 'k')) return { fail: UNSUPPORTED };
      out += ere ? `\\${n}` : escapeLiteral(n);
      last = 'atom';
      i += 2;
      continue;
    }

    if (c === '[') {
      const cls = translateClass(src, i);
      if (!cls) return { fail: INVALID };
      out += cls.text;
      last = 'atom';
      i = cls.next;
      continue;
    }

    if (c === '.') {
      out += '.';
      last = 'atom';
      i++;
      continue;
    }

    if (c === '*') {
      if (last === 'none' && !ere) {
        out += '\\*'; // a leading `*` is literal in a basic regex
        last = 'atom';
      } else if (!ere && last === 'quant') {
        // `a**` is `a*` in POSIX; JavaScript would reject it
      } else {
        const bad = quantify('*');
        if (bad) return { fail: bad };
      }
      i++;
      continue;
    }

    if (c === '^') {
      if (!ere && i !== 0) {
        out += '\\^';
        last = 'atom';
      } else {
        out += '^';
        // an anchor starts a fresh context: a following `*` is literal in BRE
        if (!ere) last = 'none';
      }
      i++;
      continue;
    }

    if (c === '$') {
      out += !ere && i !== src.length - 1 ? '\\$' : '$';
      last = 'atom';
      i++;
      continue;
    }

    if (!ere) {
      out += escapeLiteral(c);
      last = 'atom';
      i++;
      continue;
    }

    // ERE only from here on
    if (c === '+' || c === '?') {
      const bad = quantify(c);
      if (bad) return { fail: bad };
      i++;
      continue;
    }

    if (c === '{') {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i));
      if (!m) {
        out += '\\{';
        last = 'atom';
        i++;
        continue;
      }
      const lo = Number(m[1]);
      const hi = m[3] ? Number(m[3]) : 0;
      if (lo > MAX_REPEAT || hi > MAX_REPEAT) return { fail: UNSUPPORTED };
      const bad = quantify(m[0]);
      if (bad) return { fail: bad };
      i += m[0].length;
      continue;
    }

    if (c === '|') {
      out += '|';
      last = 'none';
      i++;
      continue;
    }

    if (c === '(') {
      if (src.charAt(i + 1) === '?') return { fail: UNSUPPORTED };
      stack.push({ hasQuant: false });
      out += '(';
      last = 'none';
      i++;
      continue;
    }

    if (c === ')') {
      if (stack.length < 2) return { fail: INVALID };
      const frame = stack.pop() as Frame;
      top().hasQuant ||= frame.hasQuant;
      lastGroupHad = frame.hasQuant;
      out += ')';
      last = 'group';
      i++;
      continue;
    }

    out += escapeLiteral(c);
    last = 'atom';
    i++;
  }

  if (stack.length !== 1) return { fail: INVALID };
  return { js: out };
}

/**
 * Compiles a `grep` or `awk` pattern. Never throws: every failure is an error result, and
 * `RegExp` construction is wrapped.
 */
export function compilePattern(dialect: RegexDialect, source: string, flags = ''): CompileResult {
  try {
    if (source.length > MAX_PATTERN_LENGTH) return UNSUPPORTED;
    const t = translate(dialect, source);
    if ('fail' in t) return t.fail;
    return { ok: true, regex: new RegExp(t.js, flags) };
  } catch {
    return INVALID;
  }
}

// TEST-ONLY. The shared fast-check arbitraries for the Shell's property tests. Later tasks add arbPipeline,
// arbForbiddenSyntaxLine, arbUnlistedName, arbGlobCase, arbWhere and the rest here.
import fc from 'fast-check';
import { COMMAND_LIST } from '../index';
import type { Pipeline, Word } from '../types';

/** Characters a word may hold: letters, digits, the shell's safe set and the characters that force quoting. */
const WORD_CHARS = 'abcXYZ019_@%+=:,./~*- |>\'"$;&()\\\t#?!é';

/** One non-empty word text (any of the above, so printing has to quote some of them). */
export const arbWord: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 12 })
  .map((cs) => cs.join(''));

const PRINT_SAFE = /^[A-Za-z0-9_@%+=:,./~*-]+$/;

/**
 * A Word whose `literal` flag is consistent with the parser's rule: `literal` may be true only when the text holds
 * `*` or starts with `~`, and it is forced true when the printer has to quote such a text (the parser then sees a
 * quoted word).
 */
export const arbShellWord: fc.Arbitrary<Word> = fc
  .tuple(fc.oneof(arbWord, fc.constant('')), fc.boolean())
  .map(([text, coin]) => {
    const special = text.includes('*') || text.startsWith('~');
    return { text, literal: special && (coin || !PRINT_SAFE.test(text)) };
  });

/** A Pipeline as the parser can produce it: one to four stages, an optional redirect target. */
export const arbPipeline: fc.Arbitrary<Pipeline> = fc
  .tuple(
    fc.array(fc.tuple(arbShellWord, fc.array(arbShellWord, { maxLength: 4 })), { minLength: 1, maxLength: 4 }),
    fc.option(arbShellWord, { nil: undefined }),
  )
  .map(([stages, target]) => {
    const pipeline: Pipeline = { stages: stages.map(([name, args]) => ({ name, args })) };
    if (target !== undefined) pipeline.redirect = { target };
    return pipeline;
  });

/** A command name that is not in COMMAND_LIST: the usual outsiders, path-like names, prototype keys and random ones. */
export const arbUnlistedName: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom(
      'sudo', 'vim', 'docker', 'apt', 'npm', 'pip', 'bash', 'echo', './x.sh', '/bin/ls', 'LS', 'lss',
      'constructor', 'toString', '__proto__', 'hasOwnProperty',
    ),
    fc
      .array(fc.constantFrom(...'abcXYZ019_@%+=:,./-'), { minLength: 1, maxLength: 10 })
      .map((cs) => cs.join('')),
  )
  .filter((n) => !(COMMAND_LIST as readonly string[]).includes(n));

/** A text line: no newline or carriage return, may be empty. */
const arbLine: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abc XYZ019_:,./-|\té'), { maxLength: 20 })
  .map((cs) => cs.join(''));

/** A list of lines, as `splitLines` and the text commands see them. */
export const arbLines: fc.Arbitrary<string[]> = fc.array(arbLine, { maxLength: 30 });

const GLOB_CHARS = ['a', 'b', 'A', '.', '-'];

/** A directory's names (distinct, non-empty, no `/`) and one single-segment pattern of literals and `*`. */
export const arbGlobCase: fc.Arbitrary<{ names: string[]; pattern: string }> = fc.record({
  names: fc
    .uniqueArray(
      fc.array(fc.constantFrom(...GLOB_CHARS), { minLength: 1, maxLength: 5 }).map((cs) => cs.join('')),
      { maxLength: 12 },
    )
    .filter((ns) => ns.every((n) => n !== '.' && n !== '..')),
  pattern: fc
    .array(fc.constantFrom(...GLOB_CHARS, '*', '*'), { minLength: 1, maxLength: 6 })
    .map((cs) => cs.join('')),
});

// ---- Unsupported syntax (Property 2) ----

/** Operators that are a syntax error when they appear outside quotes. */
export const FORBIDDEN_OPERATORS = [';', '&&', '||', '&', '>>', '<', '2>', '$', '`', '(', ')'] as const;

const SYNTAX_WORDS = ['ls', 'cat', 'foo', 'a.log', '-l', 'x', '~', '*.log'];
const arbSyntaxWord = fc.constantFrom(...SYNTAX_WORDS);
const arbGap = fc.constantFrom(' ', '  ', '\t');

/** A line with one unquoted forbidden construct (an operator, a bad pipe, a bare `>` or an open quote). */
export const arbForbiddenSyntaxLine: fc.Arbitrary<string> = fc
  .tuple(
    arbSyntaxWord,
    arbSyntaxWord,
    arbGap,
    fc.oneof(
      fc.constantFrom(...FORBIDDEN_OPERATORS).map((op) => (a: string, b: string, g: string) => `${a}${g}${op}${g}${b}`),
      // Glued to a word, `2>` is a plain redirect of `<word>2`, so it is left out here.
      fc
        .constantFrom(...FORBIDDEN_OPERATORS.filter((op) => op !== '2>'))
        .map((op) => (a: string, b: string) => `${a}${op}${b}`),
      fc.constant((a: string, b: string, g: string) => `|${g}${a} ${b}`),
      fc.constant((a: string, b: string, g: string) => `${a} ${b}${g}|`),
      fc.constant((a: string, b: string, g: string) => `${a}${g}|${g}|${g}${b}`),
      fc.constant((a: string, b: string, g: string) => `${a} ${b}${g}>`),
      fc.constantFrom("'", '"').map((q) => (a: string, b: string, g: string) => `${a}${g}${q}${b}`),
    ),
  )
  .map(([a, b, g, build]) => build(a, b, g));

/** The same operators inside quotes: a line with an unlisted command name, so nothing runs and no syntax error shows. */
export const arbQuotedOperatorLine: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('foo', 'zork'),
    fc.constantFrom(...FORBIDDEN_OPERATORS, '|', '>'),
    fc.constantFrom("'", '"'),
  )
  .map(([name, op, q]) => `${name} ${q}a ${op} b${q}`);

// Parser (SYS-09, R3.5-R3.7, R3.13, R3.14, R3.16, R2.7; D-104). Pure, no Engine imports.
// One pass, three modes: unquoted, single-quoted, double-quoted. No backslash escapes.
// Globs and `~` stay unexpanded in the structure; expansion happens at execution time.

import { SYNTAX, syntaxError } from './output';
import type { Pipeline, Stage, Word } from './types';

export type ParseResult = { ok: true; pipeline: Pipeline } | { ok: false; error: string };

const UNQUOTED_FORBIDDEN = new Set([';', '&', '<', '$', '`', '(', ')']);

function fail(reason: string): ParseResult {
  return { ok: false, error: syntaxError(reason) };
}

export function parseLine(line: string): ParseResult {
  const stages: Stage[] = [];
  let words: Word[] = [];
  let redirect: Word | undefined;
  let redirectSeen = false;

  // Current word state.
  let text = '';
  let inWord = false;
  let quoted = false;

  const endWord = (): void => {
    if (!inWord) return;
    const word: Word = {
      text,
      literal: quoted && (text.includes('*') || text.startsWith('~')),
    };
    if (redirectSeen) {
      if (redirect === undefined) redirect = word;
      else extraAfterRedirect = true;
    } else {
      words.push(word);
    }
    text = '';
    inWord = false;
    quoted = false;
  };
  let extraAfterRedirect = false;

  const endStage = (): boolean => {
    const [name, ...args] = words;
    if (name === undefined) return false;
    stages.push({ name, args });
    words = [];
    return true;
  };

  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);

    if (ch === "'" || ch === '"') {
      const close = line.indexOf(ch, i + 1);
      if (close === -1) return fail(SYNTAX.unterminatedQuote);
      text += line.slice(i + 1, close);
      inWord = true;
      quoted = true;
      i = close + 1;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      endWord();
      i++;
      continue;
    }

    if (ch === '|') {
      if (line[i + 1] === '|') return fail(SYNTAX.unsupportedOperator('||'));
      endWord();
      if (redirectSeen) return fail(SYNTAX.unsupportedOperator('|'));
      if (!endStage()) return fail(SYNTAX.unexpectedPipe);
      i++;
      // A pipe must be followed by another stage.
      if (line.slice(i).trim() === '') return fail(SYNTAX.unexpectedPipe);
      continue;
    }

    if (ch === '>') {
      if (line[i + 1] === '>') return fail(SYNTAX.unsupportedOperator('>>'));
      if (inWord && !quoted && text === '2') return fail(SYNTAX.unsupportedOperator('2>'));
      endWord();
      if (redirectSeen) return fail(SYNTAX.unsupportedOperator('>'));
      redirectSeen = true;
      i++;
      continue;
    }

    if (ch === '&') {
      return fail(SYNTAX.unsupportedOperator(line[i + 1] === '&' ? '&&' : '&'));
    }
    if (UNQUOTED_FORBIDDEN.has(ch)) return fail(SYNTAX.unsupportedOperator(ch));

    text += ch;
    inWord = true;
    i++;
  }

  endWord();

  if (redirectSeen) {
    if (redirect === undefined) return fail(SYNTAX.missingRedirectTarget);
    if (extraAfterRedirect) return fail('unexpected word after redirect target');
    if (words.length === 0 && stages.length === 0) return fail('missing command');
  }

  if (words.length > 0) endStage();
  else if (stages.length > 0 && !redirectSeen) return fail(SYNTAX.unexpectedPipe);
  else if (stages.length > 0 && redirectSeen && words.length === 0) {
    // `a | > f`: the last stage is empty.
    // (stages already holds `a`, but the pipe promised another stage; the trailing check above
    // does not fire because the redirect text follows the pipe.)
    return fail('missing command');
  }

  const pipeline: Pipeline = { stages };
  if (redirect !== undefined) pipeline.redirect = { target: redirect };
  return { ok: true, pipeline };
}

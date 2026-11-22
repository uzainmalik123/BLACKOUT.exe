// Pretty_Printer (PRD SYS-09, R3.8, R3.9). Pure; no Engine imports.

import type { Pipeline, Word } from './types';

const SAFE = /^[A-Za-z0-9_@%+=:,./~*-]+$/;

// Characters the lexer treats specially when unquoted. A non-literal word without any of them reads back unchanged.
const LEXER_SPECIAL = /[\s|>&;<$`()'"]/;

function printWord(w: Word): string {
  if (w.literal) return `'${w.text.replace(/'/g, `'"'"'`)}'`;
  // Quoting would mark a word with `*` or a leading `~` as literal, so such a word stays bare unless the lexer
  // would misread it (e.g. `~é` or `*#` come from the parser as non-literal and must print without quotes).
  const special = w.text.includes('*') || w.text.startsWith('~');
  if (w.text !== '' && (SAFE.test(w.text) || (special && !LEXER_SPECIAL.test(w.text)))) return w.text;
  return `'${w.text.replace(/'/g, `'"'"'`)}'`;
}

export function printLine(p: Pipeline): string {
  const body = p.stages
    .map((s) => [s.name, ...s.args].map(printWord).join(' '))
    .join(' | ');
  return p.redirect ? `${body} > ${printWord(p.redirect.target)}` : body;
}

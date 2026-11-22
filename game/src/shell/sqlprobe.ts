// SQL statement splitting and classification for `sqlite3` (R7.17, R7.18, D-103).
// Pure: no Engine imports.

/** One lexical token. Strings, comments and whitespace never show up as words or punctuation. */
export type SqlToken =
  | { kind: 'word'; text: string; upper: string; depth: number; start: number; end: number }
  | { kind: 'quoted'; text: string; depth: number; start: number; end: number; terminated: boolean }
  | { kind: 'punct'; text: string; depth: number; start: number; end: number };

export type SqlScan = {
  tokens: SqlToken[];
  /** True when a quote or a block comment runs to the end of the input. */
  unterminated: boolean;
};

const isWordChar = (c: string): boolean => /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 127;

/**
 * Tokenize `sql`, tracking `'`, `"`, backtick and `[ ]` quoting, `--` and `/* *\/` comments and
 * parenthesis depth. A token's `depth` is the number of open parentheses before it; `(` carries the
 * outer depth and `)` the depth after closing, so both sit at the depth of their group's surroundings.
 */
export function scanSql(sql: string): SqlScan {
  const tokens: SqlToken[] = [];
  let unterminated = false;
  let depth = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql.charAt(i);
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === '-' && sql.charAt(i + 1) === '-') {
      const nl = sql.indexOf('\n', i + 2);
      i = nl === -1 ? n : nl + 1;
    } else if (c === '/' && sql.charAt(i + 1) === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close === -1) {
        unterminated = true;
        i = n;
      } else {
        i = close + 2;
      }
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const closer = c === '[' ? ']' : c;
      const close = sql.indexOf(closer, i + 1);
      const terminated = close !== -1;
      const end = terminated ? close + 1 : n;
      if (!terminated) unterminated = true;
      tokens.push({
        kind: 'quoted',
        text: sql.slice(i + 1, terminated ? close : n),
        depth,
        start: i,
        end,
        terminated,
      });
      i = end;
    } else if (isWordChar(c)) {
      let j = i + 1;
      while (j < n && isWordChar(sql.charAt(j))) j += 1;
      const text = sql.slice(i, j);
      tokens.push({ kind: 'word', text, upper: text.toUpperCase(), depth, start: i, end: j });
      i = j;
    } else {
      if (c === '(') {
        tokens.push({ kind: 'punct', text: c, depth, start: i, end: i + 1 });
        depth += 1;
      } else if (c === ')') {
        depth = Math.max(0, depth - 1);
        tokens.push({ kind: 'punct', text: c, depth, start: i, end: i + 1 });
      } else {
        tokens.push({ kind: 'punct', text: c, depth, start: i, end: i + 1 });
      }
      i += 1;
    }
  }
  return { tokens, unterminated };
}

/** Cut on `;` outside quotes, comments and parentheses. Pieces with no tokens are dropped. */
export function splitStatements(sql: string): string[] {
  const { tokens } = scanSql(sql);
  const pieces: string[] = [];
  let from = 0;
  let count = 0;
  const flush = (to: number): void => {
    if (count > 0) pieces.push(sql.slice(from, to).trim());
    count = 0;
  };
  for (const t of tokens) {
    if (t.kind === 'punct' && t.text === ';' && t.depth === 0) {
      flush(t.start);
      from = t.end;
    } else {
      count += 1;
    }
  }
  flush(sql.length);
  return pieces;
}

export type StatementClass = 'read' | 'lock' | 'delete' | 'refused';

const WRITE_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'CREATE',
  'DROP',
  'ALTER',
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
]);

const READ_PRAGMAS = new Set([
  'TABLE_INFO',
  'TABLE_XINFO',
  'INDEX_LIST',
  'FOREIGN_KEY_LIST',
  'DATABASE_LIST',
]);

function isReadPragma(tokens: SqlToken[]): boolean {
  // PRAGMA [schema .] name [( arg )]; assignment forms are not reads.
  let i = 1;
  const dot = tokens[i + 1];
  if (dot?.kind === 'punct' && dot.text === '.') i += 2;
  const name = tokens[i];
  if (name === undefined || name.kind !== 'word' || !READ_PRAGMAS.has(name.upper)) return false;
  const next = tokens[i + 1];
  return next === undefined || (next.kind === 'punct' && next.text === '(');
}

/**
 * Classify one statement. Writes are decided by `parseWrite`, so a refused write form is `refused`.
 * Anything not clearly a read, lock or delete is `refused`.
 */
export function classifyStatement(stmt: string): StatementClass {
  const { tokens } = scanSql(stmt);
  const first = tokens[0];
  if (first === undefined || first.kind !== 'word') return 'refused';
  switch (first.upper) {
    case 'SELECT':
    case 'VALUES':
      return 'read';
    case 'WITH':
      // A write keyword anywhere outside strings and comments, at any depth, makes it a write.
      return tokens.some((t) => t.kind === 'word' && WRITE_KEYWORDS.has(t.upper)) ? 'refused' : 'read';
    case 'PRAGMA':
      return isReadPragma(tokens) ? 'read' : 'refused';
    case 'UPDATE':
    case 'DELETE': {
      const w = parseWrite(stmt);
      return w.kind === 'refused' ? 'refused' : w.kind;
    }
    default:
      return 'refused';
  }
}

export type ParsedWrite =
  | { kind: 'lock'; expr: string; where?: string }
  | { kind: 'delete'; where?: string }
  | { kind: 'refused'; reason: string };

const refuse = (reason: string): ParsedWrite => ({ kind: 'refused', reason });

const CLAUSE_STOPS = new Set(['WHERE', 'RETURNING', 'ORDER', 'LIMIT']);

/** True when `t` is a depth-0 word equal to one of `names` (all uppercase). */
const isKw = (t: SqlToken | undefined, names: ReadonlySet<string> | string): boolean =>
  t !== undefined &&
  t.kind === 'word' &&
  t.depth === 0 &&
  (typeof names === 'string' ? t.upper === names : names.has(t.upper));

const isUsers = (t: SqlToken | undefined): boolean =>
  t !== undefined && (t.kind === 'word' || (t.kind === 'quoted' && t.terminated)) && t.text.toLowerCase() === 'users';

/**
 * Check the tokens of an expression or WHERE part (`tokens[from..to)`) and return its text, or a
 * refusal reason. Refuses the clauses and forms the Shell does not model.
 */
function clauseText(stmt: string, tokens: SqlToken[], from: number, to: number, what: string): string | ParsedWrite {
  if (to <= from) return refuse(`missing ${what}`);
  for (let i = from; i < to; i += 1) {
    const t = tokens[i];
    if (t === undefined) continue;
    if (isKw(t, 'RETURNING')) return refuse('RETURNING is not supported');
    if (isKw(t, 'ORDER')) return refuse('ORDER BY is not supported');
    if (isKw(t, 'LIMIT')) return refuse('LIMIT is not supported');
    if (isKw(t, 'FROM')) return refuse('FROM is not supported');
  }
  const first = tokens[from];
  const last = tokens[to - 1];
  if (first === undefined || last === undefined) return refuse(`missing ${what}`);
  return stmt.slice(first.start, last.end);
}

/**
 * Recognize `UPDATE Users SET deletedAt = <expr> [WHERE <w>]` and `DELETE FROM Users [WHERE <w>]`
 * (case-insensitive, table optionally quoted). Any other write form, extra clause, unbalanced
 * parenthesis or unterminated quote or comment is `refused`. Pure.
 */
export function parseWrite(stmt: string): ParsedWrite {
  const { tokens, unterminated } = scanSql(stmt);
  if (unterminated || tokens.some((t) => t.kind === 'quoted' && !t.terminated)) {
    return refuse('unterminated quote or comment');
  }
  let open = 0;
  for (const t of tokens) {
    if (t.kind !== 'punct') continue;
    if (t.text === '(') open += 1;
    else if (t.text === ')') {
      open -= 1;
      if (open < 0) return refuse('unbalanced parentheses');
    }
  }
  if (open !== 0) return refuse('unbalanced parentheses');

  const first = tokens[0];
  if (first === undefined || first.kind !== 'word') return refuse('not a write');
  const stopIndex = (from: number): number => {
    for (let i = from; i < tokens.length; i += 1) if (isKw(tokens[i], CLAUSE_STOPS)) return i;
    return tokens.length;
  };

  if (first.upper === 'UPDATE') {
    const second = tokens[1];
    if (isKw(second, 'OR')) return refuse('UPDATE OR is not supported');
    if (!isUsers(second)) return refuse('only the Users table can be written');
    if (!isKw(tokens[2], 'SET')) return refuse('alias or schema is not supported');
    const column = tokens[3];
    const eq = tokens[4];
    if (
      column === undefined ||
      column.kind === 'punct' ||
      (column.kind === 'quoted' && !column.terminated) ||
      column.text.toLowerCase() !== 'deletedat'
    ) {
      return refuse('only deletedAt can be set');
    }
    if (eq?.kind !== 'punct' || eq.text !== '=') return refuse('only deletedAt can be set');
    const end = stopIndex(5);
    for (let i = 5; i < end; i += 1) {
      const t = tokens[i];
      if (t?.kind === 'punct' && t.text === ',' && t.depth === 0) return refuse('only one column can be set');
    }
    const expr = clauseText(stmt, tokens, 5, end, 'expression');
    if (typeof expr !== 'string') return expr;
    const stop = tokens[end];
    if (stop === undefined) return { kind: 'lock', expr };
    if (!isKw(stop, 'WHERE')) return refuse(`${stop.kind === 'word' ? stop.upper : 'clause'} is not supported`);
    const where = clauseText(stmt, tokens, end + 1, tokens.length, 'WHERE condition');
    if (typeof where !== 'string') return where;
    return { kind: 'lock', expr, where };
  }

  if (first.upper === 'DELETE') {
    if (!isKw(tokens[1], 'FROM')) return refuse('not a write');
    if (!isUsers(tokens[2])) return refuse('only the Users table can be written');
    const stop = tokens[3];
    if (stop === undefined) return { kind: 'delete' };
    if (!isKw(stop, 'WHERE')) return refuse('alias or extra clause is not supported');
    const where = clauseText(stmt, tokens, 4, tokens.length, 'WHERE condition');
    if (typeof where !== 'string') return where;
    return { kind: 'delete', where };
  }
  return refuse('not a write');
}

/** Wrap player text in parentheses; a `--` comment inside could swallow the `)`, so break the line. */
const wrap = (text: string): string => (text.includes('--') ? `(\n${text}\n)` : `(${text})`);

/**
 * The read-only probe for a recognized write (R7.5). A lock gets the expression column; a delete does
 * not. Callers run it through `db.exec`, never the tracker.
 */
export function buildProbe(write: ParsedWrite & { kind: 'lock' | 'delete' }): string {
  const cols = write.kind === 'lock' ? `id, email, deletedAt, ${wrap(write.expr)}` : 'id, email, deletedAt';
  const where = write.where === undefined ? '' : ` WHERE ${wrap(write.where)}`;
  return `SELECT ${cols} FROM Users${where}`;
}

import { describe, expect, it } from 'vitest';
import { parseLine } from './parser';
import { printLine } from './printer';
import type { Pipeline, Stage } from './types';

function parsed(line: string): Pipeline {
  const r = parseLine(line);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(line)} to parse, got: ${r.error}`);
  return r.pipeline;
}

function errorOf(line: string): string {
  const r = parseLine(line);
  if (r.ok) throw new Error(`expected ${JSON.stringify(line)} to fail`);
  return r.error;
}

function stage0(line: string): Stage {
  const s = parsed(line).stages[0];
  if (s === undefined) throw new Error('no stage');
  return s;
}

const texts = (line: string): string[] => {
  const s = stage0(line);
  return [s.name.text, ...s.args.map((w) => w.text)];
};

describe('parser: quoting (R3.5, R3.14, D-104)', () => {
  it('joins adjacent quoted and unquoted pieces into one word', () => {
    expect(texts('echo a"b c"d')).toEqual(['echo', 'ab cd']);
    expect(texts("echo a'b c'd")).toEqual(['echo', 'ab cd']);
    expect(texts(`echo 'a'"b"c`)).toEqual(['echo', 'abc']);
  });

  it('keeps spaces, | and > inside quotes in one word without the quote characters', () => {
    expect(texts('grep "a | b > c" f')).toEqual(['grep', 'a | b > c', 'f']);
    expect(texts("grep 'x y' f")).toEqual(['grep', 'x y', 'f']);
  });

  it('treats $ and backslash as literal inside quotes, with no escapes', () => {
    expect(texts('echo "$HOME"')).toEqual(['echo', '$HOME']);
    expect(texts("echo '$(x)'")).toEqual(['echo', '$(x)']);
    expect(texts("echo 'a\\b'")).toEqual(['echo', 'a\\b']);
    expect(texts('echo "a\\"')).toEqual(['echo', 'a\\']);
  });

  it('does not let the other quote kind close a quote', () => {
    expect(texts(`echo "it's"`)).toEqual(['echo', "it's"]);
    expect(texts(`echo 'say "hi"'`)).toEqual(['echo', 'say "hi"']);
  });

  it('parses an empty quoted string as an empty word', () => {
    expect(texts("echo ''")).toEqual(['echo', '']);
  });

  it('splits stages on an unquoted pipe and captures the redirect', () => {
    const p = parsed('cat a | grep b | wc -l > /tmp/out');
    expect(p.stages.map((s) => s.name.text)).toEqual(['cat', 'grep', 'wc']);
    expect(p.redirect?.target.text).toBe('/tmp/out');
  });
});

describe('parser: syntax errors outside quotes (R3.6, R3.7, R3.16)', () => {
  it.each([
    ["echo 'x", 'unterminated quote'],
    ['echo "x', 'unterminated quote'],
    ['| ls', "unexpected '|'"],
    ['ls |', "unexpected '|'"],
    ['ls | | wc', "unexpected '|'"],
    ['ls > ', 'missing redirect target'],
  ])('rejects %j', (line, reason) => {
    expect(errorOf(line)).toBe(`sh: syntax error: ${reason}`);
  });

  it.each([
    ['ls ; pwd', ';'],
    ['ls && pwd', '&&'],
    ['ls || pwd', '||'],
    ['ls & pwd', '&'],
    ['ls >> f', '>>'],
    ['cat < f', '<'],
    ['ls 2> f', '2>'],
    ['echo $HOME', '$'],
    ['echo $(ls)', '$'],
    ['echo $', '$'],
    ['echo `ls`', '`'],
    ['(ls)', '('],
    ['ls )', ')'],
  ])('rejects %j as unsupported operator %j', (line, op) => {
    expect(errorOf(line)).toBe(`sh: syntax error: unsupported operator '${op}'`);
  });

  it.each([';', '&', '&&', '||', '>>', '<', '2>', '$HOME', '$(ls)', '`ls`', '(', ')', '|', '>'])(
    'accepts %j inside quotes as plain text',
    (op) => {
      expect(texts(`echo "${op}"`)).toEqual(['echo', op]);
      expect(texts(`echo '${op}'`)).toEqual(['echo', op]);
    },
  );

  it('accepts a lone 2 before > when separated by whitespace', () => {
    expect(stage0('echo 2 > /tmp/f').args.map((w) => w.text)).toEqual(['2']);
  });
});

describe('parser: globs and ~ stay unexpanded (R3.13)', () => {
  it('keeps * and ~ words as typed, not literal when unquoted', () => {
    const s = stage0('ls ~ ~/x *.log a*b');
    expect(s.args).toEqual([
      { text: '~', literal: false },
      { text: '~/x', literal: false },
      { text: '*.log', literal: false },
      { text: 'a*b', literal: false },
    ]);
  });

  it('marks a quoted word literal only when it holds * or starts with ~', () => {
    const s = stage0(`ls '*' "a*b" '~' "~/x" 'a b' "plain"`);
    expect(s.args.map((w) => w.literal)).toEqual([true, true, true, true, false, false]);
    expect(s.args.map((w) => w.text)).toEqual(['*', 'a*b', '~', '~/x', 'a b', 'plain']);
  });

  it('marks a partly quoted word as literal when the joined text qualifies', () => {
    expect(stage0('ls a"*"').args[0]).toEqual({ text: 'a*', literal: true });
    expect(stage0('ls ""~').args[0]).toEqual({ text: '~', literal: true });
  });
});

describe('parser: redirect target rules (R3.15, R3.6)', () => {
  it('keeps * and ~ in the target unexpanded', () => {
    expect(parsed('ls > ~/out*').redirect?.target).toEqual({ text: '~/out*', literal: false });
  });

  it('accepts a quoted target and a target glued to >', () => {
    expect(parsed("ls > 'a b'").redirect?.target.text).toBe('a b');
    expect(parsed('ls >/tmp/x').redirect?.target.text).toBe('/tmp/x');
  });

  it('rejects extra words after the target', () => {
    expect(errorOf('ls > a b')).toBe('sh: syntax error: unexpected word after redirect target');
  });

  it('rejects a second >', () => {
    expect(errorOf('ls > a > b')).toBe("sh: syntax error: unsupported operator '>'");
  });

  it('rejects a pipe after the target', () => {
    expect(errorOf('ls > a | wc')).toBe("sh: syntax error: unsupported operator '|'");
  });

  it('rejects a redirect with no command', () => {
    expect(errorOf('> a')).toBe('sh: syntax error: missing command');
    expect(errorOf('ls | > a')).toBe('sh: syntax error: missing command');
  });
});

describe('printer (R3.8)', () => {
  const roundTrip = (line: string): string => printLine(parsed(line));

  it('leaves safe words unquoted', () => {
    expect(roundTrip('grep -n a.b /var/log/x_y')).toBe('grep -n a.b /var/log/x_y');
  });

  it('quotes words with spaces, | and >', () => {
    expect(roundTrip('echo "a b"')).toBe("echo 'a b'");
    expect(roundTrip('echo "a|b"')).toBe("echo 'a|b'");
    expect(roundTrip('echo "a>b"')).toBe("echo 'a>b'");
  });

  it('keeps unquoted * and ~ bare, and quotes them when they were quoted', () => {
    expect(roundTrip('ls * ~ ~/x')).toBe('ls * ~ ~/x');
    expect(roundTrip("ls '*' '~' '~/x'")).toBe("ls '*' '~' '~/x'");
  });

  it('drops quotes that carry no meaning', () => {
    expect(roundTrip('echo "plain"')).toBe('echo plain');
  });

  it('quotes an empty word and escapes an embedded apostrophe', () => {
    expect(roundTrip("echo ''")).toBe("echo ''");
    expect(roundTrip(`echo "a'b"`)).toBe(`echo 'a'"'"'b'`);
  });

  it('joins stages with " | " and prints the redirect', () => {
    expect(roundTrip('cat  a|grep  b>/tmp/o')).toBe('cat a | grep b > /tmp/o');
    expect(roundTrip("ls > 'a b'")).toBe("ls > 'a b'");
  });

  it('re-parses to the same structure', () => {
    for (const line of [`echo a"b c"d '*' "~/x" > '~/o'`, "grep 'a|b' f | wc -l", `echo "it's"`]) {
      const p = parsed(line);
      expect(parseLine(printLine(p))).toEqual({ ok: true, pipeline: p });
    }
  });
});

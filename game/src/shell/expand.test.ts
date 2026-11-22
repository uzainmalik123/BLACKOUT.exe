import { describe, expect, it } from 'vitest';
import { expandTilde, expandWord, globExpand } from './expand';
import type { Stat, VfsLister, Word } from './types';

// A fake file system: directory path -> child names (files end up as entries with no listing).
const DIRS: Record<string, string[]> = {
  '/': ['srv', 'tmp'],
  '/srv': ['juice-shop'],
  '/srv/juice-shop': ['.env', '.hidden', 'a.log', 'b.log', 'app.js', 'logs', 'notes.txt'],
  '/srv/juice-shop/logs': ['Z.log', 'access.log', 'error.log'],
  '/tmp': ['x1', 'x2'],
};
const FILES = new Set<string>([
  '/srv/juice-shop/.env',
  '/srv/juice-shop/.hidden',
  '/srv/juice-shop/a.log',
  '/srv/juice-shop/b.log',
  '/srv/juice-shop/app.js',
  '/srv/juice-shop/notes.txt',
  '/srv/juice-shop/logs/Z.log',
  '/srv/juice-shop/logs/access.log',
  '/srv/juice-shop/logs/error.log',
  '/tmp/x1',
  '/tmp/x2',
]);

const fake: VfsLister = {
  stat(abs): Stat | undefined {
    if (abs in DIRS) return { kind: 'dir', area: 'system', readonly: false };
    if (FILES.has(abs)) return { kind: 'file', area: 'system', readonly: false };
    return undefined;
  },
  list(abs) {
    return DIRS[abs] ? [...DIRS[abs]] : undefined;
  },
};

const HOME = '/srv/juice-shop';
const session = { cwd: HOME };
const w = (text: string, literal = false): Word => ({ text, literal });

describe('expandTilde', () => {
  it('expands ~ and ~/x only', () => {
    expect(expandTilde('~')).toBe(HOME);
    expect(expandTilde('~/logs')).toBe(`${HOME}/logs`);
    expect(expandTilde('~x')).toBe('~x');
    expect(expandTilde('a~')).toBe('a~');
  });
});

describe('expandWord: globs', () => {
  it('expands * to sorted matches in the cwd', () => {
    expect(expandWord(w('*.log'), session, fake)).toEqual(['a.log', 'b.log']);
  });

  it('sorts by code point (uppercase before lowercase)', () => {
    expect(expandWord(w('logs/*'), session, fake)).toEqual([
      'logs/Z.log',
      'logs/access.log',
      'logs/error.log',
    ]);
  });

  it('does not match dot-files unless the pattern starts with a dot', () => {
    expect(expandWord(w('*'), session, fake)).toEqual(['a.log', 'app.js', 'b.log', 'logs', 'notes.txt']);
    expect(expandWord(w('.*'), session, fake)).toEqual(['.env', '.hidden']);
  });

  it('keeps the typed prefix for relative and absolute patterns', () => {
    expect(expandWord(w('./*.log'), session, fake)).toEqual(['./a.log', './b.log']);
    expect(expandWord(w('/tmp/x*'), session, fake)).toEqual(['/tmp/x1', '/tmp/x2']);
    expect(expandWord(w('../juice-shop/a*'), session, fake)).toEqual([
      '../juice-shop/a.log',
      '../juice-shop/app.js',
    ]);
  });

  it('expands a * in a middle segment', () => {
    expect(expandWord(w('/srv/*/a.log'), session, fake)).toEqual(['/srv/juice-shop/a.log']);
  });

  it('leaves the pattern literal when nothing matches', () => {
    expect(expandWord(w('*.zip'), session, fake)).toEqual(['*.zip']);
    expect(globExpand('nodir/*', HOME, fake)).toEqual(['nodir/*']);
  });

  it('leaves a quoted star unchanged', () => {
    expect(expandWord(w('*.log', true), session, fake)).toEqual(['*.log']);
  });
});

describe('expandWord: tilde', () => {
  it('expands ~ and ~/x', () => {
    expect(expandWord(w('~'), session, fake)).toEqual([HOME]);
    expect(expandWord(w('~/logs'), session, fake)).toEqual([`${HOME}/logs`]);
  });

  it('expands ~ and then globs the result', () => {
    expect(expandWord(w('~/*.log'), session, fake)).toEqual([`${HOME}/a.log`, `${HOME}/b.log`]);
  });

  it('leaves a quoted ~ unchanged', () => {
    expect(expandWord(w('~', true), session, fake)).toEqual(['~']);
    expect(expandWord(w('~/x', true), session, fake)).toEqual(['~/x']);
  });
});

describe('expandWord: roles', () => {
  it('never expands the command name', () => {
    expect(expandWord(w('~'), session, fake, 'command')).toEqual(['~']);
    expect(expandWord(w('*'), session, fake, 'command')).toEqual(['*']);
  });

  it('gives a redirect target ~ only, never a glob', () => {
    expect(expandWord(w('~/out'), session, fake, 'redirect')).toEqual([`${HOME}/out`]);
    expect(expandWord(w('*.log'), session, fake, 'redirect')).toEqual(['*.log']);
    expect(expandWord(w('~/*.log'), session, fake, 'redirect')).toEqual([`${HOME}/*.log`]);
  });
});

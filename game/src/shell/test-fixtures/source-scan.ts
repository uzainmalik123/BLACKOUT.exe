/// <reference types="node" />
// TEST-ONLY. Reads the production .ts files of game/src/shell/ (tests and test-fixtures excluded) for the
// source-scan tests (actions-surface.test.ts, determinism-source.test.ts).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHELL_DIR = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'test-fixtures') walk(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
}

/** Removes block comments and line comments (a `//` at the start of a line or after whitespace). */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

export interface SourceFile {
  /** Path relative to game/src/shell/. */
  rel: string;
  /** Source with comments removed. */
  code: string;
}

export function shellSources(): SourceFile[] {
  const paths: string[] = [];
  walk(SHELL_DIR, paths);
  return paths.map((p) => ({ rel: p.slice(SHELL_DIR.length), code: stripComments(readFileSync(p, 'utf8')) }));
}

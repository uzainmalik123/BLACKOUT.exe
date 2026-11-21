/// <reference types="node" />
// TEST-ONLY. Every recording committed in src/recordings/, read from disk, so a test can run on the real
// files as soon as they land (the game itself imports its library in engine.ts).
import { readdirSync, readFileSync } from 'node:fs';
import type { Recording } from '../../recordings/format';
import { libraryFrom, type RecordingLibrary } from '../library';

const dir = new URL('../../recordings/', import.meta.url);

/** The moves, the minions and, unless `traffic` is false, the customers (traffic/, D-62). */
export function committedLibrary(traffic = true): RecordingLibrary {
  const files = readdirSync(dir).filter((f) => /^(ATK|MIN)-\d\d\.[a-z]\.json$/.test(f));
  const cust = traffic ? readdirSync(new URL('traffic/', dir)).filter((f) => /^CUST\.[a-z]\.json$/.test(f)).map((f) => `traffic/${f}`) : [];
  return libraryFrom([...files, ...cust].map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Recording));
}

// Starting a run in the browser (D-223): the real baseline database (juiceshop.sqlite) fetched once, and sql.js
// pointed at its WebAssembly file once, before the engine's `db()` opens it (sql.js keeps its first setup, so the
// engine's own initSqlJs() call then finds the file). Then the engine, the shell and Kiro, as in run.ts.

import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { Engine } from '../../engine/engine';
import dbUrl from '../../recordings/juiceshop.sqlite?url';
import type { Difficulty } from '../../rules/vocabulary';
import { freshSeed, runOn, type Run } from './run';

let baseline: Promise<Uint8Array> | null = null;

export function loadBaseline(): Promise<Uint8Array> {
  baseline ??= (async () => {
    await initSqlJs({ locateFile: () => wasmUrl });
    const r = await fetch(dbUrl);
    if (!r.ok) throw new Error(`could not load the shop's database (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  })();
  return baseline;
}

export async function startRun(difficulty: Difficulty): Promise<Run> {
  const bytes = await loadBaseline();
  const engine = new Engine({ seed: freshSeed(), difficulty, baseline: bytes });
  return runOn(engine, (e) => console.error('shell:', e));
}

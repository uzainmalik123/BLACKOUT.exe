// Helper for the Kiro hooks in .kiro/hooks/ (PRD KDEV-03, D-161).
// Usage: node scripts/kiro-hook.mjs <test-folder|prd-reminder>
// Reads the hook event JSON on stdin and acts only on files under game/src/.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'game', 'src');

let event = {};
try {
  event = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // no or bad payload: nothing to do
}

const input = event.tool_input ?? {};
const raw = input.path ?? input.file_path ?? input.filePath ?? input.targetFile;
if (typeof raw !== 'string') process.exit(0);

const file = path.resolve(event.cwd ?? root, raw);
const rel = path.relative(srcDir, file);
if (rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0); // not under game/src

const top = rel.split(path.sep)[0];
const relFromRoot = path.relative(root, file);

if (mode === 'test-folder') {
  const folder = path.relative(path.join(root, 'game'), path.dirname(file)).split(path.sep).join('/');
  console.error(`[test-on-save] ${relFromRoot} changed: running vitest on ${folder}`);
  const run = spawnSync('npx', ['vitest', 'run', folder], { cwd: path.join(root, 'game'), encoding: 'utf8' });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const summary = out
    .split('\n')
    .filter((l) => /Test Files|Tests |FAIL|Error|No test files/.test(l))
    .join('\n');
  if (run.status === 0) {
    console.error(`[test-on-save] GREEN\n${summary}`);
    process.exit(0);
  }
  console.error(`[test-on-save] RED: tests in ${folder} FAILED after editing ${relFromRoot}. Fix before going on.\n${summary}`);
  process.exit(1);
}

if (mode === 'prd-reminder') {
  if (top !== 'rules' && top !== 'engine') process.exit(0);
  console.error(
    `[prd-status-reminder] ${relFromRoot} changed. Update that row's status in docs/PRD.md section 16, ` +
      `and add an entry to docs/DECISIONS.md if a rule changed (AGENTS.md).`,
  );
  process.exit(1); // non-zero so the warning reaches the transcript; the tool has already run
}

console.error(`kiro-hook: unknown mode "${mode}"`);
process.exit(0);

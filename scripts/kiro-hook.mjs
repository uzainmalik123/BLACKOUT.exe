// Helper for the Kiro hooks in .kiro/hooks/ (PRD KDEV-03, D-161).
// Usage: node scripts/kiro-hook.mjs <test-folder|prd-reminder>
// Reads the hook event JSON on stdin and acts only on files under game/src/.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Every invocation leaves a line in .kiro/hooks.log (gitignored), so a hook's firing can be checked after a session (KI-181).
const logLine = (text) => { try { appendFileSync(path.join(root, '.kiro', 'hooks.log'), `${new Date().toISOString()} ${mode} ${text}\n`); } catch { /* best effort */ } };
const say = (text) => { console.log(text); console.error(text); };
const srcDir = path.join(root, 'game', 'src');

let event = {};
try {
  event = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // no or bad payload: nothing to do
}

const input = event.tool_input ?? {};
const raw = input.path ?? input.file_path ?? input.filePath ?? input.targetFile;
logLine(`event=${event.hook_event_name ?? '?'} tool=${event.tool_name ?? '?'} path=${typeof raw === 'string' ? raw : `(none; keys ${Object.keys(input).join(',')})`}`);
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
    logLine(`GREEN ${folder}`);
    say(`[test-on-save] GREEN: ${folder}\n${summary}`);
    process.exit(0);
  }
  logLine(`RED ${folder}`);
  say(`[test-on-save] RED: tests in ${folder} FAILED after editing ${relFromRoot}. Fix before going on.\n${summary}`);
  process.exit(1);
}

if (mode === 'prd-reminder') {
  if (top !== 'rules' && top !== 'engine') process.exit(0);
  logLine(`REMINDER ${relFromRoot}`);
  say(
    `[prd-status-reminder] ${relFromRoot} changed. Update that row's status in docs/PRD.md section 16, ` +
      `and add an entry to docs/DECISIONS.md if a rule changed (AGENTS.md).`,
  );
  process.exit(0); // exit 0 so the reminder reaches the agent as context (V2: stdout is captured, stderr only warns)
}

console.error(`kiro-hook: unknown mode "${mode}"`);
process.exit(0);

// Converts one raw run from recording/record.sh into src/recordings/<MOVE>.<variant>.json (D-15);
// customer traffic (move CUST, REC-06) goes to src/recordings/traffic/ instead, so it's never loaded as a move (D-62).
//   npm run recording:convert -- ../recording/runs/ATK-03.a [--baseline]
// --baseline also copies the run's before.sqlite to src/recordings/juiceshop.sqlite, the DB the game boots from.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import initSqlJs from 'sql.js';
import {
  buildRecording,
  diffDatabases,
  diffUploads,
  exfilFromResponses,
  parseAccessJsonl,
  parseAppLog,
  parseCurlCapture,
  parseSqlmapTraffic,
  type CapturedResponse,
  type FileInfo,
  type RunMeta,
} from '../src/recordings/convert.ts';
import { isTestNet3, type RecEvent, type Recording } from '../src/recordings/format.ts';

const OUT_DIR = resolve(import.meta.dirname, '../src/recordings');
/** Customer traffic (REC-06) is not a move: it lives one folder down, out of the moves' `*.json` (D-62). */
const TRAFFIC_MOVE = 'CUST';

function walk(root: string): Map<string, FileInfo> {
  const files = new Map<string, FileInfo>();
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else {
        const bytes = new Uint8Array(readFileSync(path));
        files.set(relative(root, path), { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), bytes });
      }
    }
  };
  if (existsSync(root)) visit(root);
  return files;
}

/** Header pretty-printed, one event per line: small diffs when a variant is re-recorded. */
function serialize(rec: Recording): string {
  const { events, ...header } = rec;
  const head = JSON.stringify(header, null, 2).replace(/\n}$/, '');
  return `${head},\n  "events": [\n${events.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]\n}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runDir = args.find((a) => !a.startsWith('--'));
  if (!runDir) throw new Error('usage: npm run recording:convert -- <recording/runs/MOVE.variant> [--baseline]');
  const read = (name: string) => readFileSync(join(runDir, name), 'utf8');
  const meta = JSON.parse(read('run.json')) as RunMeta;

  const SQL = await initSqlJs();
  const before = new SQL.Database(readFileSync(join(runDir, 'before.sqlite')));
  const after = new SQL.Database(readFileSync(join(runDir, 'after.sqlite')));

  const access = parseAccessJsonl(read('access.jsonl'), meta.startedAtMs);
  // The tools box itself, or an address it named in X-Forwarded-For (always TEST-NET-3, D-27).
  const attackerAccess = access.filter((e) => e.ip === meta.attackerIp || isTestNet3(e.ip));
  const stampT = access.at(-1)?.t ?? 0;
  const events: RecEvent[] = [
    ...access,
    ...parseAppLog(read('app.log'), meta.startedAtMs, meta.endedAtMs),
    ...diffDatabases(before, after, stampT),
    ...diffUploads(walk(join(runDir, 'uploads-before')), walk(join(runDir, 'uploads-after')), stampT),
  ];
  // The tool's own responses, when it kept them: sqlmap's -t log, or capture.sh's (D-25).
  let responses: CapturedResponse[] | undefined;
  if (existsSync(join(runDir, 'traffic.txt'))) responses = parseSqlmapTraffic(read('traffic.txt'));
  else if (existsSync(join(runDir, 'responses/index.tsv'))) {
    responses = parseCurlCapture(read('responses/index.tsv'), (n) => read(`responses/${n}.body`));
  }
  if (responses) {
    const res = before.exec('SELECT id, email, password FROM Users')[0];
    const users = (res?.values ?? []).map(([id, email, password]) => ({ id: Number(id), email: String(email), password: String(password) }));
    events.push(...exfilFromResponses(responses, attackerAccess, users));
  }

  const rec = buildRecording(meta, events);
  const outDir = meta.move === TRAFFIC_MOVE ? join(OUT_DIR, 'traffic') : OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${meta.move}.${meta.variant}.json`);
  writeFileSync(out, serialize(rec));
  const count = (kind: RecEvent['kind']) => rec.events.filter((e) => e.kind === kind).length;
  console.log(`${relative(process.cwd(), out)}: ${rec.events.length} events (access ${count('access')}, app ${count('app')}, db ${count('db')}, file ${count('file')}, exfil ${count('exfil')}), ${rec.durationMs} ms`);

  if (args.includes('--baseline')) {
    copyFileSync(join(runDir, 'before.sqlite'), join(OUT_DIR, 'juiceshop.sqlite'));
    console.log('baseline: src/recordings/juiceshop.sqlite');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

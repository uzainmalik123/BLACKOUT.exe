// Kiro's game tools (PRD KIRO-07, D-190): read-only functions over the snapshot the browser sent with the call
// (src/kiro/snapshot.ts). They are the only tools the in-game agent has (.kiro/agents/kiro-game.json lists
// `@game` and nothing else), so a write is impossible, not just refused. Pure: `runTool` returns text.
import { COMMAND_LIST } from '../src/shell';
import type { KiroSnapshot } from '../src/kiro/snapshot';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

const LINES_MAX = 60;

export const TOOLS: readonly ToolSpec[] = [
  { name: 'alerts', description: 'The alert panel: open alerts newest first, then the closed ones, with the game clock they opened at. An alert says only what kind of thing it looks like (attack, noise, leak); the logs say the rest.', inputSchema: { type: 'object', properties: {} } },
  { name: 'meters', description: 'The dashboard meters: souls (customer records) total and stolen, the heartbeat (business health) and its ceiling, the web server state, the in-game clock and time left on the shift, difficulty, and whether the run has ended.', inputSchema: { type: 'object', properties: {} } },
  { name: 'search_logs', description: 'Search the newest lines of a log (the last 500 the defender has) for a pattern (a plain substring, or a regular expression when `regex` is true). Returns the newest matches, up to `limit` (default 20, max 60), oldest first, and the total match count.', inputSchema: { type: 'object', properties: { log: { type: 'string', enum: ['access', 'app'] }, pattern: { type: 'string' }, regex: { type: 'boolean' }, limit: { type: 'number' } }, required: ['log', 'pattern'] } },
  { name: 'tail_logs', description: 'The newest `n` lines (default 20, max 60) of the access log (nginx combined format) or the app log (Juice Shop).', inputSchema: { type: 'object', properties: { log: { type: 'string', enum: ['access', 'app'] }, n: { type: 'number' } }, required: ['log'] } },
  { name: 'accounts', description: 'The accounts console: every account with its email, role and whether it is locked; filter by role (admin, customer, deluxe, accounting) with `role`. Compare the admins with the briefing: anything extra was not made by the team.', inputSchema: { type: 'object', properties: { role: { type: 'string' } } } },
  { name: 'uploads', description: 'The files in the uploads folder (path, size, sha256), planted ones among customers\' attachments. Nothing says which is which.', inputSchema: { type: 'object', properties: {} } },
  { name: 'defences', description: 'What the defender has done to the system: firewall drops, WAF rules, feature flags, patches deployed or deploying, evidence snapshots, backups available, live session counts, escalation and notification state.', inputSchema: { type: 'object', properties: {} } },
  { name: 'recent_actions', description: 'The defender\'s last 20 actions (terminal commands and console clicks), newest last, with whether each was accepted.', inputSchema: { type: 'object', properties: {} } },
  { name: 'command_list', description: 'The exact list of commands the game\'s terminal runs, with what each does. Nothing outside it exists.', inputSchema: { type: 'object', properties: {} } },
];

export const COMMAND_HELP: Readonly<Record<string, string>> = {
  ls: 'list a folder (-l, -a, -la)', cd: 'change folder', pwd: 'print the folder', cat: 'print a file', head: 'first lines (-n N)',
  tail: 'last lines (-n N)', grep: 'lines matching a pattern (-i, -c, -E, -v)', awk: "{print $N, $NF, NR} over fields (-F 'sep', /regex/)",
  sort: 'sort lines (-r, -n)', uniq: 'collapse repeats (-c counts)', wc: 'count lines/words/bytes (-l)', cut: 'cut fields (-d, -f)',
  file: 'guess a file type', sha256sum: 'hash a file', tar: 'tar czf /evidence/<name>.tgz <paths>: an evidence snapshot', cp: 'copy a file (to /tmp or /evidence)',
  rm: 'remove a file (uploads or /tmp)', mkdir: 'make a folder (/tmp)', sqlite3: 'sqlite3 [-header] <db> "<SQL>": real SQLite over the shop database (.tables, .schema)',
  iptables: 'iptables -A INPUT -s <ip> -j DROP to block an address; -D to unblock; -L to list', systemctl: 'systemctl status|stop|start|restart nginx',
  ss: 'open sockets', whois: 'whois <ip>: a passive registry lookup', ping: 'ping <ip>: active, the target notices', nmap: 'nmap <ip>: active, the target notices',
  curl: 'curl <url>: active, the target notices', date: 'the in-game date and time', history: 'the command history', clear: 'clear the screen',
  help: 'the command list', man: 'man <command>',
};

export const LOG_PATHS = { access: '/var/log/nginx/access.log', app: '/var/log/juice-shop/app.log', db: '/srv/juice-shop/data/juiceshop.sqlite', uploads: '/srv/juice-shop/uploads' } as const;

function clampN(v: unknown, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.max(1, Math.min(LINES_MAX, n));
}

/** Runs one tool over the snapshot. Unknown tool or bad arguments give an error string the agent can read. */
export function runTool(name: string, args: Record<string, unknown>, s: KiroSnapshot): { text: string; isError?: boolean } {
  switch (name) {
    case 'alerts': {
      if (s.alerts.length === 0) return { text: 'No alerts yet.' };
      const open = s.alerts.filter((a) => a.closedAt === undefined);
      const closed = s.alerts.filter((a) => a.closedAt !== undefined);
      const line = (a: KiroSnapshot['alerts'][number]) => `- #${a.id} ${a.kind}: opened at ${a.openedAt}${a.closedAt ? `, closed at ${a.closedAt}` : ' (open)'}`;
      return { text: [`Open alerts (${open.length}):`, ...open.map(line), `Closed alerts (${closed.length}):`, ...closed.map(line)].join('\n') };
    }
    case 'meters':
      return {
        text: [
          `Difficulty: ${s.difficulty}`,
          `Clock: ${s.clock.shown} into the incident (${s.clock.wallClock}); shift ends in ${s.clock.shiftEndsIn}${s.clock.paused ? '; paused' : ''}`,
          `Souls: ${s.souls.stolen} of ${s.souls.total} stolen`,
          `Heartbeat: ${s.heartbeat.now} of ${s.heartbeat.max}`,
          `Web server (nginx): ${s.nginx}`,
          s.ending ? `The run has ended: ${s.ending}` : 'The run is live.',
        ].join('\n'),
      };
    case 'search_logs': {
      const log = args.log === 'app' ? 'app' : args.log === 'access' ? 'access' : undefined;
      const pattern = typeof args.pattern === 'string' ? args.pattern : '';
      if (!log || pattern === '') return { text: 'search_logs needs `log` (access|app) and a non-empty `pattern`.', isError: true };
      let test: (l: string) => boolean;
      if (args.regex === true) {
        try {
          const re = new RegExp(pattern, 'i');
          test = (l) => re.test(l);
        } catch (e) {
          return { text: `bad regular expression: ${(e as Error).message}`, isError: true };
        }
      } else {
        const needle = pattern.toLowerCase();
        test = (l) => l.toLowerCase().includes(needle);
      }
      const lines = s.logs[log];
      const matches = lines.filter(test);
      const limit = clampN(args.limit, 20);
      const shown = matches.slice(-limit);
      return { text: `${matches.length} of the newest ${lines.length} ${log} lines match (${s.logs[`${log}Total`]} lines in the file); showing the last ${shown.length}:\n${shown.join('\n')}` };
    }
    case 'tail_logs': {
      const log = args.log === 'app' ? 'app' : args.log === 'access' ? 'access' : undefined;
      if (!log) return { text: 'tail_logs needs `log` (access|app).', isError: true };
      const n = clampN(args.n, 20);
      const lines = s.logs[log].slice(-n);
      return { text: `Last ${lines.length} of ${s.logs[`${log}Total`]} ${log} lines:\n${lines.join('\n')}` };
    }
    case 'accounts': {
      const role = typeof args.role === 'string' ? args.role : undefined;
      const rows = role ? s.accounts.filter((a) => a.role === role) : s.accounts;
      const special = rows.filter((a) => a.role !== 'customer');
      const customers = rows.length - special.length;
      const lines = special.map((a) => `- ${a.email} (${a.role})${a.locked ? ' LOCKED' : ''}`);
      if (customers > 0) lines.push(`- ${customers} customer account${customers === 1 ? '' : 's'}${role ? '' : ' (use role=customer to list them)'}`);
      if (role === 'customer') lines.push(...rows.map((a) => `- ${a.email}${a.locked ? ' LOCKED' : ''}`));
      return { text: `${rows.length} accounts:\n${lines.join('\n')}` };
    }
    case 'uploads':
      return { text: s.uploads.length === 0 ? 'The uploads folder is empty.' : s.uploads.map((f) => `- ${f.path}  ${f.size} bytes  sha256 ${f.sha256}`).join('\n') };
    case 'defences':
      return {
        text: [
          `Firewall drops: ${s.firewall.blocked.length === 0 ? 'none' : s.firewall.blocked.join(', ')}`,
          `WAF rules: ${s.waf.length === 0 ? 'none' : s.waf.map((r) => JSON.stringify(r)).join('; ')}`,
          `Feature flags: ${Object.entries(s.features).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`).join(', ')}`,
          `Patches deployed: ${s.patches.applied.join(', ') || 'none'}; deploying: ${s.patches.deploying.join(', ') || 'none'}`,
          `Evidence snapshots: ${s.evidence.length === 0 ? 'none' : s.evidence.map((e) => `${e.name} at ${e.takenAt}`).join(', ')}`,
          `Backups: ${s.backups.map((b) => `#${b.id} at ${b.takenAt}`).join(', ') || 'none'}`,
          `Live sessions: ${s.sessions.total} (${s.sessions.admin} admin)`,
          `Escalated to the incident lead: ${s.comms.escalated ? 'yes' : 'no'}; legal notified: ${s.comms.notifiedLegal ? 'yes' : 'no'}; customers notified: ${s.comms.notifiedCustomers ? 'yes' : 'no'}`,
        ].join('\n'),
      };
    case 'recent_actions':
      return { text: s.actions.length === 0 ? 'The defender has done nothing yet.' : s.actions.map((a) => `- [${a.at}] ${a.what}${a.ok ? '' : ' (refused)'}`).join('\n') };
    case 'command_list':
      return { text: `The terminal runs exactly these commands (pipes and > work; ;, &&, >>, <, $VAR, sudo, editors, docker, scripts do not):\n${COMMAND_LIST.map((c) => `- ${c}: ${COMMAND_HELP[c] ?? ''}`).join('\n')}\nPaths: ${LOG_PATHS.access}, ${LOG_PATHS.app}, ${LOG_PATHS.db}, ${LOG_PATHS.uploads}/complaints; /tmp and /evidence are writable.` };
    default:
      return { text: `unknown tool ${name}`, isError: true };
  }
}

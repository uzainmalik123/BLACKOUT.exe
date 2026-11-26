// The command registry: the single source of names, flags, help and man text (design: Registry, R2.1, R12.10, D-107).
// Handlers are placeholders until their own tasks replace them.

import { cd, ls, pwd } from './commands/navigation';
import { tar } from './commands/archive';
import { sqlite3 } from './commands/database';
import { cp, file, mkdir, rm, sha256sum } from './commands/filesys';
import { curl, nmap, ping, ss, whois } from './commands/network';
import { flag as flagCommand, iptables, systemctl } from './commands/ops';
import { clear, date, help, history, man } from './commands/session-cmds';
import { awk, cat, cut, grep, head, sort, tail, uniq, wc } from './commands/textproc';
import { fail } from './output';
import type { CommandName, CommandSpec, FlagSpec, Handler } from './types';

/** The 32 commands of .kiro/steering/game-shell.md, in that order (`flag` since D-233). */
export const COMMAND_NAMES = [
  'ls', 'cd', 'pwd', 'cat', 'head', 'tail', 'grep', 'awk', 'sort', 'uniq', 'wc', 'cut',
  'file', 'sha256sum', 'tar', 'cp', 'rm', 'mkdir', 'sqlite3', 'iptables', 'systemctl',
  'ss', 'whois', 'ping', 'nmap', 'curl', 'flag', 'date', 'history', 'clear', 'help', 'man',
] as const satisfies readonly CommandName[];

// Compile-time check: every CommandName appears in COMMAND_NAMES.
type MissingFromTuple = Exclude<CommandName, (typeof COMMAND_NAMES)[number]>;
const _tupleIsComplete: [MissingFromTuple] extends [never] ? true : never = true;
void _tupleIsComplete;

const notImplemented: Handler = (ctx) => fail(ctx.name, 'not implemented');

const INF = Number.POSITIVE_INFINITY;

function flag(name: string, summary: string, value?: FlagSpec['value'], valueName?: string): FlagSpec {
  return { name, summary, ...(value ? { value } : {}), ...(valueName ? { valueName } : {}) };
}

type Def = Omit<CommandSpec, 'name' | 'handler'>;

/** Handlers that exist so far; every other command keeps the placeholder. This is the one place they are wired. */
const HANDLERS: Partial<Record<CommandName, Handler>> = { ls, cd, pwd, cat, head, tail, grep, awk, sort, uniq, wc, cut, rm, file, sha256sum, cp, mkdir, sqlite3, iptables, systemctl, tar, whois, ping, nmap, curl, flag: flagCommand, ss, date, history, clear, help, man };

function def(name: CommandName, d: Def): CommandSpec {
  return { name, ...d, handler: HANDLERS[name] ?? notImplemented };
}

export const COMMANDS = {
  ls: def('ls', {
    summary: 'List directory contents',
    usage: 'ls [-l] [-a] [path...]',
    flags: [flag('-l', 'Long format: type, size and name'), flag('-a', 'Include names that start with a dot')],
    examples: ['ls -la /srv/juice-shop/uploads'],
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  cd: def('cd', {
    summary: 'Change the working directory',
    usage: 'cd [path]',
    flags: [],
    examples: ['cd /var/log/nginx'],
    operands: { min: 0, max: 1 },
    readsStdin: false,
  }),
  pwd: def('pwd', {
    summary: 'Print the working directory',
    usage: 'pwd',
    flags: [],
    examples: ['pwd'],
    operands: { min: 0, max: 0 },
    readsStdin: false,
  }),
  cat: def('cat', {
    summary: 'Print files',
    usage: 'cat [file...]',
    flags: [],
    examples: ['cat /var/log/juice-shop/app.log'],
    operands: { min: 0, max: INF },
    readsStdin: true,
  }),
  head: def('head', {
    summary: 'Print the first lines of input',
    usage: 'head [-n <count> | -<count>] [file...]',
    flags: [flag('-n', 'Number of lines (default 10)', 'either', '<count>')],
    examples: ['head -n 5 /var/log/nginx/access.log', 'head -5 /var/log/nginx/access.log'],
    operands: { min: 0, max: INF },
    numericCount: true,
    readsStdin: true,
  }),
  tail: def('tail', {
    summary: 'Print the last lines of input',
    usage: 'tail [-n <count> | -<count>] [file...]',
    flags: [flag('-n', 'Number of lines (default 10)', 'either', '<count>')],
    examples: ['tail -n 20 /var/log/nginx/access.log', 'tail -20 /var/log/nginx/access.log'],
    operands: { min: 0, max: INF },
    numericCount: true,
    readsStdin: true,
  }),
  grep: def('grep', {
    summary: 'Print lines that match a pattern',
    usage: 'grep [-i] [-v] [-c] [-n] [-E] [-e <pattern>]... [pattern] [file...]',
    flags: [
      flag('-i', 'Ignore case'),
      flag('-v', 'Print lines that do not match'),
      flag('-c', 'Print only the number of matching lines'),
      flag('-n', 'Prefix each line with its line number'),
      flag('-E', 'Use extended regular expressions'),
      flag('-e', 'Give a pattern (may be repeated)', 'either', '<pattern>'),
    ],
    examples: ['grep 203.0.113.7 /var/log/nginx/access.log', 'grep -c -i union /var/log/nginx/access.log'],
    operands: { min: 0, max: INF },
    readsStdin: true,
  }),
  awk: def('awk', {
    summary: 'Print fields of each line',
    usage: "awk [-F<sep>] '[/regex/] {print <expr>[, <expr>...]}' [file...]",
    flags: [flag('-F', 'Field separator', 'either', '<sep>')],
    forms: ["[-F<sep>] '[/regex/] {print <expr>[, <expr>...]}' [file...]"],
    examples: ["awk '{print $1}' /var/log/nginx/access.log", "awk -F: '/root/ {print $1, NR}' /tmp/list"],
    operands: { min: 1, max: INF },
    readsStdin: true,
  }),
  sort: def('sort', {
    summary: 'Sort lines',
    usage: 'sort [-r] [-n] [-k <field>] [file...]',
    flags: [
      flag('-r', 'Reverse the order'),
      flag('-n', 'Compare numerically'),
      flag('-k', 'Sort on a field, 1 to 99', 'either', '<field>'),
    ],
    examples: ['sort -rn /tmp/counts', 'sort -k 2 /tmp/list'],
    operands: { min: 0, max: INF },
    readsStdin: true,
  }),
  uniq: def('uniq', {
    summary: 'Collapse adjacent identical lines',
    usage: 'uniq [-c] [file]',
    flags: [flag('-c', 'Prefix each line with its repeat count')],
    examples: ['sort /tmp/ips | uniq -c'],
    operands: { min: 0, max: 1 },
    readsStdin: true,
  }),
  wc: def('wc', {
    summary: 'Count lines, words and bytes',
    usage: 'wc [-l] [-w] [-c] [file...]',
    flags: [flag('-l', 'Count lines'), flag('-w', 'Count words'), flag('-c', 'Count bytes')],
    examples: ['grep -c login /var/log/nginx/access.log', 'wc -l /var/log/nginx/access.log'],
    operands: { min: 0, max: INF },
    readsStdin: true,
  }),
  cut: def('cut', {
    summary: 'Print selected fields of each line',
    usage: 'cut -d <sep> -f <list> [file...]',
    flags: [
      flag('-d', 'Field separator, one character', 'either', '<sep>'),
      flag('-f', 'Comma-separated field numbers, 1 to 99', 'either', '<list>'),
    ],
    examples: ["cut -d ' ' -f 1 /var/log/nginx/access.log"],
    operands: { min: 0, max: INF },
    readsStdin: true,
  }),
  file: def('file', {
    summary: 'Describe the type of a file',
    usage: 'file <path>...',
    flags: [],
    examples: ['file /srv/juice-shop/uploads/complaints/rip.php'],
    operands: { min: 1, max: INF },
    readsStdin: false,
  }),
  sha256sum: def('sha256sum', {
    summary: 'Print the SHA-256 digest of a file',
    usage: 'sha256sum [file...]',
    flags: [],
    examples: ['sha256sum /evidence/before.tgz'],
    operands: { min: 0, max: INF },
    readsStdin: true,
  }),
  tar: def('tar', {
    summary: 'Create or list a .tgz archive',
    usage: 'tar czf /evidence/<name>.tgz <path>... | tar tzf <archive>',
    flags: [
      flag('-c', 'Create an archive'),
      flag('-t', 'List an archive'),
      flag('-z', 'Gzip'),
      flag('-f', 'Archive file (the next operand)'),
      flag('-v', 'Verbose'),
    ],
    forms: ['czf <archive> <path>...', 'tzf <archive>'],
    examples: ['tar czf /evidence/before.tgz /var/log/nginx /var/log/juice-shop', 'tar tzf /evidence/before.tgz'],
    operands: { min: 1, max: INF },
    readsStdin: false,
  }),
  cp: def('cp', {
    summary: 'Copy a file',
    usage: 'cp <source> <destination>',
    flags: [],
    examples: ['cp /var/log/nginx/access.log /tmp/access.log'],
    operands: { min: 2, max: 2 },
    readsStdin: false,
  }),
  rm: def('rm', {
    summary: 'Remove files',
    usage: 'rm [-r] <path>...',
    flags: [flag('-r', 'Remove directories and their contents')],
    examples: ['rm /srv/juice-shop/uploads/complaints/rip.php'],
    // The handler prints `missing operand` itself (R11.9).
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  mkdir: def('mkdir', {
    summary: 'Make directories',
    usage: 'mkdir [-p] <path>...',
    flags: [flag('-p', 'Make parent directories as needed')],
    examples: ['mkdir -p /tmp/notes'],
    operands: { min: 1, max: INF },
    readsStdin: false,
  }),
  sqlite3: def('sqlite3', {
    summary: 'Query the Juice Shop database',
    usage: 'sqlite3 [-header] <db-path> <sql>',
    flags: [flag('-header', 'Print a row of column names first')],
    forms: ['<path> <sql>'],
    examples: ["sqlite3 -header /srv/juice-shop/data/juiceshop.sqlite 'SELECT id, email FROM Users'"],
    // The handler prints its own errors for a missing path or SQL (R7).
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  iptables: def('iptables', {
    summary: 'Block or unblock an address, or list the rules',
    usage: 'iptables -A INPUT -s <ip> -j DROP | -D INPUT -s <ip> -j DROP | -L',
    // The grammar is in `forms`; the parser reads whole forms, not single flags.
    flags: [
      flag('-A', 'Append a rule', 'separate', 'INPUT'),
      flag('-D', 'Delete a rule', 'separate', 'INPUT'),
      flag('-s', 'Source address', 'separate', '<ip>'),
      flag('-j', 'Target', 'separate', 'DROP'),
      flag('-L', 'List the rules'),
    ],
    forms: ['-A INPUT -s <ip> -j DROP', '-D INPUT -s <ip> -j DROP', '-L'],
    examples: ['iptables -A INPUT -s 203.0.113.7 -j DROP', 'iptables -L'],
    operands: { min: 0, max: 0 },
    readsStdin: false,
  }),
  systemctl: def('systemctl', {
    summary: 'Control a service',
    usage: 'systemctl <status|stop|start|restart> <unit>',
    flags: [],
    forms: ['<status|stop|start|restart> <unit>'],
    examples: ['systemctl status nginx', 'systemctl restart nginx'],
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  ss: def('ss', {
    summary: 'List sockets',
    usage: 'ss [-t] [-l] [-n]',
    flags: [flag('-t', 'TCP sockets'), flag('-l', 'Listening sockets'), flag('-n', 'Numeric addresses')],
    examples: ['ss -tln'],
    operands: { min: 0, max: 0 },
    readsStdin: false,
  }),
  whois: def('whois', {
    summary: 'Look up the owner of an address',
    usage: 'whois <ip>',
    flags: [],
    examples: ['whois 203.0.113.7'],
    // The handler prints the usage error for a missing or invalid target (R6.8).
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  ping: def('ping', {
    summary: 'Send echo requests to a host',
    usage: 'ping [-c <count>] <host>',
    flags: [flag('-c', 'Number of replies, 1 to 20 (default 4)', 'either', '<count>')],
    examples: ['ping -c 2 203.0.113.7'],
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  nmap: def('nmap', {
    summary: 'Scan the ports of a host',
    usage: 'nmap [-p <ports>] [-sV] <host>',
    flags: [flag('-p', 'Ports to scan', 'either', '<ports>'), flag('-sV', 'Probe service versions')],
    examples: ['nmap -sV -p 22,80,443 203.0.113.7'],
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  curl: def('curl', {
    summary: 'Fetch a URL',
    usage: 'curl [-I] [-s] <url>',
    flags: [flag('-I', 'Headers only'), flag('-s', 'Silent')],
    examples: ['curl -I http://203.0.113.7/'],
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  flag: def('flag', {
    summary: 'Flag an address as a suspected attacker (DEF-21)',
    usage: 'flag <ip> [note...]',
    flags: [],
    examples: ['flag 203.0.113.9 scanner, thousands of 404s'],
    operands: { min: 1, max: INF },
    readsStdin: false,
  }),
  date: def('date', {
    summary: 'Print the in-game date and time',
    usage: 'date',
    flags: [],
    examples: ['date'],
    // Extra arguments print `unsupported argument` from the handler (R12.9).
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  history: def('history', {
    summary: 'Print the commands entered in this session',
    usage: 'history',
    flags: [],
    examples: ['history'],
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  clear: def('clear', {
    summary: 'Clear the terminal',
    usage: 'clear',
    flags: [],
    examples: ['clear'],
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  help: def('help', {
    summary: 'List the commands',
    usage: 'help',
    flags: [],
    examples: ['help'],
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
  man: def('man', {
    summary: 'Show the manual of a command',
    usage: 'man <command>',
    flags: [],
    examples: ['man grep'],
    operands: { min: 0, max: INF },
    readsStdin: false,
  }),
} satisfies Record<CommandName, CommandSpec>;

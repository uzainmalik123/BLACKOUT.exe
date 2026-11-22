// Task 21.1 (R16.1, R16.2): a mechanical META-test of the Shell's example coverage.
// (a) Every command in COMMAND_LIST and every flag/form in its registry spec has a row in the tables below, each row is
//     run through the Shell and accepted, and every command rejects an unsupported flag. Adding a flag or a form to the
//     registry without a row here fails the test and names the missing (command, flag) pair.
// (b) The 15 command-to-action rows of R16.2 each assert the exact Engine action (spy on engine.act) and the World change.
import { describe, expect, it, vi } from 'vitest';
import type { PlayerAction } from '../rules/vocabulary';
import { COMMAND_LIST } from './index';
import { COMMANDS } from './registry';
import type { CommandName } from './types';
import { makeFixture, type Fixture } from './test-fixtures/fixture';

const T = 30_000;
const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const LOG = '/var/log/nginx/access.log';
const UP = '/srv/juice-shop/uploads';
const IP = '203.0.113.9';
const BAD_FLAG = '-Q'; // in no command's registry flags, and not a numeric count

/** A fixture with some log text and a planted upload (`complaints/rip.php`), shared by the tables. */
const fixture = (): Fixture =>
  makeFixture({ seed: 3, advanceMs: 60_000, plant: [{ path: 'complaints/rip.php', content: '<?php echo 1;' }] });

const actsOf = (act: { mock: { calls: unknown[][] } }): PlayerAction[] => act.mock.calls.map((c) => c[0] as PlayerAction);

// ---- (a) R16.1: flags ----

interface FlagRow {
  command: CommandName;
  flag: string;
  line: string;
  /** Accepted exit codes; a documented non-flag failure (for example `grep` with no match, 1) is listed here. Default [0]. */
  codes?: number[];
}

/** One valid line per (command, flag). Rows run in order on one shell, so a later row may use an earlier row's file. */
const FLAG_ROWS: FlagRow[] = [
  { command: 'ls', flag: '-l', line: 'ls -l /tmp' },
  { command: 'ls', flag: '-a', line: 'ls -a /tmp' },
  { command: 'head', flag: '-n', line: `head -n 2 ${LOG}` },
  { command: 'tail', flag: '-n', line: `tail -n 2 ${LOG}` },
  { command: 'grep', flag: '-i', line: `grep -i get ${LOG}`, codes: [0, 1] },
  { command: 'grep', flag: '-v', line: `grep -v zzzz ${LOG}`, codes: [0, 1] },
  { command: 'grep', flag: '-c', line: `grep -c GET ${LOG}`, codes: [0, 1] },
  { command: 'grep', flag: '-n', line: `grep -n GET ${LOG}`, codes: [0, 1] },
  { command: 'grep', flag: '-E', line: `grep -E 'GET|POST' ${LOG}`, codes: [0, 1] },
  { command: 'grep', flag: '-e', line: `grep -e GET ${LOG}`, codes: [0, 1] },
  { command: 'awk', flag: '-F', line: `awk -F: '{print $1}' ${LOG}` },
  { command: 'sort', flag: '-r', line: `sort -r ${LOG}` },
  { command: 'sort', flag: '-n', line: `sort -n ${LOG}` },
  { command: 'sort', flag: '-k', line: `sort -k 2 ${LOG}` },
  { command: 'uniq', flag: '-c', line: `uniq -c ${LOG}` },
  { command: 'wc', flag: '-l', line: `wc -l ${LOG}` },
  { command: 'wc', flag: '-w', line: `wc -w ${LOG}` },
  { command: 'wc', flag: '-c', line: `wc -c ${LOG}` },
  { command: 'cut', flag: '-d', line: `cut -d ' ' -f 1 ${LOG}` },
  { command: 'cut', flag: '-f', line: `cut -d ' ' -f 1 ${LOG}` },
  { command: 'tar', flag: '-c', line: 'tar -czf /tmp/cov-a.tgz /var/log/nginx' },
  { command: 'tar', flag: '-t', line: 'tar -tzf /tmp/cov-a.tgz' },
  { command: 'tar', flag: '-z', line: 'tar -czf /tmp/cov-b.tgz /var/log/nginx' },
  { command: 'tar', flag: '-f', line: 'tar -tzf /tmp/cov-b.tgz' },
  { command: 'tar', flag: '-v', line: 'tar -czvf /tmp/cov-c.tgz /var/log/nginx' },
  { command: 'mkdir', flag: '-p', line: 'mkdir -p /tmp/cov/deep' },
  { command: 'rm', flag: '-r', line: 'rm -r /tmp/cov' },
  { command: 'sqlite3', flag: '-header', line: `sqlite3 -header ${DB} "SELECT id FROM Users LIMIT 1"` },
  { command: 'iptables', flag: '-A', line: 'iptables -A INPUT -s 203.0.113.50 -j DROP' },
  { command: 'iptables', flag: '-L', line: 'iptables -L' },
  { command: 'iptables', flag: '-D', line: 'iptables -D INPUT -s 203.0.113.50 -j DROP' },
  { command: 'iptables', flag: '-s', line: 'iptables -A INPUT -s 203.0.113.51 -j DROP' },
  { command: 'iptables', flag: '-j', line: 'iptables -D INPUT -s 203.0.113.51 -j DROP' },
  { command: 'ss', flag: '-t', line: 'ss -t' },
  { command: 'ss', flag: '-l', line: 'ss -l' },
  { command: 'ss', flag: '-n', line: 'ss -n' },
  { command: 'ping', flag: '-c', line: `ping -c 1 ${IP}` },
  { command: 'nmap', flag: '-p', line: `nmap -p 22 ${IP}` },
  { command: 'nmap', flag: '-sV', line: `nmap -sV ${IP}` },
  { command: 'curl', flag: '-I', line: `curl -I http://${IP}/` },
  { command: 'curl', flag: '-s', line: `curl -s http://${IP}/` },
];

// ---- (a) R16.1: grammar forms (one valid line and one malformed line each) ----

interface FormRow {
  command: CommandName;
  /** The form exactly as the registry's `forms` lists it. */
  form: string;
  line: string;
  malformed: string;
}

const FORM_ROWS: FormRow[] = [
  { command: 'awk', form: "[-F<sep>] '[/regex/] {print <expr>[, <expr>...]}' [file...]", line: `awk '{print $1}' ${LOG}`, malformed: 'awk' },
  { command: 'tar', form: 'czf <archive> <path>...', line: 'tar czf /tmp/cov-d.tgz /var/log/nginx', malformed: 'tar czf' },
  { command: 'tar', form: 'tzf <archive>', line: 'tar tzf /tmp/cov-d.tgz', malformed: 'tar tzf' },
  { command: 'sqlite3', form: '<path> <sql>', line: `sqlite3 ${DB} "SELECT 1"`, malformed: 'sqlite3' },
  { command: 'iptables', form: '-A INPUT -s <ip> -j DROP', line: 'iptables -A INPUT -s 203.0.113.52 -j DROP', malformed: 'iptables -A INPUT' },
  { command: 'iptables', form: '-D INPUT -s <ip> -j DROP', line: 'iptables -D INPUT -s 203.0.113.52 -j DROP', malformed: 'iptables -D INPUT' },
  { command: 'iptables', form: '-L', line: 'iptables -L', malformed: 'iptables -L extra' },
  { command: 'systemctl', form: '<status|stop|start|restart> <unit>', line: 'systemctl status nginx', malformed: 'systemctl status' },
];

describe('R16.1: every command, flag and form has a row in the coverage tables', () => {
  it('lists the command-and-flag pairs of the registry that no row covers', () => {
    const missing: string[] = [];
    for (const command of COMMAND_LIST) {
      for (const f of COMMANDS[command].flags) {
        if (!FLAG_ROWS.some((r) => r.command === command && r.flag === f.name)) missing.push(`${command} ${f.name}`);
      }
      for (const form of COMMANDS[command].forms ?? []) {
        if (!FORM_ROWS.some((r) => r.command === command && r.form === form)) missing.push(`${command} form "${form}"`);
      }
    }
    expect(missing, `registry flags or forms without a coverage row: ${missing.join('; ')}`).toEqual([]);
  });

  it('has no row for a flag or form the registry does not list', () => {
    const stale = [
      ...FLAG_ROWS.filter((r) => !COMMANDS[r.command].flags.some((f) => f.name === r.flag)).map((r) => `${r.command} ${r.flag}`),
      ...FORM_ROWS.filter((r) => !(COMMANDS[r.command].forms ?? []).includes(r.form)).map((r) => `${r.command} form "${r.form}"`),
    ];
    expect(stale).toEqual([]);
  });
});

describe('R16.1: each registry flag and form is accepted', () => {
  it('runs every flag row and finds no unsupported-flag text', { timeout: T }, async () => {
    const f = fixture();
    for (const row of FLAG_ROWS) {
      const r = await f.shell.run(row.line);
      const where = `${row.command} ${row.flag}: ${row.line} -> ${JSON.stringify(r)}`;
      expect(r.output, where).not.toContain('unsupported flag');
      expect(row.codes ?? [0], where).toContain(r.exitCode);
    }
    expect(f.internalErrors).toEqual([]);
  });

  it('runs every form row, and its malformed line prints the usage line and sends no action', { timeout: T }, async () => {
    const f = fixture();
    const act = vi.spyOn(f.engine, 'act');
    for (const row of FORM_ROWS) {
      const ok = await f.shell.run(row.line);
      expect(ok.exitCode, `${row.line} -> ${JSON.stringify(ok)}`).toBe(0);
      expect(ok.output).not.toContain('unsupported flag');
      act.mockClear();
      const bad = await f.shell.run(row.malformed);
      expect(bad, row.malformed).toEqual({ output: `${row.command}: usage: ${COMMANDS[row.command].usage}`, exitCode: 1 });
      expect(act, row.malformed).not.toHaveBeenCalled();
    }
  });
});

describe('R16.1: each command rejects an unsupported flag', () => {
  it('prints `<cmd>: unsupported flag` and the usage line, exits 1 and calls no action', { timeout: T }, async () => {
    const f = fixture();
    const act = vi.spyOn(f.engine, 'act');
    act.mockClear();
    expect(COMMAND_LIST).toHaveLength(31);
    for (const command of COMMAND_LIST) {
      const r = await f.shell.run(`${command} ${BAD_FLAG}`);
      expect(r, command).toEqual({
        output: `${command}: unsupported flag '${BAD_FLAG}'\n${command}: usage: ${COMMANDS[command].usage}`,
        exitCode: 1,
      });
    }
    expect(act).not.toHaveBeenCalled();
  });
});

// ---- (b) R16.2: the 15 command-to-action rows ----

interface ActionRow {
  name: string;
  /** Lines run before the spy is cleared (setup). */
  setup?: string[];
  line: string;
  /** The exact `Engine.act` calls the line makes, in order. */
  acts: PlayerAction[];
  /** Asserts the printed result and the World change. */
  check: (f: Fixture, r: { output: string; exitCode?: number }) => void;
}

const ACTION_ROWS: ActionRow[] = [
  {
    name: 'iptables -A (DEF-06 add)',
    line: `iptables -A INPUT -s ${IP} -j DROP`,
    acts: [{ type: 'DEF-06', op: 'add', ip: IP }],
    check: (f, r) => {
      expect(r).toEqual({ output: '', exitCode: 0 });
      expect(f.world.firewall.blocked).toContain(IP);
    },
  },
  {
    name: 'iptables -D (DEF-06 delete)',
    setup: [`iptables -A INPUT -s ${IP} -j DROP`],
    line: `iptables -D INPUT -s ${IP} -j DROP`,
    acts: [{ type: 'DEF-06', op: 'delete', ip: IP }],
    check: (f, r) => {
      expect(r).toEqual({ output: '', exitCode: 0 });
      expect(f.world.firewall.blocked).not.toContain(IP);
    },
  },
  {
    name: 'iptables -L (no action, lists the firewall)',
    setup: [`iptables -A INPUT -s ${IP} -j DROP`],
    line: 'iptables -L',
    acts: [],
    check: (f, r) => {
      expect(r.output).toBe(`Chain INPUT (policy ACCEPT)\nDROP       all  --  ${IP}  anywhere`);
      expect(f.world.firewall.blocked).toEqual([IP]);
    },
  },
  {
    name: 'systemctl stop (DEF-11)',
    line: 'systemctl stop nginx',
    acts: [{ type: 'DEF-11' }],
    check: (f, r) => {
      expect(r).toEqual({ output: '', exitCode: 0 });
      expect(f.world.nginx).toBe('stopped');
    },
  },
  {
    name: 'systemctl start (DEF-18)',
    setup: ['systemctl stop nginx'],
    line: 'systemctl start nginx',
    acts: [{ type: 'DEF-18', what: 'nginx' }],
    check: (f, r) => {
      expect(r).toEqual({ output: '', exitCode: 0 });
      expect(f.world.nginx).toBe('running');
    },
  },
  {
    name: 'systemctl restart (DEF-11 then DEF-18)',
    line: 'systemctl restart nginx',
    acts: [{ type: 'DEF-11' }, { type: 'DEF-18', what: 'nginx' }],
    check: (f, r) => {
      expect(r).toEqual({ output: '', exitCode: 0 });
      expect(f.world.nginx).toBe('running');
    },
  },
  {
    name: 'systemctl status (no action)',
    line: 'systemctl status nginx',
    acts: [],
    check: (f, r) => {
      expect(r).toEqual({ output: 'active (running)', exitCode: 0 });
      expect(f.world.nginx).toBe('running');
    },
  },
  {
    name: 'rm of an Uploaded_File by a relative path (DEF-15)',
    setup: [`cd ${UP}/complaints`],
    line: 'rm rip.php',
    acts: [{ type: 'DEF-15', path: 'complaints/rip.php' }],
    check: (f, r) => {
      expect(r).toEqual({ output: '', exitCode: 0 });
      expect(f.world.files.some((x) => x.path === 'complaints/rip.php')).toBe(false);
    },
  },
  {
    name: 'tar czf /evidence/.. (DEF-05)',
    line: 'tar czf /evidence/snap.tgz /var/log/nginx',
    acts: [{ type: 'DEF-05', name: 'snap' }],
    check: (f, r) => {
      expect(r).toEqual({ output: '', exitCode: 0 });
      expect(f.world.evidence.map((e) => e.name)).toEqual(['snap']);
    },
  },
  {
    name: 'sqlite3 UPDATE (DEF-08)',
    line: `sqlite3 ${DB} "UPDATE Users SET deletedAt = datetime('now') WHERE email = 'jim@juice-sh.op'"`,
    acts: [{ type: 'DEF-08', email: 'jim@juice-sh.op' }],
    check: (f, r) => {
      expect(r).toEqual({ output: '', exitCode: 0 });
      expect(f.world.accounts.find((a) => a.email === 'jim@juice-sh.op')?.lockedAt).toBeDefined();
    },
  },
  {
    name: 'sqlite3 DELETE (DEF-14)',
    line: `sqlite3 ${DB} "DELETE FROM Users WHERE email = 'jim@juice-sh.op'"`,
    acts: [{ type: 'DEF-14', email: 'jim@juice-sh.op' }],
    check: (f, r) => {
      expect(r).toEqual({ output: '', exitCode: 0 });
      expect(f.world.accounts.some((a) => a.email === 'jim@juice-sh.op')).toBe(false);
    },
  },
  {
    name: 'whois (DEF-04 passive)',
    line: `whois ${IP}`,
    acts: [{ type: 'DEF-04', ip: IP, mode: 'passive' }],
    check: (_f, r) => expect(r.exitCode).toBe(0),
  },
  {
    name: 'ping (DEF-04 active)',
    line: `ping -c 1 ${IP}`,
    acts: [{ type: 'DEF-04', ip: IP, mode: 'active' }],
    check: (_f, r) => expect(r.exitCode).toBe(0),
  },
  {
    name: 'nmap (DEF-04 active)',
    line: `nmap ${IP}`,
    acts: [{ type: 'DEF-04', ip: IP, mode: 'active' }],
    check: (_f, r) => expect(r.exitCode).toBe(0),
  },
  {
    name: 'curl (DEF-04 active)',
    line: `curl -I http://${IP}/`,
    acts: [{ type: 'DEF-04', ip: IP, mode: 'active' }],
    check: (_f, r) => expect(r.exitCode).toBe(0),
  },
];

describe('R16.2: the 15 command-to-action rows', () => {
  it('has 15 rows', () => {
    expect(ACTION_ROWS).toHaveLength(15);
  });

  for (const row of ACTION_ROWS) {
    it(`${row.name}: the exact Engine action and the World change`, { timeout: T }, async () => {
      const f = fixture();
      for (const line of row.setup ?? []) expect((await f.shell.run(line)).exitCode, line).toBe(0);
      const act = vi.spyOn(f.engine, 'act');
      act.mockClear();
      const r = await f.shell.run(row.line);
      expect(actsOf(act)).toEqual(row.acts);
      row.check(f, r);
      expect(f.internalErrors).toEqual([]);
    });
  }
});

describe('R16.2: the read actions and the session examples', () => {
  it('DEF-01, DEF-02 and DEF-03 are each sent once by reading a log, the database and an upload', { timeout: T }, async () => {
    const f = fixture();
    const act = vi.spyOn(f.engine, 'act');
    act.mockClear();
    const line = `grep GET ${LOG}`;
    await f.shell.run(line);
    expect(actsOf(act)).toEqual([{ type: 'DEF-01', query: line }]);
    act.mockClear();
    await f.shell.run(`sqlite3 ${DB} "SELECT id FROM Users LIMIT 1"`);
    expect(actsOf(act)).toEqual([{ type: 'DEF-02', sql: 'SELECT id FROM Users LIMIT 1' }]);
    act.mockClear();
    expect((await f.shell.run(`cat ${UP}/complaints/rip.php`)).output).toBe('<?php echo 1;');
    expect(actsOf(act)).toEqual([{ type: 'DEF-03', path: `${UP}/complaints/rip.php` }]);
  });

  it('clear returns the clear flag', { timeout: T }, async () => {
    const f = fixture();
    expect(await f.shell.run('clear')).toEqual({ output: '', exitCode: 0, clear: true });
  });

  it('exitCode is 0 on success, 1 on a command error and 127 for an unknown command', { timeout: T }, async () => {
    const f = fixture();
    expect((await f.shell.run('pwd')).exitCode).toBe(0);
    expect((await f.shell.run('ls /nowhere')).exitCode).toBe(1);
    expect(await f.shell.run('nosuchcmd')).toEqual({ output: 'nosuchcmd: command not found', exitCode: 127 });
  });

  it('globs expand and `~` is the home directory', { timeout: T }, async () => {
    const f = fixture();
    expect((await f.shell.run(`ls ${UP}/compl*`)).output).toContain('rip.php');
    expect(await f.shell.run('ls /var/log/ngin*/acc*')).toEqual({ output: LOG, exitCode: 0 });
    expect(await f.shell.run('cd ~')).toEqual({ output: '', exitCode: 0 });
    expect((await f.shell.run('pwd')).output).toBe('/srv/juice-shop');
    expect((await f.shell.run('ls ~/uploads')).output).toContain('complaints');
  });

  it('sqlite3 .tables, .schema and -header print the catalog and the column names', { timeout: T }, async () => {
    const f = fixture();
    const tables = await f.shell.run(`sqlite3 ${DB} .tables`);
    expect(tables.exitCode).toBe(0);
    expect(tables.output).toContain('Users');
    const schema = await f.shell.run(`sqlite3 ${DB} ".schema Users"`);
    expect(schema.exitCode).toBe(0);
    expect(schema.output).toMatch(/^CREATE TABLE/i);
    const header = await f.shell.run(`sqlite3 -header ${DB} "SELECT id, email FROM Users LIMIT 1"`);
    expect(header.output.split('\n')[0]).toBe('id|email');
  });
});

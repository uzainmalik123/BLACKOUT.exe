/// <reference types="node" />
// Registry tests (R2.1, R2.6, R5.19, KDEV-01): the command list, the steering-list match, flag and form parsing.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseArgs, parseForms } from './argparse';
import { COMMAND_LIST } from './index';
import { COMMAND_NAMES, COMMANDS } from './registry';
import type { CommandName } from './types';

const EXPECTED_31 = [
  'ls', 'cd', 'pwd', 'cat', 'head', 'tail', 'grep', 'awk', 'sort', 'uniq', 'wc', 'cut',
  'file', 'sha256sum', 'tar', 'cp', 'rm', 'mkdir', 'sqlite3', 'iptables', 'systemctl',
  'ss', 'whois', 'ping', 'nmap', 'curl', 'flag', 'date', 'history', 'clear', 'help', 'man',
];

// game/src/shell -> repo root is three levels up.
const STEERING = readFileSync(new URL('../../../.kiro/steering/game-shell.md', import.meta.url), 'utf8');

/** The command names in the first backtick line after "Only these commands exist:". */
function steeringCommands(): string[] {
  const match = /Only these commands exist:\s*\n\s*`([^`]+)`/.exec(STEERING);
  if (!match) throw new Error('game-shell.md: the command list line was not found');
  return (match[1] as string).trim().split(/\s+/);
}

const names = COMMAND_NAMES as readonly CommandName[];

describe('COMMAND_LIST (R2.1)', () => {
  it('is the literal 32 names in the steering order (flag since D-233)', () => {
    expect([...COMMAND_LIST]).toEqual(EXPECTED_31);
    expect(COMMAND_LIST).toHaveLength(32);
  });

  it('has no duplicates', () => {
    expect(new Set(COMMAND_LIST).size).toBe(COMMAND_LIST.length);
  });

  it('has a registry entry for every name, keyed by that name', () => {
    expect(Object.keys(COMMANDS).sort()).toEqual([...EXPECTED_31].sort());
    for (const name of names) expect(COMMANDS[name].name).toBe(name);
  });
});

describe('steering list (R2.6, KDEV-01)', () => {
  it('matches COMMAND_LIST; every command in only one list is named', () => {
    const steering = steeringCommands();
    const mismatches = [
      ...steering.filter((c) => !COMMAND_LIST.includes(c as CommandName)).map((c) => `${c}: only in game-shell.md`),
      ...COMMAND_LIST.filter((c) => !steering.includes(c)).map((c) => `${c}: only in COMMAND_LIST`),
    ];
    expect(mismatches, mismatches.join('; ')).toEqual([]);
  });
});

describe('steering files (KDEV-01)', () => {
  const read = (name: string) => readFileSync(new URL(`../../../.kiro/steering/${name}`, import.meta.url), 'utf8');

  it('both files exist and are always included', () => {
    for (const name of ['project.md', 'game-shell.md']) expect(read(name), name).toMatch(/^---\ninclusion: always\n---\n/);
  });

  it('the project rules point at AGENTS.md and the PRD', () => {
    const project = read('project.md');
    expect(project).toContain('#[[file:AGENTS.md]]');
    expect(project).toContain('docs/PRD.md');
  });
});

describe('parseArgs (R5.19)', () => {
  it('accepts every flag in each command flags list', () => {
    for (const name of names) {
      const spec = COMMANDS[name];
      for (const f of spec.flags) {
        const argv = f.value ? [f.name, 'x'] : [f.name];
        const result = parseArgs(spec, argv);
        expect(result.ok, `${name} ${f.name}`).toBe(true);
        if (result.ok) {
          expect(result.flags.has(f.name), `${name} ${f.name}`).toBe(true);
          expect(result.operands, `${name} ${f.name}`).toEqual([]);
        }
      }
    }
  });

  it('rejects flags that are not in the list', () => {
    for (const name of names) {
      const spec = COMMANDS[name];
      for (const bad of ['-Q', '--zzz']) {
        const result = parseArgs(spec, [bad]);
        expect(result.ok, `${name} ${bad}`).toBe(false);
        if (!result.ok) {
          expect(result.kind).toBe('unsupported');
          expect(result.flag).toBe(bad);
        }
      }
    }
  });

  it('handles bundled short flags (-la) and rejects a bundle with an unknown letter', () => {
    const ok = parseArgs(COMMANDS.ls, ['-la', '/tmp']);
    expect(ok).toMatchObject({ ok: true, operands: ['/tmp'] });
    if (ok.ok) expect([...ok.flags.keys()]).toEqual(['-l', '-a']);
    expect(parseArgs(COMMANDS.ls, ['-lz'])).toMatchObject({ ok: false, flag: '-z' });
  });

  it('takes -header as one whole-token flag, not as bundled letters', () => {
    const ok = parseArgs(COMMANDS.sqlite3, ['-header', '/db', 'SELECT 1']);
    expect(ok).toMatchObject({ ok: true, operands: ['/db', 'SELECT 1'] });
    if (ok.ok) expect(ok.flags.has('-header')).toBe(true);
    expect(parseArgs(COMMANDS.sqlite3, ['-hea'])).toMatchObject({ ok: false, kind: 'unsupported' });
  });

  it('reads -n 5 and -n5 as the value 5', () => {
    for (const argv of [['-n', '5', 'f'], ['-n5', 'f']]) {
      const r = parseArgs(COMMANDS.head, argv);
      expect(r).toMatchObject({ ok: true, operands: ['f'] });
      if (r.ok) expect(r.flags.get('-n')).toEqual(['5']);
    }
  });

  it('reports a flag with no value as missing-value', () => {
    expect(parseArgs(COMMANDS.head, ['-n'])).toMatchObject({ ok: false, kind: 'missing-value', flag: '-n' });
  });

  it('reads -5 as a count for head and tail, and rejects it elsewhere', () => {
    for (const cmd of ['head', 'tail'] as const) {
      const r = parseArgs(COMMANDS[cmd], ['-5', 'f']);
      expect(r).toMatchObject({ ok: true, count: '5', operands: ['f'] });
    }
    expect(parseArgs(COMMANDS.cat, ['-5'])).toMatchObject({ ok: false, kind: 'unsupported' });
  });

  it('ends flag parsing at -- and treats a lone - as an operand', () => {
    expect(parseArgs(COMMANDS.head, ['--', '-5', '-n'])).toMatchObject({ ok: true, operands: ['-5', '-n'] });
    expect(parseArgs(COMMANDS.cat, ['-', 'a'])).toMatchObject({ ok: true, operands: ['-', 'a'] });
    const r = parseArgs(COMMANDS.ls, ['-l', '--', '-a']);
    expect(r).toMatchObject({ ok: true, operands: ['-a'] });
  });
});

describe('parseForms', () => {
  it('captures a choice and a name for systemctl', () => {
    const forms = COMMANDS.systemctl.forms as readonly string[];
    expect(parseForms(forms, ['restart', 'nginx'])).toEqual({ index: 0, values: { choice: 'restart', unit: 'nginx' } });
    expect(parseForms(forms, ['reload', 'nginx'])).toBeUndefined();
    expect(parseForms(forms, ['status'])).toBeUndefined();
    expect(parseForms(forms, ['status', 'nginx', 'extra'])).toBeUndefined();
  });

  it('matches the iptables forms by literal tokens and picks the right index', () => {
    const forms = COMMANDS.iptables.forms as readonly string[];
    expect(parseForms(forms, ['-A', 'INPUT', '-s', '1.2.3.4', '-j', 'DROP'])).toEqual({ index: 0, values: { ip: '1.2.3.4' } });
    expect(parseForms(forms, ['-D', 'INPUT', '-s', '1.2.3.4', '-j', 'DROP'])).toEqual({ index: 1, values: { ip: '1.2.3.4' } });
    expect(parseForms(forms, ['-L'])).toEqual({ index: 2, values: {} });
    expect(parseForms(forms, ['-A', 'OUTPUT', '-s', '1.2.3.4', '-j', 'DROP'])).toBeUndefined();
    expect(parseForms(forms, ['-A', 'INPUT', '-s', '1.2.3.4', '-j', 'DROP', 'x'])).toBeUndefined();
    expect(parseForms(forms, [])).toBeUndefined();
  });

  it('captures a trailing <x>... as one or more tokens (tar)', () => {
    const forms = COMMANDS.tar.forms as readonly string[];
    expect(parseForms(forms, ['czf', '/evidence/a.tgz', '/a', '/b'])).toEqual({
      index: 0,
      values: { archive: '/evidence/a.tgz', path: ['/a', '/b'] },
    });
    expect(parseForms(forms, ['czf', '/evidence/a.tgz'])).toBeUndefined();
    expect(parseForms(forms, ['tzf', '/evidence/a.tgz'])).toEqual({ index: 1, values: { archive: '/evidence/a.tgz' } });
    expect(parseForms(forms, ['tzf', 'a', 'b'])).toBeUndefined();
  });
});

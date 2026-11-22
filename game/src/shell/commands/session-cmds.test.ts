import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, COMMAND_NAMES } from '../registry';
import { makeFixture } from '../test-fixtures/fixture';

const T = 30_000;

afterEach(() => {
  vi.useRealTimers();
});

describe('date (R12.1)', () => {
  it('prints the game time, identical for the same gameMs and ignoring real time', async () => {
    const { shell } = makeFixture({ baseline: false });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2001-01-01T00:00:00Z'));
    const a = await shell.run('date');
    vi.setSystemTime(new Date('2040-06-15T12:34:56Z'));
    const b = await shell.run('date');
    expect(a.exitCode).toBe(0);
    expect(a.output).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d\d:\d\d:\d\d UTC \d{4}$/);
    expect(a.output).toBe(b.output);
    expect(a.output).toContain('2026');
  }, T);

  it('changes after the engine advances', async () => {
    const { shell, engine } = makeFixture({ baseline: false });
    const before = await shell.run('date');
    engine.advance(5000);
    const after = await shell.run('date');
    expect(after.output).not.toBe(before.output);
  }, T);

  it('rejects an argument', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('date x');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("date: unsupported argument 'x'");
  }, T);
});

describe('history (R12.2, R12.3)', () => {
  it('numbers from 1 with the history line last and skips blank lines', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('pwd');
    await shell.run('   ');
    await shell.run('nosuchcmd');
    const r = await shell.run('history');
    expect(r.exitCode).toBe(0);
    expect(r.output.split('\n')).toEqual(['    1  pwd', '    2  nosuchcmd', '    3  history']);
  }, T);

  it('keeps the last 500 lines and continues numbering', async () => {
    const { shell } = makeFixture({ baseline: false });
    for (let i = 1; i <= 509; i++) await shell.run(`pwd # ${i}`);
    const lines = (await shell.run('history')).output.split('\n');
    expect(lines).toHaveLength(500);
    // 510 lines entered including `history`; the oldest kept is number 11
    expect(lines[0]).toBe('   11  pwd # 11');
    expect(lines[499]).toBe('  510  history');
  }, T);

  it('rejects an argument and a flag, adding only its own entry', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('pwd');
    const bad = await shell.run('history x');
    expect(bad.exitCode).toBe(1);
    expect(bad.output).toContain("history: unsupported argument 'x'");
    const flag = await shell.run('history -c');
    expect(flag.exitCode).toBe(1);
    expect(flag.output).toMatch(/history: unsupported (argument|flag) '-c'/);
    expect((await shell.run('history')).output.split('\n')).toEqual([
      '    1  pwd',
      '    2  history x',
      '    3  history -c',
      '    4  history',
    ]);
  }, T);
});

describe('clear (R12.4)', () => {
  it('returns the clear result', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('clear')).toEqual({ output: '', exitCode: 0, clear: true });
  }, T);

  it('sets no clear flag inside a pipeline', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('clear | cat');
    expect(r).not.toHaveProperty('clear');
    expect(r.exitCode).toBe(0);
  }, T);

  it('rejects an argument and a flag', async () => {
    const { shell } = makeFixture({ baseline: false });
    const a = await shell.run('clear x');
    expect(a.exitCode).toBe(1);
    expect(a.output).toContain("clear: unsupported argument 'x'");
    expect(a).not.toHaveProperty('clear');
    const f = await shell.run('clear -x');
    expect(f.exitCode).toBe(1);
    expect(f.output).toMatch(/clear: unsupported (argument|flag) '-x'/);
  }, T);
});

describe('help (R12.5)', () => {
  it('lists every command alphabetically with summaries up to 80 characters', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('help');
    expect(r.exitCode).toBe(0);
    const lines = r.output.split('\n').filter((l) => l !== '');
    const sorted = [...COMMAND_NAMES].sort();
    expect(lines.map((l) => l.split(' ')[0])).toEqual(sorted);
    for (const l of lines) {
      const name = l.split(' ')[0] as keyof typeof COMMANDS;
      expect(l.startsWith(`${name}  `)).toBe(true);
      const desc = l.slice(name.length + 2);
      expect(desc.length).toBeGreaterThan(0);
      expect(desc.length).toBeLessThanOrEqual(80);
    }
  }, T);

  it('rejects an argument and a flag', async () => {
    const { shell } = makeFixture({ baseline: false });
    const a = await shell.run('help ls');
    expect(a.exitCode).toBe(1);
    expect(a.output).toContain("help: unsupported argument 'ls'");
    const f = await shell.run('help -a');
    expect(f.exitCode).toBe(1);
    expect(f.output).toMatch(/help: unsupported (argument|flag) '-a'/);
  }, T);
});

describe('man (R12.6 to R12.8)', () => {
  it('prints flags and examples from the registry for every command', async () => {
    const { shell } = makeFixture({ baseline: false });
    for (const name of COMMAND_NAMES) {
      const r = await shell.run(`man ${name}`);
      expect(r.exitCode, name).toBe(0);
      const spec = COMMANDS[name];
      expect(spec.examples.length, name).toBeGreaterThan(0);
      for (const e of spec.examples) expect(r.output, name).toContain(e);
      for (const f of spec.flags) {
        expect(r.output, name).toContain(f.name);
        expect(r.output, name).toContain(f.summary);
      }
    }
  }, T);

  it('reports an unknown command', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('man nosuch');
    expect(r).toEqual({ output: 'No manual entry for nosuch', exitCode: 1 });
  }, T);

  it('prints usage with no argument', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('man');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain(`man: usage: ${COMMANDS.man.usage}`);
  }, T);

  it('rejects extra arguments', async () => {
    const { shell } = makeFixture({ baseline: false });
    const r = await shell.run('man ls cat');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("man: unsupported argument 'cat'");
  }, T);

  it('leaves the history unchanged apart from its own entries', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('man nosuch');
    await shell.run('man');
    expect((await shell.run('history')).output.split('\n').filter(Boolean)).toEqual([
      '    1  man nosuch',
      '    2  man',
      '    3  history',
    ]);
  }, T);
});

import { describe, expect, it, vi } from 'vitest';
import type { Session } from './types';
import { makeFixture } from './test-fixtures/fixture';

// Capture every (session, line) pair that createShell records, to inspect the stored history.
const recorded = vi.hoisted(() => ({ sessions: [] as Session[] }));
vi.mock('./session', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./session')>();
  return {
    ...mod,
    recordLine: (s: Session, line: string) => {
      if (!recorded.sessions.includes(s)) recorded.sessions.push(s);
      mod.recordLine(s, line);
    },
  };
});

describe('createShell', () => {
  it('sets exitCode for blank, unknown, syntax-error and ok lines', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('   ')).toEqual({ output: '', exitCode: 0 });
    expect((await shell.run('pwd')).exitCode).toBeTypeOf('number');
  }, 30_000);

  it('answers 127 for an unknown command with the fixed message', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run('frobnicate -x')).toEqual({ output: 'frobnicate: command not found', exitCode: 127 });
  }, 30_000);

  it('answers 2 for a syntax error and runs nothing', async () => {
    const { shell, actions } = makeFixture({ baseline: false });
    const before = actions().length;
    const r = await shell.run('ls |');
    expect(r.exitCode).toBe(2);
    expect(r.output).toMatch(/^sh: syntax error/);
    expect(actions()).toHaveLength(before);
  }, 30_000);

  it('returns empty output and exit 0 for a whitespace-only line', async () => {
    const { shell } = makeFixture({ baseline: false });
    expect(await shell.run(' \t ')).toEqual({ output: '', exitCode: 0 });
    expect(await shell.run('')).toEqual({ output: '', exitCode: 0 });
  }, 30_000);

  it('stores non-blank lines unmodified and skips blank ones', async () => {
    const { shell } = makeFixture({ baseline: false });
    const before = recorded.sessions.length;
    await shell.run('  frobnicate   a ');
    await shell.run('   ');
    await shell.run('ls |');
    const session = recorded.sessions[before];
    expect(session?.history).toEqual(['  frobnicate   a ', 'ls |']);
  }, 30_000);

  it('never calls advance, pause or resume', async () => {
    const { shell, engine } = makeFixture({ baseline: false });
    const advance = vi.spyOn(engine, 'advance');
    const pause = vi.spyOn(engine, 'pause');
    const resume = vi.spyOn(engine, 'resume');
    for (const line of ['pwd', 'ls', 'nope', 'ls |', '  ', 'cat a | grep b']) await shell.run(line);
    expect(advance).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  }, 30_000);

  it('leaves the Engine unchanged for an unknown command', async () => {
    const { shell, engine, worldWithoutReads, actions } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    const before = worldWithoutReads();
    const n = actions().length;
    await shell.run('frobnicate');
    await shell.run('pwd | frobnicate');
    expect(act).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(n);
    expect(worldWithoutReads()).toEqual(before);
  }, 30_000);

  it('never rejects, even when the Engine throws', async () => {
    const { shell, engine, internalErrors } = makeFixture({ baseline: false });
    vi.spyOn(engine, 'act').mockImplementation(() => {
      throw new Error('boom');
    });
    for (const line of ['pwd', 'ls', 'cat x', 'nope', '|', "echo 'a", '']) {
      await expect(shell.run(line)).resolves.toMatchObject({ exitCode: expect.any(Number) });
    }
    expect(internalErrors.every((e) => e instanceof Error)).toBe(true);
  }, 30_000);

  it('runs lines in the order they were submitted', async () => {
    const { shell } = makeFixture({ baseline: false });
    const done: string[] = [];
    const lines = ['frobnicate', '   ', 'ls |', 'zzz', 'pwd'];
    const results = await Promise.all(
      lines.map((l) =>
        shell.run(l).then((r) => {
          done.push(l);
          return r;
        }),
      ),
    );
    expect(done).toEqual(lines);
    expect(results.map((r) => r.exitCode).slice(0, 4)).toEqual([127, 0, 2, 127]);
  }, 30_000);

  it('records history in submission order when lines are queued without awaiting', async () => {
    const { shell } = makeFixture({ baseline: false });
    const before = recorded.sessions.length;
    await Promise.all(['a1', 'a2', 'a3'].map((l) => shell.run(l)));
    expect(recorded.sessions[before]?.history).toEqual(['a1', 'a2', 'a3']);
  }, 30_000);

  it('exposes complete only on easy', () => {
    expect(makeFixture({ baseline: false, difficulty: 'medium' }).shell.complete).toBeUndefined();
    expect(makeFixture({ baseline: false, difficulty: 'easy' }).shell.complete).toBeTypeOf('function');
  }, 30_000);
});

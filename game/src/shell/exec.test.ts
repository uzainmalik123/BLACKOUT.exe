import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '../engine/engine';
import { runPipeline, type ShellInternals } from './exec';
import { parseLine } from './parser';
import { COMMANDS } from './registry';
import type { CommandResult, CommandSpec, Handler, Pipeline, VirtualFsLike } from './types';

function spec(name: 'cat' | 'sort' | 'grep', handler: Handler): CommandSpec {
  return { ...COMMANDS[name], handler };
}

function setup(handlers: Partial<Record<'cat' | 'sort' | 'grep', Handler>>) {
  const act = vi.fn(() => ({ ok: true, message: '' }));
  const calls = { begin: 0, end: 0 };
  const vfs = {
    stat: () => undefined,
    list: () => undefined,
    beginInvocation: () => void calls.begin++,
    endInvocation: () => void calls.end++,
  } as unknown as VirtualFsLike;
  const onInternalError = vi.fn();
  const commands: Record<string, CommandSpec> = {};
  for (const [name, h] of Object.entries(handlers)) commands[name] = spec(name as 'cat', h);
  const sh: ShellInternals = {
    engine: { act, world: {} } as unknown as Engine,
    vfs,
    session: { cwd: '/', history: [], runCount: 0, overlay: new Map() },
    commands,
    onInternalError,
  };
  const run = (line: string) => {
    const parsed = parseLine(line);
    if (!parsed.ok) throw new Error(parsed.error);
    return runPipeline(sh, parsed.pipeline as Pipeline, line);
  };
  return { run, act, calls, onInternalError };
}

const ok = (stdout: string): CommandResult => ({ stdout, stderr: '', code: 0 });

describe('runPipeline', () => {
  it('feeds stdout of each stage to the next as stdin and brackets each invocation', async () => {
    const { run, calls } = setup({
      cat: () => ok('b\na\n'),
      sort: (_c, _a, stdin) => ok(stdin.split('\n').filter(Boolean).sort().join('\n') + '\n'),
    });
    expect(await run('cat | sort')).toEqual({ output: 'a\nb', exitCode: 0 });
    expect(calls).toEqual({ begin: 2, end: 2 });
  });

  it('answers 127 for the first unknown stage and runs nothing', async () => {
    const handler = vi.fn(() => ok('x'));
    const { run, act } = setup({ cat: handler });
    expect(await run('cat | nope | alsonope')).toEqual({ output: 'nope: command not found', exitCode: 127 });
    expect(handler).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
  });

  it('turns a throwing handler into "<cmd>: internal error" and calls the hook', async () => {
    const boom = new Error('secret detail');
    const { run, onInternalError } = setup({
      cat: () => {
        throw boom;
      },
    });
    const result = await run('cat');
    expect(result).toEqual({ output: 'cat: internal error', exitCode: 1 });
    expect(onInternalError).toHaveBeenCalledWith(boom);
  });

  it('shows stderr of earlier stages first and exits with the last stage code', async () => {
    const { run } = setup({
      cat: () => ({ stdout: 'out\n', stderr: 'cat: oops\n', code: 1 }),
      grep: (_c, _a, stdin) => ok(stdin),
    });
    expect(await run('cat | grep')).toEqual({ output: 'cat: oops\nout', exitCode: 0 });
  });

  describe('redirection', () => {
    function redirectSetup(handler: Handler) {
      const written = new Map<string, string>();
      const act = vi.fn(() => ({ ok: true, message: '' }));
      const vfs = {
        stat: (p: string) =>
          p === '/tmp' ? { kind: 'dir' } : written.has(p) ? { kind: 'file' } : p === '/evidence/e.tgz' ? { kind: 'file' } : undefined,
        areaOf: (p: string) => (p.startsWith('/tmp') ? 'tmp' : p.startsWith('/evidence') ? 'evidence' : 'system'),
        canWrite: (p: string) => p.startsWith('/tmp'),
        writeFile: (p: string, b: Uint8Array) => void written.set(p, new TextDecoder().decode(b)),
        beginInvocation: () => {},
        endInvocation: () => {},
      };
      return { act, written, vfs, handler };
    }
    const run = (r: ReturnType<typeof redirectSetup>, line: string) => {
      const parsed = parseLine(line);
      if (!parsed.ok) throw new Error(parsed.error);
      const internals = {
        engine: { act: r.act, world: {} },
        vfs: r.vfs,
        session: { cwd: '/tmp', history: [], runCount: 0, overlay: new Map() },
        commands: { cat: { ...COMMANDS.cat, handler: r.handler } },
      } as unknown as ShellInternals;
      return runPipeline(internals, parsed.pipeline as Pipeline, line);
    };

    it('writes stdout to the target and prints nothing', async () => {
      const r = redirectSetup(() => ok('hi\n'));
      expect(await run(r, 'cat > out.txt')).toEqual({ output: '', exitCode: 0 });
      expect(r.written.get('/tmp/out.txt')).toBe('hi\n');
    });

    it('refuses outside the Writable_Area before running any stage', async () => {
      const handler = vi.fn(() => ok('x'));
      const r = redirectSetup(handler);
      expect(await run(r, 'cat > /etc/x')).toEqual({ output: '/etc/x: Permission denied', exitCode: 1 });
      expect(await run(r, 'cat > /evidence/e.tgz')).toEqual({ output: '/evidence/e.tgz: Operation not permitted', exitCode: 1 });
      expect(await run(r, 'cat > /tmp')).toEqual({ output: '/tmp: Is a directory', exitCode: 1 });
      expect(await run(r, 'cat > /tmp/no/x')).toEqual({ output: '/tmp/no/x: No such file or directory', exitCode: 1 });
      expect(handler).not.toHaveBeenCalled();
      expect(r.written.size).toBe(0);
    });

    it('writes nothing when a stage fails', async () => {
      const h: Handler = () => ({ stdout: 'part\n', stderr: 'cat: bad\n', code: 1 });
      const r = redirectSetup(h);
      expect(await run(r, 'cat > out.txt')).toEqual({ output: 'cat: bad', exitCode: 1 });
      expect(r.written.size).toBe(0);
    });
  });
});

// `tar czf` / `tar tzf` (PRD SYS-09; R8, D-90, D-98, D-101, D-109).
// `tar czf` sends DEF-05 only: sources are read without the ReadTracker (D-98).

import { parseArgs } from '../argparse';
import { decodeArchive, encodeArchive, listArchive } from '../archive-format';
import { MSG, fail, ok, tarInvalidName, tarNoSuchFile, unsupportedFlag, usage } from '../output';
import { basename, byteCompare, dirname, resolvePath } from '../path';
import type { ArchiveEntry, CommandContext, CommandResult, Handler, VfsLister } from '../types';

const MAX_SOURCES = 16;
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SUFFIX = '.tgz';

function reason(e: unknown): string {
  return e instanceof Error && e.message !== '' ? e.message : MSG.ioError;
}

/** Absolute paths of everything below `dir` (directories and files), in ascending path order. */
function descendants(vfs: VfsLister, dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of vfs.list(d) ?? []) {
      const child = `${d === '/' ? '' : d}/${name}`;
      out.push(child);
      if (vfs.stat(child)?.kind === 'dir') walk(child);
    }
  };
  walk(dir);
  return out.sort(byteCompare);
}

async function create(ctx: CommandContext, archiveTyped: string, sources: string[]): Promise<CommandResult> {
  const { vfs, session } = ctx;
  const archiveAbs = resolvePath(session.cwd, archiveTyped);
  const area = vfs.areaOf(archiveAbs);

  // 1. Where the archive goes.
  let evidenceName: string | undefined;
  if (area === 'evidence') {
    const base = basename(archiveAbs);
    const name = base.endsWith(SUFFIX) ? base.slice(0, -SUFFIX.length) : undefined;
    if (dirname(archiveAbs) !== '/evidence' || name === undefined || !NAME_RE.test(name)) {
      return tarInvalidName(archiveTyped);
    }
    evidenceName = name;
  } else if (area !== 'tmp') {
    return fail('tar', `${archiveTyped}: ${MSG.permissionDenied}`);
  }

  // 2. Every source must exist (the first missing one is reported).
  const absSources = sources.map((s) => resolvePath(session.cwd, s));
  for (let i = 0; i < sources.length; i++) {
    if (!vfs.stat(absSources[i] as string)) return tarNoSuchFile(sources[i] as string);
  }

  // 3. Read the sources (no tracker sink).
  const entries: ArchiveEntry[] = [];
  const seen = new Set<string>();
  const add = async (abs: string, typed: string): Promise<CommandResult | undefined> => {
    if (seen.has(abs)) return undefined;
    seen.add(abs);
    if (vfs.stat(abs)?.kind === 'dir') {
      entries.push({ path: abs, type: 'dir', bytes: new Uint8Array(0) });
      return undefined;
    }
    try {
      entries.push({ path: abs, type: 'file', bytes: await vfs.readBytes(abs) });
    } catch (e) {
      return fail('tar', `${typed}: ${reason(e)}`);
    }
    return undefined;
  };
  for (let i = 0; i < absSources.length; i++) {
    const root = absSources[i] as string;
    const err = await add(root, sources[i] as string);
    if (err) return err;
    if (vfs.stat(root)?.kind === 'dir') {
      for (const child of descendants(vfs, root)) {
        const e = await add(child, child);
        if (e) return e;
      }
    }
  }

  // 4. DEF-05 for /evidence, then the archive.
  // Once DEF-05 succeeds the Engine lists the name and the VFS refuses writes to it (D-101), so the archive is
  // stored first; a name the Engine already holds goes to DEF-05 alone and prints its message.
  if (evidenceName !== undefined && !vfs.canWrite(archiveAbs)) {
    const result = await ctx.engine.act({ type: 'DEF-05', name: evidenceName });
    return { stdout: '', stderr: `${result.ok ? MSG.notPermitted : result.message}\n`, code: 1 };
  }
  try {
    vfs.putArchive(archiveAbs, entries, encodeArchive(entries));
  } catch (e) {
    return fail('tar', `${archiveTyped}: ${reason(e)}`);
  }
  if (evidenceName !== undefined) {
    const result = await ctx.engine.act({ type: 'DEF-05', name: evidenceName });
    if (!result.ok) {
      vfs.remove(archiveAbs);
      return { stdout: '', stderr: `${result.message}\n`, code: 1 };
    }
  }
  return ok();
}

async function list(ctx: CommandContext, archiveTyped: string): Promise<CommandResult> {
  const abs = resolvePath(ctx.session.cwd, archiveTyped);
  let entries: ArchiveEntry[] | undefined;
  try {
    entries = decodeArchive(await ctx.vfs.readBytes(abs));
  } catch {
    entries = undefined;
  }
  if (!entries) return fail('tar', `${archiveTyped}: Cannot read archive`);
  const lines = listArchive(entries);
  return ok(lines.map((l) => `${l}\n`).join(''));
}

export const tar: Handler = async (ctx, args) => {
  // The mode letters may come without a dash (`czf`), as tar allows.
  const first = args[0];
  const argv = first !== undefined && !first.startsWith('-') && /^[A-Za-z]+$/.test(first) ? [`-${first}`, ...args.slice(1)] : args;
  const parsed = parseArgs(ctx.spec, argv);
  if (!parsed.ok) return parsed.kind === 'unsupported' ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);

  const create_ = parsed.flags.has('-c');
  const list_ = parsed.flags.has('-t');
  if (create_ === list_ || !parsed.flags.has('-f') || !parsed.flags.has('-z')) return usage(ctx.spec);

  const [archive, ...rest] = parsed.operands;
  if (archive === undefined) return usage(ctx.spec);
  if (create_) {
    if (rest.length < 1 || rest.length > MAX_SOURCES) return usage(ctx.spec);
    return create(ctx, archive, rest);
  }
  if (rest.length !== 0) return usage(ctx.spec);
  return list(ctx, archive);
};

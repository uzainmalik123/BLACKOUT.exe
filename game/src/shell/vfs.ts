// The Virtual_FS (PRD SYS-09; design: Virtual file system, G1 to G5, G15, D-100 to D-102).
// Reads and overlay writes (writes under /tmp and /evidence only). Live files are computed on every call and never
// cached across calls; the one exception is the opt-in per-invocation log snapshot (G15).
// The Shell reads the Engine only through its public members and never writes the World.

import type { Engine } from '../engine/engine';
import type { VFile } from '../engine/state';
import { basename, dirname } from './path';
import { compareCodePoints, encodeUtf8, splitLines } from './text';
import type { Area, ArchiveEntry, Overlay, ReadSink, Stat, VirtualFsLike } from './types';

export type { Area, Stat } from './types';

export type FsErrorCode = 'ENOENT' | 'EACCES' | 'EISDIR' | 'ENOTDIR' | 'EEXIST' | 'EPERM' | 'EIO';

const MESSAGES: Record<FsErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EACCES: 'Permission denied',
  EISDIR: 'Is a directory',
  ENOTDIR: 'Not a directory',
  EEXIST: 'File exists',
  EPERM: 'Operation not permitted',
  EIO: 'Input/output error',
};

export class FsError extends Error {
  readonly code: FsErrorCode;
  constructor(code: FsErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = 'FsError';
    this.code = code;
  }
}

export const ACCESS_LOG = '/var/log/nginx/access.log';
export const APP_LOG = '/var/log/juice-shop/app.log';
export const DB_FILE = '/srv/juice-shop/data/juiceshop.sqlite';
export const UPLOADS = '/srv/juice-shop/uploads';
export const TMP = '/tmp';
export const EVIDENCE = '/evidence';

/** Static directories and their static children. Live children are added by `list`. */
const SKELETON: Readonly<Record<string, readonly string[]>> = {
  '/': ['evidence', 'srv', 'tmp', 'var'],
  '/var': ['log'],
  '/var/log': ['juice-shop', 'nginx'],
  '/var/log/nginx': ['access.log'],
  '/var/log/juice-shop': ['app.log'],
  '/srv': ['juice-shop'],
  '/srv/juice-shop': ['data', 'uploads'],
  '/srv/juice-shop/data': ['juiceshop.sqlite'],
  [UPLOADS]: [],
  [TMP]: [],
  [EVIDENCE]: [],
};

const EVIDENCE_SUFFIX = '.tgz';

function isUnder(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(`${root}/`);
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface UploadsIndex {
  files: Map<string, VFile>; // key: path relative to uploads/
  dirs: Set<string>; // relative directory paths, '' is uploads/ itself
}

export class VirtualFs implements VirtualFsLike {
  private snapshot: { access?: string; app?: string } | undefined;

  constructor(
    private readonly engine: Engine,
    private readonly overlay: Overlay,
  ) {}

  // ---- per-invocation log snapshot (G15) ----

  /**
   * Starts a snapshot: until `endInvocation`, each log's text is rendered at most once, so a
   * command that reads a log several times pays for one render. Without a snapshot every read
   * renders fresh. The snapshot is never kept across commands.
   */
  beginInvocation(): void {
    this.snapshot = {};
  }

  endInvocation(): void {
    this.snapshot = undefined;
  }

  private accessText(): string {
    const s = this.snapshot;
    if (!s) return this.engine.accessLog();
    return (s.access ??= this.engine.accessLog());
  }

  private appText(): string {
    const s = this.snapshot;
    if (!s) return this.engine.appLog();
    return (s.app ??= this.engine.appLog());
  }

  // ---- classification ----

  areaOf(abs: string): Area {
    if (abs === ACCESS_LOG) return 'log-access';
    if (abs === APP_LOG) return 'log-app';
    if (abs === DB_FILE) return 'db';
    if (isUnder(abs, UPLOADS)) return 'uploads';
    if (isUnder(abs, TMP)) return 'tmp';
    if (isUnder(abs, EVIDENCE)) return 'evidence';
    return 'system';
  }

  /** Area rule: under /tmp or /evidence, and not a file the Engine records as evidence (D-101). */
  canWrite(abs: string): boolean {
    const area = this.areaOf(abs);
    if (area === 'tmp') return true;
    if (area === 'evidence') return this.engineEvidenceName(abs) === undefined;
    return false;
  }

  // ---- names ----

  stat(abs: string): Stat | undefined {
    const kind = this.kindOf(abs);
    if (!kind) return undefined;
    return { kind, area: this.areaOf(abs), readonly: !this.canWrite(abs) };
  }

  list(abs: string): string[] | undefined {
    if (this.kindOf(abs) !== 'dir') return undefined;
    const names = new Set<string>(SKELETON[abs] ?? []);
    if (abs === UPLOADS || abs.startsWith(`${UPLOADS}/`)) {
      const rel = abs === UPLOADS ? '' : abs.slice(UPLOADS.length + 1);
      const idx = this.uploadsIndex();
      const prefix = rel === '' ? '' : `${rel}/`;
      for (const p of idx.files.keys()) this.addChild(names, p, prefix);
      for (const d of idx.dirs) this.addChild(names, d, prefix);
    } else if (abs === EVIDENCE) {
      for (const n of this.evidenceNames()) names.add(n);
    }
    if (this.areaOf(abs) === 'tmp' || this.areaOf(abs) === 'evidence') {
      for (const key of this.overlay.keys()) {
        if (dirname(key) === abs) names.add(basename(key));
      }
    }
    names.delete('');
    return [...names].sort(compareCodePoints);
  }

  private addChild(names: Set<string>, relPath: string, prefix: string): void {
    if (!relPath.startsWith(prefix) || relPath === prefix) return;
    const first = relPath.slice(prefix.length).split('/')[0];
    if (first) names.add(first);
  }

  private kindOf(abs: string): 'dir' | 'file' | undefined {
    if (abs in SKELETON) return 'dir';
    if (abs === ACCESS_LOG || abs === APP_LOG || abs === DB_FILE) return 'file';
    if (isUnder(abs, UPLOADS)) {
      const rel = abs.slice(UPLOADS.length + 1);
      const idx = this.uploadsIndex();
      if (idx.files.has(rel)) return 'file';
      if (idx.dirs.has(rel)) return 'dir';
      return undefined;
    }
    if (isUnder(abs, EVIDENCE) || isUnder(abs, TMP)) {
      const node = this.overlay.get(abs);
      if (node) return node.kind === 'dir' ? 'dir' : 'file';
      if (this.engineEvidenceName(abs) !== undefined) return 'file';
    }
    return undefined;
  }

  // ---- uploads (G1, D-100) ----

  private uploadsIndex(): UploadsIndex {
    const files = new Map<string, VFile>();
    const dirs = new Set<string>();
    for (const f of this.engine.files()) {
      files.set(f.path, f);
      const segs = f.path.split('/');
      for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/'));
    }
    return { files, dirs };
  }

  private uploadFile(abs: string): VFile | undefined {
    if (!abs.startsWith(`${UPLOADS}/`)) return undefined;
    return this.uploadsIndex().files.get(abs.slice(UPLOADS.length + 1));
  }

  /**
   * The digest the Engine recorded for an uploaded file whose content is not stored
   * (`contentBase64` absent), for `sha256sum` (D-100). Undefined when the file has content
   * or is not an uploaded file.
   */
  recordedSha256(abs: string): string | undefined {
    const f = this.uploadFile(abs);
    return f && f.contentBase64 === undefined ? f.sha256 : undefined;
  }

  // ---- evidence (G3, D-101) ----

  private evidenceNames(): string[] {
    const out: string[] = [];
    for (const e of this.engine.evidence()) {
      // A name with '/' cannot be a direct child of /evidence (G14); it is not listed.
      if (e.name !== '' && !e.name.includes('/')) out.push(`${e.name}${EVIDENCE_SUFFIX}`);
    }
    return out;
  }

  /** The Engine evidence entry's name for `/evidence/<name>.tgz`, if one exists. */
  private engineEvidenceName(abs: string): string | undefined {
    if (dirname(abs) !== EVIDENCE) return undefined;
    const base = basename(abs);
    if (!base.endsWith(EVIDENCE_SUFFIX)) return undefined;
    const name = base.slice(0, -EVIDENCE_SUFFIX.length);
    return this.engine.evidence().some((e) => e.name === name) ? name : undefined;
  }

  /** Content for Engine evidence the Shell did not archive: the log prefixes the snapshot held. */
  private synthesizeEvidence(name: string): Uint8Array {
    const e = this.engine.evidence().find((x) => x.name === name);
    if (!e) throw new FsError('ENOENT');
    const access = splitLines(this.accessText()).slice(0, e.accessLines);
    const app = splitLines(this.appText()).slice(0, e.appLines);
    const text = [...access, ...app].map((l) => `${l}\n`).join('');
    return encodeUtf8(text);
  }

  // ---- content ----

  async size(abs: string): Promise<number> {
    const st = this.stat(abs);
    if (!st) throw new FsError('ENOENT');
    if (st.kind === 'dir') return 0;
    const up = this.uploadFile(abs);
    if (up && up.contentBase64 === undefined) return up.size;
    return (await this.readBytes(abs)).length;
  }

  async readBytes(abs: string, sink?: ReadSink): Promise<Uint8Array> {
    const st = this.stat(abs);
    if (!st) throw new FsError('ENOENT');
    if (st.kind === 'dir') throw new FsError('EISDIR');

    if (abs === ACCESS_LOG) {
      sink?.log();
      return encodeUtf8(this.accessText());
    }
    if (abs === APP_LOG) {
      sink?.log();
      return encodeUtf8(this.appText());
    }
    if (abs === DB_FILE) {
      // Raw reads of the file are not SQL: no DEF-02 (D-102).
      try {
        return (await this.engine.db()).db.export();
      } catch {
        throw new FsError('EIO');
      }
    }
    const up = this.uploadFile(abs);
    if (up) {
      sink?.uploads(abs);
      if (up.contentBase64 === undefined) throw new FsError('EIO');
      try {
        return decodeBase64(up.contentBase64);
      } catch {
        throw new FsError('EIO');
      }
    }
    const node = this.overlay.get(abs);
    if (node && node.kind !== 'dir') return node.bytes;
    const name = this.engineEvidenceName(abs);
    if (name !== undefined) return this.synthesizeEvidence(name);
    throw new FsError('ENOENT');
  }

  // ---- writes (task 14.1; D-90, D-101, D-102) ----

  /** Refuses a path outside the Writable_Area (EACCES) and an Engine evidence file (EPERM). */
  private assertWritable(abs: string): void {
    if (this.canWrite(abs)) return;
    if (this.engineEvidenceName(abs) !== undefined) throw new FsError('EPERM');
    throw new FsError('EACCES');
  }

  /** The parent must exist and be a directory; ENOENT when missing, ENOTDIR when a file. */
  private assertParentDir(abs: string): void {
    const parent = this.stat(dirname(abs));
    if (!parent) throw new FsError('ENOENT');
    if (parent.kind !== 'dir') throw new FsError('ENOTDIR');
  }

  /** Common checks for creating or replacing a file node at `abs`. */
  private prepareFileTarget(abs: string): void {
    this.assertWritable(abs);
    const existing = this.stat(abs);
    if (existing?.kind === 'dir') throw new FsError('EISDIR');
    this.assertParentDir(abs);
  }

  writeFile(abs: string, bytes: Uint8Array): void {
    this.prepareFileTarget(abs);
    this.overlay.set(abs, { kind: 'file', bytes: bytes.slice() });
  }

  mkdir(abs: string, opts?: { parents?: boolean }): void {
    this.assertWritable(abs);
    const existing = this.stat(abs);
    if (existing) {
      if (opts?.parents && existing.kind === 'dir') return;
      throw new FsError('EEXIST');
    }
    if (opts?.parents) {
      const missing: string[] = [];
      let cur = abs;
      while (!this.stat(cur)) {
        missing.push(cur);
        cur = dirname(cur);
      }
      if (this.stat(cur)?.kind !== 'dir') throw new FsError('ENOTDIR');
      for (const p of missing.reverse()) this.overlay.set(p, { kind: 'dir' });
      return;
    }
    this.assertParentDir(abs);
    this.overlay.set(abs, { kind: 'dir' });
  }

  async copy(srcAbs: string, dstAbs: string, sink?: ReadSink): Promise<void> {
    const src = this.stat(srcAbs);
    if (!src) throw new FsError('ENOENT');
    if (src.kind === 'dir') throw new FsError('EISDIR');
    // The destination is checked first, so a refused copy never counts as a read.
    this.prepareFileTarget(dstAbs);
    const bytes = await this.readBytes(srcAbs, sink);
    const node = this.overlay.get(srcAbs);
    if (node?.kind === 'archive') {
      this.overlay.set(dstAbs, { kind: 'archive', entries: node.entries.map((e) => ({ ...e })), bytes: bytes.slice() });
    } else {
      this.overlay.set(dstAbs, { kind: 'file', bytes: bytes.slice() });
    }
  }

  remove(abs: string, opts?: { recursive?: boolean }): void {
    this.assertWritable(abs);
    const st = this.stat(abs);
    if (!st) throw new FsError('ENOENT');
    // /tmp and /evidence themselves are never removed.
    if (abs === TMP || abs === EVIDENCE) throw new FsError('EACCES');
    if (st.kind === 'dir') {
      if (!opts?.recursive) throw new FsError('EISDIR');
      const prefix = `${abs}/`;
      for (const key of [...this.overlay.keys()]) {
        if (key === abs || key.startsWith(prefix)) this.overlay.delete(key);
      }
      return;
    }
    this.overlay.delete(abs);
  }

  putArchive(abs: string, entries: ArchiveEntry[], bytes?: Uint8Array): void {
    this.prepareFileTarget(abs);
    this.overlay.set(abs, {
      kind: 'archive',
      entries: entries.map((e) => ({ ...e, bytes: e.bytes.slice() })),
      bytes: bytes ? bytes.slice() : new Uint8Array(0),
    });
  }
}

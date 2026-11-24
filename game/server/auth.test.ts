// The auth mode (SYS-18, KIRO-09, D-200, D-201): key, CLI login, or none; probed once at start and then on a timer
// for `/healthz`. No Kiro: `whoami` is a node one-liner.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeAuth, detectAuth, parseWhoAmI, watchAuth, type AuthMode } from './auth';

const whoamiPrinting = (json: string, exitCode = 0) => ({ command: process.execPath, args: ['-e', `console.log(${JSON.stringify(json)}); process.exit(${exitCode})`] });

describe('detectAuth', () => {
  it('a KIRO_API_KEY wins without running anything', async () => {
    const a = await detectAuth({ env: { KIRO_API_KEY: 'x' }, kiroCli: '/definitely/not/here' });
    expect(a).toEqual({ mode: 'key' });
    expect(describeAuth(a)).toContain('KIRO_API_KEY set');
  });

  it('the CLI login is reported with who is signed in (2.37.1 and 3.5.0 shapes)', async () => {
    const old = await detectAuth({ env: {}, kiroCli: 'kiro-cli', whoami: whoamiPrinting('{"accountType":"SocialGoogle","email":"someone@example.org"}') });
    expect(old).toEqual({ mode: 'cli-login', who: 'someone@example.org' });
    const nested = await detectAuth({ env: {}, kiroCli: 'kiro-cli', whoami: whoamiPrinting('{"account":{"accountType":"BuilderId"}}') });
    expect(nested).toEqual({ mode: 'cli-login', who: 'BuilderId' });
    expect(describeAuth(old)).toContain('kiro-cli login on this machine (someone@example.org)');
  });

  it('logged out, a missing binary and garbage all mean offline, each with its reason', async () => {
    const out = await detectAuth({ env: {}, kiroCli: 'kiro-cli', whoami: whoamiPrinting('{"account":null}', 1) }); // kiro-cli 3.5.0 logged out
    expect(out).toEqual({ mode: 'none', why: 'kiro-cli is not logged in' });
    expect(describeAuth(out)).toContain('every run plays offline');
    const missing = await detectAuth({ env: {}, kiroCli: '/definitely/not/here/kiro-cli' });
    expect(missing).toMatchObject({ mode: 'none', why: expect.stringContaining('not found on PATH') });
    const garbage = await detectAuth({ env: {}, kiroCli: 'kiro-cli', whoami: whoamiPrinting('not json', 2) });
    expect(garbage).toMatchObject({ mode: 'none', why: expect.stringContaining('whoami failed') });
  });

  it('parseWhoAmI', () => {
    expect(parseWhoAmI('')).toBeUndefined();
    expect(parseWhoAmI('[]')).toEqual({ loggedOut: true });
    expect(parseWhoAmI('{"account":null}')).toEqual({ loggedOut: true });
    expect(parseWhoAmI('{"email":"a@b"}')).toEqual({ who: 'a@b', loggedOut: false });
  });
});

describe('watchAuth (D-201: the cached probe behind /healthz)', () => {
  it('a key is known at once and never re-probed', async () => {
    const results: AuthMode[] = [];
    const w = watchAuth({ env: { KIRO_API_KEY: 'x' }, kiroCli: '/definitely/not/here', intervalMs: 5, onResult: (a) => results.push(a) });
    expect(await w.ready).toEqual({ mode: 'key' });
    expect(w.current()).toEqual({ mode: 'key' });
    await new Promise((r) => setTimeout(r, 40));
    expect(results).toHaveLength(1);
    w.stop();
  });

  it('a login that lapses between probes shows in current(), with the change reported once', async () => {
    // The fake whoami prints whatever the file holds, so the answer can change under the watcher (a lapsed token).
    const dir = mkdtempSync(join(tmpdir(), 'kiro-auth-'));
    const file = join(dir, 'whoami.json');
    writeFileSync(file, '{"account":{"email":"someone@example.org"}}');
    const whoami = { command: process.execPath, args: ['-e', 'const t=require("fs").readFileSync(process.argv[1],"utf8");console.log(t);process.exit(t.includes("null")?1:0)', file] };
    const changes: Array<[AuthMode, AuthMode | undefined]> = [];
    const w = watchAuth({ env: {}, kiroCli: 'kiro-cli', whoami, intervalMs: 30, onResult: (next, prev) => { if (prev?.mode !== next.mode) changes.push([next, prev]); } });
    try {
      expect(w.current()).toBeUndefined(); // nothing is known before the first probe finishes
      expect(await w.ready).toEqual({ mode: 'cli-login', who: 'someone@example.org' });
      writeFileSync(file, '{"account":null}');
      const lapsed = await new Promise<AuthMode | undefined>((resolve) => {
        const started = Date.now();
        const tick = () => (w.current()?.mode === 'none' || Date.now() - started > 5000 ? resolve(w.current()) : setTimeout(tick, 10));
        tick();
      });
      expect(lapsed).toEqual({ mode: 'none', why: 'kiro-cli is not logged in' });
      expect(changes.map(([n, p]) => `${p?.mode ?? '-'}→${n.mode}`)).toEqual(['-→cli-login', 'cli-login→none']);
    } finally {
      w.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

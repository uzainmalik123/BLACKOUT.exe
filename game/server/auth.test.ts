// The start-up auth line (SYS-18, KIRO-09, D-200): key, CLI login, or none. No Kiro: `whoami` is a node one-liner.
import { describe, expect, it } from 'vitest';
import { describeAuth, detectAuth, parseWhoAmI } from './auth';

const whoamiPrinting = (json: string, exitCode = 0) => ({ command: process.execPath, args: ['-e', `console.log(${JSON.stringify(json)}); process.exit(${exitCode})`] });

describe('detectAuth', () => {
  it('a KIRO_API_KEY wins without running anything', async () => {
    const a = await detectAuth({ env: { KIRO_API_KEY: 'x' }, kiroCli: '/definitely/not/here' });
    expect(a).toEqual({ mode: 'key' });
    expect(describeAuth(a)).toContain('KIRO_API_KEY set');
  });

  it('the CLI login is reported with who is signed in (2.37.1 and 3.5.0 shapes)', async () => {
    const old = await detectAuth({ env: {}, kiroCli: 'kiro-cli', whoami: whoamiPrinting('{"accountType":"SocialGoogle","email":"someone@example.org"}') });
    expect(old).toEqual({ mode: 'login', who: 'someone@example.org' });
    const nested = await detectAuth({ env: {}, kiroCli: 'kiro-cli', whoami: whoamiPrinting('{"account":{"accountType":"BuilderId"}}') });
    expect(nested).toEqual({ mode: 'login', who: 'BuilderId' });
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

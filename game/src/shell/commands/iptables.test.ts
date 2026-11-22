import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const USAGE = 'iptables: usage: iptables -A INPUT -s <ip> -j DROP | -D INPUT -s <ip> -j DROP | -L';
const HEADER = 'Chain INPUT (policy ACCEPT)';
const rule = (ip: string): string => `DROP       all  --  ${ip}  anywhere`;

describe('iptables -A (R9.1, R9.5, R16.2)', () => {
  it('calls act once with op add, blocks the ip and prints nothing', async () => {
    const { shell, engine, world } = makeFixture({ baseline: false });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run('iptables -A INPUT -s 203.0.113.7 -j DROP');
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ type: 'DEF-06', op: 'add', ip: '203.0.113.7' });
    expect(world.firewall.blocked).toEqual(['203.0.113.7']);
  }, 30_000);
});

describe('iptables -D (R9.2, R9.5, R16.2)', () => {
  it('calls act once with op delete, unblocks the ip and prints nothing', async () => {
    const { shell, engine, world } = makeFixture({ baseline: false });
    await shell.run('iptables -A INPUT -s 203.0.113.7 -j DROP');
    await shell.run('iptables -A INPUT -s 198.51.100.2 -j DROP');
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run('iptables -D INPUT -s 203.0.113.7 -j DROP');
    expect(r).toEqual({ output: '', exitCode: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ type: 'DEF-06', op: 'delete', ip: '203.0.113.7' });
    expect(world.firewall.blocked).toEqual(['198.51.100.2']);
  }, 30_000);
});

describe('iptables -L (R9.3, R16.2)', () => {
  it('prints only the header for an empty list and calls no action', async () => {
    const { shell, engine } = makeFixture({ baseline: false });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run('iptables -L');
    expect(r).toEqual({ output: HEADER, exitCode: 0 });
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);

  it('lists blocked ips in blocking order with no column-title line and calls no action', async () => {
    const { shell, engine, world } = makeFixture({ baseline: false });
    await shell.run('iptables -A INPUT -s 10.0.0.9 -j DROP');
    await shell.run('iptables -A INPUT -s 1.2.3.4 -j DROP');
    const spy = vi.spyOn(engine, 'act');
    const before = structuredClone(world.firewall);
    const r = await shell.run('iptables -L');
    expect(r).toEqual({ output: [HEADER, rule('10.0.0.9'), rule('1.2.3.4')].join('\n'), exitCode: 0 });
    expect(r.output).not.toContain('target');
    expect(spy).not.toHaveBeenCalled();
    expect(world.firewall).toEqual(before);
  }, 30_000);
});

describe('iptables when the Engine refuses (R9.4)', () => {
  it('prints the message only and leaves the listing unchanged (real refusal: already blocked)', async () => {
    const { shell } = makeFixture({ baseline: false });
    await shell.run('iptables -A INPUT -s 203.0.113.7 -j DROP');
    const listing = (await shell.run('iptables -L')).output;
    const r = await shell.run('iptables -A INPUT -s 203.0.113.7 -j DROP');
    expect(r).toEqual({ output: '203.0.113.7 is already blocked', exitCode: 1 });
    expect((await shell.run('iptables -L')).output).toBe(listing);
  }, 30_000);

  it('prints the message only for a delete of an address that is not blocked', async () => {
    const { shell } = makeFixture({ baseline: false });
    const listing = (await shell.run('iptables -L')).output;
    const r = await shell.run('iptables -D INPUT -s 203.0.113.7 -j DROP');
    expect(r).toEqual({ output: '203.0.113.7 is not blocked', exitCode: 1 });
    expect((await shell.run('iptables -L')).output).toBe(listing);
  }, 30_000);

  it('prints exactly the message of a spy that answers ok:false and changes nothing', async () => {
    const { shell, engine, world } = makeFixture({ baseline: false });
    vi.spyOn(engine, 'act').mockReturnValue({ ok: false, message: 'The run has ended' });
    const r = await shell.run('iptables -A INPUT -s 203.0.113.7 -j DROP');
    expect(r).toEqual({ output: 'The run has ended', exitCode: 1 });
    expect(world.firewall.blocked).toEqual([]);
    expect((await shell.run('iptables -L')).output).toBe(HEADER);
  }, 30_000);
});

describe('iptables usage errors (R9.6)', () => {
  const bad: [string, string][] = [
    ['bad octet value', 'iptables -A INPUT -s 256.1.1.1 -j DROP'],
    ['too few octets', 'iptables -A INPUT -s 1.2.3 -j DROP'],
    ['too many octets', 'iptables -A INPUT -s 1.2.3.4.5 -j DROP'],
    ['leading zero', 'iptables -A INPUT -s 01.2.3.4 -j DROP'],
    ['not an address', 'iptables -A INPUT -s localhost -j DROP'],
    ['a cidr suffix', 'iptables -D INPUT -s 1.2.3.4/32 -j DROP'],
    ['an extra argument after -L', 'iptables -L extra'],
    ['an extra argument after -A', 'iptables -A INPUT -s 1.2.3.4 -j DROP now'],
    ['a missing ip', 'iptables -A INPUT -s -j DROP'],
    ['the wrong order', 'iptables -A INPUT -j DROP -s 1.2.3.4'],
    ['the wrong order of chain and flag', 'iptables INPUT -A -s 1.2.3.4 -j DROP'],
    ['another chain', 'iptables -A OUTPUT -s 1.2.3.4 -j DROP'],
    ['another target', 'iptables -A INPUT -s 1.2.3.4 -j ACCEPT'],
    ['no arguments', 'iptables'],
  ];
  it.each(bad)('rejects %s with the usage line and no action', async (_name, line) => {
    const { shell, engine, world } = makeFixture({ baseline: false });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run(line);
    expect(r).toEqual({ output: USAGE, exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
    expect(world.firewall.blocked).toEqual([]);
  }, 30_000);

  it('rejects an unsupported flag naming it, with the usage line and no action', async () => {
    const { shell, engine } = makeFixture({ baseline: false });
    const spy = vi.spyOn(engine, 'act');
    const r = await shell.run('iptables -F');
    expect(r).toEqual({ output: `iptables: unsupported flag '-F'\n${USAGE}`, exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);
});

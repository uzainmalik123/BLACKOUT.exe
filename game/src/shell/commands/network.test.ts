import { describe, expect, it, vi } from 'vitest';
import { eventsOfKind } from '../../engine/log';
import { makeFixture } from '../test-fixtures/fixture';

const IP = '198.51.100.23';

function setup() {
  const f = makeFixture({ baseline: false });
  const spy = vi.spyOn(f.engine, 'act');
  return { ...f, spy };
}

const calls = (spy: ReturnType<typeof setup>['spy']) => spy.mock.calls.map((c) => c[0]);

describe('whois (R6.3, R16.2)', () => {
  it('prints owner text and an ASN and sends exactly one DEF-04 passive, with no tip-off logged', async () => {
    const { shell, spy, actsOfType, world } = setup();
    const r = await shell.run(`whois ${IP}`);
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('org-name:');
    expect(r.output).toMatch(/origin:\s+AS\d+/);
    expect(calls(spy)).toEqual([{ type: 'DEF-04', ip: IP, mode: 'passive' }]);
    expect(actsOfType('DEF-04')).toEqual([{ type: 'DEF-04', ip: IP, mode: 'passive' }]);
    expect(eventsOfKind(world, 'tip-off')).toEqual([]);
  }, 30_000);

  it('203.0.113.x names the fictional provider', async () => {
    const { shell } = setup();
    expect((await shell.run('whois 203.0.113.9')).output).toContain('Nightfall Hosting Ltd');
  }, 30_000);
});

describe('active lookups (R6.4 to R6.6, R16.2, D-91)', () => {
  const rows: [string, string][] = [
    [`ping ${IP}`, `PING ${IP}`],
    [`nmap ${IP}`, `Nmap scan report for ${IP}`],
    [`curl ${IP}`, `Welcome to ${IP}`],
    [`curl -I http://${IP}:8080/a/b`, 'HTTP/1.1 200 OK'],
    [`curl -s https://${IP}/`, `Welcome to ${IP}`],
  ];
  it.each(rows)('%s sends one DEF-04 active', async (cmd, expected) => {
    const { shell, spy, actsOfType } = setup();
    const r = await shell.run(cmd);
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain(expected);
    expect(calls(spy)).toEqual([{ type: 'DEF-04', ip: IP, mode: 'active' }]);
    expect(actsOfType('DEF-04')).toEqual([{ type: 'DEF-04', ip: IP, mode: 'active' }]);
  }, 30_000);

  const hosts: [string, string][] = [
    ['ping localhost', 'PING localhost'],
    ['ping example.org', 'PING example.org'],
    ['nmap localhost', 'Nmap scan report for localhost'],
    ['nmap example.org', 'Nmap scan report for example.org'],
    ['curl http://localhost:3000/', 'Welcome to localhost'],
    ['curl example.org', 'Welcome to example.org'],
  ];
  it.each(hosts)('%s prints output and sends no action', async (cmd, expected) => {
    const { shell, spy, actions } = setup();
    const r = await shell.run(cmd);
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain(expected);
    expect(spy).not.toHaveBeenCalled();
    expect(actions()).toEqual([]);
  }, 30_000);
});

describe('ping (R6.4)', () => {
  it('defaults to four replies and -c 2 prints two', async () => {
    const { shell } = setup();
    const four = (await shell.run('ping localhost')).output.match(/icmp_seq=/g);
    expect(four).toHaveLength(4);
    const r = await shell.run(`ping -c 2 ${IP}`);
    expect(r.output.match(/icmp_seq=/g)).toHaveLength(2);
    expect(r.output).toContain('2 packets transmitted, 2 received');
  }, 30_000);

  it.each(['0', '21', 'x', '-1', '1.5'])('-c %s is a usage error and sends no action', async (n) => {
    const { shell, spy } = setup();
    const r = await shell.run(`ping -c ${n} ${IP}`);
    expect(r).toEqual({ output: 'ping: usage: ping [-c <count>] <host>', exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);

  it('-c 20 is accepted', async () => {
    const { shell } = setup();
    expect((await shell.run('ping -c 20 localhost')).output.match(/icmp_seq=/g)).toHaveLength(20);
  }, 30_000);
});

describe('nmap (R6.5)', () => {
  it('-p 22,80-82 lists only those ports and the table has no VERSION column', async () => {
    const { shell } = setup();
    const r = await shell.run(`nmap -p 22,80-82 ${IP}`);
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('PORT      STATE  SERVICE');
    expect(r.output).not.toContain('VERSION');
    const ports = [...r.output.matchAll(/^(\d+)\/tcp/gm)].map((m) => Number(m[1]));
    for (const p of ports) expect([22, 80, 81, 82]).toContain(p);
  }, 30_000);

  it('-sV adds a VERSION column', async () => {
    const { shell } = setup();
    const r = await shell.run(`nmap -sV -p 22 ${IP}`);
    expect(r.output).toContain('VERSION');
  }, 30_000);

  it.each(['0', '65536', '80-70', 'x', '22,', '1-200', '-5'])('-p %s is a usage error and sends no action', async (p) => {
    const { shell, spy } = setup();
    const r = await shell.run(`nmap -p ${p} ${IP}`);
    expect(r).toEqual({ output: 'nmap: usage: nmap [-p <ports>] [-sV] <host>', exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);
});

describe('curl (R6.6)', () => {
  it('-I prints headers only; the default prints a body', async () => {
    const { shell } = setup();
    const h = await shell.run(`curl -I ${IP}`);
    expect(h.output).toContain('Content-Type:');
    expect(h.output).not.toContain('<html>');
    expect((await shell.run(`curl ${IP}`)).output).toContain('<html>');
  }, 30_000);

  it('-s is accepted', async () => {
    const { shell } = setup();
    expect((await shell.run(`curl -s ${IP}`)).exitCode).toBe(0);
  }, 30_000);

  it('an invalid host is a usage error and sends no action', async () => {
    const { shell, spy } = setup();
    const r = await shell.run('curl http://a_b/');
    expect(r).toEqual({ output: 'curl: usage: curl [-I] [-s] <url>', exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);
});

describe('bad targets and flags (R6.8, R6.9, R16.2)', () => {
  const USAGE: Record<string, string> = {
    whois: 'whois <ip>',
    ping: 'ping [-c <count>] <host>',
    nmap: 'nmap [-p <ports>] [-sV] <host>',
    curl: 'curl [-I] [-s] <url>',
  };
  const bad: [string, string][] = [];
  for (const c of Object.keys(USAGE)) {
    for (const t of ['', '300.1.1.1', '1.2.3', 'a_b', `${IP} ${IP}`, 'localhost extra']) bad.push([c, t]);
  }
  // whois takes an IPv4 only; the tools also take a hostname
  it.each(bad)('%s %j is a usage error and sends no action', async (c, t) => {
    const { shell, spy, actions } = setup();
    const r = await shell.run(`${c} ${t}`.trim());
    expect(r).toEqual({ output: `${c}: usage: ${USAGE[c]}`, exitCode: 1 });
    expect(spy).not.toHaveBeenCalled();
    expect(actions()).toEqual([]);
  }, 30_000);

  it('whois refuses a hostname', async () => {
    const { shell, spy } = setup();
    expect((await shell.run('whois example.org')).exitCode).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);

  it.each(['whois', 'ping', 'nmap', 'curl', 'ss'])('%s rejects an unsupported flag', async (c) => {
    const { shell, spy } = setup();
    const r = await shell.run(`${c} -z ${IP}`);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain(`${c}: unsupported flag '-z'`);
    expect(spy).not.toHaveBeenCalled();
  }, 30_000);
});

describe('ss (R6.7, R6.10)', () => {
  it('shows nginx on port 80 while running, not after systemctl stop nginx, and sends no ss action', async () => {
    const { shell, engine } = setup();
    const before = vi.spyOn(engine, 'act');
    const up = await shell.run('ss -tln');
    expect(up.exitCode).toBe(0);
    expect(up.output).toContain('0.0.0.0:80');
    expect(up.output).toContain('nginx');
    expect(before).not.toHaveBeenCalled();

    expect((await shell.run('systemctl stop nginx')).exitCode).toBe(0);
    before.mockClear();
    const down = await shell.run('ss');
    expect(down.output).not.toContain('nginx');
    expect(down.output).not.toContain('0.0.0.0:80 ');
    expect(down.output).toContain('0.0.0.0:3000');
    expect(before).not.toHaveBeenCalled();
  }, 30_000);

  it('an operand is a usage error', async () => {
    const { shell } = setup();
    expect((await shell.run('ss x')).output).toBe('ss: usage: ss [-t] [-l] [-n]');
  }, 30_000);
});

describe('the Engine refusing DEF-04 (R16.1)', () => {
  it.each([`whois ${IP}`, `ping -c 1 ${IP}`, `nmap ${IP}`, `curl ${IP}`])('%s keeps the output and shows the message', async (cmd) => {
    const { shell, spy } = setup();
    spy.mockImplementation(() => ({ ok: false, message: 'The wire is dead' }));
    const r = await shell.run(cmd);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.output).toContain('The wire is dead');
    expect(r.output).toContain(IP);
    expect(r.output.split('\n').length).toBeGreaterThan(3);
  }, 30_000);
});

import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildRecording,
  diffDatabases,
  diffUploads,
  exfilFromResponses,
  parseAccessJsonl,
  parseAppLog,
  parseCurlCapture,
  parseSqlmapTraffic,
  rewriteIp,
  type FileInfo,
  type RunMeta,
} from './convert';
import type { AccessEvent } from './format';

const START = 1794887709000;

function accessLine(msec: number, target: string, ua = 'curl/8.23.0'): string {
  return JSON.stringify({
    msec: (msec / 1000).toFixed(3), ip: '10.66.0.66', method: 'GET', target, protocol: 'HTTP/1.1',
    status: 200, bytes: 30, referer: '', ua, rt: '0.012',
  });
}

describe('parseAccessJsonl', () => {
  it('parses nginx escape=json lines, keeping quotes and backslashes in the user agent', () => {
    const line = '{"msec":"1794887709.401","ip":"10.66.0.66","method":"POST","target":"/rest/user/login","protocol":"HTTP/1.1","status":200,"bytes":784,"referer":"","ua":"evil \\"agent\\" \\\\x","rt":"0.012"}';
    const [e] = parseAccessJsonl(`${line}\n`, START);
    expect(e).toEqual({
      t: 401, kind: 'access', ip: '10.66.0.66', method: 'POST', target: '/rest/user/login', protocol: 'HTTP/1.1',
      status: 200, bytes: 784, referer: '', userAgent: 'evil "agent" \\x', requestTimeMs: 12,
    });
  });
});

describe('parseAppLog', () => {
  it('keeps window lines, drops scoreboard lines and lines before the run', () => {
    const text = [
      '2026-11-17T03:55:05.133538497Z info: Server listening on port 3000',
      '2026-11-17T03:55:09.409713486Z info: Solved 2-star loginAdminChallenge (Login Admin)',
      '2026-11-17T03:55:09.410943993Z info: Cheat score for tutorial loginAdminChallenge solved in 0min',
      '2026-11-17T03:55:09.500000000Z error: SQLITE_ERROR: near "x": syntax error',
    ].join('\n');
    const start = Date.parse('2026-11-17T03:55:09.000Z');
    expect(parseAppLog(text, start, start + 1000)).toEqual([
      { t: 500, kind: 'app', text: 'error: SQLITE_ERROR: near "x": syntax error' },
    ]);
  });
});

describe('diffDatabases', () => {
  let SQL: SqlJsStatic;
  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  it('finds an updated row and an inserted row, keyed by id', () => {
    const before = new SQL.Database();
    before.run("CREATE TABLE Users (id INTEGER PRIMARY KEY, email TEXT, role TEXT); INSERT INTO Users VALUES (1,'a@x','customer');");
    const after = new SQL.Database(before.export());
    after.run("UPDATE Users SET role='admin' WHERE id=1; INSERT INTO Users VALUES (2,'b@x','admin');");
    expect(diffDatabases(before, after, 50)).toEqual([
      { t: 50, kind: 'db', op: 'update', table: 'Users', key: { id: 1 }, before: { role: 'customer' }, after: { role: 'admin' } },
      { t: 50, kind: 'db', op: 'insert', table: 'Users', key: { id: 2 }, after: { id: 2, email: 'b@x', role: 'admin' } },
    ]);
  });

  it("ignores Juice Shop's scoreboard table (Challenges)", () => {
    const before = new SQL.Database();
    before.run('CREATE TABLE Challenges (id INTEGER PRIMARY KEY, solved INTEGER); INSERT INTO Challenges VALUES (45, 0);');
    const after = new SQL.Database(before.export());
    after.run('UPDATE Challenges SET solved = 1');
    expect(diffDatabases(before, after, 0)).toEqual([]);
  });

  it('keys a table without an id column by rowid, and sees deletes', () => {
    const before = new SQL.Database();
    before.run("CREATE TABLE Notes (body TEXT); INSERT INTO Notes VALUES ('hi');");
    const after = new SQL.Database(before.export());
    after.run('DELETE FROM Notes');
    expect(diffDatabases(before, after, 0)).toEqual([
      { t: 0, kind: 'db', op: 'delete', table: 'Notes', key: { rowid: 1 }, before: { body: 'hi' } },
    ]);
  });
});

describe('diffUploads', () => {
  const file = (size: number, sha: string): FileInfo => ({ size, sha256: sha.repeat(64), bytes: new Uint8Array(size).fill(97) });

  it('embeds small added files, not large ones, and sees changes and removals', () => {
    const before = new Map([['complaints/old.pdf', file(3, 'a')], ['complaints/keep.pdf', file(3, 'b')]]);
    const after = new Map([
      ['complaints/keep.pdf', file(3, 'c')],
      ['complaints/small.pdf', file(3, 'd')],
      ['complaints/big.zip', file(70 * 1024, 'e')],
    ]);
    const events = diffUploads(before, after, 9);
    expect(events).toContainEqual({ t: 9, kind: 'file', op: 'remove', path: 'complaints/old.pdf', size: 3, sha256: 'a'.repeat(64) });
    expect(events).toContainEqual({ t: 9, kind: 'file', op: 'change', path: 'complaints/keep.pdf', size: 3, sha256: 'c'.repeat(64), contentBase64: 'YWFh' });
    expect(events).toContainEqual({ t: 9, kind: 'file', op: 'add', path: 'complaints/small.pdf', size: 3, sha256: 'd'.repeat(64), contentBase64: 'YWFh' });
    const big = events.find((e) => e.path === 'complaints/big.zip');
    expect(big).toMatchObject({ op: 'add', size: 70 * 1024 });
    expect(big).not.toHaveProperty('contentBase64');
  });
});

function trafficEntry(n: number, target: string, body: string): string {
  return [
    `HTTP request [#${n}]:`, `GET ${target} HTTP/1.1`, 'User-Agent: sqlmap', '',
    `HTTP response [#${n}] (200 OK):`, 'Content-Type: application/json', `URI: http://10.66.0.10${target}`, '',
    body, '', '#'.repeat(76), '', '',
  ].join('\n');
}

describe('exfilFromResponses', () => {
  const users = [
    { id: 1, email: 'admin@juice-sh.op', password: '0192023a7bbd73250516f069df18b500' },
    { id: 2, email: 'jim@juice-sh.op', password: 'e541ca7ecf72b8d1286474fc613e5e45' },
  ];
  const access: AccessEvent[] = parseAccessJsonl(
    [accessLine(START + 100, '/s?q=1'), accessLine(START + 200, '/s?q=2'), accessLine(START + 300, '/s?q=3')].join('\n'),
    START,
  );

  it('throws when the traffic log and the access log disagree in count', () => {
    const traffic = trafficEntry(1, '/s?q=1', '{}') + trafficEntry(2, '/s?q=2', '{}');
    expect(() => exfilFromResponses(parseSqlmapTraffic(traffic), access, users)).toThrow('the tool captured 2 responses, access log has 3 requests');
  });

  it('throws when a request does not match its access line', () => {
    const traffic = trafficEntry(1, '/s?q=1', '{}') + trafficEntry(2, '/s?q=X', '{}') + trafficEntry(3, '/s?q=3', '{}');
    expect(() => exfilFromResponses(parseSqlmapTraffic(traffic), access, users)).toThrow('request #2');
  });

  it('reads bodies after CRLF headers, as sqlmap writes real responses', () => {
    const leak = '{"data":[{"id":"qpjvqjim@juice-sh.operetjte541ca7ecf72b8d1286474fc613e5e45qbxxq"}]}';
    const crlf = (n: number, target: string, body: string) =>
      `HTTP request [#${n}]:\r\nGET ${target} HTTP/1.1\r\nHost: x\r\n\r\nHTTP response [#${n}] (200 OK):\r\nVary: Accept-Encoding\r\nURI: http://x${target}\n\r\n${body}\n\n${'#'.repeat(76)}\n\n`;
    const traffic = crlf(1, '/s?q=1', '{}') + crlf(2, '/s?q=2', '{}') + crlf(3, '/s?q=3', leak);
    expect(exfilFromResponses(parseSqlmapTraffic(traffic), access, users)).toEqual([
      { t: 300, kind: 'exfil', table: 'Users', keys: [2], columns: ['email', 'password'] },
    ]);
  });

  it('stamps leaked rows at the response that carried them, once per row and column', () => {
    const leak = '{"data":[{"name":"qkvjqadmin@juice-sh.op0192023a7bbd73250516f069df18b500qbxxq"}]}';
    const traffic = trafficEntry(1, '/s?q=1', '{"data":[]}') + trafficEntry(2, '/s?q=2', leak) + trafficEntry(3, '/s?q=3', leak);
    expect(exfilFromResponses(parseSqlmapTraffic(traffic), access, users)).toEqual([
      { t: 200, kind: 'exfil', table: 'Users', keys: [1], columns: ['email', 'password'] },
    ]);
  });
});

describe('parseCurlCapture', () => {
  it('reads index.tsv lines into targets and bodies', () => {
    const index = '0001\tGET\thttp://10.66.0.10/api/Users\t200\n0002\tPOST\thttp://10.66.0.10/rest/user/login?x=1\t401\n';
    const bodies: Record<string, string> = { '0001': '{"data":[]}', '0002': 'Invalid email or password.' };
    expect(parseCurlCapture(index, (n) => bodies[n]!)).toEqual([
      { n: 1, target: '/api/Users', body: '{"data":[]}' },
      { n: 2, target: '/rest/user/login?x=1', body: 'Invalid email or password.' },
    ]);
  });
});

describe('exfilFromResponses with curl captures', () => {
  const users = [
    { id: 7, email: 'ava.adams@example.com', password: 'a'.repeat(32) },
    { id: 8, email: 'java.adams@example.com', password: 'b'.repeat(32) },
  ];
  const access = parseAccessJsonl(accessLine(START + 50, '/api/Users'), START);

  it('does not count an address that only appears inside a longer one', () => {
    const body = '{"data":[{"id":8,"email":"java.adams@example.com"}]}';
    expect(exfilFromResponses([{ n: 1, target: '/api/Users', body }], access, users)).toEqual([
      { t: 50, kind: 'exfil', table: 'Users', keys: [8], columns: ['email'] },
    ]);
  });

  it('a hash two users share names only the user whose email left too (D-64)', () => {
    const shared = [...users, { id: 9, email: 'ben.baker@example.net', password: 'a'.repeat(32) }];
    const body = `{"email":"ava.adams@example.com","password":"${'a'.repeat(32)}"}`;
    expect(exfilFromResponses([{ n: 1, target: '/api/Users', body }], access, shared)).toEqual([
      { t: 50, kind: 'exfil', table: 'Users', keys: [7], columns: ['email', 'password'] },
    ]);
  });

  it('counts both when both appear', () => {
    const body = '[{"email":"java.adams@example.com"},{"email":"ava.adams@example.com"}]';
    expect(exfilFromResponses([{ n: 1, target: '/api/Users', body }], access, users)).toEqual([
      { t: 50, kind: 'exfil', table: 'Users', keys: [7, 8], columns: ['email'] },
    ]);
  });
});

describe('rewriteIp', () => {
  it('replaces the address inside nested strings', () => {
    expect(rewriteIp({ a: ['from 10.66.0.66:5000'], b: { c: '10.66.0.66' }, n: 3 }, '10.66.0.66', '203.0.113.23')).toEqual({
      a: ['from 203.0.113.23:5000'], b: { c: '203.0.113.23' }, n: 3,
    });
  });
});

describe('buildRecording', () => {
  const meta: RunMeta = {
    move: 'ATK-03', variant: 'a', label: 'loud', tool: 'curl 8.x', image: 'bkimminich/juice-shop:v20.4.0',
    publicIp: '203.0.113.23', attackerIp: '10.66.0.66', startedAtMs: START, endedAtMs: START + 300,
  };

  it('sorts events, rewrites the attacker IP and fills the header', () => {
    const events = [
      { t: 200, kind: 'app' as const, text: 'client 10.66.0.66' },
      ...parseAccessJsonl(accessLine(START + 100, '/'), START),
    ];
    const rec = buildRecording(meta, events);
    expect(rec).toMatchObject({ format: 1, move: 'ATK-03', attackerIp: '203.0.113.23', recordedAt: new Date(START).toISOString(), durationMs: 300 });
    expect(rec.events.map((e) => e.t)).toEqual([100, 200]);
    expect(JSON.stringify(rec)).not.toContain('10.66.');
  });

  it("rewrites nginx's rig address, the shop's view of every client, to the proxy address", () => {
    const rec = buildRecording(meta, [{ t: 10, kind: 'app', text: 'Error: Blocked illegal activity by ::ffff:10.66.0.10' }]);
    expect(rec.events[0]).toMatchObject({ text: 'Error: Blocked illegal activity by ::ffff:10.0.0.10' });
  });

  it('stretches durationMs to cover events logged just after the tool exited', () => {
    expect(buildRecording(meta, [{ t: 900, kind: 'app', text: 'late' }]).durationMs).toBe(900);
  });

  it('throws with the validator errors for a public IP outside TEST-NET-3', () => {
    expect(() => buildRecording({ ...meta, publicIp: '8.8.8.8' }, [])).toThrow('attackerIp');
  });
});

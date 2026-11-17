import { describe, expect, it } from 'vitest';
import { isTestNet3, validateRecording, type Recording } from './format';

function valid(): Recording {
  return {
    format: 1,
    move: 'ATK-03',
    variant: 'a',
    label: 'loud: one injected login, curl user agent',
    recordedAt: '2026-11-17T03:55:09.177Z',
    durationMs: 300,
    attackerIp: '203.0.113.23',
    juiceShop: 'bkimminich/juice-shop:v20.4.0',
    tool: 'curl 8.x',
    events: [
      {
        t: 10, kind: 'access', ip: '203.0.113.23', method: 'POST', target: '/rest/user/login',
        protocol: 'HTTP/1.1', status: 200, bytes: 784, referer: '', userAgent: 'curl/8.23.0', requestTimeMs: 12,
      },
      { t: 20, kind: 'app', text: 'info: something' },
      { t: 20, kind: 'db', op: 'update', table: 'Users', key: { id: 1 }, before: { role: 'customer' }, after: { role: 'admin' } },
      { t: 20, kind: 'file', op: 'add', path: 'complaints/x.pdf', size: 3, sha256: 'a'.repeat(64), contentBase64: 'YWJj' },
      { t: 20, kind: 'exfil', table: 'Users', keys: [1], columns: ['email', 'password'] },
    ],
  };
}

describe('validateRecording', () => {
  it('accepts a valid recording', () => {
    expect(validateRecording(valid())).toEqual([]);
  });

  it('rejects events out of order, naming the event', () => {
    const r = valid();
    r.events[1]!.t = 5;
    expect(validateRecording(r)).toContainEqual(expect.stringContaining('events[1].t'));
  });

  it('rejects an attacker IP outside 203.0.113.0/24', () => {
    expect(validateRecording({ ...valid(), attackerIp: '10.66.0.66' })).toContainEqual(expect.stringContaining('attackerIp'));
  });

  it('rejects an access ip outside 203.0.113.0/24', () => {
    const r = valid();
    r.events[0] = { ...r.events[0], ip: '10.66.0.66' } as Recording['events'][number];
    expect(validateRecording(r)).toContainEqual(expect.stringContaining('events[0].ip'));
  });

  it('rejects t beyond durationMs', () => {
    expect(validateRecording({ ...valid(), durationMs: 15 })).toContainEqual(expect.stringContaining('events[1].t'));
  });

  it('rejects an unknown event kind', () => {
    const r = valid() as unknown as { events: { kind: string }[] };
    r.events[1]!.kind = 'telepathy';
    expect(validateRecording(r)).toContainEqual(expect.stringContaining('events[1].kind'));
    r.events[1]!.kind = 'constructor';
    expect(validateRecording(r)).toContainEqual(expect.stringContaining('events[1].kind'));
  });

  it('rejects NaN times and durations, which typeof calls numbers', () => {
    expect(validateRecording({ ...valid(), durationMs: NaN })).toContainEqual(expect.stringContaining('durationMs'));
    const r = valid();
    r.events[0]!.t = NaN;
    expect(validateRecording(r)).toContainEqual(expect.stringContaining('events[0].t'));
  });

  it.each([
    [0, 'status', 'x'],
    [0, 'bytes', NaN],
    [0, 'requestTimeMs', -1],
    [0, 'userAgent', undefined],
    [1, 'text', 3],
    [2, 'op', 'upsert'],
    [2, 'table', ''],
    [2, 'key', {}],
    [2, 'after', undefined],
    [2, 'before', { role: { nested: true } }],
    [3, 'size', 1.5],
    [3, 'sha256', 'abc'],
    [3, 'contentBase64', 7],
    [4, 'keys', []],
    [4, 'keys', [NaN]],
    [4, 'columns', ['']],
  ])('rejects events[%i].%s = %j', (i, field, value) => {
    const r = valid();
    r.events[i] = { ...r.events[i], [field]: value } as Recording['events'][number];
    expect(validateRecording(r)).toContainEqual(expect.stringContaining(`events[${i}].${field}`));
  });

  it('wants before on deletes and after on inserts', () => {
    const r = valid();
    r.events[2] = { t: 20, kind: 'db', op: 'delete', table: 'Users', key: { id: 1 } };
    expect(validateRecording(r)).toContainEqual(expect.stringContaining('events[2].before'));
    r.events[2] = { t: 20, kind: 'db', op: 'insert', table: 'Users', key: { id: 1 } };
    expect(validateRecording(r)).toContainEqual(expect.stringContaining('events[2].after'));
  });

  it('rejects a non-object and a wrong format version', () => {
    expect(validateRecording(null)).not.toEqual([]);
    expect(validateRecording({ ...valid(), format: 2 })).toContainEqual(expect.stringContaining('format'));
  });
});

describe('isTestNet3', () => {
  it('accepts only 203.0.113.0/24', () => {
    expect(isTestNet3('203.0.113.0')).toBe(true);
    expect(isTestNet3('203.0.113.255')).toBe(true);
    expect(isTestNet3('203.0.114.1')).toBe(false);
    expect(isTestNet3('203.0.113.256')).toBe(false);
    expect(isTestNet3('10.66.0.66')).toBe(false);
  });
});

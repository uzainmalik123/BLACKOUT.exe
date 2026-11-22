import { describe, expect, it } from 'vitest';
import { curlLines, isHostname, isIPv4, nmapLines, pingLines, ssLines, urlHost, whoisFor } from './netdata';

describe('netdata is deterministic (R6.3 to R6.10)', () => {
  const cases: [string, () => unknown][] = [
    ['whoisFor', () => whoisFor('198.51.100.9')],
    ['pingLines', () => pingLines('198.51.100.9', 3)],
    ['pingLines host', () => pingLines('example.org', 3)],
    ['nmapLines', () => nmapLines('198.51.100.9', [22, 80, 443], true)],
    ['nmapLines default', () => nmapLines('example.org', undefined, false)],
    ['curlLines', () => curlLines('http://example.org/a', false, false)],
    ['curlLines -I', () => curlLines('http://198.51.100.9:8080/x', true, true)],
    ['ssLines up', () => ssLines(true)],
    ['ssLines down', () => ssLines(false)],
  ];
  it.each(cases)('%s returns the same value twice', (_n, f) => {
    expect(f()).toEqual(f());
  });

  it('whoisFor of 203.0.113.x names the fictional provider with an ASN', () => {
    for (const ip of ['203.0.113.1', '203.0.113.77', '203.0.113.254']) {
      const w = whoisFor(ip);
      expect(w.owner).toBe('Nightfall Hosting Ltd');
      expect(w.asn).toBe('AS64501');
      expect(w.lines.join('\n')).toContain('Nightfall Hosting Ltd');
    }
  });

  it('whois text has an owner and an ASN for any address and names no real organization', () => {
    const real = /google|amazon|cloudflare|microsoft|digitalocean|ovh|hetzner|comcast|verizon|cogent|akamai/i;
    for (const ip of ['1.2.3.4', '8.8.8.8', '198.51.100.9', '10.0.0.1', '255.255.255.255']) {
      const w = whoisFor(ip);
      expect(w.asn).toMatch(/^AS\d+$/);
      expect(w.lines.join('\n')).toContain(w.owner);
      expect(w.lines.join('\n')).toContain(w.asn);
      expect(w.lines.join('\n')).not.toMatch(real);
    }
  });

  it('isIPv4 and isHostname tables', () => {
    for (const s of ['0.0.0.0', '1.2.3.4', '255.255.255.255', '203.0.113.7']) expect(isIPv4(s)).toBe(true);
    for (const s of ['300.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', 'a.b.c.d', '']) expect(isIPv4(s)).toBe(false);
    for (const s of ['localhost', 'example.org', 'a-b.example.org', 'x1']) expect(isHostname(s)).toBe(true);
    for (const s of ['a_b', '-a.org', 'a-.org', 'a..b', '', '1.2.3', '300.1.1.1', 'a'.repeat(64), `${'a.'.repeat(130)}a`]) expect(isHostname(s)).toBe(false);
  });

  it('urlHost table', () => {
    const table: [string, string | undefined][] = [
      ['http://203.0.113.7/', '203.0.113.7'],
      ['https://example.org:8443/a/b?q=1', 'example.org'],
      ['example.org', 'example.org'],
      ['localhost:3000/rest', 'localhost'],
      ['http://a_b/', undefined],
      ['http://300.1.1.1/', undefined],
      ['http:///x', undefined],
      ['', undefined],
    ];
    for (const [url, host] of table) expect(urlHost(url), url).toBe(host);
  });

  it('ss lists nginx on 80 only while it runs', () => {
    expect(ssLines(true).join('\n')).toContain('nginx');
    expect(ssLines(false).join('\n')).not.toContain('nginx');
    expect(ssLines(false).join('\n')).toContain('3000');
  });
});

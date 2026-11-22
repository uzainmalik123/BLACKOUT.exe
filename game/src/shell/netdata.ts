// Network data and helpers shared by the network commands (PRD SYS-09; design G8).
import { sha256Hex } from './sha256'

// Same grammar as the Engine's private IPV4 in actions.ts: four decimal octets 0 to 255, no leading zeros.
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIPv4(s: string): boolean {
  return IPV4.test(s);
}

const LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

/** RFC-1123-ish hostname: labels of 1 to 63 letters, digits or `-` (not starting or ending with `-`), 1 to 253 characters in all, at least one letter. */
export function isHostname(s: string): boolean {
  if (s.length < 1 || s.length > 253) return false
  if (!/[A-Za-z]/.test(s)) return false
  return s.split('.').every((l) => LABEL.test(l))
}

/** Deterministic bytes derived from the text; the only source of "random" numbers here. */
function digest(seed: string): number[] {
  const hex = sha256Hex(new TextEncoder().encode(seed))
  const out: number[] = []
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
  return out
}

const byteAt = (d: number[], i: number): number => d[i % d.length] ?? 0

const pad2 = (n: number): string => String(n).padStart(2, '0')

// ---------------------------------------------------------------- whois

const PROVIDERS: readonly { org: string; asn: number; country: string }[] = [
  { org: 'Nightfall Hosting Ltd', asn: 64501, country: 'NL' },
  { org: 'Crypt Networks GmbH', asn: 64502, country: 'DE' },
  { org: 'Hollow Cloud Services', asn: 64503, country: 'SE' },
  { org: 'Grimwood Datacenters Inc', asn: 64504, country: 'US' },
  { org: 'Pale Horse Telecom', asn: 64505, country: 'RO' },
]

/** Owner text and ASN as a pure function of the address. */
export function whoisFor(ip: string): { owner: string; asn: string; lines: string[] } {
  const d = digest(`whois:${ip}`)
  const p203 = ip.startsWith('203.0.113.')
  // TEST-NET-3 gets a fixed fictional provider; everything else is picked by hash. All names are fictional.
  const prov = p203 ? PROVIDERS[0]! : PROVIDERS[byteAt(d, 0) % PROVIDERS.length]!
  const parts = ip.split('.')
  const net = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
  const asn = `AS${prov.asn}`
  const handle = `NET-${parts.join('-')}`
  const abuse = `abuse@${prov.org.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}.example`
  const lines = [
    `% Information related to '${net}'`,
    '',
    `inetnum:        ${ip} - ${ip}`,
    `netname:        ${handle}`,
    `descr:          ${prov.org}`,
    `country:        ${prov.country}`,
    `origin:         ${asn}`,
    `org-name:       ${prov.org}`,
    `abuse-mailbox:  ${abuse}`,
    'source:         GAME-RIR',
  ]
  return { owner: prov.org, asn, lines }
}

// ---------------------------------------------------------------- ping

export function pingLines(target: string, count: number): string[] {
  const ip = isIPv4(target) ? target : hostAddress(target)
  const d = digest(`ping:${target}`)
  const base = 5 + (byteAt(d, 0) % 40) + byteAt(d, 1) / 100
  const times: number[] = []
  const lines = [`PING ${target} (${ip}) 56(84) bytes of data.`]
  for (let i = 0; i < count; i++) {
    const t = Math.round((base + (byteAt(d, i + 2) % 100) / 50) * 1000) / 1000
    times.push(t)
    lines.push(`64 bytes from ${ip}: icmp_seq=${i + 1} ttl=${52 + (byteAt(d, 2) % 12)} time=${t.toFixed(1)} ms`)
  }
  const min = Math.min(...times)
  const max = Math.max(...times)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const mdev = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / times.length)
  lines.push(
    '',
    `--- ${target} ping statistics ---`,
    `${count} packets transmitted, ${count} received, 0% packet loss, time ${(count - 1) * 1001}ms`,
    `rtt min/avg/max/mdev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/${mdev.toFixed(3)} ms`,
  )
  return lines
}

/** A hostname resolves to 127.0.0.1 for localhost and otherwise to a fixed fictional TEST-NET-3 address. */
function hostAddress(host: string): string {
  if (host === 'localhost') return '127.0.0.1'
  return `203.0.113.${1 + (byteAt(digest(`host:${host}`), 0) % 254)}`
}

// ---------------------------------------------------------------- nmap

const SERVICES: readonly { port: number; name: string; version: string }[] = [
  { port: 22, name: 'ssh', version: 'OpenSSH 8.9p1 Ubuntu 3ubuntu0.6' },
  { port: 80, name: 'http', version: 'nginx 1.18.0' },
  { port: 443, name: 'https', version: 'nginx 1.18.0' },
  { port: 3000, name: 'ppp', version: 'Node.js Express framework' },
  { port: 3306, name: 'mysql', version: 'MySQL 8.0.35' },
  { port: 8080, name: 'http-proxy', version: 'Squid http proxy 5.7' },
]

function serviceFor(port: number): { name: string; version: string } {
  const s = SERVICES.find((x) => x.port === port)
  return s ? { name: s.name, version: s.version } : { name: 'unknown', version: '' }
}

export function nmapLines(target: string, ports: number[] | undefined, sV: boolean): string[] {
  const ip = isIPv4(target) ? target : hostAddress(target)
  const d = digest(`nmap:${ip}`)
  const list = ports && ports.length > 0 ? ports : SERVICES.map((s) => s.port)
  const lines = [
    'Starting Nmap 7.94 ( https://nmap.org ) at 2026-11-08 00:00 UTC',
    `Nmap scan report for ${target}${target === ip ? '' : ` (${ip})`}`,
    `Host is up (0.0${1 + (byteAt(d, 0) % 9)}s latency).`,
  ]
  const rows: string[] = []
  let closed = 0
  list.forEach((port, i) => {
    const open = port === 3000 ? byteAt(d, 20) % 2 === 0 : byteAt(d, i) % 3 !== 0
    if (!open) {
      closed++
      return
    }
    const svc = serviceFor(port)
    const base = `${`${port}/tcp`.padEnd(9)}${'open'.padEnd(7)}${svc.name.padEnd(12)}`
    rows.push(sV ? `${base}${svc.version}`.trimEnd() : base.trimEnd())
  })
  if (closed > 0) lines.push(`Not shown: ${closed} closed tcp ports (conn-refused)`)
  lines.push(sV ? 'PORT      STATE  SERVICE     VERSION' : 'PORT      STATE  SERVICE', ...rows)
  const secs = 1 + (byteAt(d, 5) % 90) / 100 + (sV ? 5 : 0)
  lines.push('', `Nmap done: 1 IP address (1 host up) scanned in ${secs.toFixed(2)} seconds`)
  return lines
}

// ---------------------------------------------------------------- curl

/** The host of `scheme://host[:port]/...` or of a bare host; undefined when it is not a valid hostname or IPv4. */
export function urlHost(url: string): string | undefined {
  const m = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/)?([^/:?#]*)(?::\d+)?(?:[/?#].*)?$/.exec(url)
  const host = m?.[1]
  if (host === undefined || host === '') return undefined
  return isIPv4(host) || isHostname(host) ? host : undefined
}

export function curlLines(url: string, headersOnly: boolean, silent: boolean): string[] {
  void silent // the progress meter goes to stderr; stdout is the same either way
  const host = urlHost(url)
  if (host === undefined) return [`curl: (3) URL rejected: Bad hostname`]
  const d = digest(`curl:${url}`)
  const len = 200 + (byteAt(d, 0) % 200)
  const day = 1 + (byteAt(d, 1) % 28)
  const etag = `W/"${len.toString(16)}-${d.slice(2, 6).map((b) => b.toString(16).padStart(2, '0')).join('')}"`
  const headers = [
    'HTTP/1.1 200 OK',
    'Server: nginx/1.18.0 (Ubuntu)',
    `Date: Sun, ${pad2(day)} Nov 2026 00:00:00 GMT`,
    'Content-Type: text/html; charset=UTF-8',
    `Content-Length: ${len}`,
    'Connection: keep-alive',
    `ETag: ${etag}`,
  ]
  if (headersOnly) return [...headers, '']
  return [
    '<!DOCTYPE html>',
    '<html>',
    `<head><title>${host}</title></head>`,
    `<body><h1>Welcome to ${host}</h1></body>`,
    '</html>',
  ]
}

// ---------------------------------------------------------------- ss

export function ssLines(nginxRunning: boolean): string[] {
  const row = (local: string, proc: string): string =>
    `${'LISTEN'.padEnd(8)}${'0'.padEnd(7)}${'511'.padEnd(7)}${local.padEnd(23)}${'0.0.0.0:*'.padEnd(19)}${proc}`
  const lines = [
    `${'State'.padEnd(8)}${'Recv-Q'.padEnd(7)}${'Send-Q'.padEnd(7)}${'Local Address:Port'.padEnd(23)}${'Peer Address:Port'.padEnd(19)}Process`,
  ]
  if (nginxRunning) lines.push(row('0.0.0.0:80', 'users:(("nginx",pid=812,fd=6))'))
  lines.push(row('0.0.0.0:3000', 'users:(("node",pid=1043,fd=19))'))
  return lines
}

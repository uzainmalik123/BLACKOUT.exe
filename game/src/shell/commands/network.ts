// Network commands: whois, ping, nmap, curl, ss (PRD SYS-09, DEF-04; R6.3-6.10, D-91, D-107).

import { parseArgs } from '../argparse';
import { curlLines, isHostname, isIPv4, nmapLines, pingLines, ssLines, urlHost, whoisFor } from '../netdata';
import { ok, unsupportedFlag, usage } from '../output';
import type { CommandContext, CommandResult, Handler } from '../types';

const MAX_PORTS = 100;

/** The text of the tool output as a stream with a final newline. */
const text = (lines: string[]): string => `${lines.join('\n')}\n`;

/**
 * Sends DEF-04 for an IPv4 target before the tool output is printed (D-91).
 * A refused action puts its message on stderr; the output still prints.
 */
async function lookup(ctx: CommandContext, host: string, mode: 'passive' | 'active', lines: string[]): Promise<CommandResult> {
  let stderr = '';
  if (isIPv4(host)) {
    const result = await ctx.engine.act({ type: 'DEF-04', ip: host, mode });
    if (!result.ok) stderr = `${result.message}\n`;
  }
  return { stdout: text(lines), stderr, code: 0 };
}

/** Ports from a comma list with `a-b` ranges, each 1 to 65535, at most 100 in all; undefined when invalid. */
function parsePorts(spec: string): number[] | undefined {
  const ports: number[] = [];
  for (const part of spec.split(',')) {
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part);
    if (!m) return undefined;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b > 65535 || a > b) return undefined;
    if (ports.length + (b - a + 1) > MAX_PORTS) return undefined;
    for (let p = a; p <= b; p++) ports.push(p);
  }
  return ports;
}

export const whois: Handler = async (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return parsed.kind === 'unsupported' ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);
  const ip = parsed.operands[0];
  if (parsed.operands.length !== 1 || ip === undefined || !isIPv4(ip)) return usage(ctx.spec);
  return lookup(ctx, ip, 'passive', whoisFor(ip).lines);
};

export const ping: Handler = async (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return parsed.kind === 'unsupported' ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);
  let count = 4;
  const given = parsed.flags.get('-c');
  if (given && given.length > 0) {
    const raw = given[given.length - 1] as string;
    if (!/^\d{1,3}$/.test(raw)) return usage(ctx.spec);
    count = Number(raw);
    if (count < 1 || count > 20) return usage(ctx.spec);
  }
  const host = parsed.operands[0];
  if (parsed.operands.length !== 1 || host === undefined || !(isIPv4(host) || isHostname(host))) return usage(ctx.spec);
  return lookup(ctx, host, 'active', pingLines(host, count));
};

export const nmap: Handler = async (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return parsed.kind === 'unsupported' ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);
  let ports: number[] | undefined;
  const given = parsed.flags.get('-p');
  if (given && given.length > 0) {
    ports = parsePorts(given[given.length - 1] as string);
    if (!ports) return usage(ctx.spec);
  }
  const host = parsed.operands[0];
  if (parsed.operands.length !== 1 || host === undefined || !(isIPv4(host) || isHostname(host))) return usage(ctx.spec);
  return lookup(ctx, host, 'active', nmapLines(host, ports, parsed.flags.has('-sV')));
};

export const curl: Handler = async (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return parsed.kind === 'unsupported' ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);
  const url = parsed.operands[0];
  if (parsed.operands.length !== 1 || url === undefined) return usage(ctx.spec);
  const host = urlHost(url);
  if (host === undefined) return usage(ctx.spec);
  return lookup(ctx, host, 'active', curlLines(url, parsed.flags.has('-I'), parsed.flags.has('-s')));
};

export const ss: Handler = (ctx, args) => {
  const parsed = parseArgs(ctx.spec, args);
  if (!parsed.ok) return parsed.kind === 'unsupported' ? unsupportedFlag(ctx.spec, parsed.flag) : usage(ctx.spec);
  if (parsed.operands.length > 0) return usage(ctx.spec);
  return ok(text(ssLines(ctx.world.nginx === 'running')));
};

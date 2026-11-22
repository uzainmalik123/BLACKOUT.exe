// Operations commands: iptables (PRD SYS-09, DEF-06, DEF-11, DEF-18; R9, R10).

import type { PlayerAction } from '../../rules/vocabulary';
import { parseForms } from '../argparse';
import { isIPv4 } from '../netdata';
import { ok, usage } from '../output';
import type { Handler } from '../types';

export const iptables: Handler = async (ctx, args) => {
  const match = parseForms(ctx.spec.forms ?? [], args);
  if (!match) return usage(ctx.spec);

  if (match.index === 2) {
    const lines = ['Chain INPUT (policy ACCEPT)'];
    for (const ip of ctx.world.firewall.blocked) lines.push(`DROP       all  --  ${ip}  anywhere`);
    return ok(`${lines.join('\n')}\n`);
  }

  const ip = match.values.ip as string;
  if (!isIPv4(ip)) return usage(ctx.spec);
  const result = await ctx.engine.act({ type: 'DEF-06', op: match.index === 0 ? 'add' : 'delete', ip });
  if (!result.ok) return { stdout: '', stderr: `${result.message}\n`, code: 1 }; // the message only (R9.4)
  return ok();
};

export const systemctl: Handler = async (ctx, args) => {
  const match = parseForms(ctx.spec.forms ?? [], args);
  if (!match) return usage(ctx.spec);

  const verb = match.values.choice as string;
  const unit = match.values.unit as string;
  if (unit !== 'nginx') return { stdout: '', stderr: `Unit ${unit}.service could not be found.\n`, code: 1 };

  if (verb === 'status') {
    return ok(ctx.world.nginx === 'running' ? 'active (running)\n' : 'inactive (dead)\n');
  }

  // restart always attempts the stop, then the start, whatever the stop answered (D-97).
  const actions: PlayerAction[] = [];
  if (verb === 'stop' || verb === 'restart') actions.push({ type: 'DEF-11' });
  if (verb === 'start' || verb === 'restart') actions.push({ type: 'DEF-18', what: 'nginx' });

  const messages: string[] = [];
  for (const action of actions) {
    const result = await ctx.engine.act(action);
    if (!result.ok) messages.push(result.message);
  }
  if (messages.length === 0) return ok();
  return { stdout: '', stderr: `${messages.join('\n')}\n`, code: 1 };
};

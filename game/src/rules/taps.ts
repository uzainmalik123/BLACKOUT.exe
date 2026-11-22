// PRD §4.1: the leaky taps (D-42), one entry per TAP row. Each is a real Juice Shop v20.4.0 exposure that leaks
// customers' Users rows with no login (KI-03). Cadence and drip size are in game/src/engine/config.ts. Each tap plays
// its own recording (game/src/recordings/taps/, D-130).
import type { TapId, WafRule } from './vocabulary';

export interface TapRow {
  id: TapId;
  name: string;
  exposure: string;
  /** The seed `Users` ids it leaks, or every seed row (the access logs carry every customer). */
  leaks: 'every-customer' | readonly number[];
  /** The one action that closes it: a WAF path block on the exposed route. */
  closedBy: { action: 'DEF-12'; rule: Extract<WafRule, { kind: 'block-path' }> };
  pri: 'M' | 'S';
}

const block = (path: string): TapRow['closedBy'] => ({ action: 'DEF-12', rule: { kind: 'block-path', method: 'GET', path } });

export const TAPS: readonly TapRow[] = [
  { id: 'TAP-01', name: 'Open logs', exposure: "The shop's access logs, listed and served at /support/logs", leaks: 'every-customer',
    closedBy: block('/support/logs'), pri: 'M' },
  // bjoern.kimminich@gmail.com, bjoern@owasp.org, john, emma, ethereum: the memories Juice Shop seeds (config/default.yml)
  { id: 'TAP-02', name: 'Photo wall', exposure: "GET /rest/memories returns each poster's whole Users row", leaks: [4, 13, 18, 19, 21],
    closedBy: block('/rest/memories'), pri: 'M' },
  // admin, jim, bender, morty, mc.safesearch, J12934, wurstbrot, bjoern@owasp.org, accountant, uvogin, stan, basil: the seeded reviews' authors
  { id: 'TAP-03', name: 'Reviews', exposure: "GET /rest/products/:id/reviews shows each reviewer's email", leaks: [1, 2, 3, 7, 8, 9, 10, 13, 15, 16, 20, 24],
    closedBy: block('/rest/products/*/reviews'), pri: 'S' },
];

export const TAP_BY_ID: Readonly<Record<TapId, TapRow>> = Object.fromEntries(TAPS.map((t) => [t.id, t])) as Record<TapId, TapRow>;

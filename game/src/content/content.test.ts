import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRIEFING } from './briefing';
import { MOVE_TAUNTS, SPECIAL_TAUNTS } from './taunts';

const baseline = readFileSync(fileURLToPath(new URL('../recordings/juiceshop.sqlite', import.meta.url)));

async function query(sql: string): Promise<unknown[][]> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(baseline);
  try {
    return db.exec(sql)[0]?.values ?? [];
  } finally {
    db.close();
  }
}

const file = (id: string) => BRIEFING.find((f) => f.id === id)!.markdown;

describe('briefing files (CON-01)', () => {
  it('has the four files, each with content', () => {
    expect(BRIEFING.map((f) => f.id)).toEqual(['system-map', 'admins', 'normal-traffic', 'playbook']);
    for (const f of BRIEFING) expect(f.markdown.length).toBeGreaterThan(200);
  });

  it('lists exactly the special-role accounts in the baseline DB', async () => {
    const rows = await query("SELECT email FROM Users WHERE role != 'customer'");
    const listed = [...file('admins').matchAll(/\| `([^`]+@[^`]+)` \|/g)].map((m) => m[1]);
    expect(new Set(listed)).toEqual(new Set(rows.map((r) => String(r[0]))));
  });

  it('states the real customer and product counts', async () => {
    const customers = (await query("SELECT count(*) FROM Users WHERE role = 'customer'"))[0]?.[0];
    const products = (await query('SELECT count(*) FROM Products'))[0]?.[0];
    expect(customers).toBe(312);
    expect(file('admins')).toContain(`${customers} accounts`);
    expect(file('system-map')).toContain(`${customers} customers, ${products} products`);
  });

  it('never names an internal move or minion id', () => {
    for (const f of BRIEFING) expect(f.markdown).not.toMatch(/\b(ATK|MIN|DEF)-\d\d\b/);
  });
});

describe("Death's taunts (CON-04)", () => {
  it('has at least three lines per move and per special moment', () => {
    for (const lines of Object.values(MOVE_TAUNTS)) expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const lines of Object.values(SPECIAL_TAUNTS)) expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('never gives away a defence', () => {
    const all = [...Object.values(MOVE_TAUNTS), ...Object.values(SPECIAL_TAUNTS)].flat().join('\n');
    expect(all).not.toMatch(/\b(waf|firewall|iptables|patch|rate.?limit|block|disable|switch off|turn off)\b/i);
  });
});

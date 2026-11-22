import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PATCHES } from '../rules/vocabulary';
import { PATCH_BY_ID, PATCHES as ENTRIES } from './patches';

const source = readFileSync(fileURLToPath(new URL('./patches.ts', import.meta.url)), 'utf8');

/** The `-` lines of a unified diff, without the marker. */
const removed = (diff: string) => diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
const added = (diff: string) => diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));

describe('the deploy console\'s patches (CON-02, DEF-13)', () => {
  it('has one entry per Patch value, and no other', () => {
    expect(ENTRIES.map((e) => e.patch).sort()).toEqual([...PATCHES].sort());
    for (const p of PATCHES) expect(PATCH_BY_ID[p].patch).toBe(p);
  });

  it('credits Juice Shop\'s MIT licence in the header', () => {
    const header = source.split('\nimport ')[0]!;
    expect(header).toMatch(/OWASP Juice Shop v20\.4\.0/);
    expect(header).toMatch(/MIT licence/);
    expect(header).toMatch(/Bjoern Kimminich/);
  });

  it.each(ENTRIES.map((e) => [e.patch, e] as const))('%s names a file, a line range, the vulnerable code, a diff and a why', (_id, e) => {
    expect(e.title.length).toBeGreaterThan(5);
    expect(e.file).toMatch(/^(routes|lib|models)\/[\w-]+\.ts$|^server\.ts$/);
    expect(e.lines[0]).toBeGreaterThan(0);
    expect(e.lines[1]).toBeGreaterThanOrEqual(e.lines[0]);
    expect(e.vulnerable.split('\n').length).toBe(e.lines[1] - e.lines[0] + 1);
    expect(e.why).toMatch(/^[A-Z].*[.]$/);
    expect(e.why.split(/(?<=[.!?])\s+(?=[A-Z])/).length).toBe(1); // one sentence
  });

  it.each(ENTRIES.map((e) => [e.patch, e] as const))('%s: the diff is a unified diff that touches the vulnerable file and removes only lines that are really there', (_id, e) => {
    expect(e.diff).toMatch(new RegExp(`^--- a/${e.file.replace('.', '\\.')}\\n\\+\\+\\+ b/${e.file.replace('.', '\\.')}\\n@@ `, 'm'));
    expect(added(e.diff).length).toBeGreaterThan(0);
    // Every removed line of the vulnerable file's hunks is quoted in `vulnerable` (the fix really changes those lines).
    const own = e.diff.split(/^--- a\//m).find((part) => part.startsWith(e.file))!;
    for (const line of removed(own)) expect(e.vulnerable).toContain(line.trim());
  });

  it('never names an internal id or a game mechanic', () => {
    for (const e of ENTRIES) expect(`${e.title} ${e.why} ${e.diff}`).not.toMatch(/\b(ATK|MIN|DEF|TAP|SYS|KIRO)-\d\d\b|heartbeat|souls?\b/i);
  });

  it('the admin check the users-access patch relies on is introduced by the product-update patch', () => {
    expect(PATCH_BY_ID['product-update'].diff).toContain('export const isAdmin');
    expect(PATCH_BY_ID['users-access'].diff).toContain('security.isAdmin()');
    expect(PATCH_BY_ID['users-access'].why).toMatch(/product-update/);
  });
});

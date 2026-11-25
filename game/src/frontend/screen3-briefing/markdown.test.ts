import { describe, expect, it } from 'vitest';
import { BRIEFING } from '../../content/briefing';
import { inline, parseMarkdown, plain, type Block } from './markdown';

const of = <K extends Block['kind']>(blocks: Block[], kind: K) => blocks.filter((b): b is Extract<Block, { kind: K }> => b.kind === kind);

describe('screen 3: the briefing files, parsed for display (CON-01, D-182)', () => {
  it('reads bold and code inside text, and leaves stray markers alone', () => {
    expect(inline('a **b** `c` d')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'c' },
      { kind: 'text', text: ' d' },
    ]);
    expect(plain(inline('2 ** 3 and `x'))).toBe('2 ** 3 and `x');
  });

  it('reads headings, paragraphs, lists, tables and fenced code', () => {
    const b = parseMarkdown('# T\n\nOne\ntwo.\n\n- a\n- **b**\n\n| X | Y |\n|---|---|\n| 1 | `2` |\n\n```\n a  b\n```\n');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'list', 'table', 'code']);
    expect(plain((b[1] as Extract<Block, { kind: 'para' }>).text)).toBe('One two.');
    const t = b[3] as Extract<Block, { kind: 'table' }>;
    expect(t.head.map(plain)).toEqual(['X', 'Y']);
    expect(t.rows[0]!.map(plain)).toEqual(['1', '2']);
    expect((b[4] as Extract<Block, { kind: 'code' }>).text).toBe(' a  b');
  });

  it('every briefing file parses into headings and content with no table or code fence left over as text', () => {
    for (const f of BRIEFING) {
      const blocks = parseMarkdown(f.markdown);
      expect(of(blocks, 'heading')[0]?.level, f.id).toBe(1);
      for (const p of of(blocks, 'para')) {
        const s = plain(p.text);
        expect(s.startsWith('|'), `${f.id}: ${s}`).toBe(false);
        expect(s.includes('```'), `${f.id}: ${s}`).toBe(false);
      }
    }
  });

  it('keeps the scenario facts: the admin table lists all eight admins, the system map its logs and backups', () => {
    const admins = parseMarkdown(BRIEFING.find((f) => f.id === 'admins')!.markdown);
    const firstTable = of(admins, 'table')[0]!;
    expect(firstTable.rows).toHaveLength(8);
    expect(firstTable.rows.map((r) => plain(r[0]!))).toContain('admin@juice-sh.op');
    const map = parseMarkdown(BRIEFING.find((f) => f.id === 'system-map')!.markdown);
    const text = JSON.stringify(map);
    expect(text).toContain('/var/log/nginx/access.log');
    expect(text).toContain('every hour');
    expect(of(map, 'code')).toHaveLength(1);
    const playbook = parseMarkdown(BRIEFING.find((f) => f.id === 'playbook')!.markdown);
    expect(of(playbook, 'heading').filter((h) => h.level === 2).length).toBeGreaterThanOrEqual(6);
  });
});

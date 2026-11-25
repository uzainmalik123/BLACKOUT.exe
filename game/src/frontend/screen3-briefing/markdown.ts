// The small part of Markdown the briefing files use (CON-01), parsed into plain data so the screen can render it
// as React elements (never as raw HTML): headings, paragraphs, bullet lists, tables, fenced code, and inside text
// **bold** and `code`. Anything else is kept as plain text.

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'code'; text: string };

export type Block =
  | { kind: 'heading'; level: number; text: Inline[] }
  | { kind: 'para'; text: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'code'; text: string };

/** `**bold**` and `` `code` `` inside a line; unmatched markers stay as text. */
export function inline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  let i = 0;
  const flush = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  while (i < src.length) {
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ kind: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'bold', text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    text += src[i];
    i++;
  }
  flush();
  return out;
}

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

const isRule = (row: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row);

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ kind: 'para', text: inline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('```')) {
      endPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      endPara();
      blocks.push({ kind: 'heading', level: h[1]!.length, text: inline(h[2]!.trim()) });
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isRule(lines[i + 1]!)) {
      endPara();
      const head = cells(line).map(inline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!).map(inline));
      i--;
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      endPara();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) items.push(inline(lines[i++]!.replace(/^\s*[-*]\s+/, '')));
      i--;
      blocks.push({ kind: 'list', items });
      continue;
    }
    if (line.trim() === '') endPara();
    else para.push(line.trim());
  }
  endPara();
  return blocks;
}

/** The plain words of some inline text (for tests and screen readers). */
export const plain = (xs: Inline[]): string => xs.map((x) => x.text).join('');

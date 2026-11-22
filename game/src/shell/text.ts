// Pure text helpers for the Shell. No locale APIs (PRD SYS-09, R15.7).

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/** Splits text into lines. One final "\n" ends the last line instead of starting an empty one. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Joins lines, ending every line with "\n" (the inverse of `splitLines`). */
export function joinLines(lines: readonly string[]): string {
  let out = '';
  for (const line of lines) out += `${line}\n`;
  return out;
}

/** UTF-8 to string. Invalid sequences become U+FFFD; never throws. */
export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Orders strings by code point, which is the same order as their UTF-8 bytes. Returns <0, 0 or >0. */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(j) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
    const step = ca > 0xffff ? 2 : 1;
    i += step;
    j += step;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}

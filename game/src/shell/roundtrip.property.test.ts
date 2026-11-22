// Feature: shell, Property 1: Parse, print, parse round trip
// **Validates: Requirements 3.5, 3.8, 3.9, 3.13**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseLine } from './parser';
import { printLine } from './printer';
import { arbPipeline } from './test-fixtures/generators';

// Raw text from the characters that matter to the lexer, so that many strings parse and many do not.
const arbRaw = fc
  .array(fc.constantFrom(...'abc*~ |>\'"\t.-/é'), { maxLength: 24 })
  .map((cs) => cs.join(''));

describe('Property 1: parse, print, parse round trip', () => {
  it('parseLine(printLine(p)) equals { ok: true, pipeline: p } for every valid pipeline', () => {
    fc.assert(
      fc.property(arbPipeline, (p) => {
        expect(parseLine(printLine(p))).toStrictEqual({ ok: true, pipeline: p });
      }),
      { numRuns: 200 },
    );
  });

  it('parse(print(parse(s))) equals parse(s) for every string that parses', () => {
    fc.assert(
      fc.property(arbRaw, (s) => {
        const q = parseLine(s);
        fc.pre(q.ok && q.pipeline.stages.length > 0);
        if (!q.ok) return;
        expect(parseLine(printLine(q.pipeline))).toStrictEqual(q);
      }),
      { numRuns: 200 },
    );
  });
});

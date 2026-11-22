// Feature: shell, Property 3: The checking function agrees with the parser and the command list
// **Validates: Requirements 2.2, 2.3**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMAND_LIST, checkCommandLine } from './index';
import { parseLine } from './parser';

const NAMES: ReadonlySet<string> = new Set<string>(COMMAND_LIST);

// Raw text from the characters that matter to the lexer.
const arbRaw = fc
  .array(fc.constantFrom(...'abcls |>\'"$;&()`<~*-\t.9é'), { maxLength: 24 })
  .map((cs) => cs.join(''));

// Lines built from listed and unlisted names so that both outcomes occur often.
const arbName = fc.oneof(
  fc.constantFrom(...COMMAND_LIST),
  fc.constantFrom('sudo', 'bash', 'echo', 'LS', 'lss', 'rm2', '/bin/ls', ''),
);
const arbArg = fc.constantFrom('', 'a', '-l', "'x y'", '"q"', '*.log', '~', '$X', ';', "'oops");
const arbStage = fc.tuple(arbName, arbArg).map(([n, a]) => `${n} ${a}`);
const arbComposed = fc
  .tuple(
    fc.array(arbStage, { minLength: 1, maxLength: 4 }),
    fc.option(fc.constantFrom('/tmp/o', '', 'a b'), { nil: undefined }),
  )
  .map(([stages, redirect]) => stages.join(' | ') + (redirect === undefined ? '' : ` > ${redirect}`));

describe('Property 3: checkCommandLine agrees with parseLine and COMMAND_LIST', () => {
  it('is true iff the line parses to at least one stage and every stage name is listed; never throws', () => {
    fc.assert(
      fc.property(fc.oneof(arbRaw, arbComposed), (line) => {
        const parsed = parseLine(line);
        // An empty line parses with no stage; it is not a command line (the unit tests pin this to false).
        const expected =
          parsed.ok &&
          parsed.pipeline.stages.length > 0 &&
          parsed.pipeline.stages.every((s) => NAMES.has(s.name.text));
        expect(checkCommandLine(line)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });
});

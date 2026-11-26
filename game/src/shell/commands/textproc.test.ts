// Text commands: cat head tail grep awk sort uniq wc cut (PRD SYS-09; R5.4-5.14, R5.18-5.21, R6.1, R14.5, R15.1, R15.4, R16.1, R16.2).
import { describe, expect, it, vi } from 'vitest';
import { decodeUtf8 } from '../text';
import { finish, sanitize } from '../output';
import { COMMANDS } from '../registry';
import { makeFixture, WHOLE_RUN_TIMEOUT_MS, type PlantSpec } from '../test-fixtures/fixture';

const T = 30_000;
const HOME = '/srv/juice-shop';
const ACCESS = '/var/log/nginx/access.log';
const APP = '/var/log/juice-shop/app.log';
const DB = `${HOME}/data/juiceshop.sqlite`;

const F = 'b 2\na 10\nc 1\n';
const PLANT: PlantSpec[] = [
  { path: 'f.txt', content: F },
  { path: 'nums.txt', content: '10\n9\n100\n' },
  { path: 'colon.txt', content: 'root:x:0\nbin:x:1\n' },
  { path: 'dups.txt', content: 'x\nx\ny\nx\n' },
  { path: 'twelve.txt', content: Array.from({ length: 12 }, (_, i) => String(i + 1)).join('\n') + '\n' },
];
const f = 'uploads/f.txt';
const nums = 'uploads/nums.txt';
const colon = 'uploads/colon.txt';
const dups = 'uploads/dups.txt';
const twelve = 'uploads/twelve.txt';

const fixture = (extra: Parameters<typeof makeFixture>[0] = {}) => makeFixture({ baseline: false, plant: PLANT, ...extra });

async function run(line: string, extra: Parameters<typeof makeFixture>[0] = {}) {
  return fixture(extra).shell.run(line);
}

function unsupportedText(cmd: keyof typeof COMMANDS, flag: string): string {
  return `${cmd}: unsupported flag '${flag}'\n${cmd}: usage: ${COMMANDS[cmd].usage}`;
}

describe('cat (R5.4, R5.18, R5.19)', () => {
  it('prints a file, several files in order, and has no flags', async () => {
    const { shell } = fixture();
    expect(await shell.run(`cat ${f}`)).toEqual({ output: 'b 2\na 10\nc 1', exitCode: 0 });
    expect((await shell.run(`cat ${colon} ${nums}`)).output).toBe('root:x:0\nbin:x:1\n10\n9\n100');
  }, T);

  it('rejects an unsupported flag with the R5.19 text', async () => {
    expect(await run(`cat -n ${f}`)).toEqual({ output: unsupportedText('cat', '-n'), exitCode: 1 });
  }, T);

  it('a missing path prints one error line and processing continues with exit 1', async () => {
    const r = await run(`cat /nope ${f}`);
    expect(r).toEqual({ output: 'cat: /nope: No such file or directory\nb 2\na 10\nc 1', exitCode: 1 });
  }, T);

  it('a directory prints Is a directory', async () => {
    expect(await run('cat /var')).toEqual({ output: 'cat: /var: Is a directory', exitCode: 1 });
  }, T);

  it('reads stdin when it has no operand', async () => {
    expect((await run(`cat ${f} | cat`)).output).toBe('b 2\na 10\nc 1');
  }, T);
});

describe('head and tail (R5.5, R5.6)', () => {
  it('default is 10 lines', async () => {
    const { shell } = fixture();
    expect((await shell.run(`head ${twelve}`)).output).toBe('1\n2\n3\n4\n5\n6\n7\n8\n9\n10');
    expect((await shell.run(`tail ${twelve}`)).output).toBe('3\n4\n5\n6\n7\n8\n9\n10\n11\n12');
  }, T);

  it('-n <count>, -n<count> and -<count> select lines', async () => {
    const { shell } = fixture();
    expect((await shell.run(`head -n 2 ${twelve}`)).output).toBe('1\n2');
    expect((await shell.run(`head -n2 ${twelve}`)).output).toBe('1\n2');
    expect((await shell.run(`head -5 ${twelve}`)).output).toBe('1\n2\n3\n4\n5');
    expect((await shell.run(`tail -n 2 ${twelve}`)).output).toBe('11\n12');
    expect((await shell.run(`tail -3 ${twelve}`)).output).toBe('10\n11\n12');
    expect((await shell.run(`head -n 0 ${twelve}`)).output).toBe('');
  }, T);

  it('a bad count prints the usage line', async () => {
    const { shell } = fixture();
    expect(await shell.run(`head -n abc ${f}`)).toEqual({ output: `head: usage: ${COMMANDS.head.usage}`, exitCode: 1 });
    expect((await shell.run(`tail -n -1 ${f}`)).exitCode).toBe(1);
    expect((await shell.run(`head -n 2147483648 ${f}`)).output).toBe(`head: usage: ${COMMANDS.head.usage}`);
  }, T);

  it('rejects an unsupported flag with the R5.19 text', async () => {
    const { shell } = fixture();
    expect(await shell.run(`head -x ${f}`)).toEqual({ output: unsupportedText('head', '-x'), exitCode: 1 });
    expect(await shell.run(`tail -f ${f}`)).toEqual({ output: unsupportedText('tail', '-f'), exitCode: 1 });
  }, T);

  it('read stdin from a pipe', async () => {
    const { shell } = fixture();
    expect((await shell.run(`cat ${twelve} | head -n 2`)).output).toBe('1\n2');
    expect((await shell.run(`cat ${twelve} | tail -n 2`)).output).toBe('11\n12');
  }, T);

  it('a missing path continues with exit 1', async () => {
    const r = await run(`head -n 1 /nope ${f}`);
    expect(r).toEqual({ output: 'head: /nope: No such file or directory\nb 2', exitCode: 1 });
  }, T);
});

describe('grep (R5.7, R5.8, R5.21)', () => {
  it('selects matching lines; -i, -v, -c, -n, -E and -e each work', async () => {
    const { shell } = fixture();
    expect((await shell.run(`grep a ${f}`)).output).toBe('a 10');
    expect((await shell.run(`grep A ${f}`)).exitCode).toBe(1);
    expect((await shell.run(`grep -i A ${f}`)).output).toBe('a 10');
    expect((await shell.run(`grep -v a ${f}`)).output).toBe('b 2\nc 1');
    expect((await shell.run(`grep -c 1 ${f}`)).output).toBe('2');
    expect((await shell.run(`grep -n c ${f}`)).output).toBe('3:c 1');
    expect((await shell.run(`grep -E 'b|c' ${f}`)).output).toBe('b 2\nc 1');
    expect((await shell.run(`grep 'b|c' ${f}`)).exitCode).toBe(1); // BRE: | is literal
    expect((await shell.run(`grep -e a -e c ${f}`)).output).toBe('a 10\nc 1');
  }, T);

  it('exit 1 on no match, and -c prints 0 with exit 1', async () => {
    const { shell } = fixture();
    expect(await shell.run(`grep zzz ${f}`)).toEqual({ output: '', exitCode: 1 });
    expect(await shell.run(`grep -c zzz ${f}`)).toEqual({ output: '0', exitCode: 1 });
  }, T);

  it('several files prefix each line with the file name as typed', async () => {
    const r = await run(`grep 1 ${f} ${nums}`);
    expect(r).toEqual({ output: `${f}:a 10\n${f}:c 1\n${nums}:10\n${nums}:100`, exitCode: 0 });
  }, T);

  it('an unsupported pattern prints grep: unsupported pattern', async () => {
    expect(await run(`grep -E '(a+)+' ${f}`)).toEqual({ output: 'grep: unsupported pattern', exitCode: 1 });
  }, T);

  it('rejects an unsupported flag, and no pattern prints usage', async () => {
    const { shell } = fixture();
    expect(await shell.run(`grep -r a ${f}`)).toEqual({ output: unsupportedText('grep', '-r'), exitCode: 1 });
    expect((await shell.run('grep')).output).toBe(`grep: usage: ${COMMANDS.grep.usage}`);
  }, T);

  it('reads stdin from a pipe and continues past a missing path with exit 1', async () => {
    const { shell } = fixture();
    expect((await shell.run(`cat ${f} | grep -c .`)).output).toBe('3');
    expect(await shell.run(`grep a /nope ${f}`)).toEqual({
      output: `grep: /nope: No such file or directory\n${f}:a 10`,
      exitCode: 1,
    });
  }, T);
});

describe('awk (R5.9, R5.10, R5.20)', () => {
  it('prints $0, $N, $NF and NR, several expressions joined by a space', async () => {
    const { shell } = fixture();
    expect((await shell.run(`awk '{print $0}' ${f}`)).output).toBe('b 2\na 10\nc 1');
    expect((await shell.run(`awk '{print $1}' ${f}`)).output).toBe('b\na\nc');
    expect((await shell.run(`awk '{print $NF}' ${f}`)).output).toBe('2\n10\n1');
    expect((await shell.run(`awk '{print NR, $2}' ${f}`)).output).toBe('1 2\n2 10\n3 1');
  }, T);

  it('-F sets a one-character separator, attached or separate', async () => {
    const { shell } = fixture();
    expect((await shell.run(`awk -F: '{print $1}' ${colon}`)).output).toBe('root\nbin');
    expect((await shell.run(`awk -F : '{print $3}' ${colon}`)).output).toBe('0\n1');
  }, T);

  it('a /regex/ filter selects lines', async () => {
    expect((await run(`awk '/a/ {print NR, $2}' ${f}`)).output).toBe('2 10');
  }, T);

  it('a missing field is the empty string', async () => {
    expect((await run(`awk '{print $1, $5}' ${f}`)).output).toBe('b \na \nc ');
  }, T);

  it('unsupported programs and a multi-character -F print awk: unsupported program', async () => {
    const { shell } = fixture();
    const bad = { output: 'awk: unsupported program', exitCode: 1 };
    expect(await shell.run(`awk '{printf $1}' ${f}`)).toEqual(bad);
    expect(await shell.run(`awk 'BEGIN{print 1}' ${f}`)).toEqual(bad);
    expect(await shell.run(`awk '{print $1+1}' ${f}`)).toEqual(bad);
    expect(await shell.run(`awk '{print $100}' ${f}`)).toEqual(bad);
    expect(await shell.run(`awk '/(a+)+/ {print $1}' ${f}`)).toEqual(bad);
    expect(await shell.run(`awk -F:: '{print $1}' ${colon}`)).toEqual(bad); // multi-character -F is unsupported by design
  }, T);

  it('rejects an unsupported flag, and reads stdin from a pipe', async () => {
    const { shell } = fixture();
    expect(await shell.run(`awk -v x=1 '{print $1}' ${f}`)).toEqual({ output: unsupportedText('awk', '-v'), exitCode: 1 });
    expect((await shell.run(`cat ${f} | awk '{print $1}'`)).output).toBe('b\na\nc');
  }, T);

  it('a missing path continues with exit 1', async () => {
    const r = await run(`awk '{print $1}' /nope ${f}`);
    expect(r).toEqual({ output: 'awk: /nope: No such file or directory\nb\na\nc', exitCode: 1 });
  }, T);
});

describe('sort (R5.11)', () => {
  it('sorts by code point, -r reverses, -n compares numbers', async () => {
    const { shell } = fixture();
    expect((await shell.run(`sort ${f}`)).output).toBe('a 10\nb 2\nc 1');
    expect((await shell.run(`sort -r ${f}`)).output).toBe('c 1\nb 2\na 10');
    expect((await shell.run(`sort ${nums}`)).output).toBe('10\n100\n9');
    expect((await shell.run(`sort -n ${nums}`)).output).toBe('9\n10\n100');
    expect((await shell.run(`sort -rn ${nums}`)).output).toBe('100\n10\n9');
  }, T);

  it('-k N sorts on the Nth field, alone or with -n or -r', async () => {
    const { shell } = fixture();
    expect((await shell.run(`sort -k 2 ${f}`)).output).toBe('c 1\na 10\nb 2');
    expect((await shell.run(`sort -k2 -n ${f}`)).output).toBe('c 1\nb 2\na 10');
    expect((await shell.run(`sort -n -r -k 2 ${f}`)).output).toBe('a 10\nb 2\nc 1');
    expect((await shell.run(`sort -k 9 ${f}`)).output).toBe(F.trimEnd()); // missing key is empty: stable
  }, T);

  it('a bad -k value prints the usage line', async () => {
    const { shell } = fixture();
    const usage = { output: `sort: usage: ${COMMANDS.sort.usage}`, exitCode: 1 };
    expect(await shell.run(`sort -k 0 ${f}`)).toEqual(usage);
    expect(await shell.run(`sort -k x ${f}`)).toEqual(usage);
    expect(await shell.run(`sort -k 100 ${f}`)).toEqual(usage);
  }, T);

  it('rejects an unsupported flag, reads stdin, and continues past a missing path', async () => {
    const { shell } = fixture();
    expect(await shell.run(`sort -u ${f}`)).toEqual({ output: unsupportedText('sort', '-u'), exitCode: 1 });
    expect((await shell.run(`cat ${f} | sort`)).output).toBe('a 10\nb 2\nc 1');
    expect(await shell.run(`sort /nope ${f}`)).toEqual({
      output: 'sort: /nope: No such file or directory\na 10\nb 2\nc 1',
      exitCode: 1,
    });
  }, T);
});

describe('uniq (R5.12)', () => {
  it('collapses adjacent duplicates only, -c prefixes the count', async () => {
    const { shell } = fixture();
    expect((await shell.run(`uniq ${dups}`)).output).toBe('x\ny\nx');
    expect((await shell.run(`uniq -c ${dups}`)).output).toBe('      2 x\n      1 y\n      1 x');
    expect((await shell.run(`cat ${dups} | sort | uniq -c`)).output).toBe('      3 x\n      1 y');
  }, T);

  it('rejects an unsupported flag and continues past a missing path with exit 1', async () => {
    const { shell } = fixture();
    expect(await shell.run(`uniq -d ${dups}`)).toEqual({ output: unsupportedText('uniq', '-d'), exitCode: 1 });
    expect(await shell.run('uniq /nope')).toEqual({ output: 'uniq: /nope: No such file or directory', exitCode: 1 });
  }, T);
});

describe('wc (R5.13)', () => {
  it('-l, -w and -c each count one thing, no flag counts all three', async () => {
    const { shell } = fixture();
    expect((await shell.run(`wc -l ${f}`)).output).toBe(`3 ${f}`);
    expect((await shell.run(`wc -w ${f}`)).output).toBe(`6 ${f}`);
    expect((await shell.run(`wc -c ${f}`)).output).toBe(`13 ${f}`);
    expect((await shell.run(`wc ${f}`)).output).toBe(` 3  6 13 ${f}`);
    expect((await shell.run(`wc -lw ${f}`)).output).toBe(`3 6 ${f}`);
  }, T);

  it('stdin prints no name, several files add a total', async () => {
    const { shell } = fixture();
    expect((await shell.run(`cat ${f} | wc -l`)).output).toBe('3');
    expect((await shell.run(`wc -l ${f} ${dups}`)).output).toBe(`3 ${f}\n4 ${dups}\n7 total`);
  }, T);

  it('counts bytes, not characters', async () => {
    const { shell } = fixture({ plant: [{ path: 'u.txt', content: 'é\n' }] });
    expect((await shell.run('wc -c uploads/u.txt')).output).toBe('3 uploads/u.txt');
  }, T);

  it('rejects an unsupported flag and continues past a missing path with exit 1', async () => {
    const { shell } = fixture();
    expect(await shell.run(`wc -m ${f}`)).toEqual({ output: unsupportedText('wc', '-m'), exitCode: 1 });
    expect(await shell.run(`wc -l /nope ${f}`)).toEqual({
      output: `wc: /nope: No such file or directory\n3 ${f}\n3 total`,
      exitCode: 1,
    });
  }, T);
});

describe('cut (R5.14)', () => {
  it('-d and -f select fields; a list prints them in order joined by the separator', async () => {
    const { shell } = fixture();
    expect((await shell.run(`cut -d : -f 1 ${colon}`)).output).toBe('root\nbin');
    expect((await shell.run(`cut -d: -f1,3 ${colon}`)).output).toBe('root:0\nbin:1');
    expect((await shell.run(`cut -d : -f 3,1 ${colon}`)).output).toBe('root:0\nbin:1');
    expect((await shell.run(`cut -d : -f 9 ${colon}`)).output).toBe('\n');
  }, T);

  it('a line without the separator is printed whole', async () => {
    expect((await run(`cut -d : -f 2 ${f}`)).output).toBe('b 2\na 10\nc 1');
  }, T);

  it('missing -d or -f, a multi-character -d and a bad field list print the usage line', async () => {
    const { shell } = fixture();
    const usage = { output: `cut: usage: ${COMMANDS.cut.usage}`, exitCode: 1 };
    expect(await shell.run(`cut -f 1 ${colon}`)).toEqual(usage);
    expect(await shell.run(`cut -d : ${colon}`)).toEqual(usage);
    expect(await shell.run(`cut -d :: -f 1 ${colon}`)).toEqual(usage);
    expect(await shell.run(`cut -d : -f 0 ${colon}`)).toEqual(usage);
    expect(await shell.run(`cut -d : -f 1,x ${colon}`)).toEqual(usage);
    expect(await shell.run(`cut -d : -f 100 ${colon}`)).toEqual(usage);
  }, T);

  it('rejects an unsupported flag, reads stdin, and continues past a missing path', async () => {
    const { shell } = fixture();
    expect(await shell.run(`cut -b 1 ${colon}`)).toEqual({ output: unsupportedText('cut', '-b'), exitCode: 1 });
    expect((await shell.run(`cat ${colon} | cut -d : -f 1`)).output).toBe('root\nbin');
    expect(await shell.run(`cut -d : -f 1 /nope ${colon}`)).toEqual({
      output: 'cut: /nope: No such file or directory\nroot\nbin',
      exitCode: 1,
    });
  }, T);
});

describe('read tracking (R14.5, R16.2)', () => {
  it('a pipeline of two log readers sends exactly one DEF-01', async () => {
    const { shell, actsOfType } = fixture({ advanceMs: 60_000 });
    await shell.run(`head -n 1 ${ACCESS} | tail -n 1 ${APP}`);
    expect(actsOfType('DEF-01')).toHaveLength(1);
    expect(actsOfType('DEF-03')).toHaveLength(0);
  }, T);

  it('a line mixing a log and uploads/ sends one DEF-01 and one DEF-03', async () => {
    const { shell, actsOfType } = fixture({ advanceMs: 60_000 });
    await shell.run(`cat ${ACCESS} ${f} ${nums}`);
    expect(actsOfType('DEF-01')).toHaveLength(1);
    expect(actsOfType('DEF-03')).toHaveLength(1);
    await shell.run(`cat ${ACCESS}`);
    expect(actsOfType('DEF-01')).toHaveLength(2); // a new line sends a new one
  }, T);

  it('cat on the .sqlite file prints the decoded bytes and sends no DEF-02', async () => {
    const fx = makeFixture();
    const bytes = (await fx.engine.db()).db.export();
    const r = await fx.shell.run(`cat ${DB}`);
    expect(r.exitCode).toBe(0);
    expect(r.output).toBe(finish(sanitize(decodeUtf8(bytes))));
    expect(r.output.startsWith('SQLite format 3')).toBe(true);
    expect(fx.actsOfType('DEF-02')).toHaveLength(0);
  }, T);

  it('the text commands change nothing but the read actions', async () => {
    const fx = fixture({ advanceMs: 60_000 });
    const before = fx.worldWithoutReads();
    for (const line of [
      `cat ${ACCESS}`, `head -n 3 ${APP}`, `grep -c GET ${ACCESS}`, `awk '{print $1}' ${ACCESS} | sort | uniq -c`,
      `wc -l ${ACCESS}`, `cut -d ' ' -f 1 ${ACCESS}`, `tail -2 ${f}`,
    ]) await fx.shell.run(line);
    expect(fx.worldWithoutReads()).toEqual(before);
    expect(fx.actsOfType('DEF-01').length).toBeLessThanOrEqual(7);
  }, T);

  it('logs show nothing after game time (R6.1): the log read grows as the game advances', async () => {
    const fx = fixture();
    const a = (await fx.shell.run(`wc -l ${ACCESS}`)).output;
    fx.engine.advance(120_000);
    const b = (await fx.shell.run(`wc -l ${ACCESS}`)).output;
    expect(a).toBe(`0 ${ACCESS}`);
    expect(Number(b.split(' ')[0])).toBeGreaterThan(0);
  }, T);
});

describe('internal errors (R15.1, R15.4)', () => {
  it('a failing engine.accessLog prints the generic line, reaches the hook and leaves the World alone', async () => {
    const fx = fixture({ advanceMs: 60_000 });
    const before = fx.worldWithoutReads();
    const boom = new Error('boom: secret detail');
    vi.spyOn(fx.engine, 'accessLog').mockImplementation(() => {
      throw boom;
    });
    const r = await fx.shell.run(`cat ${ACCESS}`);
    expect(r).toEqual({ output: 'cat: internal error', exitCode: 1 });
    expect(r.output).not.toContain('boom');
    expect(fx.internalErrors).toContain(boom);
    expect(fx.worldWithoutReads()).toEqual(before);
    // the Shell stays usable
    expect((await fx.shell.run(`head -n 1 ${f}`)).output).toBe('b 2');
  }, T);

  it('a failing engine.files prints the generic line, reaches the hook and leaves the World alone', async () => {
    const fx = fixture();
    const before = fx.worldWithoutReads();
    const boom = new Error('files exploded');
    vi.spyOn(fx.engine, 'files').mockImplementation(() => {
      throw boom;
    });
    const r = await fx.shell.run(`grep a ${f}`);
    expect(r).toEqual({ output: 'grep: internal error', exitCode: 1 });
    expect(fx.internalErrors).toContain(boom);
    expect(fx.worldWithoutReads()).toEqual(before);
  }, T);

  it('an internal error in one stage does not stop the other stages of the line', async () => {
    const fx = fixture();
    const boom = new Error('x');
    vi.spyOn(fx.engine, 'files').mockImplementation(() => {
      throw boom;
    });
    const r = await fx.shell.run(`cat ${f} | wc -l`);
    expect(r.output).toContain('cat: internal error');
    expect(r.exitCode).toBe(0);
  }, T);
});

describe('performance on a whole-run access log (G15)', () => {
  it('grep over the access log of a whole run resolves well inside 5,000 ms', async () => {
    const fx = makeFixture({ baseline: false });
    for (let i = 0; i < 10 && !fx.world.ending; i++) fx.engine.advance(60_000); // 10 real minutes: inside Medium's 11-minute shift (D-259)
    expect(fx.world.ending).toBeUndefined();
    expect(fx.world.logs.access.length).toBeGreaterThan(1_000);
    const started = performance.now();
    const r = await fx.shell.run(`grep -c GET ${ACCESS}`);
    const elapsed = performance.now() - started;
    expect(r.exitCode).toBe(0);
    expect(Number(r.output)).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_500);
  }, WHOLE_RUN_TIMEOUT_MS);
});

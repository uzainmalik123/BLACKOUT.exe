// Checkpoint (a), task 13.1: the MVP shell plays an investigation-and-containment session end to end
// (R6, R7, R9, R10, R11, R14). Every line goes through shell.run on a real Engine with the committed baseline.
import { describe, expect, it, vi } from 'vitest';
import { makeFixture, WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/fixture';

const DB = '/srv/juice-shop/data/juiceshop.sqlite';
const ACCESS = '/var/log/nginx/access.log';
const UP = '/srv/juice-shop/uploads';
const IP = '203.0.113.77';
const noDate = /\d{4}-\d{2}-\d{2}/; // KI-91: a locked account's deletedAt is never printed

describe('MVP session: investigate, then contain', () => {
  it('runs a full session and leaves the World as the actions say', { timeout: WHOLE_RUN_TIMEOUT_MS }, async () => {
    const f = makeFixture({ plant: [{ path: 'rip.php', content: '<?php echo 1;' }], advanceMs: 180_000 });
    const { shell, world, engine } = f;
    const advance = vi.spyOn(engine, 'advance');
    const lockedBefore = world.accounts.filter((a) => a.lockedAt !== undefined).length;
    const victim = world.accounts.find((a) => a.lockedAt === undefined && a.email !== undefined)!;
    const log = engine.accessLog();
    expect(log.length).toBeGreaterThan(0);
    const seen = /^(\S+) /.exec(log.split('\n')[0]!)![1]!;

    // 1. Investigate: the log, the database, the planted upload.
    const g = await shell.run(`grep ${seen} ${ACCESS} | sort | uniq -c`);
    expect(g.exitCode).toBe(0);
    expect(g.output).toMatch(/^\s*\d+ /);
    expect(f.actsOfType('DEF-01')).toHaveLength(1);

    const s = await shell.run(`sqlite3 ${DB} "SELECT id, email FROM Users ORDER BY id LIMIT 3"`);
    expect(s.exitCode).toBe(0);
    expect(s.output.split('\n')).toHaveLength(3);
    expect(f.actsOfType('DEF-02')).toHaveLength(1);

    const c = await shell.run(`cat ${UP}/rip.php`);
    expect(c).toEqual({ output: '<?php echo 1;', exitCode: 0 });
    expect(f.actsOfType('DEF-03')).toEqual([{ type: 'DEF-03', path: `${UP}/rip.php` }]);

    // 2. Contain: block, stop nginx, lock an account, remove the file.
    expect(await shell.run(`iptables -A INPUT -s ${IP} -j DROP`)).toEqual({ output: '', exitCode: 0 });
    expect(world.firewall.blocked).toContain(IP);
    const l = await shell.run('iptables -L');
    expect(l.exitCode).toBe(0);
    expect(l.output).toContain(IP);

    expect(await shell.run('systemctl stop nginx')).toEqual({ output: '', exitCode: 0 });
    expect(world.nginx).toBe('stopped');
    expect(await shell.run('systemctl status nginx')).toEqual({ output: 'inactive (dead)', exitCode: 0 });

    const lock = await shell.run(
      `sqlite3 ${DB} "UPDATE Users SET deletedAt = datetime('now') WHERE email = '${victim.email}'"`,
    );
    expect(lock).toEqual({ output: '', exitCode: 0 });
    expect(lock.output).not.toMatch(noDate);
    expect(world.accounts.find((a) => a.email === victim.email)?.lockedAt).toBeDefined();
    expect(world.accounts.filter((a) => a.lockedAt !== undefined)).toHaveLength(lockedBefore + 1);

    expect(await shell.run(`rm ${UP}/rip.php`)).toEqual({ output: '', exitCode: 0 });
    expect(world.files.some((x) => x.path === 'rip.php')).toBe(false);
    expect((await shell.run(`ls ${UP}`)).output).not.toContain('rip.php');

    // 3. The action events, in order, one per kind per line read.
    const kinds = f.actions().map((e) => e.action.type);
    const interesting = kinds.filter((k) => ['DEF-01', 'DEF-02', 'DEF-03', 'DEF-06', 'DEF-11', 'DEF-08', 'DEF-15'].includes(k));
    expect(interesting).toEqual(['DEF-01', 'DEF-02', 'DEF-03', 'DEF-06', 'DEF-11', 'DEF-08', 'DEF-15', 'DEF-03']); // the last DEF-03 is the closing `ls` of uploads/
    expect(f.actsOfType('DEF-06')).toEqual([{ type: 'DEF-06', op: 'add', ip: IP }]);
    expect(f.actsOfType('DEF-08')).toEqual([{ type: 'DEF-08', email: victim.email }]);
    expect(f.actsOfType('DEF-15')).toEqual([{ type: 'DEF-15', path: 'rip.php' }]);

    // 4. The Shell never advanced the game and reported no internal error.
    expect(advance).not.toHaveBeenCalled();
    expect(f.internalErrors).toEqual([]);
  });
});

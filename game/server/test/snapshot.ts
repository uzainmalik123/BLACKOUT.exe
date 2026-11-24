// TEST-ONLY. A small but complete snapshot, as the browser would send it (src/kiro/snapshot.ts).
import type { KiroSnapshot } from '../../src/kiro/snapshot';

export const SNAPSHOT: KiroSnapshot = {
  difficulty: 'medium',
  clock: { gameMs: 1_800_000, shown: '30 min', wallClock: '2026-10-31 22:30:00 UTC', shiftEndsIn: '7 h 30 min', paused: false },
  souls: { total: 325, stolen: 0 },
  heartbeat: { now: 98, max: 100 },
  nginx: 'running',
  alerts: [{ id: 2, kind: 'noise', openedAt: '12 min' }, { id: 1, kind: 'attack', openedAt: '4 min', closedAt: '9 min' }],
  accounts: [{ email: 'admin@juice-sh.op', role: 'admin', locked: false }, { email: 'jim@juice-sh.op', role: 'customer', locked: false }, { email: 'reaper@example.org', role: 'admin', locked: true }],
  sessions: { total: 3, admin: 1 },
  uploads: [{ path: 'complaints/evil.zip', size: 1234, sha256: 'ab'.repeat(32) }],
  firewall: { blocked: ['203.0.113.9'] },
  waf: [{ kind: 'sqli' }],
  features: { search: true, registration: true, 'password-reset': true, uploads: true, ftp: true, 'feedback-captcha': false },
  patches: { applied: [], deploying: ['search'] },
  evidence: [{ name: 'first', takenAt: '20 min' }],
  backups: [{ id: 1, takenAt: '0 min' }],
  comms: { escalated: false, notifiedLegal: false, notifiedCustomers: false },
  logs: {
    access: [
      '203.0.113.9 - - [31/Oct/2026:22:01:00 +0000] "GET /ftp HTTP/1.1" 200 1234 "-" "Fuzz Faster U Fool"',
      '198.51.100.7 - - [31/Oct/2026:22:02:00 +0000] "POST /rest/user/login HTTP/1.1" 401 26 "-" "Mozilla/5.0"',
      '198.51.100.7 - - [31/Oct/2026:22:02:01 +0000] "POST /rest/user/login HTTP/1.1" 200 800 "-" "Mozilla/5.0"',
    ],
    app: ['info: Server listening on port 3000', 'error: SQLITE_ERROR: near "UNION": syntax error'],
    accessTotal: 3,
    appTotal: 2,
  },
  actions: [{ at: '20 min', type: 'DEF-05', what: 'evidence snapshot first', ok: true }],
};

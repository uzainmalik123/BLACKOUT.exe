// The consoles (UI-04, UI-11, D-223, D-234; PRD DEF-05..20, SYS-08): WAF, firewall, feature flags, accounts,
// sessions, deploy, backups, comms and legal, and the big red button, each its own window on the dock. Every button is
// one `engine.act` call and its answer is shown with what it did to the meters. Where the level has investigation
// buttons (Easy and Medium, SYS-08) the firewall, the snapshot and the shop's restart carry buttons too; on Hard those
// stay in the terminal, and the console says which command. During the change freeze (SYS-22) every change control
// shows locked, with the engine's reason above it; reads and the escalation stay open.

import { useContext, useEffect, useState } from 'react';
import { PATCH_BY_ID } from '../../content/patches';
import { FEATURE_DEFAULTS, FEATURES, PATCHES, type Feature, type Patch, type PlayerAction, type WafRule } from '../../rules/vocabulary';
import { DIAL } from '../shared/dial';
import type { Run } from './run';
import { Freeze, LockNote } from './Tools';
import { clockAt } from './words';

export type ConsoleId = 'waf' | 'firewall' | 'features' | 'accounts' | 'sessions' | 'deploy' | 'backups' | 'comms' | 'plug';

const FEATURE_WORDS: Record<Feature, string> = {
  search: 'Product search',
  registration: 'New registrations',
  'password-reset': 'Password reset',
  uploads: 'File uploads',
  ftp: '/ftp directory',
  'feedback-captcha': 'Feedback CAPTCHA',
};

function ruleWords(r: WafRule): string {
  switch (r.kind) {
    case 'sqli':
      return 'SQL injection rule set';
    case 'block-user-agent':
      return `block user agent "${r.pattern}"`;
    case 'block-path':
      return `block ${r.method} ${r.path}`;
    case 'rate-limit':
      return `rate-limit ${r.path}`;
  }
}

/** One console, as its own window's body (UI-11: one dock entry each, no tabs). */
export function ConsolePanel({ id, run, act, eyes }: { id: ConsoleId; run: Run; tick: number; act: (a: PlayerAction) => unknown; eyes: boolean }) {
  const easy = DIAL[run.difficulty].investigate;
  return (
    <div className="ns-consoles">
      <div className="ns-cbody">
        <LockNote />
        {id === 'waf' && <Waf run={run} act={act} />}
        {id === 'firewall' && <Firewall run={run} act={act} easy={easy} />}
        {id === 'features' && <Flags run={run} act={act} />}
        {id === 'accounts' && <Accounts run={run} act={act} eyes={eyes} />}
        {id === 'sessions' && <Sessions run={run} act={act} />}
        {id === 'deploy' && <Deploy run={run} act={act} />}
        {id === 'backups' && <Backups run={run} act={act} easy={easy} />}
        {id === 'comms' && <Comms run={run} act={act} />}
        {id === 'plug' && <Plug run={run} act={act} easy={easy} />}
      </div>
    </div>
  );
}

type P = { run: Run; act: (a: PlayerAction) => unknown };

/** True while the change freeze locks change controls (SYS-22). */
const useLocked = (): boolean => !!useContext(Freeze);

/** A button that asks once more in place ("sure?") before it acts; a modal would stop the night. Locked by the freeze. */
function Confirm({ label, onConfirm, className }: { label: string; onConfirm: () => void; className?: string }) {
  const locked = useLocked();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className ?? ''}${armed ? ' is-armed' : ''}`}
      disabled={locked}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? `${label}: sure?` : label}
    </button>
  );
}

function Field({ label, value, set, placeholder, onEnter }: { label: string; value: string; set: (v: string) => void; placeholder?: string; onEnter?: () => void }) {
  return (
    <label className="ns-field">
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') onEnter?.();
        }}
      />
    </label>
  );
}

function Waf({ run, act }: P) {
  const w = run.engine.world;
  const [ua, setUa] = useState('');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('');
  const [limit, setLimit] = useState('');
  const lk = useLocked();
  return (
    <div className="ns-cgrid">
      <div className="ns-card">
        <h4>Rule sets</h4>
        <button type="button" disabled={lk} onClick={() => act({ type: 'DEF-12', rule: { kind: 'sqli' } })}>
          Enable SQL injection rule set
        </button>
        <button type="button" data-coach="waf:login" disabled={lk} onClick={() => act({ type: 'DEF-07' })}>
          Rate-limit the login
        </button>
      </div>
      <div className="ns-card">
        <h4>Block a user agent</h4>
        <Field label="contains" value={ua} set={setUa} placeholder="e.g. a tool's name" onEnter={() => ua.trim() && act({ type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: ua.trim() } })} />
        <button type="button" disabled={lk || !ua.trim()} onClick={() => act({ type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: ua.trim() } })}>
          Block
        </button>
      </div>
      <div className="ns-card">
        <h4>Block a path</h4>
        <label className="ns-field">
          <span>method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <Field label="path" value={path} set={setPath} placeholder="/api/…" />
        <button type="button" disabled={lk || !path.trim().startsWith('/')} onClick={() => act({ type: 'DEF-12', rule: { kind: 'block-path', method, path: path.trim() } })}>
          Block path
        </button>
      </div>
      <div className="ns-card">
        <h4>Rate-limit a path</h4>
        <Field label="path" value={limit} set={setLimit} placeholder="/rest/…" />
        <button type="button" disabled={lk || !limit.trim().startsWith('/')} onClick={() => act({ type: 'DEF-12', rule: { kind: 'rate-limit', path: limit.trim() } })}>
          Rate-limit
        </button>
      </div>
      <div className="ns-card ns-wide">
        <h4>Active rules ({w.waf.length})</h4>
        {w.waf.length === 0 ? <p className="ns-quiet">None.</p> : <ul>{w.waf.map((r, i) => <li key={i}>{ruleWords(r)}</li>)}</ul>}
      </div>
    </div>
  );
}

function Firewall({ run, act, easy }: P & { easy: boolean }) {
  const w = run.engine.world;
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState('');
  const lk = useLocked();
  return (
    <div className="ns-cgrid">
      <div className="ns-card">
        <h4>Blocked addresses ({w.firewall.blocked.length})</h4>
        {w.firewall.blocked.length === 0 ? (
          <p className="ns-quiet">None.</p>
        ) : (
          <ul>
            {w.firewall.blocked.map((b) => (
              <li key={b}>
                {b}{' '}
                {easy && (
                  <button type="button" className="ns-mini" disabled={lk} onClick={() => act({ type: 'DEF-06', ip: b, op: 'delete' })}>
                    unblock
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!easy && <p className="ns-note">The firewall is managed from the terminal: iptables -A INPUT -s &lt;ip&gt; -j DROP (and -D, -L).</p>}
      </div>
      {easy && (
        <>
          <div className="ns-card">
            <h4>Address</h4>
            <Field label="ip" value={ip} set={setIp} placeholder="203.0.113.9" />
            <div className="ns-row">
              <button type="button" disabled={lk || !ip.trim()} onClick={() => act({ type: 'DEF-06', ip: ip.trim(), op: 'add' })}>
                Block
              </button>
              <button type="button" disabled={!ip.trim()} onClick={() => act({ type: 'DEF-04', ip: ip.trim(), mode: 'passive' })}>
                whois (safe)
              </button>
              <button type="button" disabled={!ip.trim()} onClick={() => act({ type: 'DEF-04', ip: ip.trim(), mode: 'active' })}>
                ping (active)
              </button>
            </div>
          </div>
          <div className="ns-card">
            <h4>Evidence and files</h4>
            <Field label="snapshot" value={name} set={setName} placeholder="before-changes" />
            <button type="button" disabled={lk || !name.trim()} onClick={() => act({ type: 'DEF-05', name: name.trim() })}>
              Snapshot the logs
            </button>
            <Field label="upload" value={file} set={setFile} placeholder="path in uploads/" />
            <button type="button" disabled={lk || !file.trim()} onClick={() => act({ type: 'DEF-15', path: file.trim() })}>
              Delete file
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Flags({ run, act }: P) {
  const w = run.engine.world;
  const lk = useLocked();
  return (
    <div className="ns-card ns-wide">
      <h4>Feature flags</h4>
      <p className="ns-note">A feature switched off closes its route, and every customer who needs it fails while it is off.</p>
      <ul className="ns-flags">
        {FEATURES.map((f) => {
          const on = w.features[f];
          const toDefault = !on === FEATURE_DEFAULTS[f];
          return (
            <li key={f}>
              <span>{FEATURE_WORDS[f]}</span>
              <button
                type="button"
                className={`ns-switch${on ? ' is-on' : ''}`} data-coach={`feature:${f}`}
                aria-pressed={on}
                disabled={lk}
                onClick={() => act(toDefault ? { type: 'DEF-18', what: f } : { type: 'DEF-10', feature: f, enabled: !on })}
              >
                {on ? 'ON' : 'OFF'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Accounts({ run, act, eyes }: P & { eyes: boolean }) {
  const w = run.engine.world;
  const [admins, setAdmins] = useState(true);
  const [q, setQ] = useState('');
  const rows = w.accounts.filter((a) => (!admins || a.role === 'admin') && (!q || a.email.toLowerCase().includes(q.toLowerCase())));
  const lk = useLocked();
  return (
    <div className="ns-card ns-wide ns-accounts">
      {eyes && <div className="ns-eyes" aria-hidden />}
      <div className="ns-row">
        <h4>Accounts ({rows.length} shown of {w.accounts.length})</h4>
        <label className="ns-follow">
          <input type="checkbox" checked={admins} onChange={(e) => setAdmins(e.target.checked)} /> admins only
        </label>
        <input className="ns-filter" placeholder="email…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Find an account" />
      </div>
      <table className="ns-table">
        <thead>
          <tr>
            <th>id</th>
            <th>email</th>
            <th>role</th>
            <th>state</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 60).map((a) => (
            <tr key={a.id} className={a.lockedAt !== undefined ? 'is-locked' : ''}>
              <td>{a.id}</td>
              <td>{a.email}</td>
              <td>{a.role}</td>
              <td>{a.lockedAt !== undefined ? 'locked' : a.passwordResetAt !== undefined ? 'reset' : 'active'}</td>
              <td className="ns-acts">
                <button type="button" className="ns-mini" disabled={lk} onClick={() => act({ type: 'DEF-08', email: a.email })}>
                  lock
                </button>
                <button type="button" className="ns-mini" disabled={lk} onClick={() => act({ type: 'DEF-16', email: a.email })}>
                  reset pw
                </button>
                <Confirm className="ns-mini is-red" label="delete" onConfirm={() => act({ type: 'DEF-14', email: a.email })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Sessions({ run, act }: P) {
  const w = run.engine.world;
  const live = w.sessions.filter((s) => s.keyVersion === w.signingKey.version);
  const admin = live.filter((s) => s.kind === 'admin').length;
  return (
    <div className="ns-card ns-wide">
      <h4>Sessions</h4>
      <p className="ns-big">
        {live.length} live · {admin} admin
      </p>
      <p className="ns-note">Signing key v{w.signingKey.version}{w.signingKey.rotatedAt !== undefined ? `, rotated at ${clockAt(w, w.signingKey.rotatedAt)}` : ''}. Revoking logs every customer out.</p>
      <Confirm className="is-red" label="Revoke all sessions + rotate the key" onConfirm={() => act({ type: 'DEF-09' })} />
    </div>
  );
}

function Deploy({ run, act }: P) {
  const w = run.engine.world;
  const [open, setOpen] = useState<Patch | null>(null);
  const entry = open ? PATCH_BY_ID[open] : null;
  const lk = useLocked();
  return (
    <div className="ns-deploy">
      <ul className="ns-patches">
        {PATCHES.map((p) => {
          const applied = w.patches.applied.includes(p);
          const pending = w.patches.pending.find((x) => x.patch === p);
          return (
            <li key={p} className={open === p ? 'is-on' : ''}>
              <button type="button" data-coach={`patch:${p}`} onClick={() => setOpen(open === p ? null : p)}>
                {PATCH_BY_ID[p].title}
              </button>
              <span className={applied ? 'is-ok' : pending ? 'is-wait' : ''}>{applied ? 'live' : pending ? `deploying, ready ${clockAt(w, pending.readyAt)}` : 'not deployed'}</span>
            </li>
          );
        })}
      </ul>
      {entry && (
        <div className="ns-diff">
          <p>
            <b>{entry.file}</b> lines {entry.lines[0]}–{entry.lines[1]}. {entry.why}
          </p>
          <pre>{entry.diff}</pre>
          <button type="button" data-coach={`deploy:${entry.patch}`} disabled={lk} onClick={() => act({ type: 'DEF-13', patch: entry.patch })}>
            Deploy this patch
          </button>
        </div>
      )}
    </div>
  );
}

function Backups({ run, act, easy }: P & { easy: boolean }) {
  const w = run.engine.world;
  return (
    <div className="ns-cgrid">
      <div className="ns-card">
        <h4>Backups ({w.backups.length})</h4>
        <ul>
          {[...w.backups].reverse().map((b) => (
            <li key={b.id}>
              #{b.id} taken {clockAt(w, b.takenAt)}{' '}
              <Confirm className="ns-mini" label="restore" onConfirm={() => act({ type: 'DEF-17', backupId: b.id })} />
            </li>
          ))}
        </ul>
      </div>
      <div className="ns-card">
        <h4>Evidence ({w.evidence.length})</h4>
        {w.evidence.length === 0 ? (
          <p className="ns-quiet">No snapshot taken.</p>
        ) : (
          <ul>
            {w.evidence.map((e) => (
              <li key={e.name}>
                {e.name} · {clockAt(w, e.takenAt)} · {e.accessLines} access lines
              </li>
            ))}
          </ul>
        )}
        {!easy && <p className="ns-note">Snapshots are taken from the terminal: tar czf /evidence/&lt;name&gt;.tgz /var/log …</p>}
      </div>
    </div>
  );
}

function Comms({ run, act }: P) {
  const w = run.engine.world;
  const clock = run.engine.notificationClock();
  const lk = useLocked();
  return (
    <div className="ns-cgrid">
      <div className="ns-card">
        <h4>Incident lead</h4>
        <p className="ns-note">{w.comms.escalatedAt !== undefined ? `Escalated at ${clockAt(w, w.comms.escalatedAt)}.` : 'Not escalated yet.'}</p>
        <button type="button" onClick={() => act({ type: 'DEF-19' })}>
          Escalate to the incident lead
        </button>
      </div>
      <div className="ns-card">
        <h4>Notification clock</h4>
        <p className={`ns-big is-${clock.state}`}>{clock.label}</p>
        <p className="ns-note">{clock.state === 'idle' ? 'Starts when a breach is confirmed.' : clock.state === 'notified' ? 'Legal notified.' : clock.state === 'overdue' ? 'Overdue.' : 'Running.'}</p>
        <div className="ns-row">
          <button type="button" disabled={lk} onClick={() => act({ type: 'DEF-20', to: 'legal' })}>
            Notify legal
          </button>
          <button type="button" disabled={lk} onClick={() => act({ type: 'DEF-20', to: 'customers' })}>
            Notify customers
          </button>
        </div>
      </div>
      <div className="ns-card ns-wide">
        <h4>Support tickets ({w.tickets.length})</h4>
        {w.tickets.length === 0 ? (
          <p className="ns-quiet">None.</p>
        ) : (
          <ul className="ns-tickets">
            {w.tickets.slice(-8).reverse().map((t) => (
              <li key={t.id}>
                <time>{clockAt(w, t.t)}</time> {t.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Plug({ run, act, easy }: P & { easy: boolean }) {
  const w = run.engine.world;
  const down = w.nginx === 'stopped';
  return (
    <div className="ns-card ns-wide ns-plug">
      <p className="ns-note">Pulling the plug stops the web server: everything stops, him and every customer. The heartbeat drains fast while it is down. Escalate first.</p>
      {down ? (
        <button type="button" className="ns-redbutton" disabled>
          SHOP OFFLINE
        </button>
      ) : (
        <Confirm className="ns-redbutton" label="PULL THE PLUG" onConfirm={() => act({ type: 'DEF-11' })} />
      )}
      {down && (easy ? (
        <button type="button" onClick={() => act({ type: 'DEF-18', what: 'nginx' })}>
          Bring the shop back
        </button>
      ) : (
        <p className="ns-note">Bring it back from the terminal: systemctl start nginx</p>
      ))}
    </div>
  );
}

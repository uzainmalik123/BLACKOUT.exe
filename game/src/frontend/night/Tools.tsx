// The dock's own tools (UI-11, D-234, D-240): the alerts, the traffic (top talkers and the error-rate strip, UI-09),
// address flags (DEF-21), the uploads list (Easy and Medium), the cheat sheet, and the freeze's lock note. Everything
// is read from the engine; every button is one `engine.act`, the same action the terminal's command would send.

import { createContext, useContext, useState } from 'react';
import type { PlayerAction } from '../../rules/vocabulary';
import { COMMAND_NAMES, COMMANDS } from '../../shell/registry';
import { DIAL } from '../shared/dial';
import type { Run } from './run';
import { clockAt, gateSentence } from './words';

/** The change freeze's reason while it holds (SYS-22), else null: change controls read it and show locked. */
export const Freeze = createContext<string | null>(null);

/** A change control's lock: the engine's own refusal, as text, above the controls it locks (never hidden). */
export function LockNote() {
  const reason = useContext(Freeze);
  if (!reason) return null;
  return (
    <p className="ns-lock" role="note">
      <span aria-hidden>🔒</span> Locked. {reason}
    </p>
  );
}

/** What an action answered, for buttons that show a refusal in place (the freeze, a flag's cooldown). */
export type Act = (a: PlayerAction) => { ok: boolean; message: string };

// ------------------------------------------------------------------ alerts

export function AlertsTool({ run, easy }: { run: Run; tick: number; easy: boolean }) {
  const w = run.engine.world;
  const open = w.alerts.filter((a) => a.closedAt === undefined).reverse();
  const closed = w.alerts.filter((a) => a.closedAt !== undefined).slice(-6).reverse();
  return (
    <div className="ns-cbody">
      {open.length === 0 && <p className="ns-quiet">No open alerts.</p>}
      <ul className="ns-alertlist">
        {open.map((a) => (
          <li key={a.id} className="is-open">
            <time>{clockAt(w, a.openedAt)}</time>
            <code>{a.route}</code>
            <span>{a.symptom}</span>
            {easy && <em>{gateSentence(a.gate)}</em>}
          </li>
        ))}
        {closed.map((a) => (
          <li key={a.id} className="is-closed">
            <time>{clockAt(w, a.openedAt)}</time>
            <code>{a.route}</code>
            <span>{a.symptom}</span>
            <small>closed {clockAt(w, a.closedAt!)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ block and flag on a row

/** "block" and "flag" beside an address (Easy and Medium): the same DEF-06 and DEF-21 the terminal sends. */
export function RowActions({ run, ip, act }: { run: Run; ip: string; act: Act }) {
  const reason = useContext(Freeze);
  const w = run.engine.world;
  const flag = w.flags.find((f) => f.ip === ip);
  const blocked = w.firewall.blocked.includes(ip);
  const [said, setSaid] = useState<string | null>(null);
  const tell = (r: { ok: boolean; message: string }) => setSaid(r.ok ? null : r.message);
  return (
    <span className="ns-rowacts" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="ns-mini" disabled={!!reason || blocked} title={reason ?? (blocked ? 'Blocked' : `iptables -A INPUT -s ${ip} -j DROP`)} onClick={() => tell(act({ type: 'DEF-06', ip, op: 'add' }))}>
        {reason ? '🔒 block' : blocked ? 'blocked' : 'block'}
      </button>
      {flag ? (
        <span className={`ns-flagstate${flag.confirmedAt !== undefined ? ' is-confirmed' : ''}`}>{flag.confirmedAt !== undefined ? 'confirmed' : 'flagged'}</span>
      ) : (
        <button type="button" className="ns-mini" title={`flag ${ip}`} onClick={() => tell(act({ type: 'DEF-21', ip }))}>
          flag
        </button>
      )}
      {said && <span className="ns-refused">{said}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ traffic: the detection tools (UI-09)

export function TrafficTool({ run, act }: { run: Run; tick: number; act: Act }) {
  const rows = DIAL[run.difficulty].rowActions;
  const talkers = run.engine.topTalkers(8);
  const rate = run.engine.errorRate().slice(-10);
  const peak = Math.max(1, ...rate.map((r) => r.requests));
  return (
    <div className="ns-cbody ns-traffic is-window">
      <table className="ns-talkers">
        <caption>Top talkers · last minute</caption>
        <thead>
          <tr>
            <th>address</th>
            <th>req</th>
            <th>err</th>
            {rows && <th />}
          </tr>
        </thead>
        <tbody>
          {talkers.map((t) => (
            <tr key={t.ip}>
              <td>{t.ip}</td>
              <td>{t.requests}</td>
              <td className={t.errors > t.requests / 2 ? 'is-bad' : ''}>{t.errors}</td>
              {rows && (
                <td>
                  <RowActions run={run} ip={t.ip} act={act} />
                </td>
              )}
            </tr>
          ))}
          {talkers.length === 0 && (
            <tr>
              <td colSpan={rows ? 4 : 3} className="ns-quiet">
                no traffic
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <figure className="ns-rate" aria-label="Requests and errors per minute">
        <figcaption>Requests per minute · 4xx · 5xx</figcaption>
        <svg viewBox={`0 0 ${Math.max(1, rate.length) * 12} 60`} preserveAspectRatio="none">
          {rate.map((r, i) => {
            const hReq = (r.requests / peak) * 56;
            const h4 = (r.clientErrors / peak) * 56;
            const h5 = (r.serverErrors / peak) * 56;
            return (
              <g key={r.minute}>
                <rect x={i * 12 + 1} y={60 - hReq} width={10} height={hReq} className="r-all" />
                <rect x={i * 12 + 1} y={60 - h4 - h5} width={10} height={h4} className="r-4xx" />
                <rect x={i * 12 + 1} y={60 - h5} width={10} height={h5} className="r-5xx" />
              </g>
            );
          })}
        </svg>
        <div className="ns-rate-now">
          {rate.length ? `${rate[rate.length - 1]!.requests} req · ${rate[rate.length - 1]!.clientErrors} 4xx · ${rate[rate.length - 1]!.serverErrors} 5xx this minute` : '—'}
        </div>
      </figure>
    </div>
  );
}

// ------------------------------------------------------------------ address flags (DEF-21)

export function AddressFlags({ run, act }: { run: Run; tick: number; act: Act }) {
  const w = run.engine.world;
  const [ip, setIp] = useState('');
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const send = () => {
    const v = ip.trim();
    if (!v) return;
    const r = act({ type: 'DEF-21', ip: v });
    setSaid({ ok: r.ok, text: r.message });
    if (r.ok) setIp('');
  };
  return (
    <div className="ns-cbody">
      <div className="ns-card ns-wide">
        <h4>Flag an address</h4>
        <p className="ns-note">A flag is a suspicion. It is confirmed when that address sends something hostile again. Flagging is allowed during the change freeze.</p>
        <div className="ns-row">
          <input
            className="ns-filter"
            value={ip}
            placeholder="203.0.113.9"
            spellCheck={false}
            aria-label="Address to flag"
            onChange={(e) => setIp(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') send();
            }}
          />
          <button type="button" disabled={!ip.trim()} onClick={send}>
            Flag
          </button>
        </div>
        {said && <p className={said.ok ? 'ns-note' : 'ns-refused'}>{said.text}</p>}
      </div>
      <div className="ns-card ns-wide">
        <h4>Flagged ({w.flags.length})</h4>
        {w.flags.length === 0 ? (
          <p className="ns-quiet">None.</p>
        ) : (
          <table className="ns-table">
            <tbody>
              {[...w.flags].reverse().map((f) => (
                <tr key={f.ip}>
                  <td>{f.ip}</td>
                  <td>{clockAt(w, f.at)}</td>
                  <td>
                    <span className={`ns-flagstate${f.confirmedAt !== undefined ? ' is-confirmed' : ''}`}>{f.confirmedAt !== undefined ? `confirmed ${clockAt(w, f.confirmedAt)}` : 'flagged'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ uploads (Easy and Medium)

export function UploadsTool({ run, act }: { run: Run; tick: number; act: Act }) {
  const reason = useContext(Freeze);
  const w = run.engine.world;
  return (
    <div className="ns-cbody">
      <LockNote />
      <div className="ns-card ns-wide">
        <h4>uploads/ ({w.files.length})</h4>
        {w.files.length === 0 ? (
          <p className="ns-quiet">Empty.</p>
        ) : (
          <table className="ns-table">
            <tbody>
              {w.files.map((f) => (
                <tr key={f.path}>
                  <td>{f.path}</td>
                  <td>{f.size} B</td>
                  <td>
                    <button type="button" className="ns-mini is-red" disabled={!!reason} title={reason ?? `rm /srv/juice-shop/uploads/${f.path}`} onClick={() => act({ type: 'DEF-15', path: f.path })}>
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the cheat sheet

/** Every shell command with its summary, usage and one real example, from the shell's own registry (never typed here). */
export function cheatRows(): Array<{ name: string; summary: string; usage: string; example: string }> {
  return COMMAND_NAMES.map((name) => {
    const c = COMMANDS[name];
    // the first example that runs this command (wc's first example is a grep -c, KI-241)
    const runs = new RegExp(`(^|\\|\\s*)${name}(\\s|$)`);
    return { name, summary: c.summary, usage: c.usage, example: c.examples.find((e) => runs.test(e)) ?? c.examples[0] ?? c.usage };
  });
}

export function CheatSheet() {
  const [q, setQ] = useState('');
  const f = q.trim().toLowerCase();
  const rows = cheatRows().filter((r) => !f || `${r.name} ${r.summary}`.toLowerCase().includes(f));
  return (
    <div className="ns-cbody">
      <input className="ns-filter ns-cheat-find" placeholder="find a command…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Find a command" />
      <dl className="ns-cheats">
        {rows.map((r) => (
          <div key={r.name}>
            <dt>
              <b>{r.name}</b> {r.summary}
            </dt>
            <dd>
              <code>{r.usage}</code>
              <code className="is-example">$ {r.example}</code>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

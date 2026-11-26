// The desk's shared parts (UI-04, UI-09, UI-11, D-223, D-240): the meters' readings and what an action did to them,
// the incident feed, and the logs window (filterable, coloured by status class). The desk's three monitors and its
// Tools view gave way to the dock and its floating windows (D-234); the consoles are in Consoles.tsx, the terminal is
// the play screen's. Every number is read from the engine; every change goes through `engine.act` or `shell.run`.

import { useEffect, useMemo, useRef, useState } from 'react';
import { explainLine } from '../../content/explanations';
import { statusClass, type StatusClass } from '../../engine/detection';
import { renderCombined } from '../../engine/replay';
import type { AccessLine } from '../../engine/state';
import { SHOWN_LINES_MAX } from '../../rules/vocabulary';
import { DIAL } from '../shared/dial';
import type { Run } from './run';
import { RowActions, type Act } from './Tools';
import { eventWords, clockAt } from './words';

export interface Meters {
  souls: number;
  total: number;
  heartbeat: number;
  max: number;
}

export const metersOf = (run: Run): Meters => {
  const w = run.engine.world;
  return { souls: w.souls.total - w.souls.stolen.length, total: w.souls.total, heartbeat: Math.round(w.heartbeat), max: Math.round(w.heartbeatMax) };
};

export interface Toast {
  id: number;
  ok: boolean;
  text: string;
  delta: string;
}

/** What an action did to the meters, in words ("🫀 −3 · 💀 −2"), or '' when nothing moved. */
export function deltaWords(a: Meters, b: Meters): string {
  const parts: string[] = [];
  if (b.heartbeat !== a.heartbeat) parts.push(`🫀 ${b.heartbeat > a.heartbeat ? '+' : '−'}${Math.abs(b.heartbeat - a.heartbeat)}`);
  if (b.max !== a.max) parts.push(`max ${b.max}`);
  if (b.souls !== a.souls) parts.push(`💀 −${a.souls - b.souls}`);
  return parts.join(' · ');
}

/** The incident feed: the last few things the player could have noticed (shown under the alerts window). */
export function Feed({ run }: { run: Run; tick: number }) {
  const w = run.engine.world;
  const lines: Array<{ id: number; t: number; text: string; tone: string }> = [];
  for (let i = w.events.length - 1; i >= 0 && lines.length < 4; i--) {
    const e = w.events[i]!;
    const words = eventWords(e);
    if (words) lines.push({ id: e.id, t: e.t, ...words });
  }
  return (
    <ol className="ns-feed" aria-label="Incident feed">
      {lines.map((l) => (
        <li key={l.id} className={`is-${l.tone}`}>
          <time>{clockAt(w, l.t)}</time> {l.text}
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------------ the logs window

const LOG_LINES = 120;
const SCAN_LINES = 3000;

/** The access log's click filters (Easy and Medium, SYS-08): an address, a status class, a path fragment. */
export interface LogFilter {
  ip: string;
  status: StatusClass | '';
  path: string;
}

export const NO_FILTER: LogFilter = { ip: '', status: '', path: '' };

/** Whether an access line passes the click filters; an empty field passes everything. */
export function passes(l: Pick<AccessLine, 'ip' | 'status' | 'target'>, f: LogFilter): boolean {
  if (f.ip && l.ip !== f.ip.trim()) return false;
  if (f.status && statusClass(l.status) !== f.status) return false;
  if (f.path && !l.target.toLowerCase().includes(f.path.trim().toLowerCase())) return false;
  return true;
}

/** The filters as the DEF-01 query they amount to (the same search the terminal's grep would log). */
export function filterWords(f: LogFilter, text: string): string {
  return [f.ip && `ip ${f.ip.trim()}`, f.status && `status ${f.status}`, f.path && `path ${f.path.trim()}`, text.trim()].filter(Boolean).join(', ');
}

export function Logs({ run, tick, act, explain }: { run: Run; tick: number; act: Act; explain: (line: string) => void }) {
  const dial = DIAL[run.difficulty];
  const [tab, setTab] = useState<'access' | 'app'>('access');
  const [filter, setFilter] = useState('');
  const [by, setBy] = useState<LogFilter>(NO_FILTER);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const w = run.engine.world;
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out: Array<{ key: number; text: string; cls: string; ip?: string }> = [];
    if (tab === 'access') {
      const src = w.logs.access;
      for (let i = src.length - 1; i >= Math.max(0, src.length - SCAN_LINES) && out.length < LOG_LINES; i--) {
        const l = src[i]!;
        if (!passes(l, by)) continue;
        const text = renderCombined(w, l);
        if (f && !text.toLowerCase().includes(f)) continue;
        out.push({ key: i, text, cls: `s${statusClass(l.status)}`, ip: l.ip });
      }
    } else {
      const src = w.logs.app;
      for (let i = src.length - 1; i >= Math.max(0, src.length - SCAN_LINES) && out.length < LOG_LINES; i--) {
        const text = src[i]!.text;
        if (f && !text.toLowerCase().includes(f)) continue;
        out.push({ key: i, text, cls: /error|fail|denied|exception/i.test(text) ? 's5xx' : 's2xx' });
      }
    }
    return out.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, tab, filter, by]);
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [rows, follow]);
  const search = () => {
    const q = filterWords(tab === 'access' ? by : NO_FILTER, filter);
    if (!q) return;
    const shown = rows.map((r) => r.text);
    act({ type: 'DEF-01', query: `${tab} log: ${q}`, shown: shown.slice(-SHOWN_LINES_MAX), shownTotal: shown.length });
  };
  const field = (k: 'ip' | 'path', placeholder: string) => (
    <input
      className="ns-filter"
      placeholder={placeholder}
      value={by[k]}
      spellCheck={false}
      onChange={(e) => setBy({ ...by, [k]: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') search();
        e.stopPropagation();
      }}
      aria-label={`Filter by ${k === 'ip' ? 'address' : 'path'}`}
    />
  );
  return (
    <div className="ns-logs">
      <div className="ns-tabs" role="tablist">
        {(['access', 'app'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
            {t === 'access' ? 'access.log' : 'app.log'}
          </button>
        ))}
        <input
          className="ns-filter"
          placeholder="filter… (Enter to search)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') search();
            e.stopPropagation();
          }}
          aria-label="Filter the log"
        />
        <label className="ns-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow
        </label>
      </div>
      {dial.investigate && tab === 'access' && (
        <div className="ns-tabs ns-logfilters">
          {field('ip', 'address')}
          <select className="ns-filter" value={by.status} onChange={(e) => setBy({ ...by, status: e.target.value as LogFilter['status'] })} aria-label="Filter by status">
            <option value="">any status</option>
            {(['2xx', '3xx', '4xx', '5xx'] as const).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {field('path', 'path')}
          <button type="button" onClick={search}>
            Search
          </button>
          {(by.ip || by.status || by.path) && (
            <button type="button" onClick={() => setBy(NO_FILTER)}>
              clear
            </button>
          )}
        </div>
      )}
      <div className="ns-loglines is-window" ref={box} onWheel={() => setFollow(false)}>
        {rows.map((r) => (
          <div key={r.key} className={`ns-logline ${r.cls}`} title={dial.explainOnHover ? explainLine(r.text).text : 'Ask Kiro to explain this line'} onClick={() => explain(r.text)}>
            {dial.rowActions && r.ip && (
              <>
                <RowActions run={run} ip={r.ip} act={act} />{' '}
              </>
            )}
            {dial.investigate && r.ip ? (
              <button type="button" className="ns-ipbtn" title={`Show only ${r.ip}`} onClick={(e) => (e.stopPropagation(), setBy({ ...by, ip: r.ip! }))}>
                {r.ip}
              </button>
            ) : null}
            {dial.investigate && r.ip ? r.text.slice(r.ip.length) : r.text}
          </div>
        ))}
        {rows.length === 0 && <div className="ns-quiet">{filter || by.ip || by.status || by.path ? 'Nothing matches.' : 'Quiet.'}</div>}
      </div>
    </div>
  );
}


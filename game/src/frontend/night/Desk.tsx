// The SOC dashboard on the office's monitors (UI-04, UI-09, D-223). Left: the logs (filterable, coloured by status
// class), the top talkers and the error-rate strip. Centre: the open alerts and the terminal, the existing shell.
// Right: the consoles. On the desk below: the souls and heartbeat meters, the game clock, the shift's end, the
// incident feed, Kiro, the briefing files and the sound. Every number is read from the engine; every change goes
// through `engine.act` or `shell.run`, and its answer is shown with what it did to the meters.

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { gameClockLabel } from '../../engine/clock';
import { statusClass } from '../../engine/detection';
import { renderCombined } from '../../engine/replay';
import type { PlayerAction } from '../../rules/vocabulary';
import { SHOWN_LINES_MAX } from '../../rules/vocabulary';
import { Consoles } from './Consoles';
import type { MonitorName } from './haunt';
import { KiroPanel, type KiroLine } from './KiroPanel';
import type { Run } from './run';
import { alertWords, eventWords, shiftLeft, clockAt } from './words';

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

export interface DeskProps {
  run: Run;
  tick: number;
  focus: MonitorName | null;
  setFocus: (m: MonitorName | null) => void;
  monitorRefs: Record<MonitorName, RefObject<HTMLDivElement | null>>;
  /** 0..1 the monitors coming on (the sit-down fade). */
  on: number;
  alarm: boolean;
  danger: 0 | 1 | 2 | 3;
  paused: boolean;
  onPause: () => void;
  onResult: (ok: boolean, text: string, before: Meters) => void;
  toasts: Toast[];
  kiroLines: KiroLine[];
  addKiro: (l: Omit<KiroLine, 'id'>) => void;
  kiroOpen: boolean;
  setKiroOpen: (o: boolean) => void;
  onFiles: () => void;
  volume: number;
  setVolume: (v: number) => void;
  muted: boolean;
  setMuted: (m: boolean) => void;
  /** Death's eyes in the accounts console (stage 3). */
  eyesInAccounts: boolean;
}

export function Desk(p: DeskProps) {
  const { run } = p;
  const w = run.engine.world;
  const easy = run.difficulty === 'easy';
  const [cmd, setCmd] = useState('');
  const termInput = useRef<HTMLInputElement>(null);
  const insert = (text: string) => {
    setCmd((c) => (c && !c.endsWith(' ') ? `${c} ${text}` : c + text));
    termInput.current?.focus();
  };
  const act = (action: PlayerAction) => {
    const before = metersOf(run);
    const r = run.engine.act(action);
    p.onResult(r.ok, r.message, before);
    return r;
  };
  const meters = metersOf(run);
  const open = w.alerts.filter((a) => a.closedAt === undefined);
  const monitor = (name: MonitorName, title: string, children: ReactNode, extra?: string) => (
    <section
      ref={p.monitorRefs[name] as RefObject<HTMLDivElement>}
      className={`ns-mon ns-mon-${name}${p.focus === name ? ' is-focus' : ''}${p.focus && p.focus !== name ? ' is-back' : ''}${p.alarm ? ' is-alarm' : ''}${extra ? ` ${extra}` : ''}`}
      style={{ opacity: p.on }}
      aria-label={title}
    >
      <header className="ns-mon-bar">
        <span className="ns-mon-title">{title}</span>
        <button type="button" className="ns-mon-zoom" onClick={() => p.setFocus(p.focus === name ? null : name)} aria-label={p.focus === name ? `Return ${title} to the desk` : `Enlarge ${title}`}>
          {p.focus === name ? 'Esc ↩' : '⤢'}
        </button>
      </header>
      <div className="ns-screen">{children}</div>
      {p.focus !== name && name !== 'centre' && (
        <button type="button" className="ns-mon-catch" onClick={() => p.setFocus(name)} aria-label={`Use ${title}`}>
          <span>Click to use</span>
        </button>
      )}
    </section>
  );

  return (
    <div className={`ns-desk danger-${p.danger}`}>
      {monitor('left', 'Logs · traffic', <Logs run={run} tick={p.tick} act={act} insert={insert} explain={(line) => explainLine(run, line, p.addKiro, p.setKiroOpen)} focused={p.focus === 'left'} />)}
      {monitor(
        'centre',
        'Terminal · alerts',
        <>
          <div className={`ns-alerts${open.length ? ' has-open' : ''}`}>
            {open.length === 0 ? (
              <span className="ns-quiet">No open alerts</span>
            ) : (
              open.slice(-4).map((a) => (
                <span key={a.id} className="ns-alert">
                  ⚠ #{a.id} {alertWords(a.about)} · {clockAt(w, a.openedAt)}
                </span>
              ))
            )}
          </div>
          <Terminal run={run} cmd={cmd} setCmd={setCmd} inputRef={termInput} onResult={p.onResult} />
        </>,
      )}
      {monitor('right', 'Consoles', <Consoles run={run} tick={p.tick} act={act} eyes={p.eyesInAccounts} />)}

      <footer className="ns-hud" style={{ opacity: p.on }}>
        <Meter kind="souls" label="Souls" value={meters.souls} of={meters.total} />
        <Meter kind="heart" label="Heartbeat" value={meters.heartbeat} of={100} max={meters.max} />
        <div className="ns-clock">
          <span className="ns-clock-time">{gameClockLabel(w)}</span>
          <span className="ns-clock-sub">shift ends in {shiftLeft(w)}</span>
          <span className={`ns-nginx is-${w.nginx}`}>shop {w.nginx === 'running' ? 'online' : 'OFFLINE'}</span>
        </div>
        <Feed run={run} />
        <div className="ns-hud-buttons">
          <button type="button" className={`ns-kiro-btn${p.kiroOpen ? ' is-open' : ''}`} onClick={() => p.setKiroOpen(!p.kiroOpen)}>
            ☾ Kiro
          </button>
          <button type="button" onClick={p.onFiles}>
            Briefing files
          </button>
          {easy && (
            <button type="button" onClick={p.onPause} aria-pressed={p.paused}>
              {p.paused ? 'Resume' : 'Pause'}
            </button>
          )}
          <label className="ns-vol" title="Sound volume">
            <span aria-hidden>{p.muted ? '🔇' : '🔊'}</span>
            <input type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => p.setVolume(Number(e.target.value))} aria-label="Sound volume" />
          </label>
          <button type="button" onClick={() => p.setMuted(!p.muted)} aria-pressed={p.muted}>
            {p.muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      </footer>

      <div className="ns-toasts" aria-live="polite">
        {p.toasts.map((t) => (
          <div key={t.id} className={`ns-toast ${t.ok ? 'is-ok' : 'is-no'}`}>
            <span>{t.text}</span>
            {t.delta && <b>{t.delta}</b>}
          </div>
        ))}
      </div>

      {p.kiroOpen && <KiroPanel run={run} lines={p.kiroLines} add={p.addKiro} insert={insert} onClose={() => p.setKiroOpen(false)} />}
    </div>
  );
}

function explainLine(run: Run, line: string, add: DeskProps['addKiro'], setOpen: (o: boolean) => void): void {
  setOpen(true);
  add({ who: 'you', text: `Explain: ${line}` });
  void run.kiro.explain(line).then((r) => add({ who: 'kiro', text: r.text, offline: r.offline }));
}

// ------------------------------------------------------------------ meters

function Meter({ kind, label, value, of, max }: { kind: 'souls' | 'heart'; label: string; value: number; of: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / of) * 100));
  const dead = max !== undefined ? 100 - max : 0;
  const low = pct < 35;
  return (
    <div className={`ns-meter ns-meter-${kind}${low ? ' is-low' : ''}`} role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={of}>
      <div className="ns-meter-head">
        <span>{kind === 'souls' ? '💀' : '🫀'} {label}</span>
        <b>
          {value}
          <small>/{of}</small>
        </b>
      </div>
      <div className="ns-meter-bar">
        <i style={{ width: `${pct}%` }} />
        {dead > 0 && <s style={{ width: `${dead}%` }} title={`Customers lost: the heartbeat can reach ${max} at most`} />}
      </div>
      {kind === 'heart' && <Ecg rate={value} />}
    </div>
  );
}

/** A little ECG trace whose beat quickens as the heartbeat falls, and flattens at zero. */
function Ecg({ rate }: { rate: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    let raf = 0;
    let x = 0;
    let last = performance.now();
    let phase = 0;
    const W = (c.width = 220);
    const H = (c.height = 34);
    g.fillStyle = '#05080a';
    g.fillRect(0, 0, W, H);
    let prevY = H / 2;
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const r = rateRef.current;
      const bpm = r <= 0 ? 0 : 60 + 90 * (1 - r / 100);
      phase += (dt * bpm) / 60;
      x = (x + dt * 70) % W;
      const ph = phase % 1;
      let y = H / 2;
      if (bpm > 0) {
        if (ph < 0.04) y = H / 2 - ph * 25 * H * 0.4;
        else if (ph < 0.07) y = H / 2 + H * 0.35;
        else if (ph < 0.1) y = H / 2 - H * 0.08;
      }
      g.fillStyle = 'rgba(5, 8, 10, 0.9)';
      g.fillRect(x, 0, 8, H);
      g.strokeStyle = r < 35 ? '#ff2a4a' : '#3ddc97';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x - 1.2, prevY);
      g.lineTo(x, y);
      g.stroke();
      prevY = y;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="ns-ecg" aria-hidden />;
}

function Feed({ run }: { run: Run }) {
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

// ------------------------------------------------------------------ the left monitor: logs and traffic

const LOG_LINES = 120;
const SCAN_LINES = 3000;

function Logs({ run, tick, act, insert, explain, focused }: { run: Run; tick: number; act: (a: PlayerAction) => unknown; insert: (t: string) => void; explain: (line: string) => void; focused: boolean }) {
  const [tab, setTab] = useState<'access' | 'app'>('access');
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const w = run.engine.world;
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out: Array<{ key: number; text: string; cls: string }> = [];
    if (tab === 'access') {
      const src = w.logs.access;
      for (let i = src.length - 1; i >= Math.max(0, src.length - SCAN_LINES) && out.length < LOG_LINES; i--) {
        const l = src[i]!;
        const text = renderCombined(w, l);
        if (f && !text.toLowerCase().includes(f)) continue;
        out.push({ key: i, text, cls: `s${statusClass(l.status)}` });
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
  }, [tick, tab, filter]);
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [rows, follow]);
  const talkers = run.engine.topTalkers(6);
  const rate = run.engine.errorRate().slice(-10);
  const peak = Math.max(1, ...rate.map((r) => r.requests));
  const search = () => {
    const q = filter.trim();
    if (!q) return;
    const shown = rows.map((r) => r.text);
    act({ type: 'DEF-01', query: `${tab} log: ${q}`, shown: shown.slice(-SHOWN_LINES_MAX), shownTotal: shown.length });
  };
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
      <div className="ns-loglines" ref={box} onWheel={() => setFollow(false)}>
        {rows.map((r) => (
          <div key={r.key} className={`ns-logline ${r.cls}`} title={focused ? 'Ask Kiro to explain this line' : undefined} onClick={() => focused && explain(r.text)}>
            {r.text}
          </div>
        ))}
        {rows.length === 0 && <div className="ns-quiet">{filter ? 'Nothing matches.' : 'Quiet.'}</div>}
      </div>
      <div className="ns-traffic">
        <table className="ns-talkers">
          <caption>Top talkers · last minute</caption>
          <thead>
            <tr>
              <th>address</th>
              <th>req</th>
              <th>err</th>
            </tr>
          </thead>
          <tbody>
            {talkers.map((t) => (
              <tr key={t.ip} onClick={() => insert(t.ip)} title="Put this address in the terminal">
                <td>{t.ip}</td>
                <td>{t.requests}</td>
                <td className={t.errors > t.requests / 2 ? 'is-bad' : ''}>{t.errors}</td>
              </tr>
            ))}
            {talkers.length === 0 && (
              <tr>
                <td colSpan={3} className="ns-quiet">
                  no traffic
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <figure className="ns-rate" aria-label="Requests and errors per minute">
          <figcaption>Requests per minute · 4xx · 5xx</figcaption>
          <svg viewBox={`0 0 ${rate.length * 12} 60`} preserveAspectRatio="none">
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
    </div>
  );
}

// ------------------------------------------------------------------ the centre monitor: the terminal

interface Entry {
  id: number;
  cmd: string;
  out: string;
  code: number;
}

const PROMPT = 'operator@blackout:~$';

function Terminal({ run, cmd, setCmd, inputRef, onResult }: { run: Run; cmd: string; setCmd: (s: string) => void; inputRef: RefObject<HTMLInputElement | null>; onResult: DeskProps['onResult'] }) {
  const [log, setLog] = useState<Entry[]>(() => [
    { id: 0, cmd: '', out: 'BLACKOUT.exe — SECURITY OPERATIONS\nSHIFT: NIGHT\nSTATUS: MONITORING\n\nType `help` for the commands this workstation allows.', code: 0 },
  ]);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const id = useRef(1);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [log, busy]);
  const submit = async () => {
    const line = cmd.trim();
    if (!line || busy) return;
    setCmd('');
    setHist((h) => [...h.slice(-49), line]);
    setHi(-1);
    setBusy(true);
    const before = metersOf(run);
    const actions = run.engine.world.events.length;
    try {
      const r = await run.shell.run(line);
      if (r.clear) setLog([]);
      else setLog((l) => [...l.slice(-60), { id: id.current++, cmd: line, out: r.output, code: r.exitCode ?? 0 }]);
      // a command that was an engine action gets its answer on the desk too
      const evs = run.engine.world.events.slice(actions).filter((e) => e.kind === 'action');
      const last = evs[evs.length - 1];
      if (last && last.kind === 'action' && last.action.type !== 'DEF-01' && last.action.type !== 'DEF-02' && last.action.type !== 'DEF-03') {
        onResult(last.ok, line, before);
      }
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };
  return (
    <div className="ns-term" onClick={() => inputRef.current?.focus()}>
      <div className="ns-term-out" ref={box}>
        {log.map((e) => (
          <div key={e.id} className="ns-term-entry">
            {e.cmd && (
              <div className="ns-term-cmd">
                <span>{PROMPT}</span> {e.cmd}
              </div>
            )}
            {e.out && <pre className={e.code ? 'is-err' : ''}>{e.out}</pre>}
          </div>
        ))}
        {busy && <div className="ns-quiet">…</div>}
      </div>
      <div className="ns-term-in">
        <span>{PROMPT}</span>
        <input
          ref={inputRef}
          value={cmd}
          spellCheck={false}
          autoComplete="off"
          aria-label="Terminal command"
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') void submit();
            else if (e.key === 'ArrowUp' && hist.length) {
              e.preventDefault();
              const n = hi < 0 ? hist.length - 1 : Math.max(0, hi - 1);
              setHi(n);
              setCmd(hist[n]!);
            } else if (e.key === 'ArrowDown' && hi >= 0) {
              e.preventDefault();
              const n = hi + 1;
              if (n >= hist.length) {
                setHi(-1);
                setCmd('');
              } else {
                setHi(n);
                setCmd(hist[n]!);
              }
            } else if (e.key === 'Tab') {
              e.preventDefault();
              const options = run.shell.complete?.(cmd) ?? [];
              // the candidates complete the last word
              if (options.length === 1) setCmd(cmd.slice(0, cmd.lastIndexOf(' ') + 1) + options[0]! + (options[0]!.endsWith('/') ? '' : ' '));
              else if (options.length > 1) setLog((l) => [...l, { id: id.current++, cmd: '', out: options.join('   '), code: 0 }]);
            } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
    </div>
  );
}

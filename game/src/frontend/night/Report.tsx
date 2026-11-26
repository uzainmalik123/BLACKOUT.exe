// Kiro's judgement (UI-07, D-223): the post-incident report as an investigation wall. Everything on it is the
// engine's: the facts, grades, mistakes and missed footholds come from `buildReport(world)` (SYS-11, the assessor),
// the timeline from `world.events`, the meters from the world as it ended. Kiro writes the debrief around those
// facts (`kiro.debrief`, KIRO-06; the rule-written text when she is offline) and gives her verdict from the grades.
// The download is the report's own Markdown with her debrief in it. There is no numeric score: the rules grade the
// four phases, and that is what is shown.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildReport, renderMarkdown, type Report as EngineReport } from '../../engine/report';
import type { Difficulty } from '../../rules/vocabulary';
import { drawKiro } from '../screen3-briefing/cinema/characters';
import { DIFFICULTY_LABEL } from '../screen2-menu/menu';
import { ENDINGS, kiroVerdict } from './judge';
import type { Run } from './run';
import { clockAt, timelineOf } from './words';

const PHASE_WORDS: Record<string, string> = { detect: 'Detect', contain: 'Contain', eradicate: 'Eradicate', recover: 'Recover' };

export function ReportWall({ run, onAgain, onMenu }: { run: Run; onAgain: (d: Difficulty) => void; onMenu: () => void }) {
  const w = run.engine.world;
  const [report, setReport] = useState<EngineReport | null>(null);
  const [debrief, setDebrief] = useState<{ text: string; offline: boolean } | null>(null);
  const [level, setLevel] = useState<Difficulty>(run.difficulty);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void buildReport(w).then((r) => {
      if (!live) return;
      setReport(r);
      void run.kiro.debrief(r).then((d) => live && setDebrief(d));
    });
    return () => {
      live = false;
    };
  }, [run, w]);
  const ending = w.ending ? ENDINGS[w.ending] : null;
  const stolen = w.souls.stolen.length;
  const stages = useMemo(() => Math.max(0, ...w.events.map((e) => (e.kind === 'move-started' ? e.stage : 0))), [w]);
  const timeline = useMemo(() => timelineOf(w.events).slice(-60), [w]);
  const actions = w.events.filter((e) => e.kind === 'action');
  const good = actions.filter((e) => e.kind === 'action' && e.ok).length;
  const markdown = report && debrief ? renderMarkdown(report, debrief) : report?.markdown;
  const download = () => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `blackout-incident-report-${w.seed}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <main className="ns-report">
      <KiroWatching />
      <header className="ns-rep-head">
        <p className="ns-rep-kicker">Post-incident report · {DIFFICULTY_LABEL[run.difficulty]} · seed {w.seed}</p>
        <h1 className={ending?.won ? 'is-won' : 'is-lost'}>{ending?.title ?? 'Shift unfinished'}</h1>
        <p className="ns-rep-line">{ending?.line}</p>
        {report && <blockquote className="ns-verdict">“{kiroVerdict(report.grades)}” <cite>Kiro</cite></blockquote>}
      </header>

      <section className="ns-rep-meters" aria-label="How it ended">
        <div className="ns-pin">
          <span>💀 Souls kept</span>
          <b>
            {w.souls.total - stolen}
            <small>/{w.souls.total}</small>
          </b>
          <i className="ns-dmg" style={{ width: `${(stolen / Math.max(1, w.souls.total)) * 100}%` }} />
          <em>{stolen} lost, for good</em>
        </div>
        <div className="ns-pin">
          <span>🫀 Heartbeat</span>
          <b>
            {Math.round(w.heartbeat)}
            <small>/100</small>
          </b>
          <i className="ns-dmg" style={{ width: `${100 - Math.round(w.heartbeat)}%` }} />
          <em>could reach {Math.round(w.heartbeatMax)} at most</em>
        </div>
        <div className="ns-pin">
          <span>Deepest stage he reached</span>
          <b>
            {stages}
            <small>/6</small>
          </b>
          <em>{['none', 'scout', 'break in', 'admin', 'harvest', 'dig in', 'strike'][stages]}</em>
        </div>
        <div className="ns-pin">
          <span>Your actions</span>
          <b>{actions.length}</b>
          <em>{good} went through</em>
        </div>
      </section>

      <section className="ns-rep-grades" aria-label="Grades">
        {report ? (
          Object.entries(report.grades).map(([phase, g], i) => (
            <div key={phase} className={`ns-grade g-${g}`} style={{ animationDelay: `${0.3 + i * 0.25}s` }}>
              <span>{PHASE_WORDS[phase] ?? phase}</span>
              <b>{g}</b>
            </div>
          ))
        ) : (
          <p className="ns-quiet">The rules are grading…</p>
        )}
      </section>

      <div className="ns-rep-cols">
        <section className="ns-rep-facts">
          <h2>Facts</h2>
          <dl>
            {report?.facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="ns-rep-timeline">
          <h2>Timeline</h2>
          <ol>
            {timeline.map((x) => (
              <li key={x.id} className={`is-${x.tone}${open === x.id ? ' is-open' : ''}`} onClick={() => setOpen(open === x.id ? null : x.id)}>
                <time>
                  {clockAt(w, x.t)}
                  {x.until !== undefined && <small>–{clockAt(w, x.until).slice(0, 5)}</small>}
                </time>
                <span>{x.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="ns-rep-cards">
          <h2>Mistakes</h2>
          {report && report.mistakes.length === 0 && <p className="ns-quiet">None.</p>}
          {report?.mistakes.map((m) => (
            <article key={m.title} className="ns-card-red">
              <h3>{m.title}</h3>
              <p>{m.why}</p>
            </article>
          ))}
          <h2>Left behind</h2>
          {report && report.missed.length === 0 && <p className="ns-quiet">Nothing left behind.</p>}
          {report?.missed.map((m) => (
            <article key={m} className="ns-card-amber">
              <p>{m}</p>
            </article>
          ))}
        </section>
      </div>

      <section className="ns-rep-debrief">
        <h2>Kiro's debrief{debrief?.offline ? ' (offline)' : ''}</h2>
        <p>{debrief ? debrief.text : 'Kiro is writing…'}</p>
      </section>

      <nav className="ns-rep-actions">
        <button type="button" onClick={download} disabled={!markdown}>
          Download incident report
        </button>
        <span className="ns-again">
          <button type="button" onClick={() => onAgain(level)}>
            Try again
          </button>
          <select value={level} onChange={(e) => setLevel(e.target.value as Difficulty)} aria-label="Difficulty for the next shift">
            {(['easy', 'medium', 'hard'] as const).map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </select>
        </span>
        <button type="button" onClick={onMenu}>
          Main menu
        </button>
      </nav>
    </main>
  );
}

/** Kiro beside the wall, watching the player read it. */
function KiroWatching() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
      if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const t = (now - t0) / 1000;
      drawKiro(g, W * 0.5, H * 1.02, H * 1.05, { t, form: reduce ? 1 : Math.min(1, t / 1.5), talk: 0, look: Math.sin(t * 0.3) * 0.3, eyes: 0.7, glitch: 0, hand: null }, dpr);
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="ns-rep-kiro" aria-hidden />;
}

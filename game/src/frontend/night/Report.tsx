// The post-incident report (UI-07, D-263): the night's last screen, as a case file. The first seconds are the horror
// game's judgement (the ending's own name, the grade, Kiro's verdict, in the ending's light); then the results fit
// one screen (six metrics, the phase grades), and the rest is one click away: Kiro's debrief, the incident timeline
// and the full incident report. Everything on it is the engine's: the grades, facts and mistakes come from the
// assessor (SYS-11), the timeline from `world.events`, the reading (the overall grade, what went right and wrong,
// the lessons) from `aftermath.ts`, the case file's shapes from `reportView.ts`; Kiro writes her debrief around them
// (`kiro.debrief`, or the rule-written text when she is offline). The download is the report's own Markdown.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildReport, type Report as EngineReport } from '../../engine/report';
import type { Difficulty } from '../../rules/vocabulary';
import { isMasterMuted, onMasterMute, setMasterMuted } from '../shared/audio';
import { KiroCanvas } from '../shared/KiroCanvas';
import { deathPortrait } from '../shared/reaper';
import { DIFFICULTY_LABEL } from '../screen2-menu/menu';
import { parseMarkdown, type Block, type Inline } from '../screen3-briefing/markdown';
import { PHASE_NAMES, aftermathOf, type Aftermath, type Grade, type Phase } from './aftermath';
import { ENDINGS, kiroMood, kiroVerdict } from './judge';
import {
  CATEGORY_LABEL,
  FILTERS,
  FOCUS,
  KEY_LABEL,
  SECTIONS,
  factsBySection,
  findingsOf,
  headlineOf,
  inFilter,
  metricsOf,
  progressionOf,
  reportMarkdown,
  shiftSpan,
  timelineItems,
  type Category,
  type Filter,
  type Finding,
  type Metric,
  type TimelineItem,
} from './reportView';
import type { Run } from './run';
import './report.css';

type View = 'overview' | 'debrief' | 'timeline' | 'full';
const PHASE_LIST: readonly Phase[] = ['detect', 'contain', 'eradicate', 'recover'];
/** How long the reveal takes before the screen is simply there (ms). */
const REVEAL_MS = 3800;

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up from 0 to its value after `delay`, unless motion is reduced or the reveal was skipped. */
function useCountUp(target: number, delay: number, instant: boolean): number {
  const still = instant || reducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (still) return;
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / 900));
      setN(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, delay, still]);
  return still ? target : n;
}

// ------------------------------------------------------------------ small pieces

/** A line of Kiro's debrief: its **bold** and `code` as elements, never raw HTML. */
function Line({ xs }: { xs: Inline[] }) {
  return (
    <>
      {xs.map((x, i) => (x.kind === 'bold' ? <b key={i}>{x.text}</b> : x.kind === 'code' ? <code key={i}>{x.text}</code> : <span key={i}>{x.text}</span>))}
    </>
  );
}

/** Kiro's debrief as written (Markdown), rendered as elements: headings, paragraphs, lists. */
function Debrief({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === 'heading' ? (
          <h4 key={i}>
            <Line xs={b.text} />
          </h4>
        ) : b.kind === 'list' ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Line xs={it} />
              </li>
            ))}
          </ul>
        ) : b.kind === 'para' ? (
          <p key={i}>
            <Line xs={b.text} />
          </p>
        ) : null,
      )}
    </>
  );
}

const ICON: Readonly<Record<Category, ReactNode>> = {
  attack: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    </>
  ),
  detected: (
    <>
      <path d="M12 3 2.5 20h19L12 3z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  access: (
    <>
      <path d="M14 4h5v16h-5" />
      <path d="M3 12h11M10 8l4 4-4 4" />
    </>
  ),
  loss: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M9 13h6" />
    </>
  ),
  evidence: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l6 6" />
    </>
  ),
  action: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  refused: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  contained: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  recovery: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  missed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  business: <path d="M2 12h4l2-5 4 10 2-5h8" />,
};

function CategoryIcon({ c }: { c: Category }) {
  return (
    <svg className={`rp-icon c-${c}`} viewBox="0 0 24 24" aria-hidden="true">
      {ICON[c]}
    </svg>
  );
}

const gradeTone = (g: Grade) => (g === 'A' || g === 'B' ? 'good' : g === 'C' ? 'fair' : 'bad');

// ------------------------------------------------------------------ the atmosphere

/** The ending's light, a few slow motes, Death's dark shape on a loss, the trace that goes flat on a flatline. */
function Atmosphere({ death }: { death: boolean }) {
  const portrait = useMemo(() => (death ? deathPortrait() : ''), [death]);
  const motes = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const r = (k: number) => {
          const s = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
          return s - Math.floor(s);
        };
        return { left: `${(r(1) * 100).toFixed(1)}%`, top: `${(r(2) * 100).toFixed(1)}%`, size: 1.5 + r(3) * 2.5, delay: -r(4) * 18, dur: 14 + r(5) * 12 };
      }),
    [],
  );
  return (
    <div className="rp-atmos" aria-hidden="true">
      <div className="rp-light" />
      {motes.map((m, i) => (
        <span key={i} className="rp-mote" style={{ left: m.left, top: m.top, width: m.size, height: m.size, animationDelay: `${m.delay}s`, animationDuration: `${m.dur}s` }} />
      ))}
      {portrait && <img className="rp-death" src={portrait} alt="" />}
      <div className="rp-vignette" />
    </div>
  );
}

// ------------------------------------------------------------------ the overview

function Seal({ m, instant }: { m: Aftermath; instant: boolean }) {
  const C = 2 * Math.PI * 86;
  const fill = Math.max(0, Math.min(1, m.overall.mean / 4));
  const mean = useCountUp(Math.round(m.overall.mean * 100), 1300, instant) / 100;
  return (
    <div className={`rp-seal t-${gradeTone(m.overall.grade)}`} role="img" aria-label={`Overall grade ${m.overall.grade}. ${m.overall.why}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="rp-ring-track" cx="100" cy="100" r="86" />
        {[0, 1, 2, 3].map((q) => (
          <line key={q} className="rp-ring-tick" x1="100" y1="8" x2="100" y2="18" transform={`rotate(${q * 90} 100 100)`} />
        ))}
        <circle className="rp-ring-fill" cx="100" cy="100" r="86" style={{ ['--c' as string]: `${C}`, ['--off' as string]: `${C * (1 - fill)}` }} />
      </svg>
      <div className="rp-seal-in">
        <span className="rp-seal-label">Overall</span>
        <b className="rp-seal-grade">{m.overall.grade}</b>
        <span className="rp-seal-score">
          {mean.toFixed(2)} <small>/ 4</small>
        </span>
      </div>
    </div>
  );
}

function MetricCard({ metric, index, lit, instant }: { metric: Metric; index: number; lit: boolean; instant: boolean }) {
  const numeric = /^\d+$/.test(metric.value);
  const n = useCountUp(numeric ? Number(metric.value) : 0, 1900 + index * 90, instant);
  return (
    <article className={`rp-metric t-${metric.tone}${lit ? ' is-lit' : ''}`} style={{ ['--i' as string]: index }}>
      <h3>{metric.label}</h3>
      <p className="rp-metric-value">
        {numeric ? n : metric.value}
        {metric.of && <small>{metric.of}</small>}
      </p>
      {metric.bar !== undefined && (
        <i className="rp-metric-bar">
          <i style={{ width: `${Math.round(metric.bar * 100)}%` }} />
        </i>
      )}
      {metric.sub.map((s) => (
        <p key={s} className="rp-metric-sub">
          {s}
        </p>
      ))}
    </article>
  );
}

// ------------------------------------------------------------------ Kiro's debrief

function FindingCard({ f, withWhy = true }: { f: Finding; withWhy?: boolean }) {
  return (
    <li className="rp-finding">
      <span className="rp-tag">{PHASE_NAMES[f.phase]}</span>
      {f.titles.length === 1 ? (
        <p className="rp-finding-title">{f.titles[0]}</p>
      ) : (
        <ul className="rp-finding-titles">
          {f.titles.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {withWhy && <p className="rp-finding-why">{f.why}</p>}
    </li>
  );
}

// ------------------------------------------------------------------ the screen

export function ReportWall({ run, onAgain, onMenu, say }: { run: Run; onAgain: (d: Difficulty) => void; onMenu: () => void; say?: (text: string) => void }) {
  const w = run.engine.world;
  const [report, setReport] = useState<EngineReport | null>(null);
  const [debrief, setDebrief] = useState<{ text: string; offline: boolean } | null>(null);
  const [level, setLevel] = useState<Difficulty>(run.difficulty);
  const [view, setView] = useState<View>('overview');
  const [skipped, setSkipped] = useState(() => reducedMotion());
  const [revealed, setRevealed] = useState(() => reducedMotion());
  const [muted, setMuted] = useState(isMasterMuted);
  const [said, setSaid] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<number | null>(null);
  const viewHead = useRef<HTMLHeadingElement>(null);
  const rows = useRef<Array<HTMLButtonElement | null>>([]);

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
  useEffect(() => onMasterMute(setMuted), []);

  const m = useMemo(() => aftermathOf(w), [w]);
  const head = headlineOf(w.ending);
  const ending = w.ending ? ENDINGS[w.ending] : null;
  const verdict = kiroVerdict(m.grades, w.ending);
  const facts = useMemo(() => report?.facts ?? [], [report]);
  const metrics = useMemo(() => metricsOf(w, m, facts), [w, m, facts]);
  const findings = useMemo(() => findingsOf(m.wrong), [m]);
  const items = useMemo(() => timelineItems(w), [w]);
  const progression = useMemo(() => progressionOf(w), [w]);
  const bySection = useMemo(() => factsBySection(facts), [facts]);
  const span = shiftSpan(w);
  const debriefBlocks = useMemo(() => (debrief ? parseMarkdown(debrief.text).filter((b) => b.kind !== 'code' && b.kind !== 'table') : []), [debrief]);
  const markdown = report ? reportMarkdown(report, debrief, m) : null;
  /** Her line for the portrait's mouth: a trailing space alternates so saying it again is a new line. */
  const spoken = said ? `${verdict}${' '.repeat(said % 2)}` : null;
  // once the reveal is over (or skipped), coming back to the results shows them at rest
  const instant = skipped || revealed;

  // the reveal: about three seconds, or at once on a key or a click
  useEffect(() => {
    if (revealed) return;
    const t = window.setTimeout(() => setRevealed(true), REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [revealed]);
  const skip = useCallback(() => {
    if (revealed) return;
    setSkipped(true);
    setRevealed(true);
  }, [revealed]);

  // Kiro says her verdict once, as the grade lands; the verdict on screen is its subtitle (the master mute holds)
  const speak = useCallback(() => {
    setSaid((n) => n + 1); // a new line each time, even the same words: her mouth moves again
    say?.(verdict);
  }, [say, verdict]);
  useEffect(() => {
    const t = window.setTimeout(speak, reducedMotion() ? 400 : 1700);
    return () => window.clearTimeout(t);
    // once, when the report opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keys: anything skips the reveal; Escape goes back to the results
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!revealed) skip();
      if (e.key === 'Escape' && view !== 'overview') setView('overview');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, skip, view]);
  useEffect(() => {
    if (view !== 'overview') viewHead.current?.focus();
  }, [view]);

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

  const shown = items.filter((x) => inFilter(x, filter));
  const selected = items.find((x) => x.id === picked) ?? shown.find((x) => x.key) ?? shown[0] ?? null;
  const moveRow = (from: number, by: number) => {
    const next = Math.max(0, Math.min(shown.length - 1, from + by));
    setPicked(shown[next]!.id);
    rows.current[next]?.focus();
  };

  const focus = w.ending ? FOCUS[w.ending] : undefined;
  const mood = kiroMood({ ending: w.ending, outcome: null, danger: 0, alertAge: null });
  const open = (v: View) => setView((now) => (now === v ? 'overview' : v));

  return (
    <main
      className={`rp tone-${head.tone} end-${w.ending ?? 'none'}${skipped ? ' is-skip' : ''}${revealed ? ' is-revealed' : ''} view-${view}`}
      aria-label="Post-incident report"
      onPointerDown={skip}
    >
      <Atmosphere death={head.death} />

      <header className="rp-bar">
        <p>
          <b>BLACKOUT.exe</b>
          <span>Post-incident report</span>
          <span>Case {w.seed}</span>
          <span>{DIFFICULTY_LABEL[run.difficulty]}</span>
          <span>
            Shift {span.from}–{span.to}
          </span>
        </p>
        <button type="button" className="rp-sound" aria-pressed={!muted} onClick={() => setMasterMuted(!muted)}>
          {muted ? 'Sound off' : 'Sound on'}
        </button>
      </header>

      <div className="rp-stage">
        {view === 'overview' && (
          <div className="rp-overview">
            <section className="rp-hero">
              <div className="rp-verdict">
                {w.ending === 'flatline' && (
                  // the heartbeat runs, and goes flat
                  <svg className="rp-ecg" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
                    <path pathLength={1} vectorEffect="non-scaling-stroke" d="M0 60h160l18-34 20 70 16-52 12 16h190l18-34 20 70 16-52 12 16h150l14-22 16 40 12-26 10 8h480" />
                  </svg>
                )}
                <p className="rp-kicker">{head.kicker}</p>
                <h1 className="rp-title">{head.title}</h1>
                {ending && <p className="rp-line">{ending.line}</p>}
                <figure className="rp-quote">
                  <KiroCanvas className="rp-kiro" mood={mood} line={spoken} appear fps={30} />
                  <blockquote>
                    <p>“{verdict}”</p>
                    <footer>
                      <cite>Kiro</cite>
                      {say && (
                        <button type="button" className="rp-hear" onClick={speak} disabled={muted} title={muted ? 'Sound is off' : undefined}>
                          ▸ Hear Kiro
                        </button>
                      )}
                    </footer>
                  </blockquote>
                </figure>
              </div>
              <div className="rp-grade">
                <Seal m={m} instant={instant} />
                <p className="rp-grade-why">{m.overall.why}</p>
              </div>
            </section>

            <section className="rp-metrics" aria-label="Key metrics">
              {metrics.map((x, i) => (
                <MetricCard key={x.id} metric={x} index={i} lit={x.id === focus} instant={instant} />
              ))}
            </section>

            <section className="rp-phases" aria-label="Phase grades">
              {PHASE_LIST.map((p, i) => (
                <article key={p} className={`rp-phase t-${gradeTone(m.grades[p])}`} style={{ ['--i' as string]: i }}>
                  <b>{m.grades[p]}</b>
                  <div>
                    <h3>{PHASE_NAMES[p]}</h3>
                    <p>{m.phaseWhy[p]}</p>
                  </div>
                </article>
              ))}
            </section>
          </div>
        )}

        {view === 'debrief' && (
          <section className="rp-view rp-debrief" aria-labelledby="rp-debrief-h">
            <aside className="rp-debrief-kiro">
              <KiroCanvas className="rp-kiro-large" mood={mood} line={spoken} fps={30} />
              <blockquote>“{verdict}”</blockquote>
              {say && (
                <button type="button" className="rp-hear" onClick={speak} disabled={muted}>
                  ▸ Hear Kiro
                </button>
              )}
            </aside>
            <div className="rp-debrief-body">
              <h2 id="rp-debrief-h" ref={viewHead} tabIndex={-1}>
                Kiro's debrief
              </h2>
              <div className="rp-debrief-cols">
                <section className="rp-col t-good">
                  <h3>What you did well</h3>
                  {m.right.length === 0 ? (
                    <p className="rp-none">Nothing stopped him tonight.</p>
                  ) : (
                    <ul className="rp-list">
                      {m.right.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="rp-col t-bad">
                  <h3>What went wrong</h3>
                  {findings.length === 0 ? (
                    <p className="rp-none">No mistakes.</p>
                  ) : (
                    <ul className="rp-findings">
                      {findings.map((f) => (
                        <FindingCard key={f.why} f={f} withWhy={false} />
                      ))}
                    </ul>
                  )}
                  {m.failed.length > 0 && (
                    <>
                      <h4>Defences that did not hold</h4>
                      <ul className="rp-list">
                        {m.failed.map((x, i) => (
                          <li key={`${i}:${x}`}>{x}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
                <section className="rp-col t-fair">
                  <h3>What to improve next time</h3>
                  <ul className="rp-list">
                    {m.nextTime.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  <h4>Three lessons</h4>
                  <ol className="rp-lessons">
                    {m.lessons.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ol>
                </section>
              </div>
              <details className="rp-written">
                <summary>
                  Her written debrief{debrief?.offline ? ' (Kiro offline: the rule-written version)' : ''}
                </summary>
                {debrief ? <Debrief blocks={debriefBlocks} /> : <p>Kiro is writing…</p>}
              </details>
            </div>
          </section>
        )}

        {view === 'timeline' && (
          <section className="rp-view rp-timeline" aria-labelledby="rp-timeline-h">
            <header className="rp-view-head">
              <h2 id="rp-timeline-h" ref={viewHead} tabIndex={-1}>
                Incident timeline
              </h2>
              <p>
                {items.length} recorded events, {items.filter((x) => x.key).length} key moments. Times are the log clock.
              </p>
              <div className="rp-filters" role="group" aria-label="Show">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                    {f.label}
                    <small>{items.filter((x) => inFilter(x, f.id)).length}</small>
                  </button>
                ))}
              </div>
            </header>
            <div className="rp-timeline-body">
              <ol className="rp-events" aria-label="Events">
                {shown.map((x, i) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      ref={(el) => {
                        rows.current[i] = el;
                      }}
                      className={`rp-event tone-${x.tone}${x.key ? ' is-key' : ''}${selected?.id === x.id ? ' is-picked' : ''}`}
                      aria-pressed={selected?.id === x.id}
                      onClick={() => setPicked(x.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          moveRow(i, e.key === 'ArrowDown' ? 1 : -1);
                        }
                      }}
                    >
                      <time>{x.clock}</time>
                      <CategoryIcon c={x.category} />
                      <span className="rp-event-text">{x.text}</span>
                      {x.key && <span className="rp-key">Key</span>}
                    </button>
                  </li>
                ))}
                {shown.length === 0 && <li className="rp-none">Nothing of this kind tonight.</li>}
              </ol>
              {selected && <EventDetail x={selected} />}
            </div>
          </section>
        )}

        {view === 'full' && (
          <article className="rp-view rp-doc" aria-labelledby="rp-doc-h">
            <header className="rp-doc-head">
              <p className="rp-doc-kicker">
                BLACKOUT.exe · Security operations · Case {w.seed}
              </p>
              <h2 id="rp-doc-h" ref={viewHead} tabIndex={-1}>
                Incident report
              </h2>
              <p className="rp-doc-meta">
                {head.title} · {DIFFICULTY_LABEL[run.difficulty]} · shift {span.from}–{span.to} · overall grade {m.overall.grade}
              </p>
            </header>
            <nav className="rp-toc" aria-label="Contents">
              {SECTIONS.map((s, i) => (
                <a key={s.id} href={`#rp-s-${s.id}`}>
                  {i + 1}. {s.title}
                </a>
              ))}
            </nav>

            <DocSection n={1} id="overview">
              <Facts
                rows={[
                  { label: 'Ending', value: `${head.title} (${m.overall.result})` },
                  { label: 'Difficulty', value: DIFFICULTY_LABEL[run.difficulty] },
                  { label: 'Overall grade', value: `${m.overall.grade}: ${m.overall.why}` },
                  ...bySection.overview,
                  { label: "Kiro's verdict", value: verdict },
                ]}
              />
            </DocSection>

            <DocSection n={2} id="progression">
              {progression.length === 0 ? (
                <p className="rp-none">He never made a move.</p>
              ) : (
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Attack</th>
                      <th>Technique</th>
                      <th>First seen</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progression.map((p) => (
                      <tr key={p.move} className={`tone-${p.tone}`}>
                        <td>{p.stage}</td>
                        <td>{p.name}</td>
                        <td>
                          <code>{p.technique}</code>
                        </td>
                        <td>
                          <time>{p.firstSeen}</time>
                        </td>
                        <td>{p.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <h4>Threats missed</h4>
              {m.missed.length === 0 ? (
                <p className="rp-none">None.</p>
              ) : (
                <ul className="rp-list">
                  {m.missed.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </DocSection>

            <DocSection n={3} id="detection">
              <Grades m={m} phases={['detect']} />
              <Facts rows={bySection.detection} />
              <Findings list={findings.filter((f) => f.phase === 'detect')} />
            </DocSection>

            <DocSection n={4} id="containment">
              <Grades m={m} phases={['contain', 'eradicate', 'recover']} />
              <Facts rows={bySection.containment} />
              <Findings list={findings.filter((f) => f.phase !== 'detect')} />
              <h4>What held</h4>
              {m.right.length === 0 ? (
                <p className="rp-none">Nothing stopped him.</p>
              ) : (
                <ul className="rp-list">
                  {m.right.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
              <h4>Defences that did not hold</h4>
              {m.failed.length === 0 ? (
                <p className="rp-none">None.</p>
              ) : (
                <ul className="rp-list">
                  {m.failed.map((x, i) => (
                    <li key={`${i}:${x}`}>{x}</li>
                  ))}
                </ul>
              )}
            </DocSection>

            <DocSection n={5} id="impact">
              <Facts rows={bySection.impact} />
            </DocSection>

            <DocSection n={6} id="evidence">
              <Facts rows={bySection.evidence} />
              <table className="rp-table rp-table-tight">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Category</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((x) => (
                    <tr key={x.id} className={`tone-${x.tone}${x.key ? ' is-key' : ''}`}>
                      <td>
                        <time>
                          {x.clock}
                          {x.untilClock && `–${x.untilClock.slice(0, 5)}`}
                        </time>
                      </td>
                      <td>{CATEGORY_LABEL[x.category]}</td>
                      <td>{x.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DocSection>

            <DocSection n={7} id="lessons">
              <h4>What a professional would have done</h4>
              {m.professional.length === 0 ? (
                <p className="rp-none">What you did is what they would have done.</p>
              ) : (
                <dl className="rp-facts">
                  {m.professional.map((p) => (
                    <div key={p.phase}>
                      <dt>{PHASE_NAMES[p.phase]}</dt>
                      <dd>{p.text}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <h4>Next time</h4>
              <ul className="rp-list">
                {m.nextTime.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <h4>Kiro's written debrief{debrief?.offline ? ' (offline)' : ''}</h4>
              <div className="rp-doc-debrief">{debrief ? <Debrief blocks={debriefBlocks} /> : <p>Kiro is writing…</p>}</div>
            </DocSection>
          </article>
        )}
      </div>

      <footer className="rp-actions">
        <nav aria-label="Report">
          {view !== 'overview' && (
            <button type="button" className="rp-back" onClick={() => setView('overview')}>
              ← Results
            </button>
          )}
          <button type="button" aria-pressed={view === 'timeline'} onClick={() => open('timeline')}>
            View incident timeline
          </button>
          <button type="button" aria-pressed={view === 'debrief'} onClick={() => open('debrief')}>
            Kiro's debrief
          </button>
          <button type="button" aria-pressed={view === 'full'} onClick={() => open('full')}>
            Full incident report
          </button>
          <button type="button" onClick={download} disabled={!markdown}>
            Download report
          </button>
        </nav>
        <nav aria-label="Next">
          <span className="rp-again">
            <select value={level} onChange={(e) => setLevel(e.target.value as Difficulty)} aria-label="Difficulty for the next night">
              {(['easy', 'medium', 'hard'] as const).map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </select>
            <button type="button" className="rp-primary" onClick={() => onAgain(level)}>
              Play again
            </button>
          </span>
          <button type="button" onClick={onMenu}>
            Main menu
          </button>
        </nav>
      </footer>
    </main>
  );
}

// ------------------------------------------------------------------ the full report's pieces

function DocSection({ n, id, children }: { n: number; id: (typeof SECTIONS)[number]['id']; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)!.title;
  return (
    <section className="rp-doc-section" id={`rp-s-${id}`} aria-labelledby={`rp-s-${id}-h`}>
      <h3 id={`rp-s-${id}-h`}>
        <span>{n}.</span> {title}
      </h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: ReadonlyArray<{ label: string; value: string }> }) {
  if (rows.length === 0) return null;
  return (
    <dl className="rp-facts">
      {rows.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Grades({ m, phases }: { m: Aftermath; phases: readonly Phase[] }) {
  return (
    <ul className="rp-doc-grades">
      {phases.map((p) => (
        <li key={p} className={`t-${gradeTone(m.grades[p])}`}>
          <b>{m.grades[p]}</b>
          <span>{PHASE_NAMES[p]}</span>
          <small>{m.phaseWhy[p]}</small>
        </li>
      ))}
    </ul>
  );
}

function Findings({ list }: { list: Finding[] }) {
  if (list.length === 0) return <p className="rp-none">No findings in this phase.</p>;
  return (
    <>
      <h4>Findings</h4>
      <ul className="rp-findings">
        {list.map((f) => (
          <FindingCard key={f.why} f={f} />
        ))}
      </ul>
    </>
  );
}

function EventDetail({ x }: { x: TimelineItem }) {
  return (
    <aside className={`rp-detail tone-${x.tone}`} aria-live="polite">
      <p className="rp-detail-cat">
        <CategoryIcon c={x.category} /> {CATEGORY_LABEL[x.category]}
      </p>
      <h3>{x.text}</h3>
      <p className="rp-detail-time">
        <time>{x.clock}</time>
        {x.untilClock && <> – {x.untilClock}</>} · {x.into} into the shift
      </p>
      {x.details.length > 0 && (
        <dl className="rp-facts">
          {x.details.map((d) => (
            <div key={d.label}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {x.impact && (
        <p className="rp-detail-impact">
          <span>Consequence</span> {x.impact}
        </p>
      )}
      {x.key && <p className="rp-detail-key">◆ Key moment: {KEY_LABEL[x.key].toLowerCase()}</p>}
    </aside>
  );
}

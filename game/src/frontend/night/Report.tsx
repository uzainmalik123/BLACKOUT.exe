// The post-incident report (UI-07, D-223, D-256): the last screen of the night, an investigation board. Everything
// on it is the engine's: the grades, facts, mistakes and missed footholds come from the assessor (SYS-11), the
// timeline from `world.events`, the meters from the world as it ended, and its reading (the overall grade by a
// documented formula, what went right and wrong, the defences that failed, the threats missed, the lessons) from
// `aftermath.ts`. Kiro writes the debrief around those facts (`kiro.debrief`; the rule-written text when she is
// offline). The download is the report's own Markdown with all of it.

import { useEffect, useMemo, useState } from 'react';
import { buildReport, renderMarkdown, type Report as EngineReport } from '../../engine/report';
import type { Difficulty } from '../../rules/vocabulary';
import { KiroCanvas } from '../shared/KiroCanvas';
import { DIFFICULTY_LABEL } from '../screen2-menu/menu';
import { PHASE_NAMES, aftermathOf, type Aftermath } from './aftermath';
import { ENDINGS, kiroMood, kiroVerdict } from './judge';
import type { Run } from './run';
import { clockAt, timelineOf } from './words';

/** The report's own sections, appended to the engine's Markdown for the download. */
function aftermathMarkdown(m: Aftermath): string {
  const list = (xs: string[], none: string) => (xs.length ? xs.map((x) => `- ${x}`) : [none]);
  return [
    `## Overall: ${m.overall.grade} (${m.overall.result})`,
    '',
    m.overall.why,
    '',
    '## What went right',
    '',
    ...list(m.right, 'Nothing stopped him.'),
    '',
    '## Defences that did not hold',
    '',
    ...list(m.failed, 'None.'),
    '',
    '## Threats missed',
    '',
    ...list(m.missed, 'None.'),
    '',
    '## What a professional would have done',
    '',
    ...list(
      m.professional.map((p) => `**${PHASE_NAMES[p.phase]}.** ${p.text}`),
      'Every phase went well.',
    ),
    '',
    '## Three lessons',
    '',
    ...m.lessons.map((l, i) => `${i + 1}. ${l}`),
    '',
    '## Next time',
    '',
    ...list(m.nextTime, ''),
    '',
  ].join('\n');
}

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
  const m = useMemo(() => aftermathOf(w), [w]);
  const timeline = useMemo(() => timelineOf(w.events).slice(-60), [w]);
  const markdown = report ? `${debrief ? renderMarkdown(report, debrief) : report.markdown}\n${aftermathMarkdown(m)}` : null;
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
  const won = m.overall.result === 'Victory';
  return (
    <main className="ns-report">
      <KiroCanvas className="ns-rep-kiro" mood={kiroMood({ ending: w.ending, outcome: null, danger: 0, alertAge: null })} line={debrief?.text.split('. ')[0] ?? null} appear fps={30} />
      <header className="ns-rep-head">
        <p className="ns-rep-kicker">Post-incident report · {DIFFICULTY_LABEL[run.difficulty]} · seed {w.seed}</p>
        <div className="ns-rep-top">
          <div>
            <p className={`ns-rep-result ${won ? 'is-won' : 'is-lost'}`}>{m.overall.result}</p>
            <h1 className={ending?.won ? 'is-won' : 'is-lost'}>{ending?.title ?? 'Shift unfinished'}</h1>
            <p className="ns-rep-line">{ending?.line}</p>
          </div>
          <div className={`ns-rep-overall g-${m.overall.grade}`} aria-label={`Overall grade ${m.overall.grade}`}>
            <span>Overall</span>
            <b>{m.overall.grade}</b>
            <small>{m.overall.why}</small>
          </div>
        </div>
        {report && (
          <blockquote className="ns-verdict">
            “{kiroVerdict(report.grades, w.ending)}” <cite>Kiro</cite>
          </blockquote>
        )}
      </header>

      <section className="ns-rep-meters" aria-label="The damage">
        <div className="ns-pin">
          <span>💀 Customer records lost</span>
          <b>
            {m.damage.soulsLost}
            <small>/{m.damage.total}</small>
          </b>
          <i className="ns-dmg" style={{ width: `${(m.damage.soulsLost / Math.max(1, m.damage.total)) * 100}%` }} />
          <em>{m.damage.soulsLost ? 'taken, for good' : 'none taken'}</em>
        </div>
        <div className="ns-pin">
          <span>🫀 Business health</span>
          <b>
            {m.damage.heartbeat}
            <small>/100</small>
          </b>
          <i className="ns-dmg" style={{ width: `${100 - m.damage.heartbeat}%` }} />
          <em>could reach {m.damage.max} at most</em>
        </div>
        <div className="ns-pin">
          <span>Downtime you caused</span>
          <b>{m.damage.downtime || '0'}</b>
          <em>the plug pulled</em>
        </div>
        <div className="ns-pin">
          <span>Customers lost for good</span>
          <b>{m.damage.customersLost || '0'}</b>
          <em>their errands failed</em>
        </div>
      </section>

      <section className="ns-rep-grades" aria-label="Grades">
        {(['detect', 'contain', 'eradicate', 'recover'] as const).map((phase, i) => (
          <div key={phase} className={`ns-grade g-${m.grades[phase]}`} style={{ animationDelay: `${0.3 + i * 0.25}s` }}>
            <span>{PHASE_NAMES[phase]}</span>
            <b>{m.grades[phase]}</b>
            <small>{m.phaseWhy[phase]}</small>
          </div>
        ))}
      </section>

      <div className="ns-rep-board">
        <section className="ns-rep-cards">
          <h2>What went right</h2>
          {m.right.length === 0 && <p className="ns-quiet">Nothing stopped him tonight.</p>}
          {m.right.map((x) => (
            <article key={x} className="ns-card-green">
              <p>{x}</p>
            </article>
          ))}
        </section>
        <section className="ns-rep-cards">
          <h2>What went wrong</h2>
          {m.wrong.length === 0 && <p className="ns-quiet">No mistakes.</p>}
          {m.wrong.map((x) => (
            <article key={x.title} className="ns-card-red">
              <h3>{x.title}</h3>
              <p>{x.why}</p>
            </article>
          ))}
        </section>
        <section className="ns-rep-cards">
          <h2>Threats missed</h2>
          {m.missed.length === 0 && <p className="ns-quiet">None.</p>}
          {m.missed.map((x) => (
            <article key={x} className="ns-card-amber">
              <p>{x}</p>
            </article>
          ))}
          <h2>Defences that did not hold</h2>
          {m.failed.length === 0 && <p className="ns-quiet">None.</p>}
          {m.failed.map((x, i) => (
            <article key={`${i}:${x}`} className="ns-card-amber">
              <p>{x}</p>
            </article>
          ))}
        </section>
      </div>

      <div className="ns-rep-cols">
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
        <details className="ns-rep-facts">
          <summary>
            <h2>Every fact</h2>
          </summary>
          <dl>
            {report?.facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>

      <section className="ns-rep-learn" aria-label="What to learn">
        <div>
          <h2>What a professional would have done</h2>
          {m.professional.length === 0 && <p className="ns-quiet">What you did is what they would have done.</p>}
          {m.professional.map((p) => (
            <p key={p.phase}>
              <b>{PHASE_NAMES[p.phase]}.</b> {p.text}
            </p>
          ))}
        </div>
        <div>
          <h2>Three lessons</h2>
          <ol>
            {m.lessons.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
        </div>
        <div>
          <h2>Next time</h2>
          {m.nextTime.map((x) => (
            <p key={x}>{x}</p>
          ))}
        </div>
      </section>

      <section className="ns-rep-debrief">
        <h2>Kiro's debrief{debrief?.offline ? ' (offline)' : ''}</h2>
        <p>{debrief ? debrief.text : 'Kiro is writing…'}</p>
      </section>

      <nav className="ns-rep-actions">
        <button type="button" onClick={download} disabled={!markdown}>
          Download report
        </button>
        <button type="button" onClick={() => onAgain(run.difficulty)}>
          Retry on {DIFFICULTY_LABEL[run.difficulty]}
        </button>
        <span className="ns-again">
          <select value={level} onChange={(e) => setLevel(e.target.value as Difficulty)} aria-label="Change difficulty">
            {(['easy', 'medium', 'hard'] as const).map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABEL[d]}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => onAgain(level)}>
            Change difficulty and play
          </button>
        </span>
        <button type="button" onClick={onMenu}>
          Main menu
        </button>
      </nav>
    </main>
  );
}

// The Six Gates (D-222): a forest path through six great gates, one for each step of the playbook, and a legal
// plinth at the end. Left and Right (or the arrows, or a click) walk the path; the chosen gate swings open and its
// step's points are shown in the file's own words, with Kiro's remark. Containment weighs what each move costs;
// eradication lists everything he leaves behind; the plinth keeps the file's legal sentence and sets beside it what
// GDPR Articles 33 and 34 actually ask (KI-199).

import { useEffect, useRef, useState } from 'react';
import { KiroGuide } from './KiroGuide';
import { GATES, LEGAL, PLACES } from './sceneData';

/** Each gate's colour and the emblem in its arch. */
const LOOK = [
  { tone: '#3ddc97', emblem: 'tower' },
  { tone: '#46e8ff', emblem: 'eye' },
  { tone: '#ffb23e', emblem: 'shield' },
  { tone: '#ff2a4a', emblem: 'key' },
  { tone: '#3ddc97', emblem: 'sun' },
  { tone: '#d9cfe9', emblem: 'candle' },
] as const;

function Emblem({ kind, tone }: { kind: string; tone: string }) {
  const s = { fill: 'none', stroke: tone, strokeWidth: 4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'tower':
      return <path {...s} d="M180 150 v-40 h10 v10 h10 v-10 h10 v10 h10 v-10 h10 v40 z M190 150 v-20 h20 v20" />;
    case 'eye':
      return (
        <g {...s}>
          <path d="M160 125 q40 -35 80 0 q-40 35 -80 0 z" />
          <circle cx="200" cy="125" r="11" fill={tone} />
        </g>
      );
    case 'shield':
      return <path {...s} d="M200 95 l34 12 v22 q0 26 -34 40 q-34 -14 -34 -40 v-22 z M200 110 v45 M184 132 h32" />;
    case 'key':
      return (
        <g {...s}>
          <circle cx="182" cy="125" r="16" />
          <path d="M198 125 h46 M230 125 v14 M242 125 v10" />
        </g>
      );
    case 'sun':
      return <path {...s} d="M168 145 a32 32 0 0 1 64 0 M200 95 v-12 M172 106 l-8 -8 M228 106 l8 -8 M160 145 h80" />;
    default:
      return <path {...s} d="M192 150 v-40 h16 v40 z M200 108 q-8 -12 0 -24 q8 12 0 24" />;
  }
}

/** One gate: stone pillars, a pointed arch, iron leaves that swing open when it is chosen, its world beyond. */
function Gate({ i, open }: { i: number; open: boolean }) {
  const { tone, emblem } = LOOK[i]!;
  return (
    <svg className={`sg-gate${open ? ' open' : ''}`} viewBox="0 0 400 520" aria-hidden="true">
      <defs>
        <radialGradient id={`sg-beyond-${i}`} cx="50%" cy="55%" r="55%">
          <stop offset="0" stopColor={tone} stopOpacity={open ? 0.55 : 0.18} />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* what lies beyond the arch */}
      <path d="M110 500 V190 Q110 110 200 80 Q290 110 290 190 V500 Z" fill={`url(#sg-beyond-${i})`} />
      {i === 2 && <path className="sg-rot" d="M130 500 q20 -60 50 -40 q25 -70 60 -20 q30 -40 30 60 z" fill="rgba(255,42,74,0.45)" />}
      {i === 4 && [0, 1, 2].map((k) => <rect key={k} className="sg-lit" x={150 + k * 38} y={330} width="26" height="34" fill="#ffd58a" style={{ animationDelay: `${k * 0.6}s` }} />)}
      {i === 5 && [0, 1, 2].map((k) => <circle key={k} className="sg-candle" cx={160 + k * 40} cy={420} r="5" fill="#ffd58a" style={{ animationDelay: `${k * 0.4}s` }} />)}
      {/* the stone */}
      <rect x="60" y="150" width="50" height="370" fill="#1d2321" stroke="#323c39" strokeWidth="3" />
      <rect x="290" y="150" width="50" height="370" fill="#1d2321" stroke="#323c39" strokeWidth="3" />
      <path d="M60 190 Q60 80 200 40 Q340 80 340 190 L290 190 Q290 110 200 80 Q110 110 110 190 Z" fill="#232b29" stroke="#3b4643" strokeWidth="3" />
      <Emblem kind={emblem} tone={tone} />
      {/* the iron leaves: scrolls between bars, swinging open */}
      {[0, 1].map((side) => (
        <g key={side} className={`sg-leaf ${side ? 'r' : 'l'}`}>
          {Array.from({ length: 5 }, (_, k) => (
            <line key={k} x1={side ? 290 - k * 18 : 110 + k * 18} y1="200" x2={side ? 290 - k * 18 : 110 + k * 18} y2="500" stroke="#0b0f0f" strokeWidth="5" />
          ))}
          {[260, 380].map((y) => (
            <path key={y} d={side ? `M290 ${y} q-40 -30 -80 0` : `M110 ${y} q40 -30 80 0`} fill="none" stroke="#0b0f0f" strokeWidth="5" />
          ))}
          {[230, 330, 440].map((y) => (
            <circle key={y} cx={side ? 245 : 155} cy={y} r="14" fill="none" stroke="#0b0f0f" strokeWidth="4" />
          ))}
        </g>
      ))}
      <text x="200" y="182" textAnchor="middle" fill={tone} fontFamily="Cinzel, Georgia, serif" fontWeight="700" fontSize="26">
        {['I', 'II', 'III', 'IV', 'V', 'VI'][i]}
      </text>
    </svg>
  );
}

/** Containment's costs, as the playbook weighs them. */
const COSTS = [
  { move: 'Block an address', cost: 1, note: 'cheap, but easy to dodge' },
  { move: 'Switch a feature off', cost: 2, note: 'hurts customers' },
  { move: 'Take the whole site offline', cost: 3, note: 'stops everything, including the business' },
];

export function SixGates() {
  const host = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [legal, setLegal] = useState(false);
  const [w, setW] = useState(1200);
  const stops = GATES.length + 1;
  const live = useRef({ at: 0 });
  useEffect(() => {
    live.current.at = at;
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Left and Right walk the path (and are not passed on to switch files)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const by = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (!by) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const next = Math.max(0, Math.min(stops - 1, live.current.at + by));
      setAt(next);
      setLegal(next === stops - 1);
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [stops]);

  const go = (i: number) => {
    setAt(i);
    setLegal(i === stops - 1);
  };
  const gw = Math.max(300, w * 0.36);
  const shift = w / 2 - (at + 0.5) * gw;
  const step = GATES[Math.min(at, GATES.length - 1)]!;
  const hidden = step.n === 4 ? (step.points[0] ?? '').split(':')[1]?.split(',').map((x) => x.replace(/^\s*(and\s+)?/, '').replace(/\.$/, '').trim()) ?? [] : [];

  return (
    <div ref={host} className="fs-scene sg-root">
      <div className="sg-forest" aria-hidden="true" style={{ transform: `translateX(${shift * 0.25}px)` }} />
      <div className="sg-track" style={{ transform: `translateX(${shift}px)` }}>
        <svg className="sg-path" viewBox={`0 0 ${stops * 100} 100`} preserveAspectRatio="none" style={{ width: stops * gw }} aria-hidden="true">
          <path d={`M0 70 ${Array.from({ length: stops }, (_, i) => `Q${i * 100 + 50} ${i % 2 ? 60 : 82} ${(i + 1) * 100} 70`).join(' ')}`} fill="none" stroke="rgba(180, 160, 120, 0.35)" strokeWidth="9" />
        </svg>
        {GATES.map((g, i) => (
          <button key={g.n} type="button" className={`sg-stop${i === at ? ' on' : ''}`} style={{ width: gw }} onClick={() => go(i)} aria-current={i === at} aria-label={`Gate ${g.n}: ${g.title}`}>
            <Gate i={i} open={i === at} />
            <span className="sg-name" style={{ color: LOOK[i]!.tone }}>
              {g.n} · {g.title}
            </span>
          </button>
        ))}
        <button type="button" className={`sg-stop sg-plinth${legal ? ' on' : ''}`} style={{ width: gw }} onClick={() => go(stops - 1)} aria-current={legal} aria-label="The legal plinth">
          <svg className="sg-gate" viewBox="0 0 400 520" aria-hidden="true">
            <rect x="140" y="300" width="120" height="200" fill="#232b29" stroke="#3b4643" strokeWidth="3" />
            <rect x="120" y="280" width="160" height="28" fill="#2b3432" />
            <text x="200" y="400" textAnchor="middle" fill="#ffb23e" fontFamily="Cinzel, Georgia, serif" fontWeight="700" fontSize="40">
              {LEGAL.hours ?? 72}h
            </text>
            <text x="200" y="440" textAnchor="middle" fill="#d9cfe9" fontFamily="Cinzel, Georgia, serif" fontSize="20">
              LEGAL
            </text>
          </svg>
          <span className="sg-name" style={{ color: '#ffb23e' }}>
            Legal
          </span>
        </button>
      </div>
      <div className="sg-nav">
        <button type="button" onClick={() => go(Math.max(0, at - 1))} disabled={at === 0} aria-label="Previous gate">
          ←
        </button>
        <span>{legal ? 'Legal' : `Gate ${step.n} of ${GATES.length}`}</span>
        <button type="button" onClick={() => go(Math.min(stops - 1, at + 1))} disabled={at === stops - 1} aria-label="Next gate">
          →
        </button>
      </div>
      <section className="sg-panel" key={legal ? 'legal' : step.n} aria-live="polite">
        {legal ? (
          <>
            <h3 style={{ color: '#ffb23e' }}>Legal</h3>
            <p className="sg-quote">The playbook: “{LEGAL.file}”</p>
            <ul>
              <li>{LEGAL.inside}</li>
              <li>{LEGAL.regulator}</li>
              <li>{LEGAL.people}</li>
            </ul>
          </>
        ) : (
          <>
            <h3 style={{ color: LOOK[at]!.tone }}>
              {step.n} · {step.title}
              {step.aim && <small> · {step.aim}</small>}
            </h3>
            <ul>
              {step.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {step.n === 3 && (
              <div className="sg-costs" aria-label="What each containment move costs">
                {COSTS.map((c) => (
                  <div key={c.move} className="sg-cost">
                    <b>{c.move}</b>
                    <span className="sg-bar">
                      {[1, 2, 3].map((k) => (
                        <i key={k} className={k <= c.cost ? 'on' : ''} />
                      ))}
                    </span>
                    <em>{c.note}</em>
                  </div>
                ))}
              </div>
            )}
            {hidden.length > 0 && (
              <div className="sg-hidden" aria-label="What he leaves behind">
                {hidden.map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <KiroGuide line={PLACES.playbook.caption} remark={legal ? 'Tell legal the moment you are sure. The regulator has a clock; your customers have a right to know when it really matters.' : step.remark} />
    </div>
  );
}

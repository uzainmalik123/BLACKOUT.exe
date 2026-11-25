// The Evidence Observatory (D-222): a dark observatory over a tunnel of streaming log fragments. At the top, the
// sample access line as one request to take apart: choose a field and Kiro's scanner closes round it and names it.
// Below, every signal of the file as a pair of lanes, emerald for normal and crimson for worth a look; choosing one
// ties the two together. "Spot the intruder" is an optional challenge of three events made from the file's own line
// and words; it changes no score. Now and then an abnormal line stretches into a silhouette and Death's eyes show
// in the data.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { KiroGuide } from './KiroGuide';
import { FIELDS, LANES, PLACES, SAMPLE, suspects } from './sceneData';

const SUSPECTS = suspects();

/** The tunnel behind everything: frames rushing out of the dark, ordinary fragments drifting past. */
function useTunnel(ref: RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const c = ref.current;
    const host = c?.parentElement;
    const g = c?.getContext('2d');
    if (!c || !host || !g) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bits = [...FIELDS.map((f) => f.text), ...LANES.map((l) => l.signal)];
    let W = 0;
    let H = 0;
    const size = () => {
      W = host.clientWidth;
      H = host.clientHeight;
      c.width = W;
      c.height = H;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / 30) return;
      last = now;
      const t = reduced ? 0 : (now - t0) / 1000;
      g.fillStyle = '#02040a';
      g.fillRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H * 0.5;
      for (let k = 0; k < 12; k++) {
        const d = ((k / 12 + t * 0.035) % 1) ** 2;
        g.strokeStyle = `rgba(70, 232, 255, ${(0.04 + 0.18 * d).toFixed(3)})`;
        g.lineWidth = 1 + 2 * d;
        g.strokeRect(cx - (W * (0.05 + d * 1.2)) / 2, cy - (H * (0.05 + d * 1.1)) / 2, W * (0.05 + d * 1.2), H * (0.05 + d * 1.1));
      }
      g.font = '12px "Cascadia Mono", Consolas, monospace';
      g.textAlign = 'center';
      for (let i = 0; i < 22; i++) {
        const d = ((Math.sin(i * 12.9) * 0.5 + 0.5 + t * 0.04) % 1) ** 1.5;
        const a = (Math.sin(i * 7.7) * 0.5 + 0.5) * Math.PI * 2;
        const r = (0.12 + d * 0.9) * Math.min(W, H) * 0.6;
        g.fillStyle = `rgba(61, 220, 151, ${(0.08 + 0.3 * d).toFixed(3)})`;
        g.fillText(bits[i % bits.length] ?? '', cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r * 0.8);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ref]);
}

export function EvidenceObservatory() {
  const bg = useRef<HTMLCanvasElement>(null);
  useTunnel(bg);
  const [field, setField] = useState<number | null>(null);
  const [lane, setLane] = useState<number | null>(null);
  const [spot, setSpot] = useState(false);
  const [pick, setPick] = useState<number | null>(null);

  const remark =
    pick !== null
      ? SUSPECTS[pick]!.intruder
        ? 'Good eye. Nobody searches for that. That is someone talking to the database through the search box.'
        : 'Look again. That one is a customer looking for juice.'
      : lane !== null
        ? `${LANES[lane]!.signal}: learn the green side, and the red side will jump out at you.`
        : field !== null
          ? `That part says ${FIELDS[field]!.label}.`
          : null;

  return (
    <div className="fs-scene eo-root">
      <canvas ref={bg} className="fs-canvas" aria-hidden="true" />
      <div className="eo-eyes" aria-hidden="true" />
      <div className="eo-stretch" aria-hidden="true" />
      <section className="eo-request" aria-label="One normal request, taken apart">
        <p className="eo-kicker">One quiet customer · choose a part</p>
        <div className="eo-line">
          {FIELDS.map((p, i) => (
            <button key={p.label} type="button" className={`eo-field${field === i ? ' on' : ''}`} onClick={() => setField(field === i ? null : i)} aria-pressed={field === i}>
              {p.text}
              {field === i && <span className="eo-label">{p.label}</span>}
            </button>
          ))}
        </div>
      </section>
      <section className="eo-lanes" aria-label="Normal and worth a look, signal by signal">
        <div className="eo-heads" aria-hidden="true">
          <span className="ok">Normal</span>
          <span />
          <span className="bad">Worth a look</span>
        </div>
        {LANES.map((l, i) => (
          <button key={l.signal} type="button" className={`eo-lane${lane === i ? ' on' : ''}`} onClick={() => setLane(lane === i ? null : i)} aria-pressed={lane === i} style={{ ['--i' as string]: i }}>
            <span className="eo-ok">{l.normal}</span>
            <b className="eo-signal">{l.signal}</b>
            <span className="eo-bad">{l.watch}</span>
          </button>
        ))}
        <p className="eo-noise">
          <b>Background noise</b> {SAMPLE.noise}
        </p>
      </section>
      <button type="button" className={`eo-spot-open${spot ? ' on' : ''}`} onClick={() => setSpot((s) => !s)} aria-expanded={spot}>
        {spot ? 'Close the challenge' : 'Spot the intruder'}
      </button>
      {spot && (
        <div className="eo-spot" role="dialog" aria-label="Spot the intruder">
          <p className="eo-kicker">Spot the intruder · which one deserves a look? (practice, not scored)</p>
          {SUSPECTS.map((s, i) => {
            const state = pick === null ? '' : s.intruder ? ' right' : i === pick ? ' wrong' : ' faded';
            return (
              <button key={i} type="button" className={`eo-suspect${state}`} disabled={pick !== null} onClick={() => setPick(i)}>
                <kbd>{i + 1}</kbd>
                <code>{s.line}</code>
                {pick !== null && (s.intruder || i === pick) && <span className="eo-why">{s.why}</span>}
              </button>
            );
          })}
          {pick !== null && (
            <button type="button" className="fs-back" onClick={() => setPick(null)}>
              Try again
            </button>
          )}
        </div>
      )}
      <KiroGuide line={PLACES['normal-traffic'].caption} remark={remark} />
    </div>
  );
}

// The drill's coach on the screen itself (UI-12, D-274): a spotlight cut out of a dim layer around the real element, an
// amber outline, and a callout beside it with the step's words. For the flag, block, password and search steps it first
// pins and outlines the suspicious request in the log and says why it looks wrong, then points at the tool that stops
// it. The dim never takes the pointer, and the coach never acts: the player does. While a callout waits for Next, the
// drill's clock waits (the director's hold). What it says and where is pure logic in coach.ts.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TrainingView } from '../../engine/training';
import { anchorTarget, calloutAt, marksFor, openWords, suspectIp, suspectLine, type Rect } from './coach';
import type { Run } from './run';
import type { ToolId } from './windows';

export interface CoachProps {
  run: Run;
  view: TrainingView;
  open: ReadonlySet<ToolId>;
  /** The callout is waiting for the player to read it: hold the drill's clock. */
  onHold?: (on: boolean) => void;
  /** The access line to keep shown in the log window (or none). */
  onPin: (index: number | null) => void;
}

/** Scrolls the list a target sits in (only that list, never a window's frame) so the target is in view. */
function reveal(el: HTMLElement): void {
  for (let p = el.parentElement; p && !p.classList.contains('ns-win'); p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) {
      const b = p.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) p.scrollTop += r.top - b.top - Math.max(0, (b.height - r.height) / 2);
      return;
    }
  }
}

const same = (a: Rect[], b: Rect[]) => a.length === b.length && a.every((r, i) => r.x === b[i]!.x && r.y === b[i]!.y && r.w === b[i]!.w && r.h === b[i]!.h);

export function Coach({ run, view, open, onHold, onPin }: CoachProps) {
  const w = run.engine.world;
  const marks = useMemo(() => marksFor(view.step), [view.step]);
  // the callout within the step: reset when the step changes
  const [pos, setPos] = useState({ step: -1, mark: 0 });
  const at = pos.step === view.index ? Math.min(pos.mark, marks.length - 1) : 0;
  const mark = marks[at]!;
  const done = view.state === 'done';
  const reading = !done && mark.wait === 'next';
  const ip = suspectIp(w);

  // the suspicious request is picked once per callout, so it stays put while the player reads
  const suspect = useMemo(
    () => (mark.line ? suspectLine(w, mark.line, mark.line === 'scan' ? (ip ?? undefined) : undefined) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.index, at, mark.line],
  );
  useEffect(() => onPin(suspect && !done ? suspect.index : null), [suspect, done, onPin]);
  useEffect(() => () => onPin(null), [onPin]);
  useEffect(() => onHold?.(reading), [reading, onHold]);
  useEffect(() => () => onHold?.(false), [onHold]);

  const targets = mark.anchors.map((a) => anchorTarget(a, open, ip));
  const opens = targets.find((t) => t.opens)?.opens;
  const selectors = targets.map((t) => t.selectors);
  const key = JSON.stringify(selectors);

  // where the targets are on screen, followed every frame (windows move, resize, open)
  const [rects, setRects] = useState<Rect[]>([]);
  const [box, setBox] = useState({ w: 380, h: 180 });
  const call = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last: Rect[] = [];
    const shown = new WeakSet<HTMLElement>();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const found: Rect[] = [];
      for (const list of JSON.parse(key) as string[][]) {
        for (const sel of list) {
          const el = document.querySelector<HTMLElement>(sel);
          // a target inside a scrolling list (the deploy button under a long diff) is brought into view once
          if (el && !shown.has(el) && !sel.includes('data-coach="line"')) {
            shown.add(el);
            reveal(el);
          }
          const r = el?.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) {
            found.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
            break;
          }
        }
      }
      if (!same(found, last)) {
        last = found;
        setRects(found);
      }
      const c = call.current;
      if (c && (Math.abs(c.offsetWidth - box.w) > 1 || Math.abs(c.offsetHeight - box.h) > 1)) setBox({ w: c.offsetWidth, h: c.offsetHeight });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [key, box.w, box.h]);

  if (view.complete) return null;
  if (done && view.by !== 'action') return null; // timed out: move on without a line that isn't true (ENGINE_API §1.2)

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centred = selectors.every((s) => s.length === 0);
  const place = calloutAt(centred ? null : (rects[0] ?? null), box, { w: vw, h: vh });
  const text = done ? view.step.done : mark.line ? (suspect?.why ?? 'Watch the log: the requests behind this alert show up there, one line each.') : mark.text;

  return (
    <div className={`pl-coach${reading ? ' is-reading' : ''}`} aria-live="polite">
      <svg className="pl-coach-dim" width={vw} height={vh} aria-hidden>
        <defs>
          <mask id="pl-coach-holes">
            <rect width={vw} height={vh} fill="white" />
            {rects.map((r, i) => (
              <rect key={i} x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={8} fill="black" />
            ))}
          </mask>
        </defs>
        <rect width={vw} height={vh} mask="url(#pl-coach-holes)" />
      </svg>
      {rects.map((r, i) => (
        <i key={i} className="pl-coach-ring" style={{ left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12 }} aria-hidden />
      ))}
      <div ref={call} className="pl-coach-call" role="dialog" aria-label="The drill's coach" style={{ left: place.x, top: place.y }}>
        <small className="pl-coach-step">
          Drill · step {view.step.step} of 6{marks.length > 1 && !done ? ` · ${at + 1}/${marks.length}` : ''}
        </small>
        {!done && opens && <p className="pl-coach-open">{openWords(opens)}</p>}
        <p className="pl-coach-text">{text}</p>
        {!done && suspect && <code className="pl-coach-line">{suspect.text}</code>}
        {done ? null : reading ? (
          <span className="pl-lesson-row">
            <button type="button" className="pl-lesson" autoFocus onClick={() => setPos({ step: view.index, mark: at + 1 })}>
              Next
            </button>
            {at > 0 && (
              <button type="button" className="pl-lesson-skip" onClick={() => setPos({ step: view.index, mark: at - 1 })}>
                Back
              </button>
            )}
          </span>
        ) : (
          <span className="pl-lesson-row">
            <em className="pl-coach-your">Your move.</em>
            {at > 0 && (
              <button type="button" className="pl-lesson-skip" onClick={() => setPos({ step: view.index, mark: at - 1 })}>
                Back
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

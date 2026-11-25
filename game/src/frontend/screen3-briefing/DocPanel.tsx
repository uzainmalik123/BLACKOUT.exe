// The briefing files on screen (CON-01, D-182, D-222): a tab per file, each opening as a place to explore
// (files/: the Chart Room, the Identity Archive, the Evidence Observatory, the Six Gates); "Full details" shows the file itself, rendered
// from its Markdown as real elements (never raw HTML). `DocPanel` is driven by its parent (the briefing screen);
// `BriefingFiles` is the same panel on its own, with its own keys, for reopening the files after the briefing.

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { DOCS, type DocId } from './briefing';
import { PLACES } from './files/sceneData';
import { SCENE_ICONS, Scene } from './files/Scene';
import { parseMarkdown, type Block, type Inline } from './markdown';
import './DocPanel.css';

function Inl({ xs }: { xs: Inline[] }) {
  return (
    <>
      {xs.map((x, i) =>
        x.kind === 'bold' ? <strong key={i}>{x.text}</strong> : x.kind === 'code' ? <code key={i}>{x.text}</code> : <Fragment key={i}>{x.text}</Fragment>,
      )}
    </>
  );
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.kind) {
    case 'heading':
      return b.level === 1 ? (
        <h2 key={i} className="bd-h1">
          <Inl xs={b.text} />
        </h2>
      ) : b.level === 2 ? (
        <h3 key={i} className="bd-h2">
          <Inl xs={b.text} />
        </h3>
      ) : (
        <h4 key={i} className="bd-h3">
          <Inl xs={b.text} />
        </h4>
      );
    case 'para':
      return (
        <p key={i}>
          <Inl xs={b.text} />
        </p>
      );
    case 'list':
      return (
        <ul key={i}>
          {b.items.map((it, n) => (
            <li key={n}>
              <Inl xs={it} />
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div key={i} className="bd-table">
          <table>
            <thead>
              <tr>
                {b.head.map((h, n) => (
                  <th key={n}>
                    <Inl xs={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, n) => (
                <tr key={n}>
                  {r.map((c, m) => (
                    <td key={m}>
                      <Inl xs={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'code':
      return (
        <pre key={i} className="bd-code">
          {b.text}
        </pre>
      );
  }
}

export interface DocPanelProps {
  doc: number;
  inspected?: readonly DocId[];
  onSelect: (i: number) => void;
  onClose: () => void;
  bodyRef?: Ref<HTMLDivElement>;
  className?: string;
  /** Showing the full text instead of the picture. */
  full?: boolean;
  /** Given, the panel offers the picture and the full text; without it, only the text. */
  onFull?: (full: boolean) => void;
}

export function DocPanel({ doc, inspected = [], onSelect, onClose, bodyRef, className = '', full = false, onFull }: DocPanelProps) {
  const file = DOCS[doc]!;
  const blocks = useMemo(() => parseMarkdown(file.markdown), [file]);
  return (
    <section className={`bd-panel ${className}`} role="dialog" aria-label={file.title}>
      <header className="bd-tabs" role="tablist">
        {DOCS.map((d, i) => (
          <button key={d.id} type="button" role="tab" aria-selected={i === doc} className={`bd-tab${i === doc ? ' on' : ''}${inspected.includes(d.id) ? ' read' : ''}`} onClick={() => onSelect(i)}>
            <span className="bd-tab-ico">{SCENE_ICONS[d.id]}</span>
            <span className="bd-tab-text">
              <b>{PLACES[d.id].name}</b>
              <small>{d.title}</small>
            </span>
          </button>
        ))}
        {onFull && (
          <button type="button" className={`bd-mode${full ? ' on' : ''}`} onClick={() => onFull(!full)} title="F">
            {full ? 'Explore' : 'Full details'}
          </button>
        )}
        <button type="button" className="bd-close" onClick={onClose} aria-label="Close the file">
          Close
        </button>
      </header>
      <div ref={bodyRef} className={`bd-body${full || !onFull ? '' : ' picture'}`} tabIndex={-1}>
        {full || !onFull ? blocks.map(renderBlock) : <Scene key={file.id} id={file.id} />}
      </div>
    </section>
  );
}

/** Scroll a file's body by lines, or to its top or bottom. */
export function scrollDoc(el: HTMLElement | null, by: number | 'top' | 'bottom'): void {
  if (!el) return;
  if (by === 'top') el.scrollTo({ top: 0 });
  else if (by === 'bottom') el.scrollTo({ top: el.scrollHeight });
  else el.scrollBy({ top: by * 28 });
}

/** The files on their own, for reopening them after the briefing: Left/Right (or 1-4) switch, Up/Down scroll, F toggles the full details, Escape closes. */
export function BriefingFiles({ inspected, onClose }: { inspected?: readonly DocId[]; onClose: () => void }) {
  const [doc, setDoc] = useState(0);
  const [full, setFull] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const n = DOCS.length;
      if (e.key === 'Escape') close.current();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setDoc((d) => (d + (e.key === 'ArrowLeft' ? -1 : 1) + n) % n);
      else if (/^[1-4]$/.test(e.key)) setDoc(Number(e.key) - 1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') scrollDoc(body.current, e.key === 'ArrowUp' ? -1 : 1);
      else if (e.key === 'f' || e.key === 'F') setFull((f) => !f);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
  return (
    <div className="bd-modal">
      <DocPanel doc={doc} inspected={inspected} onSelect={setDoc} onClose={onClose} bodyRef={body} full={full} onFull={setFull} />
    </div>
  );
}

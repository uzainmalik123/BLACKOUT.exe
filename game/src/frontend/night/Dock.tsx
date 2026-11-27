// The dock and the floating windows (UI-11, D-234, D-240): every tool one click on the dock along the left edge, each
// opening as a window over the battlefield, dragged by its bar, resized from its right edge, bottom edge or corner
// (D-272), closed at its top right, several open at once. The dock is two columns in four labelled groups (D-270). The
// window manager's state is pure (windows.ts); this file only draws it and turns the pointer into its moves.

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { BAR, DOCK_GROUPS, type Tool, type ToolId, type Win } from './windows';

export interface DockProps {
  tools: readonly Tool[];
  open: ReadonlySet<ToolId>;
  /** Entries lit by the tutorial (CON-03) or, on Easy, the console of the gate an alert names (D-235). */
  lit: ReadonlySet<ToolId>;
  /** The change freeze is on: change consoles carry a lock (SYS-22). */
  frozen: boolean;
  /** The whole dock is lit (the tutorial's "dock" step). */
  glow?: boolean;
  onPick: (id: ToolId) => void;
}

export function Dock({ tools, open, lit, frozen, glow, onPick }: DockProps) {
  return (
    <nav className={`pl-dock${glow ? ' is-lit' : ''}`} aria-label="Tools" data-coach="dock">
      {DOCK_GROUPS.map((g) => {
        const items = tools.filter((t) => t.group === g.id);
        if (!items.length) return null;
        return (
          <div key={g.id} className="pl-dock-group" role="group" aria-label={g.label}>
            <small className="pl-dock-cap">{g.label}</small>
            {items.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`pl-dock-item${open.has(t.id) ? ' is-open' : ''}${lit.has(t.id) ? ' is-lit' : ''}`}
                aria-pressed={open.has(t.id)}
                title={frozen && t.change ? `${t.label} (locked: no incident declared)` : t.label}
                data-coach={`dock:${t.id}`}
                onClick={() => onPick(t.id)}
              >
                <i aria-hidden>{t.glyph}</i>
                <span>{t.label}</span>
                {frozen && t.change && (
                  <s className="pl-dock-lock" aria-hidden>
                    🔒
                  </s>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

export interface FloatWindowProps {
  win: Win;
  title: string;
  onClose: () => void;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  /** D-272: a new size from a handle (the window manager keeps it inside the view and above the minimum). */
  onResize: (w: number, h: number) => void;
  lit?: boolean;
  /**
   * The window's body draws its own bar (the terminal's, Kiro's) and its own close at the top right; any element in
   * it marked `data-drag` is the handle. Otherwise the window draws the monitors' bar with the title and a close.
   */
  bare?: boolean;
  children?: ReactNode;
}

export function FloatWindow({ win, title, onClose, onFocus, onMove, onResize, lit, bare, children }: FloatWindowProps) {
  const down = (e: ReactPointerEvent) => {
    onFocus();
    const t = e.target as HTMLElement;
    if (e.button !== 0 || !t.closest('[data-drag]') || t.closest('button, input, select, a')) return;
    e.preventDefault();
    const dx = e.clientX - win.x;
    const dy = e.clientY - win.y;
    const move = (ev: PointerEvent) => onMove(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** D-272: a handle on the right edge (e), the bottom edge (s) or the corner (se). */
  const grip = (edge: 'e' | 's' | 'se') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const { w: w0, h: h0 } = win;
    const move = (ev: PointerEvent) => onResize(edge === 's' ? w0 : w0 + ev.clientX - x0, edge === 'e' ? h0 : h0 + ev.clientY - y0);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const grips = (
    <>
      <i className="ns-win-grip is-e" aria-hidden onPointerDown={grip('e')} />
      <i className="ns-win-grip is-s" aria-hidden onPointerDown={grip('s')} />
      <i className="ns-win-grip is-se" aria-hidden onPointerDown={grip('se')} />
    </>
  );
  return (
    <section
      className={`ns-win${lit ? ' is-lit' : ''}${bare ? ' is-bare' : ''}`}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      aria-label={title}
      data-coach={`win:${win.id}`}
      onPointerDown={down}
    >
      {bare ? (
        children
      ) : (
        <>
          <header className="ns-mon-bar ns-win-bar" style={{ height: BAR }} data-drag>
            <span className="ns-mon-title">{title}</span>
            <button type="button" className="ns-mon-zoom ns-win-close" onClick={onClose} aria-label={`Close ${title}`}>
              ✕
            </button>
          </header>
          <div className="ns-screen ns-win-body">{children}</div>
        </>
      )}
      {grips}
    </section>
  );
}

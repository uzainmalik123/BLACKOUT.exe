// Kiro at the desk (UI-04, D-223; KIRO-01..06): the panel the player talks to her through. Ask her anything
// (`ask`, 5–20 s on purpose), have her explain a log line (`explain`, from the logs monitor), draft commands for a goal
// (`draft`; the player types or inserts them, and on Easy may run them with one click: `applyDraft`), or ask for a
// hint (`hint`, which the rules decide: null means she has nothing she may say now). Answers are the server's, or
// the rule-written text labelled "offline" when it is unreachable. She never acts for the player.

import { useEffect, useRef, useState } from 'react';
import type { KiroDraft } from '../../kiro/client';
import type { Run } from './run';

export interface KiroLine {
  id: number;
  who: 'kiro' | 'you';
  text: string;
  offline?: boolean;
  draft?: KiroDraft;
  urgent?: boolean;
}

export function KiroPanel({ run, lines, add, insert, onClose }: { run: Run; lines: KiroLine[]; add: (l: Omit<KiroLine, 'id'>) => void; insert: (text: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'ask' | 'draft'>('ask');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const easy = run.difficulty === 'easy';
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, busy]);
  useEffect(() => input.current?.focus(), []);
  const send = async () => {
    const text = q.trim();
    if (!text || busy) return;
    setQ('');
    setBusy(true);
    add({ who: 'you', text: mode === 'draft' ? `Draft: ${text}` : text });
    try {
      if (mode === 'draft') {
        const d = await run.kiro.draft(text);
        add({ who: 'kiro', text: `${d.title}. ${d.why}${d.stripped ? ` (${d.stripped} line${d.stripped === 1 ? '' : 's'} left out: not commands this workstation runs.)` : ''}`, offline: d.offline, draft: d });
      } else {
        const r = await run.kiro.ask(text);
        add({ who: 'kiro', text: r.text, offline: r.offline });
      }
    } finally {
      setBusy(false);
    }
  };
  const hint = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await run.kiro.hint();
      add({ who: 'kiro', text: r ? r.text : "Nothing I can tell you right now that the evidence doesn't. Keep reading it.", offline: r?.offline });
    } finally {
      setBusy(false);
    }
  };
  const apply = async (d: KiroDraft) => {
    setBusy(true);
    try {
      const r = await run.kiro.applyDraft(run.shell, d);
      add({ who: 'kiro', text: r.ok ? `Ran ${r.outputs.length} line${r.outputs.length === 1 ? '' : 's'}. Look at what they said in the terminal's history.` : (r.message ?? 'That did not run.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="ns-kiro" aria-label="Kiro">
      <header>
        <span className="ns-kiro-sigil" aria-hidden>
          ☾
        </span>
        <div>
          <b>Kiro</b>
          <small>{run.kiro.online ? 'with you' : 'offline: rule-written answers'} · {run.kiro.calls}/60 calls</small>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Kiro">
          ✕
        </button>
      </header>
      <div className="ns-kiro-lines" ref={box}>
        {lines.length === 0 && <p className="ns-quiet">Ask me about an alert, a log line, a tool. I won't do it for you.</p>}
        {lines.map((l) => (
          <div key={l.id} className={`ns-kl is-${l.who}${l.urgent ? ' is-urgent' : ''}`}>
            {l.who === 'kiro' && l.offline && <em className="ns-off">Kiro (offline)</em>}
            <p>{l.text}</p>
            {l.draft && l.draft.lines.length > 0 && (
              <div className="ns-draft">
                {l.draft.lines.map((line, i) => (
                  <button key={i} type="button" title="Put this line in the terminal" onClick={() => insert(line)}>
                    <code>{line}</code>
                  </button>
                ))}
                {easy && (
                  <button type="button" className="ns-apply" disabled={busy} onClick={() => void apply(l.draft!)}>
                    Run these lines (Easy)
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="ns-quiet ns-thinking">Kiro is thinking…</p>}
      </div>
      <div className="ns-kiro-in">
        <div className="ns-tabs">
          <button type="button" className={mode === 'ask' ? 'is-on' : ''} onClick={() => setMode('ask')}>
            Ask
          </button>
          <button type="button" className={mode === 'draft' ? 'is-on' : ''} onClick={() => setMode('draft')}>
            Draft commands
          </button>
          <button type="button" onClick={() => void hint()} disabled={busy}>
            Hint
          </button>
        </div>
        <input
          ref={input}
          value={q}
          placeholder={mode === 'ask' ? 'Ask Kiro…' : 'What do you want to do? e.g. find who is scanning'}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') void send();
            if (e.key === 'Escape') onClose();
          }}
          aria-label={mode === 'ask' ? 'Ask Kiro' : 'Goal for Kiro to draft'}
        />
      </div>
    </aside>
  );
}

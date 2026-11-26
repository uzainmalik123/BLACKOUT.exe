// Kiro as the guide through the briefing places (D-222, D-250): the logo's ghost, small and animated, with the
// place's line and a remark on whatever is being inspected. She comes together again and talks each time she has
// something new to say, and can be hushed to a small ghost icon and called back. Text only: reading is never
// interrupted by sound.

import { useState } from 'react';
import { KiroCanvas, KiroIcon } from '../../shared/KiroCanvas';

export function KiroGuide({ line, remark }: { line: string; remark: string | null }) {
  const [hushed, setHushed] = useState(false);
  const text = remark ?? line;

  if (hushed)
    return (
      <button type="button" className="kg-sigil" onClick={() => setHushed(false)} aria-label="Call Kiro back" title="Call Kiro back">
        <KiroIcon />
      </button>
    );
  return (
    <aside className="kg-root" aria-live="polite">
      <KiroCanvas className="kg-portrait" mood="calm" line={text} appear fit={0.8} fps={30} />
      <div className="kg-bubble" key={text}>
        <p className="kg-line">{line}</p>
        {remark && <p className="kg-remark">{remark}</p>}
      </div>
      <button type="button" className="kg-hush" onClick={() => setHushed(true)} aria-label="Hush Kiro" title="Hush Kiro">
        ×
      </button>
    </aside>
  );
}

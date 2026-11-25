import { useEffect, useState } from 'react';
import type { Difficulty } from './rules/vocabulary';
import {
  BriefingFiles,
  BriefingScreen,
  DIFFICULTY_LABEL,
  DOCS,
  MenuScreen,
  SCENARIO,
  TitleScreen,
  stopAllAudio,
  type BriefingResult,
  type MenuChoice,
} from './frontend';

export const TITLE = 'BLACKOUT.exe';

type Screen =
  | { kind: 'title' }
  | { kind: 'menu' }
  | { kind: 'briefing'; choice: MenuChoice }
  | { kind: 'arrives'; choice: MenuChoice; briefing: BriefingResult };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });
  // the menu reopens on the last difficulty picked
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  // sound belongs to the briefing alone: leaving it, by any path, stops everything (D-220)
  useEffect(() => {
    if (screen.kind !== 'briefing') stopAllAudio();
  }, [screen.kind]);

  if (screen.kind === 'menu') {
    return (
      <MenuScreen
        title={TITLE}
        initialDifficulty={difficulty}
        onStart={(choice) => {
          setDifficulty(choice.difficulty);
          setScreen({ kind: 'briefing', choice });
        }}
        onBack={() => setScreen({ kind: 'title' })}
      />
    );
  }

  if (screen.kind === 'briefing') {
    return (
      <BriefingScreen
        title={TITLE}
        choice={screen.choice}
        onBegin={(briefing) => setScreen({ kind: 'arrives', choice: screen.choice, briefing })}
        onBack={() => setScreen({ kind: 'menu' })}
      />
    );
  }

  if (screen.kind === 'arrives') return <DeathArrivesPlaceholder choice={screen.choice} briefing={screen.briefing} onMenu={() => setScreen({ kind: 'menu' })} />;

  return (
    <TitleScreen
      title={TITLE}
      onEnterSystem={() => setScreen({ kind: 'menu' })}
      onExit={() => {
        window.close();
      }}
    />
  );
}

/**
 * A clearly labelled stand-in for "Death arrives" (screen 4) and the dashboard, neither built yet. It carries what the
 * briefing handed over and keeps the briefing files reachable, as the dashboard must (UI-03, UI-04).
 */
function DeathArrivesPlaceholder({ choice, briefing, onMenu }: { choice: MenuChoice; briefing: BriefingResult; onMenu: () => void }) {
  const [files, setFiles] = useState(false);

  const button = {
    background: 'none',
    border: '1px solid rgba(236,229,211,0.35)',
    color: '#ece5d3',
    fontFamily: 'Cinzel, Georgia, serif',
    padding: '12px 22px',
    cursor: 'pointer',
    letterSpacing: 3,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
  };
  return (
    <main style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#030304', color: '#ece5d3', fontFamily: '"Cormorant Garamond", Georgia, serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 680, padding: 36, border: '1px solid rgba(236,229,211,0.22)', background: 'rgba(6,6,8,0.95)' }}>
        <p style={{ margin: '0 0 8px', fontFamily: 'Cinzel, Georgia, serif', letterSpacing: 6, fontSize: 13, color: 'rgba(236,229,211,0.55)', textTransform: 'uppercase' }}>Placeholder · screen 4 is not built yet</p>
        <h1 style={{ margin: '0 0 18px', fontFamily: 'Cinzel, Georgia, serif', letterSpacing: 8, color: '#ff5a66', textTransform: 'uppercase' }}>Death arrives</h1>
        <p style={{ fontSize: 20, lineHeight: 1.5, margin: '0 0 6px', fontStyle: 'italic' }}>
          {SCENARIO.name} · {DIFFICULTY_LABEL[choice.difficulty]} · the night shift has begun
        </p>
        <p style={{ fontSize: 18, lineHeight: 1.5, margin: '0 0 26px', color: 'rgba(236,229,211,0.7)', fontStyle: 'italic' }}>
          Briefing watched: {briefing.seen ? `${briefing.seen} of ${briefing.of} parts · quiz ${briefing.right} of ${briefing.quizzes}` : 'skipped'} · the {DOCS.length} briefing files stay open to you
        </p>
        <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>
          <button type="button" style={button} onClick={() => setFiles(true)}>
            Briefing files
          </button>
          <button type="button" style={button} onClick={onMenu}>
            Back to menu
          </button>
        </div>
      </div>
      {files && <BriefingFiles onClose={() => setFiles(false)} />}
    </main>
  );
}

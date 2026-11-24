import { useState } from 'react';
import type { Difficulty } from './rules/vocabulary';
import { DIFFICULTY_LABEL, MenuScreen, SCENARIO, TitleScreen, type MenuChoice } from './frontend';

export const TITLE = 'BLACKOUT.exe';

type Screen = { kind: 'title' } | { kind: 'menu' } | { kind: 'started'; choice: MenuChoice };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });
  // the menu reopens on the last difficulty picked
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  if (screen.kind === 'menu') {
    return (
      <MenuScreen
        title={TITLE}
        initialDifficulty={difficulty}
        onStart={(choice) => {
          setDifficulty(choice.difficulty);
          setScreen({ kind: 'started', choice });
        }}
        onBack={() => setScreen({ kind: 'title' })}
      />
    );
  }

  if (screen.kind === 'started') {
    // The briefing (UI-03) is not built yet; this placeholder stands in for it.
    return (
      <main style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#020305', color: '#00ff66', fontFamily: 'Courier New, monospace' }}>
        <div style={{ textAlign: 'center', maxWidth: 640, padding: 32, border: '1px solid rgba(0,255,102,0.3)', background: 'rgba(6,10,14,0.95)' }}>
          <h1 style={{ margin: '0 0 16px', letterSpacing: 4 }}>{TITLE} // SOC MAINFRAME</h1>
          <p style={{ color: '#94a3b8', lineHeight: 1.6, marginBottom: 24 }}>
            [ ACCESS GRANTED ] {SCENARIO.name} · {DIFFICULTY_LABEL[screen.choice.difficulty]}
            <br />
            The briefing is not built yet.
          </p>
          <button
            type="button"
            onClick={() => setScreen({ kind: 'menu' })}
            style={{
              background: 'rgba(0, 255, 102, 0.15)',
              border: '1px solid #00ff66',
              color: '#00ff66',
              fontFamily: 'inherit',
              padding: '12px 24px',
              cursor: 'pointer',
              letterSpacing: 2,
              fontWeight: 700,
            }}
          >
            [ BACK TO MENU ]
          </button>
        </div>
      </main>
    );
  }

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

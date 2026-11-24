import { useState } from 'react';
import { TitleScreen } from './frontend';

export const TITLE = 'BLACKOUT.exe';

export function App() {
  const [inSystem, setInSystem] = useState(false);

  if (inSystem) {
    return (
      <main style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#020305', color: '#00ff66', fontFamily: 'Courier New, monospace' }}>
        <div style={{ textAlign: 'center', maxWidth: 640, padding: 32, border: '1px solid rgba(0,255,102,0.3)', background: 'rgba(6,10,14,0.95)' }}>
          <h1 style={{ margin: '0 0 16px', letterSpacing: 4 }}>{TITLE} // SOC MAINFRAME</h1>
          <p style={{ color: '#94a3b8', lineHeight: 1.6, marginBottom: 24 }}>
            [ ACCESS GRANTED ] Terminal workstation verified.
            <br />
            Defensive protocols online. Death is active in Sector 0.
          </p>
          <button
            type="button"
            onClick={() => setInSystem(false)}
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
            [ DISCONNECT TO GATE ]
          </button>
        </div>
      </main>
    );
  }

  return (
    <TitleScreen
      title={TITLE}
      onEnterSystem={() => setInSystem(true)}
      onExit={() => {
        window.close();
      }}
    />
  );
}

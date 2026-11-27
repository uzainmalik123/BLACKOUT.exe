import { useEffect, useState } from 'react';
import type { Difficulty } from './rules/vocabulary';
import { BriefingScreen, MenuScreen, NightShift, TitleScreen, stopAllAudio, type BriefingResult, type MenuChoice } from './frontend';

export const TITLE = 'BLACKOUT.exe';

type Screen =
  | { kind: 'title' }
  | { kind: 'menu' }
  | { kind: 'briefing'; choice: MenuChoice }
  | { kind: 'night'; choice: MenuChoice; briefing: BriefingResult; attempt: number; start?: 'shift' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });
  // the menu reopens on the last difficulty picked
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  // sound belongs to the screen that made it: leaving one, by any path, stops everything (D-220). The night shift
  // starts its own sound as it mounts, before this runs, so the briefing's is stopped at the hand-over instead.
  useEffect(() => {
    if (screen.kind !== 'briefing' && screen.kind !== 'night') stopAllAudio();
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
        onBegin={(briefing) => {
          stopAllAudio();
          setScreen({ kind: 'night', choice: screen.choice, briefing, attempt: 0 });
        }}
        onBack={() => setScreen({ kind: 'menu' })}
      />
    );
  }

  if (screen.kind === 'night') {
    // a retry is a fresh run on a fresh engine (new seed), at the same or another level, straight to the desk
    return (
      <NightShift
        key={screen.attempt}
        difficulty={screen.choice.difficulty}
        skipPrologue={screen.attempt > 0}
        start={screen.start}
        // the drill's card hands over to the real shift, at the level picked in the menu, straight at the desk (D-273)
        onShift={() => {
          stopAllAudio();
          setScreen({ ...screen, attempt: screen.attempt + 1, start: 'shift' });
        }}
        onMenu={() => setScreen({ kind: 'menu' })}
        onAgain={(d) => {
          stopAllAudio();
          setDifficulty(d);
          setScreen({ kind: 'night', choice: { ...screen.choice, difficulty: d }, briefing: screen.briefing, attempt: screen.attempt + 1 });
        }}
      />
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

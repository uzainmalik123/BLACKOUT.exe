// The night shift's prologue (UI-10, D-223, D-224) as pure state, free of the DOM so it can be tested: the dark,
// Death's eyes, waking in the office, Kiro's approach and lines, the handshake, following her to the desk, sitting
// down, the login, the alarm, and the shift. Time moves it on where the story carries itself; the player's keys move
// it on where the player has to act (E to shake her hand and to sit, W to follow). Kept short on purpose (D-224).

export type Phase =
  | 'dark' // black, breathing
  | 'eyes' // Death's eyes open, follow the mouse
  | 'wake' // the office fades in, first person
  | 'approach' // Kiro walks out of the dark side of the room
  | 'intro' // her lines
  | 'offer' // her hand held out: E to shake it
  | 'shake' // the handshake plays: reach, grip, shake, let go
  | 'after' // "Come on."
  | 'walk' // she walks to the desk; W follows
  | 'seat' // at the chair: E to sit
  | 'sitting' // the camera lowers to the desk
  | 'login' // the workstation logs the operator in; waits for the run to be ready
  | 'alarm' // the first alert: lights flicker, the alarm (over the live play screen, D-243)
  | 'shift'; // the play screen is live: the shift begins, the calm (SYS-22)

export interface Flow {
  phase: Phase;
  /** Seconds in this phase. */
  t: number;
  /** 0..1 how far the player has walked toward the desk. */
  walked: number;
}

export type Input =
  | { kind: 'time'; dt: number }
  | { kind: 'interact' } // E (or a click on her hand)
  | { kind: 'walk'; dt: number } // W held for dt seconds
  | { kind: 'ready' } // the run is ready: the desk shows and the shift begins
  | { kind: 'alarm' } // the first alert opened during the shift
  | { kind: 'skip' }; // jump straight to the shift (retries, the menu)

/** How long the story phases last on their own, in seconds. */
export const DURATION: Partial<Record<Phase, number>> = {
  dark: 2,
  eyes: 4.5,
  wake: 2,
  approach: 3.5,
  intro: 5,
  shake: 3.4,
  after: 2.2,
  sitting: 1.8,
  login: 2,
  alarm: 3.5,
};

/** The handshake's beats, in seconds into it: the hands reach, the fingers close, two pumps, they let go. */
export const SHAKE = { reach: 0.6, grip: 1.1, pumpEnd: 2.6, release: 3.4 } as const;

/** Seconds of W to reach the desk. */
export const WALK_SECONDS = 2.2;

const NEXT: Partial<Record<Phase, Phase>> = {
  dark: 'eyes',
  eyes: 'wake',
  wake: 'approach',
  approach: 'intro',
  intro: 'offer',
  shake: 'after',
  after: 'walk',
  sitting: 'login',
  alarm: 'shift',
};

export const startFlow = (): Flow => ({ phase: 'dark', t: 0, walked: 0 });

const go = (f: Flow, phase: Phase): Flow => ({ ...f, phase, t: 0 });

export function step(f: Flow, input: Input): Flow {
  switch (input.kind) {
    case 'skip':
      return { ...go(f, 'shift'), walked: 1 };
    case 'time': {
      const next: Flow = { ...f, t: f.t + Math.max(0, input.dt) };
      const d = DURATION[f.phase];
      const n = NEXT[f.phase];
      if (d !== undefined && n && next.t >= d) return go(next, n);
      return next; // the login waits for the run
    }
    case 'interact':
      if (f.phase === 'offer') return go(f, 'shake');
      if (f.phase === 'seat') return go(f, 'sitting');
      return f;
    case 'walk': {
      if (f.phase !== 'walk') return f;
      const walked = Math.min(1, f.walked + Math.max(0, input.dt) / WALK_SECONDS);
      return walked >= 1 ? { ...go(f, 'seat'), walked } : { ...f, walked };
    }
    case 'ready':
      if (f.phase === 'login' && f.t >= (DURATION.login ?? 0)) return go(f, 'shift');
      return f;
    case 'alarm':
      if (f.phase === 'shift') return go(f, 'alarm');
      return f;
  }
}

/** The handshake's progress at `t` seconds: how far the hands have reached, how closed the grip is, the pump. */
export function handshake(t: number): { reach: number; grip: number; pump: number; release: number } {
  const c = (v: number) => Math.max(0, Math.min(1, v));
  return {
    reach: c(t / SHAKE.reach),
    grip: c((t - SHAKE.reach) / (SHAKE.grip - SHAKE.reach)),
    pump: t > SHAKE.grip && t < SHAKE.pumpEnd ? (t - SHAKE.grip) / (SHAKE.pumpEnd - SHAKE.grip) : 0,
    release: c((t - SHAKE.pumpEnd) / (SHAKE.release - SHAKE.pumpEnd)),
  };
}

/** The prompt to show, if the player has to act. */
export function prompt(f: Flow): string | null {
  switch (f.phase) {
    case 'offer':
      return '[E] Shake hand';
    case 'walk':
      return '[W] Follow her';
    case 'seat':
      return '[E] Sit down';
    default:
      return null;
  }
}

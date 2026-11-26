// The training shift (SYS-24, D-236): a scripted drill in place of the Director. The company's own security team plays
// three loud variants, one per step, slowly; each step waits for the action Kiro's tutorial teaches (TRAINING_STEPS,
// CON-03) or its timeout, shows its `done` line, then the next. It ends in "drill complete": no verdict, no report.
import { TRAINING_STEPS, type TrainingStep } from '../content/kiro-fallback';
import type { MoveId } from '../rules/vocabulary';
import { LOGIN_RATE_LIMIT } from './bandages';
import { CONFIG } from './config';
import { play } from './director';
import type { RecordingLibrary } from './library';
import { emit } from './log';
import { activeDeathReplay } from './replay';
import type { World } from './state';

const S = 1000; // real ms

export interface TrainingScriptStep {
  teach: TrainingStep;
  /** The drill move this step plays (a loud variant), replayed while the step waits unless `once` (then once a drill). */
  move?: { move: MoveId; variant: string; once?: boolean };
  /**
   * `step`: the step (its text) starts as soon as the one before is over, and its move `leadInRealMs` later. `alert`:
   * its move starts `leadInRealMs` after the step before is over, and the step itself only once that move has opened an
   * alert (its text reads "a new alert…"), or `alertWaitRealMs` after the move could start, whichever comes first.
   */
  startsOn: 'step' | 'alert';
  /** Real ms before the step's move may start (from the step's start, or from the end of the one before for `alert`). */
  leadInRealMs: number;
  /** The taught action is done. */
  waitFor: (world: World) => boolean;
  /** Real ms from the step's start after which it ends anyway. */
  timeoutRealMs: number;
  /** Real ms the step's `done` line shows (its move still playing) before the next step starts. */
  tailRealMs: number;
}

/** Every address the drill has played from (its starts and its running replays). */
function drillAddresses(world: World): Set<string> {
  const set = new Set<string>();
  for (const e of world.events) if (e.kind === 'move-started') set.add(e.ip);
  for (const r of world.replays) for (const ip of r.ips ?? [r.ip]) set.add(ip);
  return set;
}

const teach = (id: string): TrainingStep => {
  const t = TRAINING_STEPS.find((s) => s.id === id);
  if (!t) throw new Error(`no training step ${id}`);
  return t;
};

const SCAN = { move: 'ATK-01', variant: 'a' } as const; // loud: ffuf, its own user agent
const GUESS = { move: 'ATK-04', variant: 'a' } as const; // loud: hydra
const DUMP = { move: 'ATK-08', variant: 'c', once: true } as const; // loud: sqlmap probing, then a fast dump

/** SYS-24: the script, one step per TRAINING_STEPS entry, in order. Times are _(tune)_. */
export const TRAINING_SCRIPT: readonly TrainingScriptStep[] = [
  { teach: teach('room'), move: SCAN, startsOn: 'step', leadInRealMs: 20 * S, waitFor: (w) => w.incident.declaredAt !== undefined, timeoutRealMs: 60 * S, tailRealMs: 5 * S },
  { teach: teach('flag'), move: SCAN, startsOn: 'step', leadInRealMs: 0, waitFor: (w) => w.flags.some((f) => f.confirmedAt !== undefined), timeoutRealMs: 45 * S, tailRealMs: 5 * S },
  { teach: teach('block'), move: SCAN, startsOn: 'step', leadInRealMs: 0, waitFor: (w) => { const d = drillAddresses(w); return w.firewall.blocked.some((ip) => d.has(ip)); }, timeoutRealMs: 35 * S, tailRealMs: 12 * S },
  { teach: teach('rate-limit'), move: GUESS, startsOn: 'alert', leadInRealMs: 5 * S, waitFor: (w) => w.waf.some((r) => JSON.stringify(r) === JSON.stringify(LOGIN_RATE_LIMIT)), timeoutRealMs: 45 * S, tailRealMs: 8 * S },
  { teach: teach('search-off'), move: DUMP, startsOn: 'alert', leadInRealMs: 5 * S, waitFor: (w) => !w.features.search, timeoutRealMs: 90 * S, tailRealMs: 8 * S },
  { teach: teach('patch'), startsOn: 'step', leadInRealMs: 0, waitFor: (w) => w.patches.applied.includes('search'), timeoutRealMs: 50 * S, tailRealMs: 5 * S },
  { teach: teach('evidence'), startsOn: 'step', leadInRealMs: 0, waitFor: (w) => w.evidence.length > 0, timeoutRealMs: 30 * S, tailRealMs: 3 * S },
];

/** D-236 _(tune)_: the gap before a step's move plays again, the dump's share of the souls, the heartbeat's floor. */
export const TRAINING_TUNING = { replayGapRealMs: 6 * S, alertWaitRealMs: 30 * S, soulCapFraction: 0.1, heartbeatFloor: 20 } as const;

/** World state of a training run (D-236). Absent from the real game's worlds. */
export interface TrainingState {
  index: number; // the current step in TRAINING_SCRIPT
  startedAt?: number; // game ms the current step started (unset until beginShift)
  doneAt?: number; // the step's action was done (or it timed out): its `done` line shows until doneAt + tail
  by?: 'action' | 'timeout';
  pendingSince?: number; // the step before is over and the next (an `alert` step) waits for its move's alert
  lastActiveAt?: number; // the last tick a drill move was running
  completeAt?: number; // "drill complete": advance() stops here
}

export function initialTraining(): TrainingState {
  return { index: 0 };
}

/** What the screens read (UI-12): the current step and where it stands. Never a move id. */
export interface TrainingView {
  index: number;
  count: number;
  step: TrainingStep;
  state: 'teach' | 'done';
  by?: 'action' | 'timeout';
  startedAt?: number;
  complete: boolean;
}

export function trainingView(world: World): TrainingView | undefined {
  const t = world.training;
  if (!t) return undefined;
  const view: TrainingView = {
    index: t.index, count: TRAINING_SCRIPT.length, step: TRAINING_SCRIPT[t.index]!.teach,
    state: t.doneAt === undefined ? 'teach' : 'done', complete: t.completeAt !== undefined,
  };
  if (t.by) view.by = t.by;
  if (t.startedAt !== undefined) view.startedAt = t.startedAt;
  return view;
}

function startStep(world: World, index: number): void {
  const t = world.training!;
  t.index = index;
  t.startedAt = world.clock.gameMs;
  delete t.doneAt;
  delete t.by;
  emit(world, { kind: 'training-step', step: TRAINING_SCRIPT[index]!.teach.id, index });
}

/** Plays the step's move once its lead-in from `base` has passed, no drill move runs and the gap since the last is over. */
function maybePlay(world: World, library: RecordingLibrary, step: TrainingScriptStep, base: number, ratio: number): void {
  const t = world.training!;
  const now = world.clock.gameMs;
  if (activeDeathReplay(world)) {
    t.lastActiveAt = now;
    return;
  }
  if (!step.move || now < base + step.leadInRealMs * ratio) return;
  const { move, variant } = step.move;
  if (step.move.once && world.events.some((e) => e.kind === 'move-started' && e.move === move && e.variant === variant)) return; // once a drill
  if (t.lastActiveAt !== undefined && now - t.lastActiveAt < TRAINING_TUNING.replayGapRealMs * ratio) return; // a breath between two plays
  const v = library.variantsOf(move).find((x) => x.variant === variant);
  if (!v) return;
  play(world, v);
  const replay = activeDeathReplay(world);
  if (replay?.soulCap !== undefined) replay.soulCap = Math.min(replay.soulCap, Math.ceil(world.souls.total * TRAINING_TUNING.soulCapFraction));
  t.lastActiveAt = now;
}

/** One tick of the drill, in place of the Director and the endings (advance.ts). Nothing before beginShift(). */
export function stepTraining(world: World, library: RecordingLibrary): void {
  const t = world.training;
  if (!t || t.completeAt !== undefined || world.shift.beganAt === undefined) return;
  world.heartbeat = Math.max(world.heartbeat, Math.min(world.heartbeatMax, TRAINING_TUNING.heartbeatFloor));
  if (t.startedAt === undefined) startStep(world, 0);
  const ratio = CONFIG[world.difficulty].gameMsPerRealMs;
  const step = TRAINING_SCRIPT[t.index]!;
  const now = world.clock.gameMs;
  if (t.pendingSince !== undefined) return awaitAlert(world, library, ratio);
  maybePlay(world, library, step, t.startedAt!, ratio);
  if (t.doneAt === undefined) {
    const by = step.waitFor(world) ? 'action' : now - t.startedAt! >= step.timeoutRealMs * ratio ? 'timeout' : undefined;
    if (!by) return;
    t.doneAt = now;
    t.by = by;
    emit(world, { kind: 'training-step-done', step: step.teach.id, index: t.index, by });
  }
  if (now - t.doneAt < step.tailRealMs * ratio) return;
  if (t.index + 1 >= TRAINING_SCRIPT.length) {
    t.completeAt = now;
    emit(world, { kind: 'drill-complete' });
    return;
  }
  if (TRAINING_SCRIPT[t.index + 1]!.startsOn === 'step') return startStep(world, t.index + 1);
  t.pendingSince = now;
  awaitAlert(world, library, ratio);
}

/** An `alert` step: its move plays from the end of the step before; the step starts on that move's alert (or the wait's end). */
function awaitAlert(world: World, library: RecordingLibrary, ratio: number): void {
  const t = world.training!;
  const next = TRAINING_SCRIPT[t.index + 1]!;
  const since = t.pendingSince!;
  maybePlay(world, library, next, since, ratio);
  const alerted = world.events.some((e) => e.kind === 'alert-opened' && e.about === next.move?.move && e.t >= since);
  if (!alerted && world.clock.gameMs - since < (next.leadInRealMs + TRAINING_TUNING.alertWaitRealMs) * ratio) return;
  delete t.pendingSince;
  startStep(world, t.index + 1);
}

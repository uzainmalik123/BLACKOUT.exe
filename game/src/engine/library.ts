// The recordings the engine can play, grouped by move (SYS-03). The game injects the committed ones;
// the sims inject made-up ones from src/engine/test-fixtures/.
import type { Recording } from '../recordings/format';
import type { MinionId, MoveId } from '../rules/vocabulary';
import type { VariantInfo } from './facts';

export interface Variant {
  move: MoveId | MinionId;
  variant: string;
  recording: Recording;
  info: VariantInfo;
}

export interface RecordingLibrary {
  variantsOf(move: MoveId | MinionId): Variant[];
}

export const EMPTY_LIBRARY: RecordingLibrary = { variantsOf: () => [] };

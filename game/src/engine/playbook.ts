// The playbook phase (D-233, spec call 4): what the "Now:" strip reads. `watch` during the change freeze, `identify`
// once the incident is declared, `contain` after the first confirmed flag, `eradicate` once no Death move has run for
// one of the level's longest breathers, `recover` after a patch deploys or a backup restores, and back to `contain`
// when a new Death move starts. Driven by the player's own acts and visible events, never by assessor state (D-114).
import { CONFIG } from './config';
import { activeDeathReplay } from './replay';
import type { PlaybookPhase, World } from './state';

function moveTo(world: World, phase: PlaybookPhase): void {
  if (world.playbook.phase === phase) return;
  world.playbook.phase = phase;
  world.playbook.since = world.clock.gameMs;
}

/** Any Death move started, patch applied or backup restored since `since`? */
function since(world: World, kind: 'move-started' | 'patch-applied' | 'restore', t: number): boolean {
  for (let i = world.events.length - 1; i >= 0; i--) {
    const e = world.events[i]!;
    if (e.t < t) return false;
    if (kind === 'restore' ? e.kind === 'action' && e.ok && e.action.type === 'DEF-17' : e.kind === kind) return true;
  }
  return false;
}

export function stepPlaybook(world: World): void {
  const p = world.playbook;
  const now = world.clock.gameMs;
  if (activeDeathReplay(world)) p.lastDeathActiveAt = now;
  if (world.incident.declaredAt === undefined) return moveTo(world, 'watch');
  if (p.phase === 'watch') return moveTo(world, 'identify');
  const confirmed = world.flags.some((f) => f.confirmedAt !== undefined);
  if (p.phase === 'identify') {
    if (confirmed) moveTo(world, 'contain');
    return;
  }
  if (since(world, 'move-started', p.since) && p.phase !== 'contain') return moveTo(world, 'contain');
  if (p.phase === 'contain') {
    const quietFor = now - (p.lastDeathActiveAt ?? p.since);
    if (quietFor >= CONFIG[world.difficulty].breatherGameMs.max) moveTo(world, 'eradicate');
    return;
  }
  if (p.phase === 'eradicate' && (since(world, 'patch-applied', p.since) || since(world, 'restore', p.since))) moveTo(world, 'recover');
}

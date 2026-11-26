// D-233: the "Now:" strip's phase, from visible events and the player's own acts, never from the assessor.
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { CONFIG } from './config';
import { emit } from './log';
import { stepPlaybook } from './playbook';
import { beginShift, declareIncident } from './shift';
import { initialWorld } from './state';

describe('the playbook phase (D-233)', () => {
  it('watch while the incident is undeclared; identify once declared; contain after the first confirmed flag; eradicate after one breather with no Death move; recover after a patch or a restore; back to contain when a new move starts', () => {
    const w = initialWorld(1, 'medium');
    beginShift(w);
    stepPlaybook(w);
    expect(w.playbook).toMatchObject({ phase: 'watch', since: 0 });
    w.clock.gameMs = 1000;
    declareIncident(w, 'alert');
    stepPlaybook(w);
    expect(w.playbook).toMatchObject({ phase: 'identify', since: 1000 });
    w.flags.push({ ip: '203.0.113.9', at: 1000 }); // flagged, not confirmed
    stepPlaybook(w);
    expect(w.playbook.phase).toBe('identify');
    w.clock.gameMs = 2000;
    w.flags[0]!.confirmedAt = 2000;
    stepPlaybook(w);
    expect(w.playbook).toMatchObject({ phase: 'contain', since: 2000 });
    // a Death move running keeps it in contain
    w.replays.push({ id: 1, owner: 'death', move: 'ATK-08', variant: 'd', ip: '203.0.113.85', recordedIp: '203.0.113.85', startedAt: 2000, cursor: 0 });
    w.clock.gameMs = 2000 + CONFIG.medium.breatherGameMs.max;
    stepPlaybook(w);
    expect(w.playbook.phase).toBe('contain');
    w.replays = [];
    w.clock.gameMs += CONFIG.medium.breatherGameMs.max - 1;
    stepPlaybook(w);
    expect(w.playbook.phase).toBe('contain');
    w.clock.gameMs += 1;
    stepPlaybook(w);
    expect(w.playbook).toMatchObject({ phase: 'eradicate', since: w.clock.gameMs });
    w.clock.gameMs += 1000;
    emit(w, { kind: 'patch-applied', patch: 'search' });
    stepPlaybook(w);
    expect(w.playbook.phase).toBe('recover');
    w.clock.gameMs += 1000;
    emit(w, { kind: 'move-started', move: 'ATK-09', variant: 'b', stage: 4, ip: '203.0.113.30' });
    stepPlaybook(w);
    expect(w.playbook).toMatchObject({ phase: 'contain', since: w.clock.gameMs });
  });

  it('a restore counts as recovery too, and the phase never reads the assessor', () => {
    const w = initialWorld(1, 'medium');
    beginShift(w);
    declareIncident(w, 'escalation');
    w.flags.push({ ip: '203.0.113.9', at: 0, confirmedAt: 0 });
    stepPlaybook(w);
    stepPlaybook(w);
    expect(w.playbook.phase).toBe('contain');
    w.clock.gameMs = CONFIG.medium.breatherGameMs.max;
    stepPlaybook(w);
    expect(w.playbook.phase).toBe('eradicate');
    w.clock.gameMs += 1;
    expect(applyAction(w, { type: 'DEF-17', backupId: 0 }).ok).toBe(true);
    stepPlaybook(w);
    expect(w.playbook.phase).toBe('recover');
    expect(JSON.stringify(w.playbook)).not.toMatch(/grade|gap|assess/);
  });
});

// TEST-ONLY. A lab world (D-230): the shift begun with no first-move wait and the incident already declared, so a
// crafted test sees Death move at once and acts freely, as every engine test did before the calm and the freeze.
// The sims (runSim) play the real opening; a test that wants the old lab run on a sim passes `lab: true`.
import { beginShift } from '../shift';
import type { World } from '../state';

export function lab(w: World): World {
  beginShift(w, { firstMoveDelayGameMs: 0 });
  w.shift.firstMoveAt = w.clock.gameMs; // the pests keep their old schedule from 0
  w.incident = { declaredAt: w.clock.gameMs, by: 'escalation' }; // declared before the run, as a crafted world may be
  return w;
}

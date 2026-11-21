// The briefing files (PRD CON-01, UI-03): what a real defender would have before the shift.
// Every fact in them must match the scenario: the baseline DB, the rig's paths and the feature flags.
import systemMap from './01-system-map.md?raw';
import admins from './02-admins.md?raw';
import normalTraffic from './03-normal-traffic.md?raw';
import playbook from './04-playbook.md?raw';

export interface BriefingFile {
  id: 'system-map' | 'admins' | 'normal-traffic' | 'playbook';
  title: string;
  markdown: string;
}

export const BRIEFING: readonly BriefingFile[] = [
  { id: 'system-map', title: 'System map', markdown: systemMap },
  { id: 'admins', title: 'Who has admin access', markdown: admins },
  { id: 'normal-traffic', title: 'What normal looks like', markdown: normalTraffic },
  { id: 'playbook', title: 'Incident response playbook', markdown: playbook },
];

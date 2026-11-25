// The four briefing places (D-222), one per file: the Chart Room, the Identity Archive, the Evidence Observatory and
// the Six Gates. Each is visual first; the file's full text stays one switch away in the panel.

import type { DocId } from '../briefing';
import { ChartRoom } from './ChartRoom';
import { EvidenceObservatory } from './EvidenceObservatory';
import { IdentityArchive } from './IdentityArchive';
import { SixGates } from './SixGates';
import './scenes.css';

export function Scene({ id }: { id: DocId }) {
  switch (id) {
    case 'system-map':
      return <ChartRoom />;
    case 'admins':
      return <IdentityArchive />;
    case 'normal-traffic':
      return <EvidenceObservatory />;
    case 'playbook':
      return <SixGates />;
  }
}

/** The places' marks on their tabs. */
export const SCENE_ICONS: Record<DocId, string> = {
  'system-map': '⚓',
  admins: '✦',
  'normal-traffic': '◉',
  playbook: '⌂',
};

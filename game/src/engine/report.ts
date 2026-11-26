// The post-incident report (SYS-11, D-06, D-112, D-114): the judging engine's final snapshot (assess.ts) in ENGINE_API
// §5's Report shape, with the debrief Kiro writes around it (KIRO-06; an offline placeholder until then) and the
// Markdown for the download button. Nothing here grades: the rules live in assess.ts.
import { evaluate, PHASES, type Assessment, type Phase } from './assess';
import type { World } from './state';

export { evaluate as gradeWorld, fmtGameMs, GRADING, type Grade, type Mistake, type Phase } from './assess';

export interface Report {
  facts: Array<{ label: string; value: string }>;
  grades: Record<Phase, 'A' | 'B' | 'C' | 'D' | 'F'>;
  mistakes: Array<{ title: string; why: string }>;
  missed: string[]; // footholds left behind
  debrief: { text: string; offline: boolean };
  markdown: string;
}

/** KIRO-09: what the report says while Kiro is offline or not built yet. */
export const OFFLINE_DEBRIEF = 'Kiro (offline). The facts and grades above were computed by the rules; the debrief will be written around them when Kiro is reachable.';

export function renderMarkdown(g: Pick<Assessment, 'facts' | 'grades' | 'missed'> & { mistakes: Array<{ title: string; why: string }> }, debrief: Report['debrief']): string {
  const outcome = g.facts.find((f) => f.label === 'Outcome')?.value;
  const lines: string[] = [`# Post-incident report${outcome ? `: ${outcome}` : ''}`, ''];
  lines.push('## Facts', '', ...g.facts.map((f) => `- **${f.label}:** ${f.value}`), '');
  lines.push('## Grades', '', '| Phase | Grade |', '|---|---|', ...PHASES.map((p) => `| ${p[0]!.toUpperCase()}${p.slice(1)} | ${g.grades[p]} |`), '');
  lines.push('## Mistakes', '', ...(g.mistakes.length === 0 ? ['None.'] : g.mistakes.map((m) => `- **${m.title}.** ${m.why}`)), '');
  lines.push('## Missed', '', ...(g.missed.length === 0 ? ['Nothing left behind.'] : g.missed.map((m) => `- ${m}`)), '');
  lines.push(`## Debrief${debrief.offline ? ' (Kiro offline)' : ''}`, '', debrief.text, '');
  return lines.join('\n');
}

/** ENGINE_API §5: the report for a finished (or unfinished) run: the assessor's snapshot of the world as it stands. */
export async function buildReport(world: World): Promise<Report> {
  if (world.training) throw new Error('The training shift has no report: it ends on the drill-complete card (SYS-24, D-236)');
  const { facts, grades, mistakes, missed } = evaluate(world);
  const debrief = { text: OFFLINE_DEBRIEF, offline: true };
  const g = { facts, grades, mistakes: mistakes.map(({ title, why }) => ({ title, why })), missed };
  return { ...g, debrief, markdown: renderMarkdown(g, debrief) };
}

/**
 * Procedure engine — matches ticket topics to procedure trigger_topics
 * and formats matching procedures into system prompt instructions.
 */

import { listProcedures, type AIProcedure } from './procedures';

/**
 * Find all enabled procedures whose triggerTopics overlap with the given topics.
 * Matching is case-insensitive substring: a procedure trigger "billing" matches
 * a ticket topic "billing-dispute".
 */
export async function matchProcedures(
  workspaceId: string,
  topics: string[],
): Promise<AIProcedure[]> {
  if (topics.length === 0) return [];

  const all = await listProcedures(workspaceId);
  const enabled = all.filter((p) => p.enabled);

  const lowerTopics = topics.map((t) => t.toLowerCase());

  return enabled.filter((proc) =>
    proc.triggerTopics.some((trigger) => {
      const lt = trigger.toLowerCase();
      return lowerTopics.some(
        (topic) => topic.includes(lt) || lt.includes(topic),
      );
    }),
  );
}

/**
 * Format matched procedures into a block of system prompt text
 * that the AI agent can follow.
 */
export function formatProcedurePrompt(procedures: AIProcedure[]): string {
  if (procedures.length === 0) return '';

  const blocks = procedures.map((proc) => {
    const header = `PROCEDURE: ${proc.name}`;
    const desc = proc.description ? `Description: ${proc.description}` : '';
    const stepsText = Array.isArray(proc.steps)
      ? proc.steps
          .map((step, i) => {
            if (typeof step === 'string') return `  ${i + 1}. ${step}`;
            if (typeof step === 'object' && step !== null) {
              const s = step as Record<string, unknown>;
              const label = s.label ?? s.instruction ?? s.text ?? JSON.stringify(step);
              return `  ${i + 1}. ${label}`;
            }
            return `  ${i + 1}. ${JSON.stringify(step)}`;
          })
          .join('\n')
      : '';
    const triggers = `Trigger topics: ${proc.triggerTopics.join(', ')}`;

    return [header, desc, triggers, 'Steps:', stepsText].filter(Boolean).join('\n');
  });

  return `\n\n--- ACTIVE PROCEDURES ---\nThe following procedures are relevant to this ticket. Follow them carefully.\n\n${blocks.join('\n\n---\n\n')}`;
}

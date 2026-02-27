/**
 * Workflow→Engine sync layer: decomposes active workflows into automation
 * rules and merges them with manually-created rules in the engine.
 *
 * Workflow-generated rule IDs all start with `wf-{workflowId}-` (via
 * makeRuleId in decomposer.ts), so they can be safely partitioned from
 * manual rules.
 */

import { getActiveWorkflows, getWorkflow } from './store';
import { decomposeWorkflowToRules, WF_RULE_PREFIX } from './decomposer';
import {
  getAutomationRules,
  setAutomationRules,
} from '@/lib/automation/executor';

/** Check if a rule ID belongs to a specific workflow. */
function isWorkflowRule(ruleId: string, workflowId?: string): boolean {
  if (workflowId) {
    return ruleId.startsWith(`${WF_RULE_PREFIX}${workflowId}-`);
  }
  return ruleId.startsWith(WF_RULE_PREFIX);
}

/**
 * Full sync: fetch all active workflows, decompose each to rules,
 * merge with existing manual (non-workflow) rules, and set on the engine.
 */
export async function syncWorkflowRules(): Promise<{ ruleCount: number }> {
  const workflows = await getActiveWorkflows();

  // Collect all workflow-generated rules
  const workflowRules = workflows.flatMap((wf) => decomposeWorkflowToRules(wf));

  // Keep only manual rules (non-workflow)
  const manualRules = getAutomationRules().filter(
    (r) => !isWorkflowRule(r.id),
  );

  setAutomationRules([...manualRules, ...workflowRules]);
  return { ruleCount: workflowRules.length };
}

/**
 * Incremental sync for a single workflow: remove old rules for this
 * workflow ID, re-decompose if enabled, merge back.
 */
export async function syncSingleWorkflow(
  workflowId: string,
  enabled: boolean,
): Promise<{ ruleCount: number }> {
  // Remove existing rules for this workflow
  const currentRules = getAutomationRules().filter(
    (r) => !isWorkflowRule(r.id, workflowId),
  );

  if (!enabled) {
    setAutomationRules(currentRules);
    return { ruleCount: 0 };
  }

  // Re-fetch and decompose
  const workflow = await getWorkflow(workflowId);
  if (!workflow || !workflow.enabled) {
    setAutomationRules(currentRules);
    return { ruleCount: 0 };
  }

  const newRules = decomposeWorkflowToRules(workflow);
  setAutomationRules([...currentRules, ...newRules]);
  return { ruleCount: newRules.length };
}

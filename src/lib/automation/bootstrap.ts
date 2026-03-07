/**
 * Bootstrap: lazy-loads DB rules into the in-memory automation engine.
 * Same idempotent promise pattern as workflow/bootstrap.ts.
 *
 * Workflow-generated rules (prefixed `wf-`) are preserved — only
 * non-workflow rules are replaced from the DB.
 */

import { tryDb, withRls } from '@/lib/store-helpers';
import { getAutomationRules, setAutomationRules } from './executor';
import type { Rule } from './engine';
import type { RuleConditions } from './conditions';
import type { RuleAction } from './actions';

declare global {
  // eslint-disable-next-line no-var
  var __cliaasRuleBootstrapPromise: Promise<void> | undefined;
}

const WF_RULE_PREFIX = 'wf-';

/**
 * Ensure DB rules are loaded into the engine.
 * No-ops if already bootstrapped in this process.
 */
export async function bootstrapRules(workspaceId?: string): Promise<void> {
  if (global.__cliaasRuleBootstrapPromise) {
    return global.__cliaasRuleBootstrapPromise;
  }

  global.__cliaasRuleBootstrapPromise = loadDbRules(workspaceId)
    .then(() => {})
    .catch(() => {
      // Next invocation will retry
      global.__cliaasRuleBootstrapPromise = undefined;
    });

  return global.__cliaasRuleBootstrapPromise;
}

/** Clear the bootstrap promise so the next call reloads from DB. */
export function invalidateRuleCache(): void {
  global.__cliaasRuleBootstrapPromise = undefined;
}

async function loadDbRules(workspaceId?: string): Promise<void> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(schema.rules)
        .where(eq(schema.rules.enabled, true));
      return rows.map(row => ({
        id: row.id,
        type: row.type,
        name: row.name,
        enabled: row.enabled,
        conditions: (row.conditions ?? { all: [], any: [] }) as RuleConditions,
        actions: (row.actions ?? []) as RuleAction[],
        workspaceId: row.workspaceId,
      }));
    });
    if (result !== null) {
      const workflowRules = getAutomationRules().filter(r => r.id.startsWith(WF_RULE_PREFIX));
      setAutomationRules([...workflowRules, ...result]);
      return;
    }
  }

  // Unscoped DB path (fallback)
  const conn = await tryDb();
  if (!conn) return; // No DB available — keep whatever is in memory

  const { db, schema } = conn;
  const { eq } = await import('drizzle-orm');

  const conditions = [eq(schema.rules.enabled, true)];
  if (workspaceId) {
    conditions.push(eq(schema.rules.workspaceId, workspaceId));
  }

  const { and } = await import('drizzle-orm');
  const rows = await db
    .select()
    .from(schema.rules)
    .where(and(...conditions));

  const dbRules: Rule[] = rows.map(row => ({
    id: row.id,
    type: row.type,
    name: row.name,
    enabled: row.enabled,
    conditions: (row.conditions ?? { all: [], any: [] }) as RuleConditions,
    actions: (row.actions ?? []) as RuleAction[],
    workspaceId: row.workspaceId,
  }));

  // Preserve workflow-generated rules, replace everything else with DB rules
  const workflowRules = getAutomationRules().filter(r => r.id.startsWith(WF_RULE_PREFIX));
  setAutomationRules([...workflowRules, ...dbRules]);
}

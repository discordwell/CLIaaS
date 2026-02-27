/**
 * Workflow bootstrap: lazy-loads all enabled workflows into the
 * automation engine on first ticket event.
 *
 * Handles cold starts (Next.js serverless resets global state).
 * Idempotent — safe to call on every evaluateAutomation() invocation.
 * Concurrent callers await the same promise to avoid partial rule sets.
 */

import { syncWorkflowRules } from './sync';

declare global {
  // eslint-disable-next-line no-var
  var __cliaasWorkflowBootstrapPromise: Promise<void> | undefined;
}

/**
 * Ensure workflow rules are loaded into the engine.
 * No-ops if already bootstrapped in this process.
 * Concurrent callers share the same bootstrap promise.
 */
export async function bootstrapWorkflows(): Promise<void> {
  if (global.__cliaasWorkflowBootstrapPromise) {
    return global.__cliaasWorkflowBootstrapPromise;
  }

  global.__cliaasWorkflowBootstrapPromise = syncWorkflowRules()
    .then(() => {})
    .catch(() => {
      // Don't block ticket processing if workflow sync fails.
      // Next invocation will retry since we clear the promise.
      global.__cliaasWorkflowBootstrapPromise = undefined;
    });

  return global.__cliaasWorkflowBootstrapPromise;
}

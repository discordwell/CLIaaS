/**
 * Campaign orchestration engine — enrolls customers, executes steps, advances through sequences.
 */

import {
  getCampaign,
  getCampaignSteps,
  getCampaignStep,
  updateCampaign,
  createEnrollment,
  getEnrollments,
  updateEnrollment,
  getActiveEnrollmentsDue,
  addStepEvent,
  type Campaign,
  type CampaignStep,
  type CampaignEnrollment,
} from './campaign-store';
import { evaluateSegment, type SegmentQuery, type EvaluableCustomer } from '../segments/evaluator';
import { createLogger } from '../logger';

const logger = createLogger('campaigns:orchestration');

// ---- Enrollment ----

/**
 * Activate a campaign: evaluate its segment query, create enrollments for matching customers,
 * and set the campaign status to 'active'.
 */
export async function enrollCampaign(
  campaignId: string,
  customers: EvaluableCustomer[],
  workspaceId?: string,
): Promise<{ enrolled: number; campaign: Campaign | null }> {
  const campaign = await getCampaign(campaignId, workspaceId);
  if (!campaign) return { enrolled: 0, campaign: null };

  if (campaign.status !== 'draft' && campaign.status !== 'scheduled' && campaign.status !== 'paused') {
    return { enrolled: 0, campaign };
  }

  const steps = await getCampaignSteps(campaignId, workspaceId);
  if (steps.length === 0) {
    return { enrolled: 0, campaign };
  }

  const entryStepId = campaign.entryStepId ?? steps[0].id;

  // Evaluate segment
  const segmentQuery = (campaign.segmentQuery ?? {}) as SegmentQuery;
  const matching = evaluateSegment(customers, segmentQuery);

  // Get already enrolled customer IDs to avoid duplicates
  const existingEnrollments = await getEnrollments(campaignId, workspaceId);
  const enrolledCustomerIds = new Set(existingEnrollments.map(e => e.customerId));

  let enrolled = 0;
  const now = new Date().toISOString();

  for (const customer of matching) {
    if (enrolledCustomerIds.has(customer.id)) continue;

    createEnrollment({
      campaignId,
      customerId: customer.id,
      currentStepId: entryStepId,
      nextExecutionAt: now,
    }, workspaceId);
    enrolled++;
  }

  // Update campaign status
  updateCampaign(campaignId, { status: 'active' }, workspaceId);

  return { enrolled, campaign: (await getCampaign(campaignId, workspaceId))! };
}

/**
 * Pause a running campaign — stops executing next steps.
 */
export async function pauseCampaign(campaignId: string, workspaceId?: string): Promise<Campaign | null> {
  const campaign = await getCampaign(campaignId, workspaceId);
  if (!campaign || campaign.status !== 'active') return null;
  return updateCampaign(campaignId, { status: 'paused' }, workspaceId);
}

/**
 * Resume a paused campaign.
 */
export async function resumeCampaign(campaignId: string, workspaceId?: string): Promise<Campaign | null> {
  const campaign = await getCampaign(campaignId, workspaceId);
  if (!campaign || campaign.status !== 'paused') return null;
  return updateCampaign(campaignId, { status: 'active' }, workspaceId);
}

// ---- Step Execution ----

export interface StepExecutionResult {
  success: boolean;
  advance: boolean;
  nextStepId?: string;
  error?: string;
}

/**
 * Execute a single step for an enrollment. Returns whether to advance.
 */
export function executeStep(
  step: CampaignStep,
  enrollment: CampaignEnrollment,
  workspaceId?: string,
): StepExecutionResult {
  try {
    switch (step.stepType) {
      case 'send_email': {
        // In production: enqueue via email-send queue
        // For now: log and mark as sent
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'sent' }, workspaceId);
        return { success: true, advance: true, nextStepId: step.nextStepId };
      }

      case 'send_sms': {
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'sent' }, workspaceId);
        return { success: true, advance: true, nextStepId: step.nextStepId };
      }

      case 'send_in_app': {
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'sent' }, workspaceId);
        return { success: true, advance: true, nextStepId: step.nextStepId };
      }

      case 'send_push': {
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'sent' }, workspaceId);
        return { success: true, advance: true, nextStepId: step.nextStepId };
      }

      case 'wait_delay': {
        const delaySecs = step.delaySeconds ?? (step.config as { seconds?: number }).seconds ?? 0;
        const nextExecution = new Date(Date.now() + delaySecs * 1000).toISOString();
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        // Set next execution time and advance to next step
        updateEnrollment(enrollment.id, { nextExecutionAt: nextExecution, currentStepId: step.nextStepId });
        return { success: true, advance: false }; // Don't advance now — wait for delay
      }

      case 'wait_event': {
        const timeoutSecs = (step.config as { timeout_seconds?: number }).timeout_seconds ?? 86400;
        const nextExecution = new Date(Date.now() + timeoutSecs * 1000).toISOString();
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        updateEnrollment(enrollment.id, { nextExecutionAt: nextExecution, currentStepId: step.nextStepId });
        return { success: true, advance: false };
      }

      case 'condition': {
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        // Evaluate condition — for now, simple field/operator/value check
        // In a real implementation, this would check against the customer's current data
        const conditionMet = true; // Simplified — always true for now
        const nextId = conditionMet ? step.branchTrueStepId : step.branchFalseStepId;
        return { success: true, advance: true, nextStepId: nextId ?? step.nextStepId };
      }

      case 'branch': {
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        // Branch evaluates multiple conditions — simplified to default path
        const defaultStepId = (step.config as { defaultStepId?: string }).defaultStepId;
        return { success: true, advance: true, nextStepId: step.branchTrueStepId ?? defaultStepId ?? step.nextStepId };
      }

      case 'update_tag': {
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'completed' }, workspaceId);
        return { success: true, advance: true, nextStepId: step.nextStepId };
      }

      case 'webhook': {
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'executed' }, workspaceId);
        // In production: POST to config.url with config.body
        addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'completed' }, workspaceId);
        return { success: true, advance: true, nextStepId: step.nextStepId };
      }

      default:
        return { success: false, advance: false, error: `Unknown step type: ${step.stepType}` };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    addStepEvent({ enrollmentId: enrollment.id, stepId: step.id, eventType: 'failed', metadata: { error } }, workspaceId);
    return { success: false, advance: false, error };
  }
}

/**
 * Advance an enrollment to the next step, or mark it completed if no next step.
 */
export function advanceEnrollment(
  enrollment: CampaignEnrollment,
  nextStepId?: string,
  workspaceId?: string,
): void {
  if (!nextStepId) {
    // No more steps — mark completed
    updateEnrollment(enrollment.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      currentStepId: undefined,
    });
    return;
  }

  // Advance to next step, execute immediately
  updateEnrollment(enrollment.id, {
    currentStepId: nextStepId,
    nextExecutionAt: new Date().toISOString(),
  });
}

// ---- Tick Processing ----

/**
 * Process one tick of the campaign orchestration engine.
 * Finds all due enrollments and executes their current step.
 * Called by the campaign worker or setInterval fallback.
 */
export async function processCampaignTick(): Promise<{ processed: number; errors: number }> {
  const dueEnrollments = getActiveEnrollmentsDue();
  let processed = 0;
  let errors = 0;

  for (const enrollment of dueEnrollments) {
    if (!enrollment.currentStepId) {
      // No current step — mark completed
      updateEnrollment(enrollment.id, { status: 'completed', completedAt: new Date().toISOString() });
      processed++;
      continue;
    }

    // Check campaign is still active
    const campaign = await getCampaign(enrollment.campaignId);
    if (!campaign || campaign.status !== 'active') continue;

    const step = await getCampaignStep(enrollment.currentStepId);
    if (!step) {
      logger.warn(`Step ${enrollment.currentStepId} not found for enrollment ${enrollment.id}`);
      updateEnrollment(enrollment.id, { status: 'failed' });
      errors++;
      continue;
    }

    const result = executeStep(step, enrollment, enrollment.workspaceId);

    if (result.success && result.advance) {
      advanceEnrollment(enrollment, result.nextStepId, enrollment.workspaceId);
    } else if (!result.success) {
      updateEnrollment(enrollment.id, { status: 'failed' });
      errors++;
    }

    processed++;
  }

  return { processed, errors };
}

import { describe, it, expect, beforeEach } from 'vitest';
import type { EvaluableCustomer } from '../lib/segments/evaluator';

const testCustomers: EvaluableCustomer[] = [
  { id: 'c1', email: 'alice@test.com', name: 'Alice', plan: 'pro' },
  { id: 'c2', email: 'bob@test.com', name: 'Bob', plan: 'free' },
  { id: 'c3', email: 'carol@test.com', name: 'Carol', plan: 'pro' },
];

describe('Campaign Orchestration', () => {
  let store: typeof import('../lib/campaigns/campaign-store');
  let orchestration: typeof import('../lib/campaigns/orchestration');

  beforeEach(async () => {
    store = await import('../lib/campaigns/campaign-store');
    orchestration = await import('../lib/campaigns/orchestration');
  });

  it('enrollCampaign enrolls matching customers and activates campaign', async () => {
    const campaign = store.createCampaign({
      name: 'Enroll Test',
      channel: 'email',
      segmentQuery: { conditions: [{ field: 'plan', operator: 'eq', value: 'pro' }] },
    });
    await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Welcome' });

    const result = await orchestration.enrollCampaign(campaign.id, testCustomers);
    expect(result.enrolled).toBe(2); // Alice and Carol
    expect(result.campaign?.status).toBe('active');
  });

  it('enrollCampaign with empty segment enrolls all customers', async () => {
    const campaign = store.createCampaign({
      name: 'All Enroll',
      channel: 'email',
      segmentQuery: {},
    });
    await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Welcome' });

    const result = await orchestration.enrollCampaign(campaign.id, testCustomers);
    expect(result.enrolled).toBe(3);
  });

  it('enrollCampaign does not duplicate existing enrollments', async () => {
    const campaign = store.createCampaign({ name: 'No Dupe', channel: 'email' });
    await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Email' });

    await orchestration.enrollCampaign(campaign.id, testCustomers);
    // Pause and re-enroll with same customers
    store.updateCampaign(campaign.id, { status: 'paused' });
    const result2 = await orchestration.enrollCampaign(campaign.id, testCustomers);
    expect(result2.enrolled).toBe(0); // All already enrolled
  });

  it('enrollCampaign returns 0 enrolled when no steps', async () => {
    const campaign = store.createCampaign({ name: 'No Steps', channel: 'email' });
    const result = await orchestration.enrollCampaign(campaign.id, testCustomers);
    expect(result.enrolled).toBe(0);
  });

  it('pauseCampaign changes status to paused', async () => {
    const campaign = store.createCampaign({ name: 'Pause Test', channel: 'email' });
    await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Email' });
    await orchestration.enrollCampaign(campaign.id, testCustomers);

    const paused = await orchestration.pauseCampaign(campaign.id);
    expect(paused?.status).toBe('paused');
  });

  it('pauseCampaign returns null for non-active campaigns', async () => {
    const campaign = store.createCampaign({ name: 'Not Active', channel: 'email' });
    expect(await orchestration.pauseCampaign(campaign.id)).toBeNull();
  });

  it('resumeCampaign changes status back to active', async () => {
    const campaign = store.createCampaign({ name: 'Resume Test', channel: 'email' });
    await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Email' });
    await orchestration.enrollCampaign(campaign.id, testCustomers);
    await orchestration.pauseCampaign(campaign.id);

    const resumed = await orchestration.resumeCampaign(campaign.id);
    expect(resumed?.status).toBe('active');
  });

  it('resumeCampaign returns null for non-paused campaigns', async () => {
    const campaign = store.createCampaign({ name: 'Not Paused', channel: 'email' });
    expect(await orchestration.resumeCampaign(campaign.id)).toBeNull();
  });

  it('executeStep for send_email records executed and sent events', async () => {
    const campaign = store.createCampaign({ name: 'Exec Test', channel: 'email' });
    const step = await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Email' });
    const enrollment = store.createEnrollment({ campaignId: campaign.id, customerId: 'c1', currentStepId: step.id });

    const result = orchestration.executeStep(step, enrollment);
    expect(result.success).toBe(true);
    expect(result.advance).toBe(true);

    const events = await store.getStepEvents(step.id);
    expect(events.some((e: { eventType: string }) => e.eventType === 'executed')).toBe(true);
    expect(events.some((e: { eventType: string }) => e.eventType === 'sent')).toBe(true);
  });

  it('executeStep for wait_delay sets nextExecutionAt', async () => {
    const campaign = store.createCampaign({ name: 'Wait Test', channel: 'email' });
    const step = await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'wait_delay',
      name: 'Wait 1 hour',
      delaySeconds: 3600,
    });
    const enrollment = store.createEnrollment({ campaignId: campaign.id, customerId: 'c1', currentStepId: step.id });

    const result = orchestration.executeStep(step, enrollment);
    expect(result.success).toBe(true);
    expect(result.advance).toBe(false); // Should wait

    // Verify enrollment was updated
    const updated = await store.getEnrollment(enrollment.id);
    expect(updated?.nextExecutionAt).toBeTruthy();
    const nextExec = new Date(updated!.nextExecutionAt!).getTime();
    expect(nextExec).toBeGreaterThan(Date.now());
  });

  it('executeStep for condition branches correctly', async () => {
    const campaign = store.createCampaign({ name: 'Branch Test', channel: 'email' });
    const trueStep = await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'True Branch' });
    const step = await store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'condition',
      name: 'Check Plan',
      branchTrueStepId: trueStep.id,
    });
    store.updateCampaignStep(step.id, { branchTrueStepId: trueStep.id });

    const enrollment = store.createEnrollment({ campaignId: campaign.id, customerId: 'c1', currentStepId: step.id });
    const result = orchestration.executeStep(step, enrollment);
    expect(result.success).toBe(true);
    expect(result.advance).toBe(true);
  });

  it('advanceEnrollment marks completed when no next step', async () => {
    const campaign = store.createCampaign({ name: 'Complete Test', channel: 'email' });
    const enrollment = store.createEnrollment({ campaignId: campaign.id, customerId: 'c1' });

    orchestration.advanceEnrollment(enrollment, undefined);

    const updated = await store.getEnrollment(enrollment.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).toBeTruthy();
  });

  it('advanceEnrollment moves to next step', async () => {
    const campaign = store.createCampaign({ name: 'Advance Test', channel: 'email' });
    const step2 = await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Step 2' });
    const enrollment = store.createEnrollment({ campaignId: campaign.id, customerId: 'c1' });

    orchestration.advanceEnrollment(enrollment, step2.id);

    const updated = await store.getEnrollment(enrollment.id);
    expect(updated?.currentStepId).toBe(step2.id);
    expect(updated?.status).toBe('active');
  });

  it('processCampaignTick executes due enrollments', async () => {
    const campaign = store.createCampaign({ name: 'Tick Test', channel: 'email' });
    const step = await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Email' });
    store.updateCampaign(campaign.id, { status: 'active' });

    // Create enrollment with nextExecutionAt in the past
    store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'c1',
      currentStepId: step.id,
      nextExecutionAt: new Date(Date.now() - 1000).toISOString(),
    });

    const result = await orchestration.processCampaignTick();
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);
  });

  it('processCampaignTick skips paused campaigns', async () => {
    const campaign = store.createCampaign({ name: 'Paused Skip', channel: 'email' });
    const step = await store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Email' });
    store.updateCampaign(campaign.id, { status: 'paused' });

    store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'c1',
      currentStepId: step.id,
      nextExecutionAt: new Date(Date.now() - 1000).toISOString(),
    });

    const result = await orchestration.processCampaignTick();
    // Should not process because campaign is paused
    const enrollments = await store.getEnrollments(campaign.id);
    expect(enrollments[0].status).toBe('active'); // Still active, not processed
  });
});

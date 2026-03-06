import { describe, it, expect, beforeEach } from 'vitest';

describe('Campaign Steps CRUD', () => {
  let store: typeof import('../lib/campaigns/campaign-store');

  beforeEach(async () => {
    store = await import('../lib/campaigns/campaign-store');
  });

  it('addCampaignStep creates a step and returns it', () => {
    const campaign = store.createCampaign({ name: 'Test Multi-Step', channel: 'email' });
    const step = store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email',
      name: 'Welcome Email',
      config: { subject: 'Hello!', templateBody: 'Welcome {{name}}' },
    });

    expect(step.id).toBeTruthy();
    expect(step.campaignId).toBe(campaign.id);
    expect(step.stepType).toBe('send_email');
    expect(step.name).toBe('Welcome Email');
    expect(step.position).toBe(0);
  });

  it('addCampaignStep sets entry_step_id on campaign for first step', () => {
    const campaign = store.createCampaign({ name: 'Entry Step Test', channel: 'email' });
    const step = store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email',
      name: 'First Step',
    });

    const updated = store.getCampaign(campaign.id);
    expect(updated?.entryStepId).toBe(step.id);
  });

  it('getCampaignSteps returns sorted by position', () => {
    const campaign = store.createCampaign({ name: 'Sorted Steps', channel: 'email' });
    store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Step A' });
    store.addCampaignStep({ campaignId: campaign.id, stepType: 'wait_delay', name: 'Step B' });
    store.addCampaignStep({ campaignId: campaign.id, stepType: 'condition', name: 'Step C' });

    const steps = store.getCampaignSteps(campaign.id);
    expect(steps).toHaveLength(3);
    expect(steps[0].name).toBe('Step A');
    expect(steps[0].position).toBe(0);
    expect(steps[1].name).toBe('Step B');
    expect(steps[1].position).toBe(1);
    expect(steps[2].name).toBe('Step C');
    expect(steps[2].position).toBe(2);
  });

  it('updateCampaignStep modifies step fields', () => {
    const campaign = store.createCampaign({ name: 'Update Test', channel: 'email' });
    const step = store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'wait_delay',
      name: 'Wait 1 Day',
      delaySeconds: 86400,
    });

    const updated = store.updateCampaignStep(step.id, { name: 'Wait 2 Days', delaySeconds: 172800 });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Wait 2 Days');
    expect(updated!.delaySeconds).toBe(172800);
  });

  it('removeCampaignStep deletes a step', () => {
    const campaign = store.createCampaign({ name: 'Remove Test', channel: 'email' });
    const step = store.addCampaignStep({
      campaignId: campaign.id,
      stepType: 'send_email',
      name: 'Removable',
    });

    expect(store.removeCampaignStep(step.id)).toBe(true);
    expect(store.getCampaignSteps(campaign.id)).toHaveLength(0);
  });

  it('removeCampaignStep returns false for nonexistent', () => {
    expect(store.removeCampaignStep('nonexistent')).toBe(false);
  });

  it('reorderCampaignSteps changes positions', () => {
    const campaign = store.createCampaign({ name: 'Reorder Test', channel: 'email' });
    const a = store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'A' });
    const b = store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'B' });
    const c = store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'C' });

    const reordered = store.reorderCampaignSteps(campaign.id, [c.id, a.id, b.id]);
    expect(reordered[0].name).toBe('C');
    expect(reordered[0].position).toBe(0);
    expect(reordered[1].name).toBe('A');
    expect(reordered[1].position).toBe(1);
    expect(reordered[2].name).toBe('B');
    expect(reordered[2].position).toBe(2);
  });

  it('campaign type includes new statuses', () => {
    const campaign = store.createCampaign({ name: 'Status Test', channel: 'email' });
    const updated = store.updateCampaign(campaign.id, { status: 'active' });
    expect(updated?.status).toBe('active');
  });

  it('campaign type includes new channels', () => {
    const campaign = store.createCampaign({ name: 'Channel Test', channel: 'in_app' });
    expect(campaign.channel).toBe('in_app');
  });
});

describe('Campaign Enrollments', () => {
  let store: typeof import('../lib/campaigns/campaign-store');

  beforeEach(async () => {
    store = await import('../lib/campaigns/campaign-store');
  });

  it('createEnrollment creates an active enrollment', () => {
    const campaign = store.createCampaign({ name: 'Enroll Test', channel: 'email' });
    const enrollment = store.createEnrollment({
      campaignId: campaign.id,
      customerId: 'cust-1',
    });

    expect(enrollment.status).toBe('active');
    expect(enrollment.customerId).toBe('cust-1');
    expect(enrollment.enrolledAt).toBeTruthy();
  });

  it('getEnrollments returns enrollments for campaign', () => {
    const campaign = store.createCampaign({ name: 'List Enroll', channel: 'email' });
    store.createEnrollment({ campaignId: campaign.id, customerId: 'cust-1' });
    store.createEnrollment({ campaignId: campaign.id, customerId: 'cust-2' });

    const enrollments = store.getEnrollments(campaign.id);
    expect(enrollments).toHaveLength(2);
  });

  it('updateEnrollment modifies enrollment fields', () => {
    const campaign = store.createCampaign({ name: 'Update Enroll', channel: 'email' });
    const enrollment = store.createEnrollment({ campaignId: campaign.id, customerId: 'cust-1' });

    const updated = store.updateEnrollment(enrollment.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
    expect(updated?.status).toBe('completed');
  });
});

describe('Campaign Step Events', () => {
  let store: typeof import('../lib/campaigns/campaign-store');

  beforeEach(async () => {
    store = await import('../lib/campaigns/campaign-store');
  });

  it('addStepEvent records an event', () => {
    const event = store.addStepEvent({
      enrollmentId: 'enr-1',
      stepId: 'step-1',
      eventType: 'executed',
    });
    expect(event.eventType).toBe('executed');
  });

  it('getStepEvents returns events for a step', () => {
    store.addStepEvent({ enrollmentId: 'enr-1', stepId: 'step-x', eventType: 'executed' });
    store.addStepEvent({ enrollmentId: 'enr-2', stepId: 'step-x', eventType: 'sent' });

    const events = store.getStepEvents('step-x');
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Campaign Funnel Analytics', () => {
  let store: typeof import('../lib/campaigns/campaign-store');

  beforeEach(async () => {
    store = await import('../lib/campaigns/campaign-store');
  });

  it('getCampaignFunnel returns per-step analytics', () => {
    const campaign = store.createCampaign({ name: 'Funnel Test', channel: 'email' });
    const step1 = store.addCampaignStep({ campaignId: campaign.id, stepType: 'send_email', name: 'Email 1' });
    const step2 = store.addCampaignStep({ campaignId: campaign.id, stepType: 'wait_delay', name: 'Wait' });

    store.addStepEvent({ enrollmentId: 'e1', stepId: step1.id, eventType: 'executed' });
    store.addStepEvent({ enrollmentId: 'e1', stepId: step1.id, eventType: 'sent' });
    store.addStepEvent({ enrollmentId: 'e2', stepId: step1.id, eventType: 'executed' });
    store.addStepEvent({ enrollmentId: 'e2', stepId: step1.id, eventType: 'failed' });
    store.addStepEvent({ enrollmentId: 'e1', stepId: step2.id, eventType: 'executed' });
    store.addStepEvent({ enrollmentId: 'e1', stepId: step2.id, eventType: 'completed' });

    const funnel = store.getCampaignFunnel(campaign.id);
    expect(funnel).toHaveLength(2);
    expect(funnel[0].executed).toBe(2);
    expect(funnel[0].completed).toBe(1); // 'sent' counts as completed
    expect(funnel[0].failed).toBe(1);
    expect(funnel[1].executed).toBe(1);
    expect(funnel[1].completed).toBe(1);
  });
});

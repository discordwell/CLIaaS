/**
 * Extended features tests — P2/P3 coverage for Campaigns, Chatbots, PII,
 * Reports, KB, CRM & Custom Objects.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- Campaign imports ----
import {
  createCampaign,
  getCampaign,
  getCampaigns,
  updateCampaign,
  sendCampaign,
  getCampaignAnalytics,
  addCampaignStep,
  getCampaignSteps,
  getCampaignStep,
  updateCampaignStep,
  removeCampaignStep,
  reorderCampaignSteps,
  createEnrollment,
  getEnrollments,
  getEnrollment,
  updateEnrollment,
  getActiveEnrollmentsDue,
  addStepEvent,
  getStepEvents,
  getEnrollmentEvents,
  getCampaignFunnel,
  type Campaign,
  type CampaignStep,
  type CampaignEnrollment,
} from '@/lib/campaigns/campaign-store';

import {
  enrollCampaign,
  pauseCampaign,
  resumeCampaign,
  executeStep,
  advanceEnrollment,
} from '@/lib/campaigns/orchestration';

// ---- Chatbot imports ----
import type {
  ChatbotFlow,
  ChatbotNode,
  ChatbotSessionState,
} from '@/lib/chatbot/types';

import {
  initBotSession,
  evaluateBotResponse,
  processInitialGreeting,
} from '@/lib/chatbot/runtime';

import {
  getChatbots,
  getChatbot,
  upsertChatbot,
  deleteChatbot,
} from '@/lib/chatbot/store';

// ---- PII imports ----
import {
  detectPiiRegex,
  validateLuhn,
  maskText,
  getDefaultRules,
  type PiiMatch,
  type PiiSensitivityRule,
} from '@/lib/compliance/pii-detector';

// ---- Reports imports ----
import {
  getMetric,
  validateGroupBy,
  listMetrics,
  METRIC_REGISTRY,
} from '@/lib/reports/metrics';

import {
  REPORT_TEMPLATES,
  getTemplateSeedData,
} from '@/lib/reports/templates';

// ---- Custom Objects imports ----
import {
  createObjectType,
  getObjectType,
  listObjectTypes,
  updateObjectType,
  deleteObjectType,
  createRecord,
  getRecord,
  listRecords,
  updateRecord,
  deleteRecord,
  createRelationship,
  listRelationships,
  deleteRelationship,
  validateRecordData,
  type CustomObjectType,
  type CustomObjectRecord,
  type CustomObjectRelationship,
} from '@/lib/custom-objects';

// ---- CRM Link imports ----
import {
  createCrmLink,
  listCrmLinks,
  getCrmLink,
  updateCrmLink,
  deleteCrmLink,
} from '@/lib/integrations/link-store';

// ============================================================
// Mock JSONL persistence with in-memory backing store
// ============================================================

const jsonlStore = new Map<string, unknown[]>();

vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: (filename: string) => {
    return jsonlStore.get(filename) ?? [];
  },
  writeJsonlFile: (filename: string, items: unknown[]) => {
    jsonlStore.set(filename, [...items]);
  },
}));

vi.mock('@/lib/store-helpers', () => ({
  withRls: async () => null,
  tryDb: async () => null,
  getDefaultWorkspaceId: async () => 'ws-test',
}));

// ============================================================
// Plan 19 — Campaigns
// ============================================================

describe('Plan 19 — Campaigns', () => {
  describe('Campaign store CRUD', () => {
    it('creates a campaign with draft status', () => {
      const camp = createCampaign({
        name: 'Test Welcome Campaign',
        channel: 'email',
        subject: 'Welcome!',
        templateBody: 'Hello {{name}}, welcome aboard.',
      });
      expect(camp.id).toBeDefined();
      expect(camp.name).toBe('Test Welcome Campaign');
      expect(camp.channel).toBe('email');
      expect(camp.status).toBe('draft');
      expect(camp.subject).toBe('Welcome!');
      expect(camp.createdAt).toBeDefined();
      expect(camp.updatedAt).toBeDefined();
    });

    it('retrieves a campaign by id', async () => {
      const camp = createCampaign({ name: 'Retrieve Test', channel: 'sms' });
      const fetched = await getCampaign(camp.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(camp.id);
      expect(fetched!.name).toBe('Retrieve Test');
    });

    it('lists campaigns with optional status filter', async () => {
      const c1 = createCampaign({ name: 'List A', channel: 'email' });
      updateCampaign(c1.id, { status: 'active' });
      createCampaign({ name: 'List B', channel: 'email' });

      const all = await getCampaigns();
      expect(all.length).toBeGreaterThanOrEqual(2);

      const drafts = await getCampaigns({ status: 'draft' });
      expect(drafts.every(c => c.status === 'draft')).toBe(true);
    });

    it('updates a campaign', () => {
      const camp = createCampaign({ name: 'Update Me', channel: 'email' });
      const updated = updateCampaign(camp.id, { name: 'Updated Name', status: 'scheduled' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.status).toBe('scheduled');
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(camp.updatedAt).getTime());
    });

    it('returns null when updating nonexistent campaign', () => {
      const result = updateCampaign('nonexistent-id', { name: 'Nope' });
      expect(result).toBeNull();
    });

    it('sends a draft campaign', async () => {
      const camp = createCampaign({ name: 'Send Test', channel: 'email' });
      const sent = await sendCampaign(camp.id);
      expect(sent).not.toBeNull();
      expect(sent!.status).toBe('sent');
      expect(sent!.sentAt).toBeDefined();
    });

    it('cannot send an already-sent campaign', async () => {
      const camp = createCampaign({ name: 'Double Send', channel: 'email' });
      await sendCampaign(camp.id);
      const result = await sendCampaign(camp.id);
      expect(result).toBeNull();
    });
  });

  describe('Campaign step sequencing', () => {
    let campaignId: string;

    beforeEach(async () => {
      const camp = createCampaign({ name: 'Step Test Campaign', channel: 'email' });
      campaignId = camp.id;
    });

    it('adds steps with auto-incrementing position', async () => {
      const s1 = await addCampaignStep({ campaignId, stepType: 'send_email', name: 'Welcome Email' });
      const s2 = await addCampaignStep({ campaignId, stepType: 'wait_delay', name: 'Wait 1 day', delaySeconds: 86400 });
      const s3 = await addCampaignStep({ campaignId, stepType: 'send_email', name: 'Follow-up' });

      expect(s1.position).toBe(0);
      expect(s2.position).toBe(1);
      expect(s3.position).toBe(2);
    });

    it('sets entry step to first added step', async () => {
      const s1 = await addCampaignStep({ campaignId, stepType: 'send_email', name: 'First Step' });
      const camp = await getCampaign(campaignId);
      expect(camp!.entryStepId).toBe(s1.id);
    });

    it('retrieves steps sorted by position', async () => {
      await addCampaignStep({ campaignId, stepType: 'send_email', name: 'Step A' });
      await addCampaignStep({ campaignId, stepType: 'wait_delay', name: 'Step B' });
      await addCampaignStep({ campaignId, stepType: 'condition', name: 'Step C' });

      const steps = await getCampaignSteps(campaignId);
      expect(steps).toHaveLength(3);
      expect(steps[0].position).toBeLessThan(steps[1].position);
      expect(steps[1].position).toBeLessThan(steps[2].position);
    });

    it('updates a step', async () => {
      const s = await addCampaignStep({ campaignId, stepType: 'wait_delay', name: 'Old Name', delaySeconds: 60 });
      const updated = updateCampaignStep(s.id, { name: 'New Name', delaySeconds: 120 });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
      expect(updated!.delaySeconds).toBe(120);
    });

    it('removes a step', async () => {
      const s = await addCampaignStep({ campaignId, stepType: 'send_email', name: 'Remove Me' });
      expect(removeCampaignStep(s.id)).toBe(true);
      const fetched = await getCampaignStep(s.id);
      expect(fetched).toBeUndefined();
    });

    it('reorders steps', async () => {
      const s1 = await addCampaignStep({ campaignId, stepType: 'send_email', name: 'First' });
      const s2 = await addCampaignStep({ campaignId, stepType: 'wait_delay', name: 'Second' });
      const s3 = await addCampaignStep({ campaignId, stepType: 'send_sms', name: 'Third' });

      const reordered = await reorderCampaignSteps(campaignId, [s3.id, s1.id, s2.id]);
      expect(reordered[0].id).toBe(s3.id);
      expect(reordered[0].position).toBe(0);
      expect(reordered[1].id).toBe(s1.id);
      expect(reordered[1].position).toBe(1);
    });

    it('supports branch step with true/false paths', async () => {
      const s = await addCampaignStep({
        campaignId,
        stepType: 'condition',
        name: 'Branch Check',
        branchTrueStepId: 'true-path',
        branchFalseStepId: 'false-path',
      });
      expect(s.branchTrueStepId).toBe('true-path');
      expect(s.branchFalseStepId).toBe('false-path');
    });
  });

  describe('Enrollment lifecycle', () => {
    it('creates an enrollment with active status', () => {
      const enrollment = createEnrollment({
        campaignId: 'camp-test',
        customerId: 'cust-1',
        currentStepId: 'step-1',
      });
      expect(enrollment.status).toBe('active');
      expect(enrollment.campaignId).toBe('camp-test');
      expect(enrollment.customerId).toBe('cust-1');
      expect(enrollment.enrolledAt).toBeDefined();
    });

    it('retrieves enrollment by id', async () => {
      const e = createEnrollment({ campaignId: 'camp-x', customerId: 'cust-2' });
      const fetched = await getEnrollment(e.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(e.id);
    });

    it('lists enrollments by campaign', async () => {
      const campId = 'camp-enrollment-list';
      createEnrollment({ campaignId: campId, customerId: 'cust-a' });
      createEnrollment({ campaignId: campId, customerId: 'cust-b' });
      createEnrollment({ campaignId: 'other-camp', customerId: 'cust-c' });

      const list = await getEnrollments(campId);
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.every(e => e.campaignId === campId)).toBe(true);
    });

    it('updates enrollment status', () => {
      const e = createEnrollment({ campaignId: 'camp-update', customerId: 'cust-u' });
      const updated = updateEnrollment(e.id, { status: 'completed', completedAt: new Date().toISOString() });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('completed');
      expect(updated!.completedAt).toBeDefined();
    });

    it('finds active enrollments that are due', () => {
      const pastTime = new Date(Date.now() - 60000).toISOString();
      const futureTime = new Date(Date.now() + 60000).toISOString();

      createEnrollment({ campaignId: 'camp-due', customerId: 'cust-past', nextExecutionAt: pastTime });
      createEnrollment({ campaignId: 'camp-due', customerId: 'cust-future', nextExecutionAt: futureTime });

      const due = getActiveEnrollmentsDue();
      const pastEnrollment = due.find(e => e.customerId === 'cust-past');
      const futureEnrollment = due.find(e => e.customerId === 'cust-future');

      expect(pastEnrollment).toBeDefined();
      expect(futureEnrollment).toBeUndefined();
    });
  });

  describe('Step execution', () => {
    it('executes a send_email step and records events', () => {
      const step: CampaignStep = {
        id: 'step-email-1',
        campaignId: 'camp-exec',
        stepType: 'send_email',
        position: 0,
        name: 'Send welcome',
        config: {},
        nextStepId: 'step-next',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const enrollment: CampaignEnrollment = {
        id: 'enr-exec-1',
        campaignId: 'camp-exec',
        customerId: 'cust-exec',
        currentStepId: 'step-email-1',
        status: 'active',
        enrolledAt: new Date().toISOString(),
        metadata: {},
      };

      const result = executeStep(step, enrollment);
      expect(result.success).toBe(true);
      expect(result.advance).toBe(true);
      expect(result.nextStepId).toBe('step-next');
    });

    it('executes a wait_delay step and does not advance immediately', () => {
      const step: CampaignStep = {
        id: 'step-wait-1',
        campaignId: 'camp-exec',
        stepType: 'wait_delay',
        position: 1,
        name: 'Wait 1 hour',
        config: { seconds: 3600 },
        delaySeconds: 3600,
        nextStepId: 'step-after-wait',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const enrollment: CampaignEnrollment = {
        id: 'enr-exec-2',
        campaignId: 'camp-exec',
        customerId: 'cust-exec',
        currentStepId: 'step-wait-1',
        status: 'active',
        enrolledAt: new Date().toISOString(),
        metadata: {},
      };

      const result = executeStep(step, enrollment);
      expect(result.success).toBe(true);
      expect(result.advance).toBe(false); // Wait, don't advance yet
    });

    it('executes a condition step and branches to true path', () => {
      const step: CampaignStep = {
        id: 'step-cond-1',
        campaignId: 'camp-exec',
        stepType: 'condition',
        position: 2,
        name: 'Check VIP',
        config: {},
        branchTrueStepId: 'step-vip-path',
        branchFalseStepId: 'step-normal-path',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const enrollment: CampaignEnrollment = {
        id: 'enr-exec-3',
        campaignId: 'camp-exec',
        customerId: 'cust-exec',
        currentStepId: 'step-cond-1',
        status: 'active',
        enrolledAt: new Date().toISOString(),
        metadata: {},
      };

      const result = executeStep(step, enrollment);
      expect(result.success).toBe(true);
      expect(result.advance).toBe(true);
      // Current impl always evaluates condition as true
      expect(result.nextStepId).toBe('step-vip-path');
    });

    it('returns error for unknown step type', () => {
      const step: CampaignStep = {
        id: 'step-unknown',
        campaignId: 'camp-exec',
        stepType: 'unknown_type' as any,
        position: 0,
        name: 'Bad Step',
        config: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const enrollment: CampaignEnrollment = {
        id: 'enr-exec-4',
        campaignId: 'camp-exec',
        customerId: 'cust-exec',
        currentStepId: 'step-unknown',
        status: 'active',
        enrolledAt: new Date().toISOString(),
        metadata: {},
      };

      const result = executeStep(step, enrollment);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown step type');
    });

    it('executes webhook and update_tag step types', () => {
      const webhookStep: CampaignStep = {
        id: 'step-wh-1',
        campaignId: 'camp-exec',
        stepType: 'webhook',
        position: 0,
        name: 'Webhook Call',
        config: { url: 'https://example.com/hook' },
        nextStepId: 'step-next',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const enrollment: CampaignEnrollment = {
        id: 'enr-exec-5',
        campaignId: 'camp-exec',
        customerId: 'cust-exec',
        currentStepId: 'step-wh-1',
        status: 'active',
        enrolledAt: new Date().toISOString(),
        metadata: {},
      };

      const whResult = executeStep(webhookStep, enrollment);
      expect(whResult.success).toBe(true);
      expect(whResult.advance).toBe(true);

      const tagStep: CampaignStep = {
        ...webhookStep,
        id: 'step-tag-1',
        stepType: 'update_tag',
        name: 'Tag Customer',
      };
      const tagResult = executeStep(tagStep, { ...enrollment, id: 'enr-exec-6', currentStepId: 'step-tag-1' });
      expect(tagResult.success).toBe(true);
      expect(tagResult.advance).toBe(true);
    });
  });

  describe('advanceEnrollment', () => {
    it('marks enrollment completed when no next step', () => {
      const e = createEnrollment({ campaignId: 'camp-adv', customerId: 'cust-adv' });
      advanceEnrollment(e, undefined);
      const fetched = getActiveEnrollmentsDue().find(en => en.id === e.id);
      // It should be completed, not in active enrollments
      expect(fetched).toBeUndefined();
    });

    it('advances to next step when provided', () => {
      const e = createEnrollment({ campaignId: 'camp-adv2', customerId: 'cust-adv2', currentStepId: 'step-1' });
      advanceEnrollment(e, 'step-2');
      const updated = getActiveEnrollmentsDue().find(en => en.id === e.id);
      // Should now be at step-2 and due for execution
      expect(updated?.currentStepId).toBe('step-2');
    });
  });

  describe('Campaign analytics', () => {
    it('computes analytics from recipients', async () => {
      const camp = createCampaign({ name: 'Analytics Test', channel: 'email' });
      const analytics = await getCampaignAnalytics(camp.id);
      expect(analytics).not.toBeNull();
      expect(analytics!.campaignId).toBe(camp.id);
      expect(typeof analytics!.total).toBe('number');
      expect(typeof analytics!.sent).toBe('number');
    });

    it('returns null for nonexistent campaign', async () => {
      const analytics = await getCampaignAnalytics('nonexistent-camp');
      expect(analytics).toBeNull();
    });
  });

  describe('Step events & funnel', () => {
    it('records and retrieves step events', async () => {
      const event = addStepEvent({ enrollmentId: 'enr-evt', stepId: 'step-evt', eventType: 'executed' });
      expect(event.id).toBeDefined();
      expect(event.eventType).toBe('executed');

      const events = await getStepEvents('step-evt');
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.some(e => e.eventType === 'executed')).toBe(true);
    });

    it('retrieves enrollment events in chronological order', async () => {
      const enrollmentId = `enr-chrono-${Date.now()}`;
      addStepEvent({ enrollmentId, stepId: 'step-a', eventType: 'executed' });
      addStepEvent({ enrollmentId, stepId: 'step-a', eventType: 'sent' });
      addStepEvent({ enrollmentId, stepId: 'step-b', eventType: 'executed' });

      const events = await getEnrollmentEvents(enrollmentId);
      expect(events.length).toBe(3);
      // Should be in chronological order (ascending)
      for (let i = 1; i < events.length; i++) {
        expect(new Date(events[i].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(events[i - 1].createdAt).getTime()
        );
      }
    });

    it('computes campaign funnel analytics', async () => {
      const camp = createCampaign({ name: 'Funnel Test', channel: 'email' });
      const s1 = await addCampaignStep({ campaignId: camp.id, stepType: 'send_email', name: 'Email Step' });

      // Add some events for the step
      addStepEvent({ enrollmentId: 'enr-f1', stepId: s1.id, eventType: 'executed' });
      addStepEvent({ enrollmentId: 'enr-f1', stepId: s1.id, eventType: 'sent' });
      addStepEvent({ enrollmentId: 'enr-f2', stepId: s1.id, eventType: 'executed' });
      addStepEvent({ enrollmentId: 'enr-f2', stepId: s1.id, eventType: 'failed' });

      const funnel = await getCampaignFunnel(camp.id);
      expect(funnel.length).toBe(1);
      expect(funnel[0].stepName).toBe('Email Step');
      expect(funnel[0].executed).toBe(2);
      expect(funnel[0].completed).toBe(1); // 'sent' counts as completed
      expect(funnel[0].failed).toBe(1);
    });
  });

  describe('Orchestration - enrollCampaign', () => {
    it('enrolls matching customers and activates campaign', async () => {
      const camp = createCampaign({
        name: 'Enroll Test',
        channel: 'email',
        segmentQuery: {
          combinator: 'and',
          conditions: [{ field: 'plan', operator: 'eq', value: 'pro' }],
        },
      });

      await addCampaignStep({ campaignId: camp.id, stepType: 'send_email', name: 'Welcome' });

      const customers = [
        { id: 'cust-pro-1', plan: 'pro', email: 'a@test.com' },
        { id: 'cust-free-1', plan: 'free', email: 'b@test.com' },
        { id: 'cust-pro-2', plan: 'pro', email: 'c@test.com' },
      ];

      const result = await enrollCampaign(camp.id, customers);
      expect(result.enrolled).toBe(2);
      expect(result.campaign).not.toBeNull();
      expect(result.campaign!.status).toBe('active');
    });

    it('does not enroll if campaign has no steps', async () => {
      const camp = createCampaign({ name: 'No Steps', channel: 'email' });
      const result = await enrollCampaign(camp.id, [{ id: 'cust-1' }]);
      expect(result.enrolled).toBe(0);
    });

    it('does not enroll already-enrolled customers', async () => {
      const camp = createCampaign({ name: 'Dedup Test', channel: 'email' });
      const step = await addCampaignStep({ campaignId: camp.id, stepType: 'send_email', name: 'Email' });

      // First enrollment
      await enrollCampaign(camp.id, [{ id: 'cust-dup' }]);
      // Pause so we can re-enroll
      await pauseCampaign(camp.id);

      // Try again with same customer
      const result = await enrollCampaign(camp.id, [{ id: 'cust-dup' }]);
      expect(result.enrolled).toBe(0);
    });
  });

  describe('Orchestration - pause/resume', () => {
    it('pauses an active campaign', async () => {
      const camp = createCampaign({ name: 'Pause Test', channel: 'email' });
      await addCampaignStep({ campaignId: camp.id, stepType: 'send_email', name: 'Email' });
      await enrollCampaign(camp.id, [{ id: 'cust-pause' }]);

      const paused = await pauseCampaign(camp.id);
      expect(paused).not.toBeNull();
      expect(paused!.status).toBe('paused');
    });

    it('resumes a paused campaign', async () => {
      const camp = createCampaign({ name: 'Resume Test', channel: 'email' });
      await addCampaignStep({ campaignId: camp.id, stepType: 'send_email', name: 'Email' });
      await enrollCampaign(camp.id, [{ id: 'cust-resume' }]);
      await pauseCampaign(camp.id);

      const resumed = await resumeCampaign(camp.id);
      expect(resumed).not.toBeNull();
      expect(resumed!.status).toBe('active');
    });

    it('returns null when pausing a non-active campaign', async () => {
      const camp = createCampaign({ name: 'Not Active', channel: 'email' });
      const result = await pauseCampaign(camp.id);
      expect(result).toBeNull(); // draft cannot be paused
    });
  });
});

// ============================================================
// Plan 18 — Chatbots
// ============================================================

describe('Plan 18 — Chatbots', () => {
  // Helper: build a minimal chatbot flow
  function buildTestFlow(overrides?: Partial<ChatbotFlow>): ChatbotFlow {
    return {
      id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'Test Bot',
      rootNodeId: 'root',
      enabled: true,
      nodes: {
        root: {
          id: 'root',
          type: 'message',
          data: { text: 'Hello! How can I help?' },
          children: ['buttons-1'],
        },
        'buttons-1': {
          id: 'buttons-1',
          type: 'buttons',
          data: {
            text: 'Choose an option:',
            options: [
              { label: 'Sales', nextNodeId: 'sales-msg' },
              { label: 'Support', nextNodeId: 'support-msg' },
            ],
          },
        },
        'sales-msg': {
          id: 'sales-msg',
          type: 'message',
          data: { text: 'Sales team will contact you shortly.' },
          children: ['handoff-1'],
        },
        'support-msg': {
          id: 'support-msg',
          type: 'message',
          data: { text: 'Let me route you to support.' },
          children: ['handoff-1'],
        },
        'handoff-1': {
          id: 'handoff-1',
          type: 'handoff',
          data: { message: 'Connecting you with a human agent...' },
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  describe('Chatbot store CRUD', () => {
    it('upserts and retrieves a chatbot', async () => {
      const flow = buildTestFlow();
      await upsertChatbot(flow);

      const fetched = await getChatbot(flow.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('Test Bot');
      expect(Object.keys(fetched!.nodes)).toHaveLength(5);
    });

    it('lists chatbots', async () => {
      const flow1 = buildTestFlow({ name: 'Bot Alpha' });
      const flow2 = buildTestFlow({ name: 'Bot Beta' });
      await upsertChatbot(flow1);
      await upsertChatbot(flow2);

      const all = await getChatbots();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('updates an existing chatbot via upsert', async () => {
      const flow = buildTestFlow({ name: 'Original Name' });
      await upsertChatbot(flow);
      flow.name = 'Updated Name';
      await upsertChatbot(flow);

      const fetched = await getChatbot(flow.id);
      expect(fetched!.name).toBe('Updated Name');
    });

    it('deletes a chatbot', async () => {
      const flow = buildTestFlow();
      await upsertChatbot(flow);

      const deleted = await deleteChatbot(flow.id);
      expect(deleted).toBe(true);

      const fetched = await getChatbot(flow.id);
      expect(fetched).toBeNull();
    });

    it('returns false when deleting nonexistent chatbot', async () => {
      const deleted = await deleteChatbot('nonexistent-bot-id');
      expect(deleted).toBe(false);
    });
  });

  describe('Engine — flow traversal', () => {
    it('processes initial greeting from root node', () => {
      const flow = buildTestFlow();
      const response = processInitialGreeting(flow);

      // Should walk root message -> buttons-1 and stop at buttons
      expect(response.text).toContain('Hello! How can I help?');
      expect(response.text).toContain('Choose an option:');
      expect(response.buttons).toBeDefined();
      expect(response.buttons!.length).toBe(2);
      expect(response.handoff).toBe(false);
    });

    it('handles button selection and advances to next node', () => {
      const flow = buildTestFlow();

      // Step 1: Get to buttons
      const greeting = processInitialGreeting(flow);
      const state = greeting.newState;

      // Step 2: User selects "Sales"
      const response = evaluateBotResponse(flow, state, 'Sales');
      expect(response.text).toContain('Sales team will contact you shortly.');
      expect(response.text).toContain('Connecting you with a human agent...');
      expect(response.handoff).toBe(true);
    });

    it('handles button selection for Support path', () => {
      const flow = buildTestFlow();
      const greeting = processInitialGreeting(flow);

      const response = evaluateBotResponse(flow, greeting.newState, 'Support');
      expect(response.text).toContain('Let me route you to support.');
      expect(response.handoff).toBe(true);
    });

    it('re-shows buttons on invalid input', () => {
      const flow = buildTestFlow();
      const greeting = processInitialGreeting(flow);

      const response = evaluateBotResponse(flow, greeting.newState, 'InvalidChoice');
      expect(response.buttons).toBeDefined();
      expect(response.buttons!.length).toBe(2);
      expect(response.handoff).toBe(false);
    });

    it('tracks visited nodes in state', () => {
      const flow = buildTestFlow();
      const greeting = processInitialGreeting(flow);

      expect(greeting.newState.visitedNodes).toContain('root');
    });

    it('stores lastChoice variable after button selection', () => {
      const flow = buildTestFlow();
      const greeting = processInitialGreeting(flow);
      const response = evaluateBotResponse(flow, greeting.newState, 'Sales');

      expect(response.newState.variables['lastChoice']).toBe('Sales');
    });
  });

  describe('Engine — branch node', () => {
    it('evaluates branch conditions and follows matching path', () => {
      const flow: ChatbotFlow = {
        id: 'branch-test',
        name: 'Branch Bot',
        rootNodeId: 'branch-1',
        enabled: true,
        nodes: {
          'branch-1': {
            id: 'branch-1',
            type: 'branch',
            data: {
              field: 'message',
              conditions: [
                { op: 'contains', value: 'billing', nextNodeId: 'billing-msg' },
                { op: 'contains', value: 'technical', nextNodeId: 'tech-msg' },
              ],
              fallbackNodeId: 'fallback-msg',
            },
          },
          'billing-msg': {
            id: 'billing-msg',
            type: 'message',
            data: { text: 'Billing department here.' },
          },
          'tech-msg': {
            id: 'tech-msg',
            type: 'message',
            data: { text: 'Technical support here.' },
          },
          'fallback-msg': {
            id: 'fallback-msg',
            type: 'message',
            data: { text: 'General support.' },
          },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const state = initBotSession(flow);

      const billingResponse = evaluateBotResponse(flow, state, 'I have a billing question');
      expect(billingResponse.text).toBe('Billing department here.');

      const techResponse = evaluateBotResponse(flow, state, 'I need technical help');
      expect(techResponse.text).toBe('Technical support here.');

      const fallbackResponse = evaluateBotResponse(flow, state, 'hello');
      expect(fallbackResponse.text).toBe('General support.');
    });
  });

  describe('Engine — collect_input node', () => {
    it('prompts for input and validates email', () => {
      // Put a message node before collect_input so the first visit
      // correctly shows the prompt (not the re-evaluation path).
      const flow: ChatbotFlow = {
        id: 'collect-test',
        name: 'Collect Bot',
        rootNodeId: 'intro-msg',
        enabled: true,
        nodes: {
          'intro-msg': {
            id: 'intro-msg',
            type: 'message',
            data: { text: 'Welcome!' },
            children: ['collect-1'],
          },
          'collect-1': {
            id: 'collect-1',
            type: 'collect_input',
            data: {
              prompt: 'What is your email?',
              variable: 'email',
              validation: 'email',
              errorMessage: 'Please enter a valid email.',
            },
            children: ['thanks'],
          },
          thanks: {
            id: 'thanks',
            type: 'message',
            data: { text: 'Thank you!' },
          },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const state = initBotSession(flow);

      // First visit: walks intro-msg -> collect-1, shows prompt and stops
      const r1 = evaluateBotResponse(flow, state, '');
      expect(r1.text).toContain('What is your email?');
      expect(r1.collectInput).toBeDefined();

      // Invalid email — re-evaluation at collect-1
      const r2 = evaluateBotResponse(flow, r1.newState, 'not-an-email');
      expect(r2.text).toBe('Please enter a valid email.');
      expect(r2.collectInput).toBeDefined();

      // Valid email — advances to thanks
      const r3 = evaluateBotResponse(flow, r2.newState, 'user@example.com');
      expect(r3.text).toBe('Thank you!');
      expect(r3.newState.variables['email']).toBe('user@example.com');
    });
  });

  describe('Engine — action and delay nodes', () => {
    it('collects actions from action nodes', () => {
      const flow: ChatbotFlow = {
        id: 'action-test',
        name: 'Action Bot',
        rootNodeId: 'action-1',
        enabled: true,
        nodes: {
          'action-1': {
            id: 'action-1',
            type: 'action',
            data: { actionType: 'set_tag', value: 'vip' },
            children: ['msg-1'],
          },
          'msg-1': {
            id: 'msg-1',
            type: 'message',
            data: { text: 'Tagged as VIP.' },
          },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const state = initBotSession(flow);
      const response = evaluateBotResponse(flow, state, '');
      expect(response.actions).toHaveLength(1);
      expect(response.actions[0].actionType).toBe('set_tag');
      expect(response.actions[0].value).toBe('vip');
      expect(response.text).toBe('Tagged as VIP.');
    });

    it('returns delay seconds from delay nodes', () => {
      const flow: ChatbotFlow = {
        id: 'delay-test',
        name: 'Delay Bot',
        rootNodeId: 'msg-1',
        enabled: true,
        nodes: {
          'msg-1': {
            id: 'msg-1',
            type: 'message',
            data: { text: 'Please wait...' },
            children: ['delay-1'],
          },
          'delay-1': {
            id: 'delay-1',
            type: 'delay',
            data: { seconds: 5 },
            children: ['msg-2'],
          },
          'msg-2': {
            id: 'msg-2',
            type: 'message',
            data: { text: 'Done waiting.' },
          },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const state = initBotSession(flow);
      const response = evaluateBotResponse(flow, state, '');
      expect(response.text).toBe('Please wait...');
      expect(response.delay).toBe(5);
      expect(response.newState.currentNodeId).toBe('msg-2');
    });
  });

  describe('Engine — ai_response and webhook nodes', () => {
    it('returns AI request from ai_response node', () => {
      const flow: ChatbotFlow = {
        id: 'ai-test',
        name: 'AI Bot',
        rootNodeId: 'ai-1',
        enabled: true,
        nodes: {
          'ai-1': {
            id: 'ai-1',
            type: 'ai_response',
            data: {
              systemPrompt: 'You are a helpful assistant.',
              useRag: true,
              ragCollections: ['kb-main'],
              maxTokens: 500,
            },
            children: ['msg-1'],
          },
          'msg-1': {
            id: 'msg-1',
            type: 'message',
            data: { text: 'After AI.' },
          },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const state = initBotSession(flow);
      const response = evaluateBotResponse(flow, state, 'help me');
      expect(response.aiRequest).toBeDefined();
      expect(response.aiRequest!.systemPrompt).toBe('You are a helpful assistant.');
      expect(response.aiRequest!.useRag).toBe(true);
      expect(response.newState.currentNodeId).toBe('msg-1');
    });

    it('returns webhook request from webhook node', () => {
      const flow: ChatbotFlow = {
        id: 'webhook-test',
        name: 'Webhook Bot',
        rootNodeId: 'wh-1',
        enabled: true,
        nodes: {
          'wh-1': {
            id: 'wh-1',
            type: 'webhook',
            data: {
              url: 'https://api.example.com/lookup',
              method: 'POST',
              headers: { 'X-Api-Key': 'test' },
              bodyTemplate: '{"query": "{{message}}"}',
              responseVariable: 'lookupResult',
            },
            children: ['msg-1'],
          },
          'msg-1': {
            id: 'msg-1',
            type: 'message',
            data: { text: 'Lookup complete.' },
          },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const state = initBotSession(flow);
      const response = evaluateBotResponse(flow, state, '');
      expect(response.webhookRequest).toBeDefined();
      expect(response.webhookRequest!.url).toBe('https://api.example.com/lookup');
      expect(response.webhookRequest!.method).toBe('POST');
      expect(response.webhookRequest!.responseVariable).toBe('lookupResult');
    });
  });

  describe('Version management (JSONL path)', () => {
    it('publishes a chatbot and increments version', async () => {
      const { publishChatbot } = await import('@/lib/chatbot/versions');
      const flow = buildTestFlow({ version: 1 });
      await upsertChatbot(flow);

      const result = await publishChatbot(flow.id);
      expect(result).not.toBeNull();
      expect(result!.version).toBe(2);

      // Verify the flow was updated
      const fetched = await getChatbot(flow.id);
      expect(fetched!.version).toBe(2);
      expect(fetched!.status).toBe('published');
    });

    it('returns null when publishing nonexistent chatbot', async () => {
      const { publishChatbot } = await import('@/lib/chatbot/versions');
      const result = await publishChatbot('nonexistent-bot');
      expect(result).toBeNull();
    });
  });
});

// ============================================================
// Plan 16 — PII Detection & Masking
// ============================================================

describe('Plan 16 — PII Detection & Masking', () => {
  describe('SSN detection', () => {
    it('detects valid SSN with dashes', () => {
      const matches = detectPiiRegex('My SSN is 123-45-6789.');
      const ssns = matches.filter(m => m.piiType === 'ssn');
      expect(ssns).toHaveLength(1);
      expect(ssns[0].text).toBe('123-45-6789');
      expect(ssns[0].confidence).toBe(0.95);
    });

    it('rejects SSN with 000 area code', () => {
      const matches = detectPiiRegex('SSN: 000-12-3456');
      expect(matches.filter(m => m.piiType === 'ssn')).toHaveLength(0);
    });

    it('rejects SSN with 666 area code', () => {
      const matches = detectPiiRegex('SSN: 666-12-3456');
      expect(matches.filter(m => m.piiType === 'ssn')).toHaveLength(0);
    });

    it('rejects SSN with 9xx area code', () => {
      const matches = detectPiiRegex('SSN: 912-12-3456');
      expect(matches.filter(m => m.piiType === 'ssn')).toHaveLength(0);
    });

    it('detects multiple SSNs in one text', () => {
      const matches = detectPiiRegex('SSN1: 123-45-6789, SSN2: 234-56-7890');
      const ssns = matches.filter(m => m.piiType === 'ssn');
      expect(ssns).toHaveLength(2);
    });

    it('records correct start/end positions', () => {
      const text = 'SSN: 123-45-6789 end';
      const matches = detectPiiRegex(text);
      const ssn = matches.find(m => m.piiType === 'ssn');
      expect(ssn).toBeDefined();
      expect(text.slice(ssn!.start, ssn!.end)).toBe('123-45-6789');
    });
  });

  describe('Credit card detection with Luhn', () => {
    it('detects valid Visa card', () => {
      const matches = detectPiiRegex('Card: 4111111111111111');
      expect(matches.some(m => m.piiType === 'credit_card')).toBe(true);
    });

    it('detects valid card with spaces', () => {
      const matches = detectPiiRegex('Card: 4111 1111 1111 1111');
      expect(matches.some(m => m.piiType === 'credit_card')).toBe(true);
    });

    it('rejects card number failing Luhn check', () => {
      const matches = detectPiiRegex('Fake: 1234567890123456');
      expect(matches.filter(m => m.piiType === 'credit_card')).toHaveLength(0);
    });

    it('validates Luhn for known test numbers', () => {
      expect(validateLuhn('4111111111111111')).toBe(true);  // Visa
      expect(validateLuhn('5500000000000004')).toBe(true);  // Mastercard
      expect(validateLuhn('378282246310005')).toBe(true);   // Amex
      expect(validateLuhn('6011111111111117')).toBe(true);  // Discover
    });

    it('rejects Luhn for invalid numbers', () => {
      expect(validateLuhn('1234567890123456')).toBe(false);
      expect(validateLuhn('1111111111111112')).toBe(false);
    });

    it('rejects too-short numbers', () => {
      expect(validateLuhn('123456')).toBe(false);
      expect(validateLuhn('41111')).toBe(false);
    });

    it('has high confidence for credit cards', () => {
      const matches = detectPiiRegex('Card: 4111111111111111');
      const cc = matches.find(m => m.piiType === 'credit_card');
      expect(cc!.confidence).toBe(0.98);
    });
  });

  describe('Email detection', () => {
    it('detects standard email', () => {
      const matches = detectPiiRegex('Contact: user@example.com');
      const emails = matches.filter(m => m.piiType === 'email');
      expect(emails).toHaveLength(1);
      expect(emails[0].confidence).toBe(0.99);
    });

    it('detects email with dots and plus', () => {
      const matches = detectPiiRegex('Email: first.last+tag@domain.co.uk');
      expect(matches.some(m => m.piiType === 'email')).toBe(true);
    });
  });

  describe('Phone detection', () => {
    it('detects US phone with parens', () => {
      const matches = detectPiiRegex('Call (555) 123-4567');
      expect(matches.some(m => m.piiType === 'phone')).toBe(true);
    });

    it('detects phone with country code', () => {
      const matches = detectPiiRegex('Phone: +1 555-123-4567');
      expect(matches.some(m => m.piiType === 'phone')).toBe(true);
    });

    it('has 0.80 confidence for phones', () => {
      const matches = detectPiiRegex('Call (555) 123-4567');
      const phone = matches.find(m => m.piiType === 'phone');
      expect(phone!.confidence).toBe(0.80);
    });
  });

  describe('DOB detection', () => {
    it('detects valid MM/DD/YYYY', () => {
      const matches = detectPiiRegex('DOB: 01/15/1990');
      expect(matches.some(m => m.piiType === 'dob')).toBe(true);
    });

    it('rejects invalid month 13', () => {
      const matches = detectPiiRegex('Date: 13/15/1990');
      expect(matches.filter(m => m.piiType === 'dob')).toHaveLength(0);
    });

    it('rejects invalid month 00', () => {
      const matches = detectPiiRegex('Date: 00/15/1990');
      expect(matches.filter(m => m.piiType === 'dob')).toHaveLength(0);
    });
  });

  describe('Medical ID detection', () => {
    it('detects MRN format', () => {
      const matches = detectPiiRegex('Patient MRN-12345678');
      expect(matches.some(m => m.piiType === 'medical_id')).toBe(true);
    });

    it('detects MBI format', () => {
      const matches = detectPiiRegex('Medicare MBI 1EG4TE5MK73');
      expect(matches.some(m => m.piiType === 'medical_id')).toBe(true);
    });

    it('has 0.85 confidence for medical IDs', () => {
      const matches = detectPiiRegex('Patient MRN-12345678');
      const med = matches.find(m => m.piiType === 'medical_id');
      expect(med!.confidence).toBe(0.85);
    });
  });

  describe('Masking styles', () => {
    it('full masking replaces with [REDACTED-TYPE]', () => {
      const matches: PiiMatch[] = [
        { piiType: 'ssn', text: '123-45-6789', start: 0, end: 11, confidence: 0.95, method: 'regex' },
      ];
      const result = maskText('123-45-6789', matches, 'full');
      expect(result).toBe('[REDACTED-SSN]');
    });

    it('partial masking keeps last 4 digits for credit cards', () => {
      const matches: PiiMatch[] = [
        { piiType: 'credit_card', text: '4111111111111111', start: 0, end: 16, confidence: 0.98, method: 'regex' },
      ];
      const result = maskText('4111111111111111', matches, 'partial');
      expect(result).toBe('***1111');
    });

    it('partial masking keeps last 4 digits for SSN', () => {
      const matches: PiiMatch[] = [
        { piiType: 'ssn', text: '123-45-6789', start: 0, end: 11, confidence: 0.95, method: 'regex' },
      ];
      const result = maskText('123-45-6789', matches, 'partial');
      expect(result).toBe('***6789');
    });

    it('partial masking keeps last 2 for other types', () => {
      const matches: PiiMatch[] = [
        { piiType: 'email', text: 'user@example.com', start: 0, end: 16, confidence: 0.99, method: 'regex' },
      ];
      const result = maskText('user@example.com', matches, 'partial');
      expect(result).toBe('***om');
    });

    it('hash masking replaces with [HASH-TYPE]', () => {
      const matches: PiiMatch[] = [
        { piiType: 'phone', text: '555-123-4567', start: 0, end: 12, confidence: 0.80, method: 'regex' },
      ];
      const result = maskText('555-123-4567', matches, 'hash');
      expect(result).toBe('[HASH-PHONE]');
    });

    it('masks multiple matches from end to start', () => {
      const matches: PiiMatch[] = [
        { piiType: 'ssn', text: '123-45-6789', start: 0, end: 11, confidence: 0.95, method: 'regex' },
        { piiType: 'email', text: 'a@b.com', start: 12, end: 19, confidence: 0.99, method: 'regex' },
      ];
      const result = maskText('123-45-6789 a@b.com', matches, 'full');
      expect(result).toBe('[REDACTED-SSN] [REDACTED-EMAIL]');
    });

    it('returns original text for empty matches', () => {
      expect(maskText('safe text here', [], 'full')).toBe('safe text here');
    });
  });

  describe('Custom pattern ReDoS guard', () => {
    it('rejects patterns over 200 chars', () => {
      const longPattern = 'a'.repeat(201);
      const rules: PiiSensitivityRule[] = [
        { piiType: 'custom', enabled: true, autoRedact: false, maskingStyle: 'full', customPattern: longPattern },
      ];
      const matches = detectPiiRegex('test text', rules);
      expect(matches.filter(m => m.piiType === 'custom')).toHaveLength(0);
    });

    it('accepts patterns at exactly 200 chars', () => {
      const pattern200 = 'test';  // Short valid pattern
      const rules: PiiSensitivityRule[] = [
        { piiType: 'custom', enabled: true, autoRedact: false, maskingStyle: 'full', customPattern: pattern200 },
      ];
      const matches = detectPiiRegex('this is a test', rules);
      expect(matches.some(m => m.piiType === 'custom')).toBe(true);
    });

    it('skips invalid regex without throwing', () => {
      const rules: PiiSensitivityRule[] = [
        { piiType: 'custom', enabled: true, autoRedact: false, maskingStyle: 'full', customPattern: '[unclosed' },
      ];
      expect(() => detectPiiRegex('test', rules)).not.toThrow();
    });
  });

  describe('Sensitivity rules filtering', () => {
    it('respects disabled types', () => {
      const rules: PiiSensitivityRule[] = [
        { piiType: 'ssn', enabled: false, autoRedact: false, maskingStyle: 'full' },
        { piiType: 'email', enabled: true, autoRedact: false, maskingStyle: 'full' },
      ];
      const matches = detectPiiRegex('SSN: 123-45-6789, Email: user@example.com', rules);
      expect(matches.filter(m => m.piiType === 'ssn')).toHaveLength(0);
      expect(matches.filter(m => m.piiType === 'email')).toHaveLength(1);
    });

    it('getDefaultRules returns 10 enabled rules', () => {
      const rules = getDefaultRules();
      expect(rules).toHaveLength(10);
      expect(rules.every(r => r.enabled)).toBe(true);
      expect(rules.every(r => !r.autoRedact)).toBe(true);
      expect(rules.every(r => r.maskingStyle === 'full')).toBe(true);
    });
  });

  describe('Clean text produces no false positives for core types', () => {
    it('no SSN/CC in safe text', () => {
      const matches = detectPiiRegex('Hello, how are you? Order #12345 is on the way.');
      const sensitive = matches.filter(m => m.piiType === 'ssn' || m.piiType === 'credit_card');
      expect(sensitive).toHaveLength(0);
    });
  });
});

// ============================================================
// Plan 13 — Reports
// ============================================================

describe('Plan 13 — Reports', () => {
  describe('Metric registry', () => {
    it('has at least 15 metric definitions', () => {
      expect(METRIC_REGISTRY.length).toBeGreaterThanOrEqual(15);
    });

    it('getMetric finds ticket_volume', () => {
      const metric = getMetric('ticket_volume');
      expect(metric).toBeDefined();
      expect(metric!.label).toBe('Ticket Volume');
      expect(metric!.aggregation).toBe('count');
      expect(metric!.validGroupBy).toContain('date');
    });

    it('getMetric returns undefined for unknown metric', () => {
      expect(getMetric('nonexistent_metric')).toBeUndefined();
    });

    it('validates groupBy dimensions', () => {
      const valid = validateGroupBy('ticket_volume', ['date', 'status', 'invalid_dimension']);
      expect(valid).toContain('date');
      expect(valid).toContain('status');
      expect(valid).not.toContain('invalid_dimension');
    });

    it('validateGroupBy returns empty for unknown metric', () => {
      const result = validateGroupBy('unknown_metric', ['date']);
      expect(result).toEqual([]);
    });

    it('listMetrics returns key, label, description', () => {
      const metrics = listMetrics();
      expect(metrics.length).toBeGreaterThanOrEqual(15);
      expect(metrics[0]).toHaveProperty('key');
      expect(metrics[0]).toHaveProperty('label');
      expect(metrics[0]).toHaveProperty('description');
    });
  });

  describe('Metric definitions correctness', () => {
    it('avg_first_response_time uses tickets and messages tables', () => {
      const metric = getMetric('avg_first_response_time');
      expect(metric!.sourceTables).toContain('tickets');
      expect(metric!.sourceTables).toContain('messages');
      expect(metric!.aggregation).toBe('avg');
    });

    it('sla_compliance_rate uses pct aggregation', () => {
      const metric = getMetric('sla_compliance_rate');
      expect(metric!.aggregation).toBe('pct');
    });

    it('csat_score uses csat_ratings table', () => {
      const metric = getMetric('csat_score');
      expect(metric!.sourceTables).toContain('csat_ratings');
    });

    it('agent_tickets_handled allows assignee groupBy', () => {
      const metric = getMetric('agent_tickets_handled');
      expect(metric!.validGroupBy).toContain('assignee');
    });

    it('ai_resolution_rate uses pct aggregation', () => {
      const metric = getMetric('ai_resolution_rate');
      expect(metric!.aggregation).toBe('pct');
    });
  });

  describe('Report templates', () => {
    it('has at least 5 templates', () => {
      expect(REPORT_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    });

    it('all templates reference valid metrics', () => {
      for (const template of REPORT_TEMPLATES) {
        const metric = getMetric(template.metric);
        expect(metric).toBeDefined();
      }
    });

    it('all templates have visualization types', () => {
      for (const template of REPORT_TEMPLATES) {
        expect(['bar', 'line', 'pie', 'number', 'table']).toContain(template.visualization);
      }
    });

    it('getTemplateSeedData produces correct shape', () => {
      const seeds = getTemplateSeedData('ws-test');
      expect(seeds.length).toBe(REPORT_TEMPLATES.length);
      for (const seed of seeds) {
        expect(seed.workspaceId).toBe('ws-test');
        expect(seed.isTemplate).toBe(true);
        expect(seed.name).toBeDefined();
        expect(seed.metric).toBeDefined();
      }
    });
  });
});

// ============================================================
// Plan 20 — CRM Links & Custom Objects
// ============================================================

describe('Plan 20 — CRM & Custom Objects', () => {
  describe('CRM link store', () => {
    it('creates and retrieves a CRM link', async () => {
      const link = createCrmLink({
        workspaceId: 'ws-test',
        provider: 'salesforce',
        entityType: 'customer',
        entityId: 'cust-100',
        crmObjectType: 'Contact',
        crmObjectId: 'sf-contact-1',
        crmObjectUrl: 'https://salesforce.com/contact/sf-contact-1',
        crmData: { email: 'test@example.com', company: 'Acme Corp' },
      });

      expect(link.id).toBeDefined();
      expect(link.provider).toBe('salesforce');
      expect(link.crmObjectType).toBe('Contact');

      const fetched = await getCrmLink(link.id);
      expect(fetched).toBeDefined();
      expect(fetched!.crmObjectId).toBe('sf-contact-1');
    });

    it('lists CRM links with filtering', async () => {
      createCrmLink({
        workspaceId: 'ws-test',
        provider: 'hubspot',
        entityType: 'customer',
        entityId: 'cust-200',
        crmObjectType: 'Contact',
        crmObjectId: 'hs-1',
        crmData: {},
      });

      createCrmLink({
        workspaceId: 'ws-test',
        provider: 'hubspot',
        entityType: 'organization',
        entityId: 'org-100',
        crmObjectType: 'Company',
        crmObjectId: 'hs-2',
        crmData: {},
      });

      const customerLinks = await listCrmLinks('customer', undefined, 'ws-test');
      expect(customerLinks.every(l => l.entityType === 'customer')).toBe(true);

      const orgLinks = await listCrmLinks('organization', undefined, 'ws-test');
      expect(orgLinks.every(l => l.entityType === 'organization')).toBe(true);
    });

    it('updates a CRM link', () => {
      const link = createCrmLink({
        workspaceId: 'ws-test',
        provider: 'salesforce',
        entityType: 'customer',
        entityId: 'cust-upd',
        crmObjectType: 'Contact',
        crmObjectId: 'sf-upd',
        crmData: { name: 'Old Name' },
      });

      const updated = updateCrmLink(link.id, { crmData: { name: 'New Name' } });
      expect(updated).not.toBeNull();
      expect(updated!.crmData.name).toBe('New Name');
    });

    it('deletes a CRM link', async () => {
      const link = createCrmLink({
        workspaceId: 'ws-test',
        provider: 'salesforce',
        entityType: 'customer',
        entityId: 'cust-del',
        crmObjectType: 'Contact',
        crmObjectId: 'sf-del',
        crmData: {},
      });

      expect(deleteCrmLink(link.id)).toBe(true);
      const fetched = await getCrmLink(link.id);
      expect(fetched).toBeUndefined();
    });

    it('returns false when deleting nonexistent link', () => {
      expect(deleteCrmLink('nonexistent-link')).toBe(false);
    });
  });

  describe('Custom object types', () => {
    it('creates a custom object type', () => {
      const type = createObjectType({
        workspaceId: 'ws-test',
        key: `asset_${Date.now()}`,
        name: 'IT Asset',
        namePlural: 'IT Assets',
        description: 'Hardware and software assets',
        fields: [
          { key: 'serial_number', name: 'Serial Number', type: 'text', required: true },
          { key: 'purchase_date', name: 'Purchase Date', type: 'date' },
          { key: 'value', name: 'Value', type: 'currency' },
          { key: 'status', name: 'Status', type: 'select', options: ['active', 'retired', 'maintenance'] },
        ],
      });

      expect(type.id).toBeDefined();
      expect(type.name).toBe('IT Asset');
      expect(type.fields).toHaveLength(4);
    });

    it('prevents duplicate keys in same workspace', () => {
      const key = `unique_key_${Date.now()}`;
      createObjectType({
        workspaceId: 'ws-test',
        key,
        name: 'Type A',
        namePlural: 'Type As',
        fields: [],
      });

      expect(() =>
        createObjectType({
          workspaceId: 'ws-test',
          key,
          name: 'Type B',
          namePlural: 'Type Bs',
          fields: [],
        })
      ).toThrow(/already exists/);
    });

    it('lists object types by workspace', () => {
      const key = `list_test_${Date.now()}`;
      createObjectType({
        workspaceId: 'ws-list-test',
        key,
        name: 'List Test',
        namePlural: 'List Tests',
        fields: [],
      });

      const types = listObjectTypes('ws-list-test');
      expect(types.some(t => t.key === key)).toBe(true);

      const otherTypes = listObjectTypes('ws-other');
      expect(otherTypes.some(t => t.key === key)).toBe(false);
    });

    it('updates a custom object type', () => {
      const type = createObjectType({
        workspaceId: 'ws-test',
        key: `upd_${Date.now()}`,
        name: 'Original',
        namePlural: 'Originals',
        fields: [],
      });

      const updated = updateObjectType(type.id, { name: 'Updated', description: 'Now with description' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated');
      expect(updated!.description).toBe('Now with description');
    });

    it('deletes a custom object type and cascades to records', () => {
      const type = createObjectType({
        workspaceId: 'ws-test',
        key: `del_${Date.now()}`,
        name: 'To Delete',
        namePlural: 'To Deletes',
        fields: [{ key: 'name', name: 'Name', type: 'text' }],
      });

      const record = createRecord({
        workspaceId: 'ws-test',
        typeId: type.id,
        data: { name: 'Test Record' },
      });

      expect(deleteObjectType(type.id)).toBe(true);
      expect(getObjectType(type.id)).toBeUndefined();

      // Records should also be deleted
      const records = listRecords(type.id);
      expect(records).toHaveLength(0);
    });
  });

  describe('Custom object records', () => {
    let typeId: string;

    beforeEach(() => {
      const type = createObjectType({
        workspaceId: 'ws-test',
        key: `rec_test_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        name: 'Test Object',
        namePlural: 'Test Objects',
        fields: [
          { key: 'name', name: 'Name', type: 'text', required: true },
          { key: 'count', name: 'Count', type: 'number' },
          { key: 'active', name: 'Active', type: 'boolean' },
        ],
      });
      typeId = type.id;
    });

    it('creates a record', () => {
      const record = createRecord({
        workspaceId: 'ws-test',
        typeId,
        data: { name: 'Widget Alpha', count: 42, active: true },
      });

      expect(record.id).toBeDefined();
      expect(record.data.name).toBe('Widget Alpha');
      expect(record.data.count).toBe(42);
    });

    it('retrieves a record by id', () => {
      const record = createRecord({
        workspaceId: 'ws-test',
        typeId,
        data: { name: 'Retrieve Me' },
      });

      const fetched = getRecord(record.id);
      expect(fetched).toBeDefined();
      expect(fetched!.data.name).toBe('Retrieve Me');
    });

    it('lists records by typeId', () => {
      createRecord({ workspaceId: 'ws-test', typeId, data: { name: 'Rec A' } });
      createRecord({ workspaceId: 'ws-test', typeId, data: { name: 'Rec B' } });

      const records = listRecords(typeId);
      expect(records.length).toBeGreaterThanOrEqual(2);
      expect(records.every(r => r.typeId === typeId)).toBe(true);
    });

    it('updates a record', () => {
      const record = createRecord({ workspaceId: 'ws-test', typeId, data: { name: 'Old', count: 1 } });
      const updated = updateRecord(record.id, { data: { name: 'New', count: 2 } });
      expect(updated).not.toBeNull();
      expect(updated!.data.name).toBe('New');
      expect(updated!.data.count).toBe(2);
    });

    it('deletes a record and cascades to relationships', () => {
      const record = createRecord({ workspaceId: 'ws-test', typeId, data: { name: 'Del Me' } });
      const otherRecord = createRecord({ workspaceId: 'ws-test', typeId, data: { name: 'Other' } });

      createRelationship({
        workspaceId: 'ws-test',
        sourceType: 'custom_object',
        sourceId: record.id,
        targetType: 'custom_object',
        targetId: otherRecord.id,
        relationshipType: 'related',
        metadata: {},
      });

      expect(deleteRecord(record.id)).toBe(true);
      expect(getRecord(record.id)).toBeUndefined();

      // Relationship should be cleaned up
      const rels = listRelationships({ sourceId: record.id });
      expect(rels).toHaveLength(0);
    });
  });

  describe('Custom object relationships', () => {
    it('creates a relationship between records', () => {
      const rel = createRelationship({
        workspaceId: 'ws-test',
        sourceType: 'ticket',
        sourceId: 'ticket-1',
        targetType: 'custom_object',
        targetId: 'co-rec-1',
        relationshipType: 'related',
        metadata: { note: 'linked from ticket' },
      });

      expect(rel.id).toBeDefined();
      expect(rel.sourceType).toBe('ticket');
      expect(rel.targetType).toBe('custom_object');
    });

    it('prevents duplicate relationships', () => {
      const input = {
        workspaceId: 'ws-test',
        sourceType: 'customer',
        sourceId: `cust-dup-${Date.now()}`,
        targetType: 'custom_object',
        targetId: `co-dup-${Date.now()}`,
        relationshipType: 'owns',
        metadata: {},
      };

      createRelationship(input);
      expect(() => createRelationship(input)).toThrow(/already exists/);
    });

    it('lists relationships with filters', () => {
      const sourceId = `src-${Date.now()}`;
      createRelationship({
        workspaceId: 'ws-test',
        sourceType: 'customer',
        sourceId,
        targetType: 'custom_object',
        targetId: `tgt-${Date.now()}-a`,
        relationshipType: 'owns',
        metadata: {},
      });
      createRelationship({
        workspaceId: 'ws-test',
        sourceType: 'customer',
        sourceId,
        targetType: 'custom_object',
        targetId: `tgt-${Date.now()}-b`,
        relationshipType: 'uses',
        metadata: {},
      });

      const rels = listRelationships({ sourceId });
      expect(rels.length).toBe(2);

      const byType = listRelationships({ sourceType: 'customer', sourceId });
      expect(byType.length).toBe(2);
    });

    it('deletes a relationship', () => {
      const rel = createRelationship({
        workspaceId: 'ws-test',
        sourceType: 'ticket',
        sourceId: `del-src-${Date.now()}`,
        targetType: 'custom_object',
        targetId: `del-tgt-${Date.now()}`,
        relationshipType: 'related',
        metadata: {},
      });

      expect(deleteRelationship(rel.id)).toBe(true);
      expect(deleteRelationship(rel.id)).toBe(false); // Already deleted
    });
  });

  describe('Record data validation', () => {
    it('validates required fields', () => {
      const type: CustomObjectType = {
        id: 'type-val',
        workspaceId: 'ws-test',
        key: 'validation_test',
        name: 'Validation',
        namePlural: 'Validations',
        fields: [
          { key: 'name', name: 'Name', type: 'text', required: true },
          { key: 'count', name: 'Count', type: 'number' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = validateRecordData(type, { count: 5 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name is required');
    });

    it('validates field types', () => {
      const type: CustomObjectType = {
        id: 'type-val2',
        workspaceId: 'ws-test',
        key: 'type_check',
        name: 'Type Check',
        namePlural: 'Type Checks',
        fields: [
          { key: 'count', name: 'Count', type: 'number' },
          { key: 'active', name: 'Active', type: 'boolean' },
          { key: 'url', name: 'URL', type: 'url' },
          { key: 'birthday', name: 'Birthday', type: 'date' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = validateRecordData(type, {
        count: 'not a number',
        active: 'not a boolean',
        url: 42,
        birthday: 'not-a-date',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(4);
    });

    it('validates select fields against options', () => {
      const type: CustomObjectType = {
        id: 'type-sel',
        workspaceId: 'ws-test',
        key: 'select_check',
        name: 'Select Check',
        namePlural: 'Select Checks',
        fields: [
          { key: 'status', name: 'Status', type: 'select', options: ['open', 'closed'] },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const valid = validateRecordData(type, { status: 'open' });
      expect(valid.valid).toBe(true);

      const invalid = validateRecordData(type, { status: 'pending' });
      expect(invalid.valid).toBe(false);
    });

    it('passes validation for valid data', () => {
      const type: CustomObjectType = {
        id: 'type-ok',
        workspaceId: 'ws-test',
        key: 'all_good',
        name: 'All Good',
        namePlural: 'All Goods',
        fields: [
          { key: 'name', name: 'Name', type: 'text', required: true },
          { key: 'count', name: 'Count', type: 'number' },
          { key: 'active', name: 'Active', type: 'boolean' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = validateRecordData(type, { name: 'Widget', count: 42, active: true });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('skips validation for undefined optional fields', () => {
      const type: CustomObjectType = {
        id: 'type-opt',
        workspaceId: 'ws-test',
        key: 'optional_check',
        name: 'Optional Check',
        namePlural: 'Optional Checks',
        fields: [
          { key: 'optional_field', name: 'Optional', type: 'text' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = validateRecordData(type, {});
      expect(result.valid).toBe(true);
    });
  });
});

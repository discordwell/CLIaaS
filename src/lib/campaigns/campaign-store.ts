/**
 * Campaign store — JSONL-backed in-memory storage for proactive/outbound messaging campaigns.
 * Follows the same pattern as src/lib/webhooks.ts.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export interface Campaign {
  id: string;
  workspaceId?: string;
  name: string;
  channel: 'email' | 'sms' | 'whatsapp' | 'in_app' | 'push';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'active' | 'paused' | 'completed';
  subject?: string;
  templateBody?: string;
  templateVariables?: Record<string, unknown>;
  segmentQuery?: Record<string, unknown>;
  entryStepId?: string;
  scheduledAt?: string;
  sentAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type CampaignStepType = 'send_email' | 'send_sms' | 'send_in_app' | 'send_push' | 'wait_delay' | 'wait_event' | 'condition' | 'branch' | 'update_tag' | 'webhook';

export interface CampaignStep {
  id: string;
  campaignId: string;
  workspaceId?: string;
  stepType: CampaignStepType;
  position: number;
  name: string;
  config: Record<string, unknown>;
  delaySeconds?: number;
  conditionQuery?: Record<string, unknown>;
  nextStepId?: string;
  branchTrueStepId?: string;
  branchFalseStepId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignEnrollment {
  id: string;
  campaignId: string;
  workspaceId?: string;
  customerId: string;
  currentStepId?: string;
  status: 'active' | 'completed' | 'exited' | 'failed';
  enrolledAt: string;
  completedAt?: string;
  nextExecutionAt?: string;
  metadata: Record<string, unknown>;
}

export interface CampaignStepEvent {
  id: string;
  enrollmentId: string;
  stepId: string;
  workspaceId?: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CampaignRecipient {
  id: string;
  campaignId: string;
  workspaceId?: string;
  customerId?: string;
  email?: string;
  phone?: string;
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'failed';
  sentAt?: string;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  error?: string;
}

export interface CampaignAnalytics {
  campaignId: string;
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
}

// ---- JSONL persistence ----

const CAMPAIGNS_FILE = 'campaigns.jsonl';
const CAMPAIGN_RECIPIENTS_FILE = 'campaign-recipients.jsonl';
const CAMPAIGN_STEPS_FILE = 'campaign-steps.jsonl';
const CAMPAIGN_ENROLLMENTS_FILE = 'campaign-enrollments.jsonl';
const CAMPAIGN_STEP_EVENTS_FILE = 'campaign-step-events.jsonl';

function persistCampaigns(): void {
  writeJsonlFile(CAMPAIGNS_FILE, campaigns);
}

function persistRecipients(): void {
  writeJsonlFile(CAMPAIGN_RECIPIENTS_FILE, recipients);
}

function persistSteps(): void {
  writeJsonlFile(CAMPAIGN_STEPS_FILE, steps);
}

function persistEnrollments(): void {
  writeJsonlFile(CAMPAIGN_ENROLLMENTS_FILE, enrollments);
}

function persistStepEvents(): void {
  writeJsonlFile(CAMPAIGN_STEP_EVENTS_FILE, stepEvents);
}

// ---- In-memory stores ----

const campaigns: Campaign[] = [];
const recipients: CampaignRecipient[] = [];
const steps: CampaignStep[] = [];
const enrollments: CampaignEnrollment[] = [];
const stepEvents: CampaignStepEvent[] = [];

let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  // Try loading from persisted JSONL files
  const savedCampaigns = readJsonlFile<Campaign>(CAMPAIGNS_FILE);
  const savedRecipients = readJsonlFile<CampaignRecipient>(CAMPAIGN_RECIPIENTS_FILE);

  const savedSteps = readJsonlFile<CampaignStep>(CAMPAIGN_STEPS_FILE);
  const savedEnrollments = readJsonlFile<CampaignEnrollment>(CAMPAIGN_ENROLLMENTS_FILE);
  const savedStepEvents = readJsonlFile<CampaignStepEvent>(CAMPAIGN_STEP_EVENTS_FILE);

  if (savedSteps.length > 0) steps.push(...savedSteps);
  if (savedEnrollments.length > 0) enrollments.push(...savedEnrollments);
  if (savedStepEvents.length > 0) stepEvents.push(...savedStepEvents);

  if (savedCampaigns.length > 0) {
    campaigns.push(...savedCampaigns);
    recipients.push(...savedRecipients);
    return;
  }

  // Fall back to demo defaults
  const now = new Date();
  const sentCampaign: Campaign = {
    id: 'camp-demo-1',
    name: 'Welcome Series — New Users',
    channel: 'email',
    status: 'sent',
    subject: 'Welcome to CLIaaS! Here is how to get started.',
    templateBody: 'Hi {{name}}, welcome aboard! We are excited to have you. Here are your first steps...',
    templateVariables: { name: 'Customer Name' },
    sentAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
    createdBy: 'demo-user',
    createdAt: new Date(now.getTime() - 5 * 86400000).toISOString(),
    updatedAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
  };

  const draftCampaign: Campaign = {
    id: 'camp-demo-2',
    name: 'Feature Announcement — Voice Channels',
    channel: 'email',
    status: 'draft',
    subject: 'New: Voice channels are now live!',
    templateBody: 'Hi {{name}}, we just launched voice channel support. Check it out at {{link}}.',
    templateVariables: { name: 'Customer Name', link: 'https://cliaas.com/channels' },
    createdBy: 'demo-user',
    createdAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
    updatedAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
  };

  campaigns.push(sentCampaign, draftCampaign);

  // Demo recipients for the sent campaign
  const demoRecipients: CampaignRecipient[] = [
    {
      id: 'recip-demo-1',
      campaignId: 'camp-demo-1',
      customerId: 'cust-1',
      email: 'alice@example.com',
      status: 'opened',
      sentAt: sentCampaign.sentAt,
      deliveredAt: sentCampaign.sentAt,
      openedAt: new Date(now.getTime() - 1.5 * 86400000).toISOString(),
    },
    {
      id: 'recip-demo-2',
      campaignId: 'camp-demo-1',
      customerId: 'cust-2',
      email: 'bob@example.com',
      status: 'clicked',
      sentAt: sentCampaign.sentAt,
      deliveredAt: sentCampaign.sentAt,
      openedAt: new Date(now.getTime() - 1.8 * 86400000).toISOString(),
      clickedAt: new Date(now.getTime() - 1.7 * 86400000).toISOString(),
    },
    {
      id: 'recip-demo-3',
      campaignId: 'camp-demo-1',
      customerId: 'cust-3',
      email: 'carol@example.com',
      status: 'delivered',
      sentAt: sentCampaign.sentAt,
      deliveredAt: sentCampaign.sentAt,
    },
    {
      id: 'recip-demo-4',
      campaignId: 'camp-demo-1',
      customerId: 'cust-4',
      email: 'dave@example.com',
      status: 'sent',
      sentAt: sentCampaign.sentAt,
    },
    {
      id: 'recip-demo-5',
      campaignId: 'camp-demo-1',
      customerId: 'cust-5',
      email: 'eve@example.com',
      status: 'failed',
      sentAt: sentCampaign.sentAt,
      error: 'Mailbox full',
    },
  ];

  recipients.push(...demoRecipients);
  persistCampaigns();
  persistRecipients();
}

// ---- Public API ----

export function getCampaigns(filters?: {
  status?: Campaign['status'];
  channel?: Campaign['channel'];
  workspaceId?: string;
}): Campaign[] {
  ensureDefaults();
  let result = [...campaigns];
  if (filters?.workspaceId) {
    result = result.filter(c => !c.workspaceId || c.workspaceId === filters.workspaceId);
  }
  if (filters?.status) {
    result = result.filter(c => c.status === filters.status);
  }
  if (filters?.channel) {
    result = result.filter(c => c.channel === filters.channel);
  }
  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getCampaign(id: string, workspaceId?: string): Campaign | undefined {
  ensureDefaults();
  const campaign = campaigns.find(c => c.id === id);
  if (!campaign) return undefined;
  if (workspaceId && campaign.workspaceId && campaign.workspaceId !== workspaceId) return undefined;
  return campaign;
}

export function createCampaign(
  input: Pick<Campaign, 'name' | 'channel'> & Partial<Pick<Campaign, 'subject' | 'templateBody' | 'templateVariables' | 'segmentQuery' | 'scheduledAt' | 'createdBy'>>,
  workspaceId?: string,
): Campaign {
  ensureDefaults();
  const now = new Date().toISOString();
  const campaign: Campaign = {
    id: `camp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    name: input.name,
    channel: input.channel,
    status: 'draft',
    subject: input.subject,
    templateBody: input.templateBody,
    templateVariables: input.templateVariables,
    segmentQuery: input.segmentQuery,
    scheduledAt: input.scheduledAt,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  campaigns.push(campaign);
  persistCampaigns();
  return campaign;
}

export function updateCampaign(
  id: string,
  updates: Partial<Omit<Campaign, 'id' | 'createdAt'>>,
  workspaceId?: string,
): Campaign | null {
  ensureDefaults();
  const idx = campaigns.findIndex(
    c => c.id === id && (!workspaceId || !c.workspaceId || c.workspaceId === workspaceId),
  );
  if (idx === -1) return null;
  campaigns[idx] = {
    ...campaigns[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  persistCampaigns();
  return campaigns[idx];
}

export function sendCampaign(id: string, workspaceId?: string): Campaign | null {
  ensureDefaults();
  const campaign = getCampaign(id, workspaceId);
  if (!campaign) return null;
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') return null;

  const now = new Date().toISOString();

  // Mark as sending
  const idx = campaigns.findIndex(c => c.id === id);
  campaigns[idx] = {
    ...campaigns[idx],
    status: 'sending',
    updatedAt: now,
  };

  // Create placeholder recipients (in a real system, these would come from the segment query)
  const demoRecipientEmails = ['user1@example.com', 'user2@example.com', 'user3@example.com'];
  for (const email of demoRecipientEmails) {
    recipients.push({
      id: `recip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      campaignId: id,
      workspaceId,
      email,
      status: 'sent',
      sentAt: now,
    });
  }

  // Mark as sent
  campaigns[idx] = {
    ...campaigns[idx],
    status: 'sent',
    sentAt: now,
    updatedAt: now,
  };

  persistCampaigns();
  persistRecipients();
  return campaigns[idx];
}

export function getCampaignAnalytics(id: string, workspaceId?: string): CampaignAnalytics | null {
  ensureDefaults();
  const campaign = getCampaign(id, workspaceId);
  if (!campaign) return null;

  const campaignRecipients = recipients.filter(r => r.campaignId === id);

  return {
    campaignId: id,
    total: campaignRecipients.length,
    pending: campaignRecipients.filter(r => r.status === 'pending').length,
    sent: campaignRecipients.filter(r => r.status === 'sent').length,
    delivered: campaignRecipients.filter(r => r.status === 'delivered').length,
    opened: campaignRecipients.filter(r => r.status === 'opened').length,
    clicked: campaignRecipients.filter(r => r.status === 'clicked').length,
    failed: campaignRecipients.filter(r => r.status === 'failed').length,
  };
}

// ---- Campaign Steps CRUD ----

export function getCampaignSteps(campaignId: string, workspaceId?: string): CampaignStep[] {
  ensureDefaults();
  return steps
    .filter(s => s.campaignId === campaignId && (!workspaceId || !s.workspaceId || s.workspaceId === workspaceId))
    .sort((a, b) => a.position - b.position);
}

export function getCampaignStep(stepId: string): CampaignStep | undefined {
  ensureDefaults();
  return steps.find(s => s.id === stepId);
}

export function addCampaignStep(
  input: Pick<CampaignStep, 'campaignId' | 'stepType' | 'name'> & Partial<Pick<CampaignStep, 'config' | 'delaySeconds' | 'conditionQuery' | 'nextStepId' | 'branchTrueStepId' | 'branchFalseStepId'>>,
  workspaceId?: string,
): CampaignStep {
  ensureDefaults();
  const existing = getCampaignSteps(input.campaignId, workspaceId);
  const now = new Date().toISOString();
  const step: CampaignStep = {
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    campaignId: input.campaignId,
    workspaceId,
    stepType: input.stepType,
    position: existing.length,
    name: input.name,
    config: input.config ?? {},
    delaySeconds: input.delaySeconds,
    conditionQuery: input.conditionQuery,
    nextStepId: input.nextStepId,
    branchTrueStepId: input.branchTrueStepId,
    branchFalseStepId: input.branchFalseStepId,
    createdAt: now,
    updatedAt: now,
  };
  steps.push(step);

  // Set as entry step if first step
  if (existing.length === 0) {
    const campaign = getCampaign(input.campaignId, workspaceId);
    if (campaign) {
      updateCampaign(input.campaignId, { entryStepId: step.id }, workspaceId);
    }
  }

  persistSteps();
  return step;
}

export function updateCampaignStep(
  stepId: string,
  updates: Partial<Omit<CampaignStep, 'id' | 'campaignId' | 'createdAt'>>,
): CampaignStep | null {
  ensureDefaults();
  const idx = steps.findIndex(s => s.id === stepId);
  if (idx === -1) return null;
  steps[idx] = {
    ...steps[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  persistSteps();
  return steps[idx];
}

export function removeCampaignStep(stepId: string): boolean {
  ensureDefaults();
  const idx = steps.findIndex(s => s.id === stepId);
  if (idx === -1) return false;
  steps.splice(idx, 1);
  persistSteps();
  return true;
}

export function reorderCampaignSteps(campaignId: string, stepIds: string[]): CampaignStep[] {
  ensureDefaults();
  for (let i = 0; i < stepIds.length; i++) {
    const idx = steps.findIndex(s => s.id === stepIds[i] && s.campaignId === campaignId);
    if (idx !== -1) {
      steps[idx] = { ...steps[idx], position: i, updatedAt: new Date().toISOString() };
    }
  }
  persistSteps();
  return getCampaignSteps(campaignId);
}

// ---- Campaign Enrollments CRUD ----

export function getEnrollments(campaignId: string, workspaceId?: string): CampaignEnrollment[] {
  ensureDefaults();
  return enrollments
    .filter(e => e.campaignId === campaignId && (!workspaceId || !e.workspaceId || e.workspaceId === workspaceId))
    .sort((a, b) => new Date(b.enrolledAt).getTime() - new Date(a.enrolledAt).getTime());
}

export function getEnrollment(enrollmentId: string): CampaignEnrollment | undefined {
  ensureDefaults();
  return enrollments.find(e => e.id === enrollmentId);
}

export function createEnrollment(
  input: Pick<CampaignEnrollment, 'campaignId' | 'customerId'> & Partial<Pick<CampaignEnrollment, 'currentStepId' | 'nextExecutionAt' | 'metadata'>>,
  workspaceId?: string,
): CampaignEnrollment {
  ensureDefaults();
  const now = new Date().toISOString();
  const enrollment: CampaignEnrollment = {
    id: `enr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    campaignId: input.campaignId,
    workspaceId,
    customerId: input.customerId,
    currentStepId: input.currentStepId,
    status: 'active',
    enrolledAt: now,
    nextExecutionAt: input.nextExecutionAt ?? now,
    metadata: input.metadata ?? {},
  };
  enrollments.push(enrollment);
  persistEnrollments();
  return enrollment;
}

export function updateEnrollment(
  enrollmentId: string,
  updates: Partial<Omit<CampaignEnrollment, 'id' | 'campaignId' | 'enrolledAt'>>,
): CampaignEnrollment | null {
  ensureDefaults();
  const idx = enrollments.findIndex(e => e.id === enrollmentId);
  if (idx === -1) return null;
  enrollments[idx] = { ...enrollments[idx], ...updates };
  persistEnrollments();
  return enrollments[idx];
}

export function getActiveEnrollmentsDue(): CampaignEnrollment[] {
  ensureDefaults();
  const now = new Date().getTime();
  return enrollments.filter(
    e => e.status === 'active' && e.nextExecutionAt && new Date(e.nextExecutionAt).getTime() <= now,
  );
}

// ---- Campaign Step Events ----

export function addStepEvent(
  input: Pick<CampaignStepEvent, 'enrollmentId' | 'stepId' | 'eventType'> & Partial<Pick<CampaignStepEvent, 'metadata'>>,
  workspaceId?: string,
): CampaignStepEvent {
  ensureDefaults();
  const event: CampaignStepEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    enrollmentId: input.enrollmentId,
    stepId: input.stepId,
    workspaceId,
    eventType: input.eventType,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
  stepEvents.push(event);
  persistStepEvents();
  return event;
}

export function getStepEvents(stepId: string): CampaignStepEvent[] {
  ensureDefaults();
  return stepEvents
    .filter(e => e.stepId === stepId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getEnrollmentEvents(enrollmentId: string): CampaignStepEvent[] {
  ensureDefaults();
  return stepEvents
    .filter(e => e.enrollmentId === enrollmentId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

// ---- Funnel Analytics ----

export interface StepFunnelEntry {
  stepId: string;
  stepName: string;
  stepType: CampaignStepType;
  position: number;
  executed: number;
  completed: number;
  failed: number;
  skipped: number;
}

export function getCampaignFunnel(campaignId: string, workspaceId?: string): StepFunnelEntry[] {
  ensureDefaults();
  const campaignSteps = getCampaignSteps(campaignId, workspaceId);
  return campaignSteps.map(step => {
    const events = stepEvents.filter(e => e.stepId === step.id);
    return {
      stepId: step.id,
      stepName: step.name,
      stepType: step.stepType,
      position: step.position,
      executed: events.filter(e => e.eventType === 'executed').length,
      completed: events.filter(e => e.eventType === 'completed' || e.eventType === 'sent' || e.eventType === 'delivered').length,
      failed: events.filter(e => e.eventType === 'failed' || e.eventType === 'bounced').length,
      skipped: events.filter(e => e.eventType === 'skipped').length,
    };
  });
}

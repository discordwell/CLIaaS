/**
 * Campaign store — JSONL-backed in-memory storage for proactive/outbound messaging campaigns.
 * Follows the same pattern as src/lib/webhooks.ts.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

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

export async function getCampaigns(filters?: {
  status?: Campaign['status'];
  channel?: Campaign['channel'];
  workspaceId?: string;
}): Promise<Campaign[]> {
  if (filters?.workspaceId) {
    const result = await withRls(filters.workspaceId, async ({ db, schema }) => {
      const { eq, and } = await import('drizzle-orm');
      const conditions = [];
      if (filters.status) conditions.push(eq(schema.campaigns.status, filters.status));
      if (filters.channel) conditions.push(eq(schema.campaigns.channel, filters.channel));
      const rows = await db.select().from(schema.campaigns)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(schema.campaigns.updatedAt);
      return rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        name: r.name,
        channel: r.channel,
        status: r.status,
        subject: r.subject ?? undefined,
        templateBody: r.templateBody ?? undefined,
        templateVariables: (r.templateVariables as Record<string, unknown>) ?? undefined,
        segmentQuery: (r.segmentQuery as Record<string, unknown>) ?? undefined,
        entryStepId: r.entryStepId ?? undefined,
        scheduledAt: r.scheduledAt?.toISOString(),
        sentAt: r.sentAt?.toISOString(),
        createdBy: r.createdBy ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } as Campaign)).reverse();
    });
    if (result !== null) return result;
  }
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

export async function getCampaign(id: string, workspaceId?: string): Promise<Campaign | undefined> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [row] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
      if (!row) return undefined;
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        channel: row.channel,
        status: row.status,
        subject: row.subject ?? undefined,
        templateBody: row.templateBody ?? undefined,
        templateVariables: (row.templateVariables as Record<string, unknown>) ?? undefined,
        segmentQuery: (row.segmentQuery as Record<string, unknown>) ?? undefined,
        entryStepId: row.entryStepId ?? undefined,
        scheduledAt: row.scheduledAt?.toISOString(),
        sentAt: row.sentAt?.toISOString(),
        createdBy: row.createdBy ?? undefined,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      } as Campaign;
    });
    if (result !== null) return result;
  }
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

export async function sendCampaign(id: string, workspaceId?: string): Promise<Campaign | null> {
  ensureDefaults();
  const campaign = await getCampaign(id, workspaceId);
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

export async function getCampaignAnalytics(id: string, workspaceId?: string): Promise<CampaignAnalytics | null> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      // Verify the campaign exists
      const [camp] = await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id));
      if (!camp) return null;
      const rows = await db.select().from(schema.campaignRecipients).where(eq(schema.campaignRecipients.campaignId, id));
      return {
        campaignId: id,
        total: rows.length,
        pending: rows.filter(r => r.status === 'pending').length,
        sent: rows.filter(r => r.status === 'sent').length,
        delivered: rows.filter(r => r.status === 'delivered').length,
        opened: rows.filter(r => r.status === 'opened').length,
        clicked: rows.filter(r => r.status === 'clicked').length,
        failed: rows.filter(r => r.status === 'failed').length,
      };
    });
    if (result !== null) return result;
  }
  ensureDefaults();
  const campaign = await getCampaign(id, workspaceId);
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

export async function getCampaignSteps(campaignId: string, workspaceId?: string): Promise<CampaignStep[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(schema.campaignSteps)
        .where(eq(schema.campaignSteps.campaignId, campaignId))
        .orderBy(schema.campaignSteps.position);
      return rows.map(r => ({
        id: r.id,
        campaignId: r.campaignId,
        workspaceId: r.workspaceId,
        stepType: r.stepType,
        position: r.position,
        name: r.name,
        config: (r.config as Record<string, unknown>) ?? {},
        delaySeconds: r.delaySeconds ?? undefined,
        conditionQuery: (r.conditionQuery as Record<string, unknown>) ?? undefined,
        nextStepId: r.nextStepId ?? undefined,
        branchTrueStepId: r.branchTrueStepId ?? undefined,
        branchFalseStepId: r.branchFalseStepId ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } as CampaignStep));
    });
    if (result !== null) return result;
  }
  ensureDefaults();
  return steps
    .filter(s => s.campaignId === campaignId && (!workspaceId || !s.workspaceId || s.workspaceId === workspaceId))
    .sort((a, b) => a.position - b.position);
}

export async function getCampaignStep(stepId: string, workspaceId?: string): Promise<CampaignStep | undefined> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [r] = await db.select().from(schema.campaignSteps).where(eq(schema.campaignSteps.id, stepId));
      if (!r) return undefined;
      return {
        id: r.id,
        campaignId: r.campaignId,
        workspaceId: r.workspaceId,
        stepType: r.stepType,
        position: r.position,
        name: r.name,
        config: (r.config as Record<string, unknown>) ?? {},
        delaySeconds: r.delaySeconds ?? undefined,
        conditionQuery: (r.conditionQuery as Record<string, unknown>) ?? undefined,
        nextStepId: r.nextStepId ?? undefined,
        branchTrueStepId: r.branchTrueStepId ?? undefined,
        branchFalseStepId: r.branchFalseStepId ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } as CampaignStep;
    });
    if (result !== null) return result;
  }
  ensureDefaults();
  return steps.find(s => s.id === stepId);
}

export async function addCampaignStep(
  input: Pick<CampaignStep, 'campaignId' | 'stepType' | 'name'> & Partial<Pick<CampaignStep, 'config' | 'delaySeconds' | 'conditionQuery' | 'nextStepId' | 'branchTrueStepId' | 'branchFalseStepId'>>,
  workspaceId?: string,
): Promise<CampaignStep> {
  ensureDefaults();
  const existing = await getCampaignSteps(input.campaignId, workspaceId);
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
    const campaign = await getCampaign(input.campaignId, workspaceId);
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

export async function reorderCampaignSteps(campaignId: string, stepIds: string[]): Promise<CampaignStep[]> {
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

export async function getEnrollments(campaignId: string, workspaceId?: string): Promise<CampaignEnrollment[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(schema.campaignEnrollments)
        .where(eq(schema.campaignEnrollments.campaignId, campaignId));
      return rows.map(r => ({
        id: r.id,
        campaignId: r.campaignId,
        workspaceId: r.workspaceId,
        customerId: r.customerId,
        currentStepId: r.currentStepId ?? undefined,
        status: r.status as CampaignEnrollment['status'],
        enrolledAt: r.enrolledAt.toISOString(),
        completedAt: r.completedAt?.toISOString(),
        nextExecutionAt: r.nextExecutionAt?.toISOString(),
        metadata: (r.metadata as Record<string, unknown>) ?? {},
      } as CampaignEnrollment)).sort((a, b) => new Date(b.enrolledAt).getTime() - new Date(a.enrolledAt).getTime());
    });
    if (result !== null) return result;
  }
  ensureDefaults();
  return enrollments
    .filter(e => e.campaignId === campaignId && (!workspaceId || !e.workspaceId || e.workspaceId === workspaceId))
    .sort((a, b) => new Date(b.enrolledAt).getTime() - new Date(a.enrolledAt).getTime());
}

export async function getEnrollment(enrollmentId: string, workspaceId?: string): Promise<CampaignEnrollment | undefined> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [r] = await db.select().from(schema.campaignEnrollments).where(eq(schema.campaignEnrollments.id, enrollmentId));
      if (!r) return undefined;
      return {
        id: r.id,
        campaignId: r.campaignId,
        workspaceId: r.workspaceId,
        customerId: r.customerId,
        currentStepId: r.currentStepId ?? undefined,
        status: r.status as CampaignEnrollment['status'],
        enrolledAt: r.enrolledAt.toISOString(),
        completedAt: r.completedAt?.toISOString(),
        nextExecutionAt: r.nextExecutionAt?.toISOString(),
        metadata: (r.metadata as Record<string, unknown>) ?? {},
      } as CampaignEnrollment;
    });
    if (result !== null) return result;
  }
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

export async function getStepEvents(stepId: string, workspaceId?: string): Promise<CampaignStepEvent[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(schema.campaignStepEvents)
        .where(eq(schema.campaignStepEvents.stepId, stepId));
      return rows.map(r => ({
        id: r.id,
        enrollmentId: r.enrollmentId,
        stepId: r.stepId,
        workspaceId: r.workspaceId,
        eventType: r.eventType,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        createdAt: r.createdAt.toISOString(),
      } as CampaignStepEvent)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });
    if (result !== null) return result;
  }
  ensureDefaults();
  return stepEvents
    .filter(e => e.stepId === stepId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getEnrollmentEvents(enrollmentId: string, workspaceId?: string): Promise<CampaignStepEvent[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(schema.campaignStepEvents)
        .where(eq(schema.campaignStepEvents.enrollmentId, enrollmentId));
      return rows.map(r => ({
        id: r.id,
        enrollmentId: r.enrollmentId,
        stepId: r.stepId,
        workspaceId: r.workspaceId,
        eventType: r.eventType,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        createdAt: r.createdAt.toISOString(),
      } as CampaignStepEvent)).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
    if (result !== null) return result;
  }
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

export async function getCampaignFunnel(campaignId: string, workspaceId?: string): Promise<StepFunnelEntry[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const stepsRows = await db.select().from(schema.campaignSteps)
        .where(eq(schema.campaignSteps.campaignId, campaignId))
        .orderBy(schema.campaignSteps.position);
      // Fetch all events for all steps
      const allEvents: { stepId: string; eventType: string }[] = [];
      for (const s of stepsRows) {
        const evts = await db.select({ stepId: schema.campaignStepEvents.stepId, eventType: schema.campaignStepEvents.eventType })
          .from(schema.campaignStepEvents)
          .where(eq(schema.campaignStepEvents.stepId, s.id));
        allEvents.push(...evts);
      }
      return stepsRows.map(step => {
        const events = allEvents.filter(e => e.stepId === step.id);
        return {
          stepId: step.id,
          stepName: step.name,
          stepType: step.stepType,
          position: step.position,
          executed: events.filter(e => e.eventType === 'executed').length,
          completed: events.filter(e => e.eventType === 'completed' || e.eventType === 'sent' || e.eventType === 'delivered').length,
          failed: events.filter(e => e.eventType === 'failed' || e.eventType === 'bounced').length,
          skipped: events.filter(e => e.eventType === 'skipped').length,
        } as StepFunnelEntry;
      });
    });
    if (result !== null) return result;
  }
  ensureDefaults();
  const campaignStepsLocal = await getCampaignSteps(campaignId, workspaceId);
  return campaignStepsLocal.map(step => {
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

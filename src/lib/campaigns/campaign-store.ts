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
  channel: 'email' | 'sms' | 'whatsapp';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  subject?: string;
  templateBody?: string;
  templateVariables?: Record<string, unknown>;
  segmentQuery?: Record<string, unknown>;
  scheduledAt?: string;
  sentAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
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

function persistCampaigns(): void {
  writeJsonlFile(CAMPAIGNS_FILE, campaigns);
}

function persistRecipients(): void {
  writeJsonlFile(CAMPAIGN_RECIPIENTS_FILE, recipients);
}

// ---- In-memory stores ----

const campaigns: Campaign[] = [];
const recipients: CampaignRecipient[] = [];

let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  // Try loading from persisted JSONL files
  const savedCampaigns = readJsonlFile<Campaign>(CAMPAIGNS_FILE);
  const savedRecipients = readJsonlFile<CampaignRecipient>(CAMPAIGN_RECIPIENTS_FILE);

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

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export interface CustomerActivity {
  id: string;
  workspaceId?: string;
  customerId: string;
  activityType: string;
  entityType?: string;
  entityId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CustomerNote {
  id: string;
  workspaceId?: string;
  customerId: string;
  authorId?: string;
  noteType: 'note' | 'call_log' | 'meeting';
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSegment {
  id: string;
  workspaceId?: string;
  name: string;
  description?: string;
  query: Record<string, unknown>;
  customerCount: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerMergeEntry {
  id: string;
  workspaceId?: string;
  primaryCustomerId: string;
  mergedCustomerId: string;
  mergedData: Record<string, unknown>;
  mergedBy?: string;
  createdAt: string;
}

export interface CustomerEnrichment {
  customAttributes?: Record<string, unknown>;
  avatarUrl?: string;
  locale?: string;
  timezone?: string;
  lastSeenAt?: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  signupDate?: string;
  plan?: string;
}

// ---- JSONL persistence ----

const ACTIVITIES_FILE = 'customer-activities.jsonl';
const NOTES_FILE = 'customer-notes.jsonl';
const SEGMENTS_FILE = 'customer-segments.jsonl';
const MERGE_LOG_FILE = 'customer-merge-log.jsonl';

function persistActivities(): void {
  writeJsonlFile(ACTIVITIES_FILE, activities);
}

function persistNotes(): void {
  writeJsonlFile(NOTES_FILE, notes);
}

function persistSegments(): void {
  writeJsonlFile(SEGMENTS_FILE, segments);
}

function persistMergeLog(): void {
  writeJsonlFile(MERGE_LOG_FILE, mergeLog);
}

// ---- In-memory stores ----

const activities: CustomerActivity[] = [];
const notes: CustomerNote[] = [];
const segments: CustomerSegment[] = [];
const mergeLog: CustomerMergeEntry[] = [];

let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  // Try loading from persisted JSONL files
  const savedActivities = readJsonlFile<CustomerActivity>(ACTIVITIES_FILE);
  const savedNotes = readJsonlFile<CustomerNote>(NOTES_FILE);
  const savedSegments = readJsonlFile<CustomerSegment>(SEGMENTS_FILE);
  const savedMergeLog = readJsonlFile<CustomerMergeEntry>(MERGE_LOG_FILE);

  if (savedActivities.length > 0 || savedNotes.length > 0 || savedSegments.length > 0 || savedMergeLog.length > 0) {
    activities.push(...savedActivities);
    notes.push(...savedNotes);
    segments.push(...savedSegments);
    mergeLog.push(...savedMergeLog);
    return;
  }

  // Fall back to demo defaults
  const now = Date.now();

  const demoActivities: CustomerActivity[] = [
    {
      id: 'ca-1',
      customerId: 'cust-1',
      activityType: 'ticket_created',
      entityType: 'ticket',
      entityId: 'tkt-101',
      metadata: { subject: 'Login issue', priority: 'high' },
      createdAt: new Date(now - 7 * 86400000).toISOString(),
    },
    {
      id: 'ca-2',
      customerId: 'cust-1',
      activityType: 'ticket_resolved',
      entityType: 'ticket',
      entityId: 'tkt-101',
      metadata: { resolvedBy: 'Alice Chen', resolutionTime: '2h 15m' },
      createdAt: new Date(now - 6.5 * 86400000).toISOString(),
    },
    {
      id: 'ca-3',
      customerId: 'cust-2',
      activityType: 'ticket_created',
      entityType: 'ticket',
      entityId: 'tkt-102',
      metadata: { subject: 'Billing question', priority: 'normal' },
      createdAt: new Date(now - 3 * 86400000).toISOString(),
    },
    {
      id: 'ca-4',
      customerId: 'cust-1',
      activityType: 'page_viewed',
      entityType: 'kb_article',
      entityId: 'kb-5',
      metadata: { title: 'Getting Started Guide', url: '/kb/getting-started' },
      createdAt: new Date(now - 2 * 86400000).toISOString(),
    },
    {
      id: 'ca-5',
      customerId: 'cust-3',
      activityType: 'survey_submitted',
      entityType: 'survey',
      entityId: 'srv-1',
      metadata: { type: 'csat', rating: 5, comment: 'Great support!' },
      createdAt: new Date(now - 1 * 86400000).toISOString(),
    },
  ];

  const demoNotes: CustomerNote[] = [
    {
      id: 'cn-1',
      customerId: 'cust-1',
      authorId: 'user-1',
      noteType: 'note',
      body: 'Enterprise customer. Renewed annual plan last month. Primary contact for Acme Corp.',
      createdAt: new Date(now - 10 * 86400000).toISOString(),
      updatedAt: new Date(now - 10 * 86400000).toISOString(),
    },
    {
      id: 'cn-2',
      customerId: 'cust-2',
      authorId: 'user-2',
      noteType: 'call_log',
      body: 'Called regarding billing discrepancy on March invoice. Escalated to finance team.',
      createdAt: new Date(now - 4 * 86400000).toISOString(),
      updatedAt: new Date(now - 4 * 86400000).toISOString(),
    },
  ];

  const demoSegments: CustomerSegment[] = [
    {
      id: 'cs-1',
      name: 'Enterprise Accounts',
      description: 'Customers on enterprise plan with more than 50 seats',
      query: { plan: 'enterprise', seats: { $gt: 50 } },
      customerCount: 12,
      createdBy: 'user-1',
      createdAt: new Date(now - 30 * 86400000).toISOString(),
      updatedAt: new Date(now - 30 * 86400000).toISOString(),
    },
  ];

  activities.push(...demoActivities);
  notes.push(...demoNotes);
  segments.push(...demoSegments);
}

// ---- Public API: Activities ----

export function getCustomerActivities(customerId: string): CustomerActivity[] {
  ensureDefaults();
  return activities
    .filter((a) => a.customerId === customerId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function addCustomerActivity(
  input: Omit<CustomerActivity, 'id' | 'createdAt'>,
): CustomerActivity {
  ensureDefaults();
  const activity: CustomerActivity = {
    ...input,
    id: `ca-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  activities.push(activity);
  persistActivities();
  return activity;
}

// ---- Public API: Notes ----

export function getCustomerNotes(customerId: string): CustomerNote[] {
  ensureDefaults();
  return notes
    .filter((n) => n.customerId === customerId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function addCustomerNote(
  input: Omit<CustomerNote, 'id' | 'createdAt' | 'updatedAt'>,
): CustomerNote {
  ensureDefaults();
  const now = new Date().toISOString();
  const note: CustomerNote = {
    ...input,
    id: `cn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  notes.push(note);
  persistNotes();
  return note;
}

// ---- Public API: Segments ----

export function getCustomerSegments(): CustomerSegment[] {
  ensureDefaults();
  return [...segments];
}

export function createCustomerSegment(
  input: Omit<CustomerSegment, 'id' | 'createdAt' | 'updatedAt'>,
): CustomerSegment {
  ensureDefaults();
  const now = new Date().toISOString();
  const segment: CustomerSegment = {
    ...input,
    id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  segments.push(segment);
  persistSegments();
  return segment;
}

// ---- Public API: Merge ----

export function mergeCustomers(
  primaryId: string,
  mergedId: string,
  mergedData: Record<string, unknown>,
  mergedBy?: string,
): CustomerMergeEntry {
  ensureDefaults();
  const entry: CustomerMergeEntry = {
    id: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    primaryCustomerId: primaryId,
    mergedCustomerId: mergedId,
    mergedData,
    mergedBy,
    createdAt: new Date().toISOString(),
  };
  mergeLog.push(entry);
  persistMergeLog();

  // Re-assign activities and notes from merged customer to primary
  for (const activity of activities) {
    if (activity.customerId === mergedId) {
      activity.customerId = primaryId;
    }
  }
  persistActivities();

  for (const note of notes) {
    if (note.customerId === mergedId) {
      note.customerId = primaryId;
    }
  }
  persistNotes();

  // Record the merge as an activity on the primary customer
  addCustomerActivity({
    customerId: primaryId,
    activityType: 'customer_merged',
    metadata: { mergedCustomerId: mergedId, mergedBy },
  });

  return entry;
}

export function getMergeLog(): CustomerMergeEntry[] {
  ensureDefaults();
  return [...mergeLog];
}

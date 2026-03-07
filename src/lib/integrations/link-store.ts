/**
 * JSONL fallback store for ticket external links and CRM links.
 * Used when DATABASE_URL is not set (BYOC/demo mode).
 */
import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

// ---- Types ----

export interface ExternalLink {
  id: string;
  workspaceId: string;
  ticketId: string;
  provider: string;
  externalId: string;
  externalUrl: string;
  externalStatus?: string;
  externalTitle?: string;
  direction: 'outbound' | 'inbound' | 'bidirectional';
  metadata: Record<string, unknown>;
  syncEnabled: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalLinkComment {
  id: string;
  linkId: string;
  workspaceId?: string;
  direction: 'to_external' | 'from_external';
  localMessageId?: string;
  externalCommentId?: string;
  body: string;
  authorName?: string;
  syncedAt: string;
  createdAt: string;
}

export interface CrmLink {
  id: string;
  workspaceId: string;
  provider: string;
  entityType: 'customer' | 'organization';
  entityId: string;
  crmObjectType: string;
  crmObjectId: string;
  crmObjectUrl?: string;
  crmData: Record<string, unknown>;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationCredential {
  id: string;
  workspaceId: string;
  provider: string;
  authType: string;
  credentials: Record<string, unknown>;
  scopes: string[];
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- JSONL files ----

const LINKS_FILE = 'external-links.jsonl';
const COMMENTS_FILE = 'external-link-comments.jsonl';
const CRM_LINKS_FILE = 'crm-links.jsonl';
const CREDS_FILE = 'integration-credentials.jsonl';

// ---- In-memory stores ----

let links: ExternalLink[] = [];
let comments: ExternalLinkComment[] = [];
let crmLinks: CrmLink[] = [];
let creds: IntegrationCredential[] = [];
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  links = readJsonlFile<ExternalLink>(LINKS_FILE);
  comments = readJsonlFile<ExternalLinkComment>(COMMENTS_FILE);
  crmLinks = readJsonlFile<CrmLink>(CRM_LINKS_FILE);
  creds = readJsonlFile<IntegrationCredential>(CREDS_FILE);
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---- External Links ----

export async function listExternalLinks(ticketId?: string, workspaceId?: string): Promise<ExternalLink[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      let query = db.select().from(schema.ticketExternalLinks);
      if (ticketId) {
        const { eq } = await import('drizzle-orm');
        query = query.where(eq(schema.ticketExternalLinks.ticketId, ticketId)) as typeof query;
      }
      const rows = await query;
      return rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        ticketId: r.ticketId,
        provider: r.provider,
        externalId: r.externalId,
        externalUrl: r.externalUrl,
        externalStatus: r.externalStatus ?? undefined,
        externalTitle: r.externalTitle ?? undefined,
        direction: r.direction as 'outbound' | 'inbound' | 'bidirectional',
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        syncEnabled: r.syncEnabled,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } as ExternalLink));
    });
    if (result !== null) return result;
  }
  ensureLoaded();
  return links.filter(l =>
    (!ticketId || l.ticketId === ticketId) &&
    (!workspaceId || l.workspaceId === workspaceId),
  );
}

export async function getExternalLink(id: string, workspaceId?: string): Promise<ExternalLink | undefined> {
  if (workspaceId) {
    const { eq } = await import('drizzle-orm');
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.ticketExternalLinks).where(eq(schema.ticketExternalLinks.id, id));
      if (rows.length === 0) return undefined;
      const r = rows[0];
      return {
        id: r.id,
        workspaceId: r.workspaceId,
        ticketId: r.ticketId,
        provider: r.provider,
        externalId: r.externalId,
        externalUrl: r.externalUrl,
        externalStatus: r.externalStatus ?? undefined,
        externalTitle: r.externalTitle ?? undefined,
        direction: r.direction as 'outbound' | 'inbound' | 'bidirectional',
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        syncEnabled: r.syncEnabled,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } as ExternalLink;
    });
    if (result !== null) return result;
  }
  ensureLoaded();
  return links.find(l => l.id === id);
}

export function createExternalLink(input: Omit<ExternalLink, 'id' | 'createdAt' | 'updatedAt'>): ExternalLink {
  ensureLoaded();
  const now = new Date().toISOString();
  const link: ExternalLink = { ...input, id: uid(), createdAt: now, updatedAt: now };
  links.push(link);
  writeJsonlFile(LINKS_FILE, links);
  return link;
}

export function updateExternalLink(id: string, updates: Partial<ExternalLink>): ExternalLink | null {
  ensureLoaded();
  const idx = links.findIndex(l => l.id === id);
  if (idx === -1) return null;
  links[idx] = { ...links[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJsonlFile(LINKS_FILE, links);
  return links[idx];
}

export function deleteExternalLink(id: string): boolean {
  ensureLoaded();
  const idx = links.findIndex(l => l.id === id);
  if (idx === -1) return false;
  links.splice(idx, 1);
  comments = comments.filter(c => c.linkId !== id);
  writeJsonlFile(LINKS_FILE, links);
  writeJsonlFile(COMMENTS_FILE, comments);
  return true;
}

// ---- External Link Comments ----

export async function listLinkComments(linkId: string, workspaceId?: string): Promise<ExternalLinkComment[]> {
  if (workspaceId) {
    const { eq } = await import('drizzle-orm');
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.externalLinkComments).where(eq(schema.externalLinkComments.linkId, linkId));
      return rows.map(r => ({
        id: r.id,
        linkId: r.linkId,
        workspaceId: r.workspaceId ?? undefined,
        direction: r.direction as 'to_external' | 'from_external',
        localMessageId: r.localMessageId ?? undefined,
        externalCommentId: r.externalCommentId ?? undefined,
        body: r.body,
        authorName: r.authorName ?? undefined,
        syncedAt: r.syncedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      } as ExternalLinkComment));
    });
    if (result !== null) return result;
  }
  ensureLoaded();
  return comments.filter(c => c.linkId === linkId);
}

export function createLinkComment(input: Omit<ExternalLinkComment, 'id' | 'createdAt' | 'syncedAt'>): ExternalLinkComment {
  ensureLoaded();
  const now = new Date().toISOString();
  const comment: ExternalLinkComment = { ...input, id: uid(), syncedAt: now, createdAt: now };
  comments.push(comment);
  writeJsonlFile(COMMENTS_FILE, comments);
  return comment;
}

// ---- CRM Links ----

export async function listCrmLinks(entityType?: string, entityId?: string, workspaceId?: string): Promise<CrmLink[]> {
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.crmLinks);
      return rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        provider: r.provider,
        entityType: r.entityType as 'customer' | 'organization',
        entityId: r.entityId,
        crmObjectType: r.crmObjectType,
        crmObjectId: r.crmObjectId,
        crmObjectUrl: r.crmObjectUrl ?? undefined,
        crmData: (r.crmData ?? {}) as Record<string, unknown>,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } as CrmLink));
    });
    if (result !== null) {
      return result.filter(l =>
        (!entityType || l.entityType === entityType) &&
        (!entityId || l.entityId === entityId),
      );
    }
  }
  ensureLoaded();
  return crmLinks.filter(l =>
    (!entityType || l.entityType === entityType) &&
    (!entityId || l.entityId === entityId) &&
    (!workspaceId || l.workspaceId === workspaceId),
  );
}

export async function getCrmLink(id: string, workspaceId?: string): Promise<CrmLink | undefined> {
  if (workspaceId) {
    const { eq } = await import('drizzle-orm');
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.crmLinks).where(eq(schema.crmLinks.id, id));
      if (rows.length === 0) return undefined;
      const r = rows[0];
      return {
        id: r.id,
        workspaceId: r.workspaceId,
        provider: r.provider,
        entityType: r.entityType as 'customer' | 'organization',
        entityId: r.entityId,
        crmObjectType: r.crmObjectType,
        crmObjectId: r.crmObjectId,
        crmObjectUrl: r.crmObjectUrl ?? undefined,
        crmData: (r.crmData ?? {}) as Record<string, unknown>,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      } as CrmLink;
    });
    if (result !== null) return result;
  }
  ensureLoaded();
  return crmLinks.find(l => l.id === id);
}

export function createCrmLink(input: Omit<CrmLink, 'id' | 'createdAt' | 'updatedAt'>): CrmLink {
  ensureLoaded();
  const now = new Date().toISOString();
  const link: CrmLink = { ...input, id: uid(), createdAt: now, updatedAt: now };
  crmLinks.push(link);
  writeJsonlFile(CRM_LINKS_FILE, crmLinks);
  return link;
}

export function updateCrmLink(id: string, updates: Partial<CrmLink>): CrmLink | null {
  ensureLoaded();
  const idx = crmLinks.findIndex(l => l.id === id);
  if (idx === -1) return null;
  crmLinks[idx] = { ...crmLinks[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJsonlFile(CRM_LINKS_FILE, crmLinks);
  return crmLinks[idx];
}

export function deleteCrmLink(id: string): boolean {
  ensureLoaded();
  const idx = crmLinks.findIndex(l => l.id === id);
  if (idx === -1) return false;
  crmLinks.splice(idx, 1);
  writeJsonlFile(CRM_LINKS_FILE, crmLinks);
  return true;
}

// ---- Integration Credentials ----

export async function getCredentials(workspaceId: string, provider: string): Promise<IntegrationCredential | undefined> {
  const { eq, and } = await import('drizzle-orm');
  const result = await withRls(workspaceId, async ({ db, schema }) => {
    const rows = await db.select().from(schema.integrationCredentials).where(
      and(eq(schema.integrationCredentials.workspaceId, workspaceId), eq(schema.integrationCredentials.provider, provider)),
    );
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      provider: r.provider,
      authType: r.authType,
      credentials: (r.credentials ?? {}) as Record<string, unknown>,
      scopes: (r.scopes ?? []) as string[],
      expiresAt: r.expiresAt?.toISOString() ?? undefined,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    } as IntegrationCredential;
  });
  if (result !== null) return result;
  ensureLoaded();
  return creds.find(c => c.workspaceId === workspaceId && c.provider === provider);
}

export function saveCredentials(input: Omit<IntegrationCredential, 'id' | 'createdAt' | 'updatedAt'>): IntegrationCredential {
  ensureLoaded();
  const now = new Date().toISOString();
  const existing = creds.findIndex(c => c.workspaceId === input.workspaceId && c.provider === input.provider);
  if (existing !== -1) {
    creds[existing] = { ...creds[existing], ...input, updatedAt: now };
    writeJsonlFile(CREDS_FILE, creds);
    return creds[existing];
  }
  const cred: IntegrationCredential = { ...input, id: uid(), createdAt: now, updatedAt: now };
  creds.push(cred);
  writeJsonlFile(CREDS_FILE, creds);
  return cred;
}

export function deleteCredentials(workspaceId: string, provider: string): boolean {
  ensureLoaded();
  const idx = creds.findIndex(c => c.workspaceId === workspaceId && c.provider === provider);
  if (idx === -1) return false;
  creds.splice(idx, 1);
  writeJsonlFile(CREDS_FILE, creds);
  return true;
}

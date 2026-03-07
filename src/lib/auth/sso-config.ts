/**
 * SSO provider configuration store — dual-mode (DB primary, JSONL fallback).
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb } from '../store-helpers';

// ---- Types ----

export interface SSOProvider {
  id: string;
  name: string;
  protocol: 'saml' | 'oidc';
  enabled: boolean;
  workspaceId?: string;
  // SAML fields
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  // OIDC fields
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  // Common
  domainHint?: string;
  defaultRole?: string;
  forceAuthn?: boolean;
  signedAssertions?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- JSONL fallback ----

const SSO_FILE = 'sso-providers.jsonl';

const g = globalThis as unknown as {
  __cliaasSSO?: SSOProvider[];
  __cliaasSSO_loaded?: boolean;
};

function getInMemoryProviders(): SSOProvider[] {
  if (!g.__cliaasSSO || !g.__cliaasSSO_loaded) {
    g.__cliaasSSO = readJsonlFile<SSOProvider>(SSO_FILE);
    g.__cliaasSSO_loaded = true;
  }
  return g.__cliaasSSO;
}

function persistProviders(): void {
  writeJsonlFile(SSO_FILE, getInMemoryProviders());
}

// ---- DB row mapper ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbRowToProvider(row: any): SSOProvider {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    enabled: row.enabled,
    workspaceId: row.workspaceId,
    entityId: row.entityId ?? undefined,
    ssoUrl: row.ssoUrl ?? undefined,
    certificate: row.certificate ?? undefined,
    clientId: row.clientId ?? undefined,
    clientSecret: row.clientSecret ?? undefined,
    issuer: row.issuer ?? undefined,
    authorizationUrl: row.authorizationUrl ?? undefined,
    tokenUrl: row.tokenUrl ?? undefined,
    userInfoUrl: row.userInfoUrl ?? undefined,
    domainHint: row.domainHint ?? undefined,
    defaultRole: row.defaultRole ?? undefined,
    forceAuthn: row.forceAuthn ?? undefined,
    signedAssertions: row.signedAssertions ?? undefined,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

// ---- Public API ----

export async function getProvidersAsync(workspaceId?: string): Promise<SSOProvider[]> {
  const conn = await tryDb();
  if (conn && conn.schema.ssoProviders) {
    try {
      const { eq } = await import('drizzle-orm');
      const query = workspaceId
        ? conn.db.select().from(conn.schema.ssoProviders).where(eq(conn.schema.ssoProviders.workspaceId, workspaceId))
        : conn.db.select().from(conn.schema.ssoProviders);
      const rows = await query;
      return rows.map(dbRowToProvider);
    } catch { /* fall through */ }
  }
  return getInMemoryProviders().filter(
    p => !workspaceId || !p.workspaceId || p.workspaceId === workspaceId,
  );
}

/** Sync version for backward compat */
export function getProviders(): SSOProvider[] {
  return [...getInMemoryProviders()];
}

export function getProvider(id: string): SSOProvider | undefined {
  return getInMemoryProviders().find((p) => p.id === id);
}

export async function getProviderAsync(id: string): Promise<SSOProvider | undefined> {
  const conn = await tryDb();
  if (conn && conn.schema.ssoProviders) {
    try {
      const { eq } = await import('drizzle-orm');
      const [row] = await conn.db.select().from(conn.schema.ssoProviders)
        .where(eq(conn.schema.ssoProviders.id, id)).limit(1);
      if (row) return dbRowToProvider(row);
    } catch { /* fall through */ }
  }
  return getInMemoryProviders().find((p) => p.id === id);
}

export async function createProviderAsync(
  input: Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<SSOProvider> {
  const conn = await tryDb();
  if (conn && conn.schema.ssoProviders) {
    try {
      const [row] = await conn.db.insert(conn.schema.ssoProviders).values({
        name: input.name,
        protocol: input.protocol,
        enabled: input.enabled,
        workspaceId: input.workspaceId!,
        entityId: input.entityId ?? null,
        ssoUrl: input.ssoUrl ?? null,
        certificate: input.certificate ?? null,
        clientId: input.clientId ?? null,
        clientSecret: input.clientSecret ?? null,
        issuer: input.issuer ?? null,
        authorizationUrl: input.authorizationUrl ?? null,
        tokenUrl: input.tokenUrl ?? null,
        userInfoUrl: input.userInfoUrl ?? null,
        domainHint: input.domainHint ?? null,
      }).returning();
      return dbRowToProvider(row);
    } catch { /* fall through */ }
  }

  // JSONL fallback
  const now = new Date().toISOString();
  const provider: SSOProvider = {
    ...input,
    id: `sso-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };
  getInMemoryProviders().push(provider);
  persistProviders();
  return provider;
}

/** Sync version for backward compat */
export function createProvider(
  input: Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>
): SSOProvider {
  const now = new Date().toISOString();
  const provider: SSOProvider = {
    ...input,
    id: `sso-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
  };
  getInMemoryProviders().push(provider);
  persistProviders();
  return provider;
}

export async function updateProviderAsync(
  id: string,
  updates: Partial<Omit<SSOProvider, 'id' | 'createdAt'>>,
): Promise<SSOProvider | null> {
  const conn = await tryDb();
  if (conn && conn.schema.ssoProviders) {
    try {
      const { eq } = await import('drizzle-orm');
      const set: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(updates)) {
        if (k !== 'updatedAt') set[k] = v ?? null;
      }
      const [row] = await conn.db.update(conn.schema.ssoProviders)
        .set(set).where(eq(conn.schema.ssoProviders.id, id)).returning();
      if (row) return dbRowToProvider(row);
    } catch { /* fall through */ }
  }

  // JSONL fallback
  const providers = getInMemoryProviders();
  const idx = providers.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  providers[idx] = { ...providers[idx], ...updates, updatedAt: new Date().toISOString() };
  persistProviders();
  return providers[idx];
}

/** Sync version for backward compat */
export function updateProvider(
  id: string,
  updates: Partial<Omit<SSOProvider, 'id' | 'createdAt'>>
): SSOProvider | null {
  const providers = getInMemoryProviders();
  const idx = providers.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  providers[idx] = { ...providers[idx], ...updates, updatedAt: new Date().toISOString() };
  persistProviders();
  return providers[idx];
}

export async function deleteProviderAsync(id: string): Promise<boolean> {
  const conn = await tryDb();
  if (conn && conn.schema.ssoProviders) {
    try {
      const { eq } = await import('drizzle-orm');
      const result = await conn.db.delete(conn.schema.ssoProviders)
        .where(eq(conn.schema.ssoProviders.id, id));
      if (result.rowCount && result.rowCount > 0) return true;
    } catch { /* fall through */ }
  }

  const providers = getInMemoryProviders();
  const idx = providers.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  providers.splice(idx, 1);
  persistProviders();
  return true;
}

/** Sync version for backward compat */
export function deleteProvider(id: string): boolean {
  const providers = getInMemoryProviders();
  const idx = providers.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  providers.splice(idx, 1);
  persistProviders();
  return true;
}

export async function findByDomainAsync(emailDomain: string): Promise<SSOProvider | undefined> {
  const conn = await tryDb();
  if (conn && conn.schema.ssoProviders) {
    try {
      const { eq, and } = await import('drizzle-orm');
      const [row] = await conn.db.select().from(conn.schema.ssoProviders)
        .where(and(
          eq(conn.schema.ssoProviders.enabled, true),
          eq(conn.schema.ssoProviders.domainHint, emailDomain),
        )).limit(1);
      if (row) return dbRowToProvider(row);
    } catch { /* fall through */ }
  }

  return getInMemoryProviders().find(
    (p) => p.enabled && p.domainHint === emailDomain,
  );
}

/** Sync version for backward compat */
export function findByDomain(emailDomain: string): SSOProvider | undefined {
  return getInMemoryProviders().find(
    (p) => p.enabled && p.domainHint === emailDomain,
  );
}

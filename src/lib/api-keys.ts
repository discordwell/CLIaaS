/**
 * API Key management service.
 *
 * Keys follow the format: cliaas_<prefix>_<random>
 * - prefix: first 8 chars of random portion (used for display/lookup)
 * - The full key is only returned once at creation time
 * - Storage uses SHA-256 hash of the full key
 */

import { randomBytes, createHash } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import type { AuthUser } from '@/lib/api-auth';

const KEY_PREFIX = 'cliaas_';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function generateApiKey(): { rawKey: string; keyHash: string; prefix: string } {
  const random = randomBytes(32).toString('hex');
  const prefix = random.slice(0, 8);
  const rawKey = `${KEY_PREFIX}${prefix}_${random.slice(8)}`;
  const keyHash = sha256(rawKey);
  return { rawKey, keyHash, prefix: `${KEY_PREFIX}${prefix}` };
}

export interface CreateApiKeyOpts {
  workspaceId: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date;
  createdBy: string;
}

export interface ApiKeyRecord {
  id: string;
  workspaceId: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdBy: string;
  createdAt: Date;
  revokedAt: Date | null;
}

export async function createApiKey(opts: CreateApiKeyOpts): Promise<{ key: ApiKeyRecord; rawKey: string }> {
  const { db } = await import('@/db');
  const { apiKeys } = await import('@/db/schema');

  const { rawKey, keyHash, prefix } = generateApiKey();

  const [row] = await db.insert(apiKeys).values({
    workspaceId: opts.workspaceId,
    name: opts.name,
    keyHash,
    prefix,
    scopes: opts.scopes ?? [],
    expiresAt: opts.expiresAt ?? null,
    createdBy: opts.createdBy,
  }).returning();

  return {
    key: {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
    },
    rawKey,
  };
}

export async function listApiKeys(workspaceId: string): Promise<ApiKeyRecord[]> {
  const { db } = await import('@/db');
  const { apiKeys } = await import('@/db/schema');

  const rows = await db
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdBy: apiKeys.createdBy,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(
      eq(apiKeys.workspaceId, workspaceId),
      isNull(apiKeys.revokedAt),
    ));

  return rows;
}

export async function revokeApiKey(id: string, workspaceId: string): Promise<boolean> {
  const { db } = await import('@/db');
  const { apiKeys } = await import('@/db/schema');

  const result = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(apiKeys.id, id),
      eq(apiKeys.workspaceId, workspaceId),
      isNull(apiKeys.revokedAt),
    ))
    .returning({ id: apiKeys.id });

  return result.length > 0;
}

/**
 * Validate an API key and return the associated AuthUser.
 * Updates lastUsedAt on successful validation.
 */
export async function validateApiKey(rawKey: string): Promise<AuthUser | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;

  const { db } = await import('@/db');
  const { apiKeys, users } = await import('@/db/schema');

  const keyHash = sha256(rawKey);

  const rows = await db
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdBy: apiKeys.createdBy,
      userName: users.name,
      userEmail: users.email,
      userRole: users.role,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.createdBy))
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt < new Date()) return null;

  // Update lastUsedAt (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .then(() => {})
    .catch(() => {});

  return {
    id: row.createdBy,
    email: row.userEmail ?? '',
    role: (row.userRole as 'owner' | 'admin' | 'agent') ?? 'agent',
    workspaceId: row.workspaceId,
    authType: 'api-key',
  };
}

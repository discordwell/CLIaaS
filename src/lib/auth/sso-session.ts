import { createToken, type SessionUser } from '../auth';
import { getProviderAsync } from './sso-config';

// ---- SSO-to-JWT Bridge ----

export type SsoLoginResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * Bridge SSO authentication results into the existing JWT session system.
 * Finds or creates a user record and issues a session JWT token.
 *
 * JIT (Just-In-Time) provisioning behaviour:
 *  - If the SSO provider has jitEnabled !== false (default true), unknown
 *    users are auto-created with the provider's defaultRole (or 'agent').
 *  - If jitEnabled is explicitly false, unknown users are rejected.
 *
 * In demo mode (no DATABASE_URL), creates a deterministic mock SessionUser
 * derived from the SSO user's email address.
 */
export async function handleSsoLogin(user: {
  email: string;
  name: string;
  providerId: string;
}): Promise<SsoLoginResult> {
  // Look up the SSO provider for JIT configuration
  const provider = await getProviderAsync(user.providerId);

  // In demo mode — no database, build a mock session user
  if (!process.env.DATABASE_URL) {
    // In demo mode, respect jitEnabled if provider is found
    // (demo mode always "creates" a session — check JIT to gate it)
    if (provider && provider.jitEnabled === false) {
      return { ok: false, error: 'Your account does not exist and automatic provisioning is disabled for this SSO provider. Please contact your administrator.' };
    }

    const role = (provider?.defaultRole as 'owner' | 'admin' | 'agent') || 'agent';
    const mockUser: SessionUser = {
      id: `sso-${deterministicId(user.email)}`,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      role,
      workspaceId: 'ws-demo',
      tenantId: 'tenant-demo',
    };

    const token = await createToken(mockUser);
    return { ok: true, token };
  }

  // With database — find or create user
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  // Look up existing user by email
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      workspaceId: schema.users.workspaceId,
      tenantId: schema.workspaces.tenantId,
    })
    .from(schema.users)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaces.id, schema.users.workspaceId)
    )
    .where(eq(schema.users.email, user.email))
    .limit(1);

  if (rows.length > 0) {
    const existing = rows[0];
    const token = await createToken({
      id: existing.id,
      email: existing.email!,
      name: existing.name,
      role: existing.role as 'owner' | 'admin' | 'agent',
      workspaceId: existing.workspaceId,
      tenantId: existing.tenantId,
    });
    return { ok: true, token };
  }

  // ---- No existing user — JIT provisioning ----

  // Check if JIT is disabled for this provider
  if (provider && provider.jitEnabled === false) {
    return {
      ok: false,
      error: 'Your account does not exist and automatic provisioning is disabled for this SSO provider. Please contact your administrator.',
    };
  }

  // Determine target workspace — prefer the provider's workspaceId, fall back to first
  let ws: { id: string; tenantId: string };

  if (provider?.workspaceId) {
    const wsRows = await db
      .select({ id: schema.workspaces.id, tenantId: schema.workspaces.tenantId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, provider.workspaceId))
      .limit(1);

    if (wsRows.length > 0) {
      ws = wsRows[0];
    } else {
      return { ok: false, error: 'SSO provider workspace not found' };
    }
  } else {
    const workspaces = await db
      .select({ id: schema.workspaces.id, tenantId: schema.workspaces.tenantId })
      .from(schema.workspaces)
      .limit(1);

    if (workspaces.length === 0) {
      return { ok: false, error: 'No workspace available for SSO user provisioning' };
    }
    ws = workspaces[0];
  }

  // Use provider's defaultRole, falling back to 'agent'
  type UserRole = 'owner' | 'admin' | 'agent' | 'light_agent' | 'collaborator' | 'viewer' | 'system' | 'unknown';
  const role = (provider?.defaultRole || 'agent') as UserRole;

  const [newUser] = await db
    .insert(schema.users)
    .values({
      email: user.email,
      name: user.name || user.email.split('@')[0],
      role,
      status: 'active',
      workspaceId: ws.id,
    })
    .returning();

  const token = await createToken({
    id: newUser.id,
    email: newUser.email!,
    name: newUser.name,
    role: newUser.role as 'owner' | 'admin' | 'agent',
    workspaceId: ws.id,
    tenantId: ws.tenantId,
  });
  return { ok: true, token };
}

/**
 * Generate a deterministic short ID from a string (for demo mode).
 */
function deterministicId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

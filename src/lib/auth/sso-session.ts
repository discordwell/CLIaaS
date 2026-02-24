import { createToken, type SessionUser } from '../auth';

// ---- SSO-to-JWT Bridge ----

/**
 * Bridge SSO authentication results into the existing JWT session system.
 * Finds or creates a user record and issues a session JWT token.
 *
 * In demo mode (no DATABASE_URL), creates a deterministic mock SessionUser
 * derived from the SSO user's email address.
 */
export async function handleSsoLogin(user: {
  email: string;
  name: string;
  providerId: string;
}): Promise<string> {
  // In demo mode — no database, build a mock session user
  if (!process.env.DATABASE_URL) {
    const mockUser: SessionUser = {
      id: `sso-${deterministicId(user.email)}`,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      role: 'agent',
      workspaceId: 'ws-demo',
      tenantId: 'tenant-demo',
    };

    return createToken(mockUser);
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
    return createToken({
      id: existing.id,
      email: existing.email!,
      name: existing.name,
      role: existing.role as 'owner' | 'admin' | 'agent',
      workspaceId: existing.workspaceId,
      tenantId: existing.tenantId,
    });
  }

  // No existing user — find the first workspace and create one
  const workspaces = await db
    .select({ id: schema.workspaces.id, tenantId: schema.workspaces.tenantId })
    .from(schema.workspaces)
    .limit(1);

  if (workspaces.length === 0) {
    throw new Error('No workspace available for SSO user provisioning');
  }

  const ws = workspaces[0];

  const [newUser] = await db
    .insert(schema.users)
    .values({
      email: user.email,
      name: user.name || user.email.split('@')[0],
      role: 'agent',
      status: 'active',
      workspaceId: ws.id,
    })
    .returning();

  return createToken({
    id: newUser.id,
    email: newUser.email!,
    name: newUser.name,
    role: newUser.role as 'owner' | 'admin' | 'agent',
    workspaceId: ws.id,
    tenantId: ws.tenantId,
  });
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

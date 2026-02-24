import { eq } from 'drizzle-orm';

export interface CreateAccountInput {
  email: string;
  name: string;
  workspaceName: string;
  passwordHash: string | null;
}

export interface CreateAccountResult {
  user: { id: string; email: string; name: string; role: string };
  workspaceId: string;
  tenantId: string;
}

/**
 * Create a tenant, workspace, and owner user in a single transaction.
 * Used by both email signup and Google OAuth signup.
 */
export async function createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');

  // Check if email already exists
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .limit(1);

  if (existing.length > 0) {
    throw new AccountExistsError('An account with this email already exists');
  }

  const plan = 'byoc';
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: input.workspaceName, plan })
    .returning({ id: schema.tenants.id });

  const [workspace] = await db
    .insert(schema.workspaces)
    .values({ tenantId: tenant.id, name: input.workspaceName })
    .returning({ id: schema.workspaces.id });

  const [user] = await db
    .insert(schema.users)
    .values({
      workspaceId: workspace.id,
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      role: 'owner',
      status: 'active',
    })
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
    });

  return {
    user: { id: user.id, email: user.email ?? input.email, name: user.name ?? input.name, role: user.role },
    workspaceId: workspace.id,
    tenantId: tenant.id,
  };
}

export class AccountExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountExistsError';
  }
}

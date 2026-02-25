import { eq } from 'drizzle-orm';
import { isPersonalEmail, extractDomain } from './personal-domains';
import { findOrgByDomain } from './domain-matching';

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

export interface CreateOrJoinResult extends CreateAccountResult {
  /** True if the user joined an existing workspace rather than creating a new one. */
  joined: boolean;
  /** Name of the organization, if one was matched/created. */
  orgName: string | null;
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
      tenantId: tenant.id,
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

  // For work emails, create an organization record with this domain
  const domain = extractDomain(input.email);
  if (domain && !isPersonalEmail(input.email)) {
    await db
      .insert(schema.organizations)
      .values({
        workspaceId: workspace.id,
        name: domain.split('.')[0], // e.g. "acme" from "acme.com"
        domains: [domain],
      });
  }

  return {
    user: { id: user.id, email: user.email ?? input.email, name: user.name ?? input.name, role: user.role },
    workspaceId: workspace.id,
    tenantId: tenant.id,
  };
}

/**
 * Join an existing workspace as an agent.
 * Used when a work-email user signs up and their domain already has an org.
 */
export async function joinWorkspace(input: {
  email: string;
  name: string;
  passwordHash: string | null;
  workspaceId: string;
  tenantId: string;
}): Promise<CreateAccountResult> {
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

  const [user] = await db
    .insert(schema.users)
    .values({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      role: 'agent',
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
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
  };
}

/**
 * Coordinator: checks if the user's email domain matches an existing org.
 * - Work email + existing org → join as agent
 * - Work email + no org → create new workspace (auto-name from domain)
 * - Personal email → require workspaceName, create new workspace
 */
export async function createOrJoinAccount(input: {
  email: string;
  name: string;
  workspaceName?: string;
  passwordHash: string | null;
}): Promise<CreateOrJoinResult> {
  const domain = extractDomain(input.email);
  const personal = isPersonalEmail(input.email);

  // Work email: check for existing org
  if (!personal && domain) {
    const match = await findOrgByDomain(domain);
    if (match) {
      const result = await joinWorkspace({
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        workspaceId: match.workspaceId,
        tenantId: match.tenantId,
      });
      return { ...result, joined: true, orgName: match.orgName };
    }

    // No existing org — create workspace named after domain
    const wsName = input.workspaceName || domain.split('.')[0];
    const result = await createAccount({
      email: input.email,
      name: input.name,
      workspaceName: wsName,
      passwordHash: input.passwordHash,
    });
    return { ...result, joined: false, orgName: wsName };
  }

  // Personal email: workspaceName is required
  if (!input.workspaceName) {
    throw new Error('Workspace name is required for personal email addresses');
  }

  const result = await createAccount({
    email: input.email,
    name: input.name,
    workspaceName: input.workspaceName,
    passwordHash: input.passwordHash,
  });
  return { ...result, joined: false, orgName: null };
}

export class AccountExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountExistsError';
  }
}

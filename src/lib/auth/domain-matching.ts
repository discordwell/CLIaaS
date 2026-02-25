/**
 * Domain-based organization lookup.
 * Finds an existing organization by matching an email domain against
 * the `domains` array column on the organizations table.
 */

import { sql } from 'drizzle-orm';

export interface OrgMatch {
  orgId: string;
  orgName: string;
  workspaceId: string;
  tenantId: string;
}

/**
 * Look up an organization whose `domains` array contains the given domain.
 * Returns the first match or null if no organization claims this domain.
 */
export async function findOrgByDomain(domain: string): Promise<OrgMatch | null> {
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');

  const rows = await db
    .select({
      orgId: schema.organizations.id,
      orgName: schema.organizations.name,
      workspaceId: schema.organizations.workspaceId,
    })
    .from(schema.organizations)
    .where(sql`${domain} = ANY(${schema.organizations.domains})`)
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];

  // Resolve the tenantId from the workspace
  const [ws] = await db
    .select({ tenantId: schema.workspaces.tenantId })
    .from(schema.workspaces)
    .where(sql`${schema.workspaces.id} = ${row.workspaceId}`)
    .limit(1);

  if (!ws) return null;

  return {
    orgId: row.orgId,
    orgName: row.orgName,
    workspaceId: row.workspaceId,
    tenantId: ws.tenantId,
  };
}

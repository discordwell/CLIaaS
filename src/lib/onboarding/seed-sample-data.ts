/**
 * Seeds a workspace with sample demo data from fixtures/demo-data/.
 * Uses the existing Zendesk export ingest pipeline.
 */

import { join } from 'path';
import { eq } from 'drizzle-orm';

export interface SeedOptions {
  tenantId: string;
  workspaceId: string;
}

/**
 * Seed a workspace with the bundled demo data.
 * Resolves tenant/workspace IDs to names, then calls the ingest pipeline.
 */
export async function seedWorkspaceWithSampleData(opts: SeedOptions): Promise<void> {
  const { db } = await import('@/db');
  const schema = await import('@/db/schema');

  // Resolve tenant name
  const [tenant] = await db
    .select({ name: schema.tenants.name })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, opts.tenantId))
    .limit(1);

  if (!tenant) throw new Error(`Tenant ${opts.tenantId} not found`);

  // Resolve workspace name
  const [workspace] = await db
    .select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, opts.workspaceId))
    .limit(1);

  if (!workspace) throw new Error(`Workspace ${opts.workspaceId} not found`);

  const { ingestZendeskExportDir } = await import('@/lib/zendesk/ingest');

  const demoDir = join(process.cwd(), 'fixtures', 'demo-data');

  await ingestZendeskExportDir({
    dir: demoDir,
    tenant: tenant.name,
    workspace: workspace.name,
  });
}

import { describe, it, expect } from 'vitest';
import * as schema from '@/db/schema';

/**
 * Cross-tenant isolation tests.
 * Verifies workspace scoping is available on all data tables.
 */
describe('cross-tenant data isolation', () => {
  it('all workspace-scoped tables have workspaceId for RLS', () => {
    // All tables that hold user data must have workspaceId for RLS filtering
    const workspaceScopedTables = [
      schema.organizations,
      schema.customers,
      schema.groups,
      schema.inboxes,
      schema.ticketForms,
      schema.brands,
      schema.tickets,
      schema.tags,
      schema.customFields,
      schema.rules,
      schema.automationRules,
      schema.slaPolicies,
      schema.views,
      schema.kbCollections,
      schema.kbArticles,
      schema.integrations,
      schema.auditEvents,
      schema.ssoProviders,
      schema.apiKeys,
      // Denormalized tables
      schema.conversations,
      schema.messages,
      schema.attachments,
      schema.ticketTags,
      schema.csatRatings,
      schema.timeEntries,
      schema.slaEvents,
      schema.kbCategories,
      schema.kbRevisions,
      schema.externalObjects,
      schema.syncCursors,
      schema.importJobs,
      schema.exportJobs,
      schema.rawRecords,
      schema.customFieldValues,
      // Compliance tables
      schema.auditEntries,
      schema.gdprDeletionRequests,
      schema.retentionPolicies,
    ];

    for (const table of workspaceScopedTables) {
      expect(
        (table as unknown as Record<string, unknown>).workspaceId,
        `Table missing workspaceId column`,
      ).toBeDefined();
    }
  });

  it('tenant-level tables have tenantId', () => {
    expect(schema.workspaces.tenantId).toBeDefined();
    expect(schema.users.tenantId).toBeDefined();
    expect(schema.tickets.tenantId).toBeDefined();
    expect(schema.usageMetrics.tenantId).toBeDefined();
    expect(schema.billingEvents.tenantId).toBeDefined();
  });

  it('RLS context functions exist', async () => {
    const rls = await import('@/db/rls');
    expect(typeof rls.withTenantContext).toBe('function');
    expect(typeof rls.withSystemContext).toBe('function');
    expect(typeof rls.verifyRlsSetup).toBe('function');
  });
});

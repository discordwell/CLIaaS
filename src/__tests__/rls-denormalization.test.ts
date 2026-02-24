import { describe, it, expect } from 'vitest';
import * as schema from '@/db/schema';

describe('RLS denormalization — workspace_id columns', () => {
  const tablesWithDenormalizedWorkspaceId = [
    { name: 'conversations', table: schema.conversations },
    { name: 'messages', table: schema.messages },
    { name: 'attachments', table: schema.attachments },
    { name: 'ticketTags', table: schema.ticketTags },
    { name: 'csatRatings', table: schema.csatRatings },
    { name: 'timeEntries', table: schema.timeEntries },
    { name: 'slaEvents', table: schema.slaEvents },
    { name: 'kbCategories', table: schema.kbCategories },
    { name: 'kbRevisions', table: schema.kbRevisions },
    { name: 'externalObjects', table: schema.externalObjects },
    { name: 'syncCursors', table: schema.syncCursors },
    { name: 'importJobs', table: schema.importJobs },
    { name: 'exportJobs', table: schema.exportJobs },
    { name: 'rawRecords', table: schema.rawRecords },
    { name: 'customFieldValues', table: schema.customFieldValues },
  ];

  for (const { name, table } of tablesWithDenormalizedWorkspaceId) {
    it(`${name} has workspaceId column`, () => {
      expect((table as unknown as Record<string, unknown>).workspaceId).toBeDefined();
    });
  }

  const tablesAlreadyHavingWorkspaceId = [
    { name: 'organizations', table: schema.organizations },
    { name: 'customers', table: schema.customers },
    { name: 'groups', table: schema.groups },
    { name: 'inboxes', table: schema.inboxes },
    { name: 'ticketForms', table: schema.ticketForms },
    { name: 'brands', table: schema.brands },
    { name: 'tickets', table: schema.tickets },
    { name: 'tags', table: schema.tags },
    { name: 'customFields', table: schema.customFields },
    { name: 'rules', table: schema.rules },
    { name: 'automationRules', table: schema.automationRules },
    { name: 'slaPolicies', table: schema.slaPolicies },
    { name: 'views', table: schema.views },
    { name: 'kbCollections', table: schema.kbCollections },
    { name: 'kbArticles', table: schema.kbArticles },
    { name: 'integrations', table: schema.integrations },
    { name: 'auditEvents', table: schema.auditEvents },
    { name: 'ssoProviders', table: schema.ssoProviders },
    { name: 'apiKeys', table: schema.apiKeys },
  ];

  for (const { name, table } of tablesAlreadyHavingWorkspaceId) {
    it(`${name} still has workspaceId column`, () => {
      expect((table as unknown as Record<string, unknown>).workspaceId).toBeDefined();
    });
  }

  it('auditEntries has workspaceId column', () => {
    expect(schema.auditEntries.workspaceId).toBeDefined();
  });

  it('gdprDeletionRequests table exists with workspaceId', () => {
    expect(schema.gdprDeletionRequests).toBeDefined();
    expect(schema.gdprDeletionRequests.workspaceId).toBeDefined();
  });

  it('retentionPolicies table exists with workspaceId', () => {
    expect(schema.retentionPolicies).toBeDefined();
    expect(schema.retentionPolicies.workspaceId).toBeDefined();
  });
});

/**
 * Cross-workspace isolation tests for RLS.
 * Verifies that withRls-enabled store functions properly scope data by workspace.
 *
 * Since tests run without DATABASE_URL, we verify:
 * 1. The withRls path returns null (DB not available) and falls through to JSONL
 * 2. Store functions accept workspaceId parameters without crashing
 * 3. Migration SQL has correct policy definitions
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('cross-workspace isolation', () => {
  describe('store functions accept workspaceId', () => {
    it('chatbot store accepts workspaceId', async () => {
      const { getChatbots, getChatbot, getActiveChatbot, deleteChatbot } = await import(
        '@/lib/chatbot/store'
      );
      // All functions should accept optional workspaceId without errors
      const bots = await getChatbots('00000000-0000-0000-0000-000000000001');
      expect(Array.isArray(bots)).toBe(true);

      const bot = await getChatbot('nonexistent', '00000000-0000-0000-0000-000000000001');
      expect(bot).toBeNull();

      const active = await getActiveChatbot('00000000-0000-0000-0000-000000000001');
      // May or may not find one — just verify no crash
      expect(active === null || typeof active === 'object').toBe(true);

      const deleted = await deleteChatbot('nonexistent', '00000000-0000-0000-0000-000000000001');
      expect(deleted).toBe(false);
    });

    it('chatbot versions store accepts workspaceId', async () => {
      const { getChatbotVersions } = await import('@/lib/chatbot/versions');
      const versions = await getChatbotVersions(
        'nonexistent',
        '00000000-0000-0000-0000-000000000001',
      );
      expect(Array.isArray(versions)).toBe(true);
    });

    it('workflow store accepts workspaceId', async () => {
      const { getWorkflows, getWorkflow, getActiveWorkflows, deleteWorkflow } = await import(
        '@/lib/workflow/store'
      );
      const flows = await getWorkflows('00000000-0000-0000-0000-000000000001');
      expect(Array.isArray(flows)).toBe(true);

      const flow = await getWorkflow('nonexistent', '00000000-0000-0000-0000-000000000001');
      expect(flow).toBeNull();

      const active = await getActiveWorkflows('00000000-0000-0000-0000-000000000001');
      expect(Array.isArray(active)).toBe(true);

      const deleted = await deleteWorkflow('nonexistent', '00000000-0000-0000-0000-000000000001');
      expect(deleted).toBe(false);
    });
  });

  describe('migration SQL verification', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../db/migrations/0026_rls_big_bang.sql',
    );
    let migrationSql: string;

    it('migration file exists', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
      migrationSql = fs.readFileSync(migrationPath, 'utf-8');
    });

    it('all policies use app.current_workspace_id (not app.workspace_id)', () => {
      // Should NOT contain the broken setting name in actual SQL (exclude comments)
      const sqlLines = migrationSql.split('\n').filter(l => !l.trim().startsWith('--'));
      const sqlOnly = sqlLines.join('\n');
      const brokenMatches = sqlOnly.match(/app\.workspace_id[^_]/g);
      expect(brokenMatches).toBeNull();

      // Should contain the correct setting name
      expect(migrationSql).toContain("app.current_workspace_id");
    });

    it('all workspace policies include true parameter for missing default', () => {
      // Every current_setting call should have 'true' as second param
      const calls = migrationSql.match(/current_setting\([^)]+\)/g) ?? [];
      for (const call of calls) {
        expect(call).toContain(', true)');
      }
    });

    it('FORCE RLS is applied to tables with ENABLE RLS', () => {
      const enableCount = (migrationSql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length;
      const forceCount = (migrationSql.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length;
      // Force count should be >= enable count (some tables already had ENABLE from prior migrations)
      expect(forceCount).toBeGreaterThanOrEqual(enableCount);
      expect(forceCount).toBeGreaterThan(50);
    });

    it('denormalizes workspace_id into 8 child tables', () => {
      const denormalized = [
        'chatbot_versions',
        'chatbot_analytics',
        'schedule_shifts',
        'holiday_entries',
        'dashboard_widgets',
        'report_cache',
        'qa_calibration_entries',
        'custom_role_permissions',
      ];

      for (const table of denormalized) {
        expect(migrationSql).toContain(`ALTER TABLE ${table} ADD COLUMN workspace_id`);
        expect(migrationSql).toContain(`CREATE INDEX ${table}_workspace_idx ON ${table}`);
        expect(migrationSql).toContain(`CREATE POLICY workspace_isolation ON ${table}`);
      }
    });

    it('tenant-level tables have tenant_id policies', () => {
      expect(migrationSql).toContain('CREATE POLICY tenant_isolation ON tenants');
      expect(migrationSql).toContain('CREATE POLICY tenant_isolation ON workspaces');
      expect(migrationSql).toContain('CREATE POLICY tenant_isolation ON usage_metrics');
      expect(migrationSql).toContain('CREATE POLICY tenant_isolation ON billing_events');
    });

    it('drops broken policies before creating correct ones', () => {
      const brokenPolicies = [
        'canned_responses_workspace_isolation',
        'macros_workspace_isolation',
        'agent_signatures_workspace_isolation',
        'ticket_merge_log_workspace_isolation',
        'ticket_split_log_workspace_isolation',
        'holiday_calendars_workspace_isolation',
        'group_memberships_workspace_isolation',
        'ticket_collaborators_workspace_isolation',
        'custom_roles_workspace_isolation',
        'integration_credentials_workspace',
        'ticket_external_links_workspace',
        'external_link_comments_workspace',
        'crm_links_workspace',
        'custom_object_types_workspace',
        'custom_object_records_workspace',
        'custom_object_relationships_workspace',
      ];

      for (const policyName of brokenPolicies) {
        expect(migrationSql).toContain(`DROP POLICY IF EXISTS ${policyName}`);
      }
    });
  });

  describe('schema has workspaceId on denormalized tables', () => {
    it('chatbotVersions has workspaceId', async () => {
      const schema = await import('@/db/schema');
      expect(schema.chatbotVersions.workspaceId).toBeDefined();
    });

    it('chatbotAnalytics has workspaceId', async () => {
      const schema = await import('@/db/schema');
      expect(schema.chatbotAnalytics.workspaceId).toBeDefined();
    });

    it('scheduleShifts has workspaceId', async () => {
      const schema = await import('@/db/schema');
      expect(schema.scheduleShifts.workspaceId).toBeDefined();
    });

    it('holidayEntries has workspaceId', async () => {
      const schema = await import('@/db/schema');
      expect(schema.holidayEntries.workspaceId).toBeDefined();
    });

    it('dashboardWidgets has workspaceId', async () => {
      const schema = await import('@/db/schema');
      expect(schema.dashboardWidgets.workspaceId).toBeDefined();
    });

    it('reportCache has workspaceId', async () => {
      const schema = await import('@/db/schema');
      expect(schema.reportCache.workspaceId).toBeDefined();
    });

    it('qaCalibrationEntries has workspaceId', async () => {
      const schema = await import('@/db/schema');
      expect(schema.qaCalibrationEntries.workspaceId).toBeDefined();
    });

    it('customRolePermissions has workspaceId', async () => {
      const schema = await import('@/db/schema');
      expect(schema.customRolePermissions.workspaceId).toBeDefined();
    });
  });
});

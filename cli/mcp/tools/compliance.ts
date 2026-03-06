/**
 * MCP tools for PII masking and HIPAA compliance.
 * 9 tools: pii_scan, pii_detections, pii_review, pii_redact, pii_rules,
 * pii_stats, pii_access_log, hipaa_status, retroactive_scan.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';

export function registerComplianceTools(server: McpServer): void {
  // ---- pii_scan ----
  server.tool(
    'pii_scan',
    'Scan a specific entity (message, ticket, customer) for PII',
    {
      entityType: z.enum(['message', 'ticket', 'customer']).describe('Entity type to scan'),
      entityId: z.string().describe('Entity ID to scan'),
    },
    async ({ entityType, entityId }) => {
      try {
        const { scanEntity } = await import('@/lib/compliance/pii-masking.js');
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');

        let wsId = 'default';
        const conn = await tryDb();
        if (conn) wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        const detections = await scanEntity(entityType, entityId, wsId);
        return textResult({
          entityType,
          entityId,
          detectionsFound: detections.length,
          detections,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'PII scan failed');
      }
    },
  );

  // ---- pii_detections ----
  server.tool(
    'pii_detections',
    'List PII detections with optional filters',
    {
      status: z.enum(['pending', 'confirmed', 'redacted', 'dismissed', 'auto_redacted']).optional().describe('Filter by detection status'),
      piiType: z.string().optional().describe('Filter by PII type (ssn, credit_card, phone, email, etc.)'),
      entityType: z.enum(['message', 'ticket', 'customer']).optional().describe('Filter by entity type'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ status, piiType, entityType, limit }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) return errorResult('Database not available');

        const { eq, and, desc } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        const conditions = [eq(conn.schema.piiDetections.workspaceId, wsId)];
        if (status) conditions.push(eq(conn.schema.piiDetections.status, status));
        if (piiType) conditions.push(eq(conn.schema.piiDetections.piiType, piiType as typeof conn.schema.piiDetections.piiType.enumValues[number]));
        if (entityType) conditions.push(eq(conn.schema.piiDetections.entityType, entityType));

        const rows = await conn.db
          .select()
          .from(conn.schema.piiDetections)
          .where(and(...conditions))
          .orderBy(desc(conn.schema.piiDetections.createdAt))
          .limit(limit ?? 50);

        return textResult({
          count: rows.length,
          detections: rows.map(r => ({
            id: r.id,
            entityType: r.entityType,
            entityId: r.entityId,
            fieldName: r.fieldName,
            piiType: r.piiType,
            confidence: r.confidence,
            maskedValue: r.maskedValue,
            status: r.status,
            detectionMethod: r.detectionMethod,
            createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list detections');
      }
    },
  );

  // ---- pii_review ----
  server.tool(
    'pii_review',
    'Confirm or dismiss a PII detection (requires confirm=true)',
    {
      detectionId: z.string().describe('Detection ID to review'),
      action: z.enum(['confirm', 'dismiss']).describe('Review action'),
      confirm: z.boolean().optional().describe('Must be true to execute'),
    },
    async ({ detectionId, action, confirm }) => {
      const guard = scopeGuard('pii_review');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `${action} PII detection ${detectionId}`,
        preview: { detectionId, action },
        execute: async () => {
          const { reviewDetection } = await import('@/lib/compliance/pii-masking.js');
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');

          const conn = await tryDb();
          if (!conn) return { error: 'Database not available' };

          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          await reviewDetection(detectionId, action, 'mcp-agent', wsId);

          recordMCPAction({
            tool: 'pii_review', action,
            params: { detectionId },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return { reviewed: true, detectionId, action };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- pii_redact ----
  server.tool(
    'pii_redact',
    'Redact a PII detection or all confirmed detections (requires confirm=true)',
    {
      detectionId: z.string().optional().describe('Specific detection ID to redact'),
      allConfirmed: z.boolean().optional().describe('Redact all confirmed detections'),
      confirm: z.boolean().optional().describe('Must be true to execute'),
    },
    async ({ detectionId, allConfirmed, confirm }) => {
      const guard = scopeGuard('pii_redact');
      if (guard) return guard;

      if (!detectionId && !allConfirmed) {
        return errorResult('Either detectionId or allConfirmed=true is required');
      }

      const actionDesc = allConfirmed
        ? 'Redact ALL confirmed PII detections'
        : `Redact PII detection ${detectionId}`;

      const result = withConfirmation(confirm, {
        description: actionDesc,
        preview: { detectionId, allConfirmed: allConfirmed ?? false },
        execute: async () => {
          const { redactDetection, redactAllConfirmed } = await import('@/lib/compliance/pii-masking.js');
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');

          const conn = await tryDb();
          if (!conn) return { error: 'Database not available' };

          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

          if (allConfirmed) {
            const count = await redactAllConfirmed(wsId, 'mcp-agent');
            recordMCPAction({
              tool: 'pii_redact', action: 'redact_all_confirmed',
              params: {},
              timestamp: new Date().toISOString(), result: 'success',
            });
            return { redacted: count, scope: 'all_confirmed' };
          }

          await redactDetection(detectionId!, 'mcp-agent', wsId);
          recordMCPAction({
            tool: 'pii_redact', action: 'redact',
            params: { detectionId },
            timestamp: new Date().toISOString(), result: 'success',
          });
          return { redacted: 1, detectionId };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- pii_rules ----
  server.tool(
    'pii_rules',
    'View or update PII sensitivity rules',
    {
      action: z.enum(['list', 'set']).optional().describe('Action: list (default) or set'),
      piiType: z.string().optional().describe('PII type to update (required for set)'),
      enabled: z.boolean().optional().describe('Enable/disable this PII type'),
      autoRedact: z.boolean().optional().describe('Enable/disable auto-redaction'),
      maskingStyle: z.enum(['full', 'partial', 'hash']).optional().describe('Masking style'),
    },
    async ({ action, piiType, enabled, autoRedact, maskingStyle }) => {
      const guard = scopeGuard('pii_rules');
      if (guard) return guard;

      try {
        const { getSensitivityRules, upsertSensitivityRules } = await import('@/lib/compliance/pii-rules.js');
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');

        let wsId = 'default';
        const conn = await tryDb();
        if (conn) wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        if (action === 'set') {
          if (!piiType) return errorResult('piiType is required for set action');

          const currentRules = await getSensitivityRules(wsId);
          const existing = currentRules.find(r => r.piiType === piiType);
          const rule = existing || {
            piiType: piiType as import('@/lib/compliance/pii-detector.js').PiiType,
            enabled: true,
            autoRedact: false,
            maskingStyle: 'full' as const,
          };

          if (enabled !== undefined) rule.enabled = enabled;
          if (autoRedact !== undefined) rule.autoRedact = autoRedact;
          if (maskingStyle !== undefined) rule.maskingStyle = maskingStyle;

          const updated = await upsertSensitivityRules(wsId, [rule]);

          recordMCPAction({
            tool: 'pii_rules', action: 'set',
            params: { piiType, enabled, autoRedact, maskingStyle },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return textResult({ updated: true, rule: updated[0] });
        }

        // List
        const rules = await getSensitivityRules(wsId);
        return textResult({ count: rules.length, rules });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to manage PII rules');
      }
    },
  );

  // ---- pii_stats ----
  server.tool(
    'pii_stats',
    'Get PII detection statistics for the workspace',
    {},
    async () => {
      try {
        const { getPiiStats } = await import('@/lib/compliance/pii-masking.js');
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');

        let wsId = 'default';
        const conn = await tryDb();
        if (conn) wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        const stats = await getPiiStats(wsId);
        return textResult({ stats });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get PII stats');
      }
    },
  );

  // ---- pii_access_log ----
  server.tool(
    'pii_access_log',
    'Query the PII access audit log',
    {
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ limit }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) return errorResult('Database not available');

        const { eq, desc } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        const rows = await conn.db
          .select()
          .from(conn.schema.piiAccessLog)
          .where(eq(conn.schema.piiAccessLog.workspaceId, wsId))
          .orderBy(desc(conn.schema.piiAccessLog.createdAt))
          .limit(limit ?? 50);

        return textResult({
          count: rows.length,
          entries: rows.map(r => ({
            id: r.id,
            userId: r.userId,
            entityType: r.entityType,
            entityId: r.entityId,
            fieldName: r.fieldName,
            piiType: r.piiType,
            accessType: r.accessType,
            ipAddress: r.ipAddress,
            createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to query access log');
      }
    },
  );

  // ---- hipaa_status ----
  server.tool(
    'hipaa_status',
    'Evaluate HIPAA readiness checklist for the workspace',
    {},
    async () => {
      try {
        const { evaluateHipaaReadiness, getHipaaScore } = await import('@/lib/compliance/hipaa.js');
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');

        let wsId = 'default';
        const conn = await tryDb();
        if (conn) wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        const controls = await evaluateHipaaReadiness(wsId);
        const score = getHipaaScore(controls);

        return textResult({
          score,
          controls: controls.map(c => ({
            id: c.id,
            category: c.category,
            name: c.name,
            status: c.status,
            evidence: c.evidence,
            remediation: c.remediation,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to evaluate HIPAA status');
      }
    },
  );

  // ---- retroactive_scan ----
  server.tool(
    'retroactive_scan',
    'Start a retroactive PII scan or check scan job status',
    {
      action: z.enum(['start', 'status']).describe('start a new scan or check status'),
      entityTypes: z.array(z.enum(['message', 'ticket', 'customer'])).optional().describe('Entity types to scan (default: [message])'),
      batchSize: z.number().optional().describe('Batch size (default 100)'),
      jobId: z.string().optional().describe('Job ID to check (for status action)'),
      confirm: z.boolean().optional().describe('Must be true to start a scan'),
    },
    async ({ action, entityTypes, batchSize, jobId, confirm }) => {
      const guard = scopeGuard('retroactive_scan');
      if (guard) return guard;

      if (action === 'status') {
        try {
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return errorResult('Database not available');

          const { eq, and, desc } = await import('drizzle-orm');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

          if (jobId) {
            const [job] = await conn.db
              .select()
              .from(conn.schema.piiScanJobs)
              .where(
                and(
                  eq(conn.schema.piiScanJobs.id, jobId),
                  eq(conn.schema.piiScanJobs.workspaceId, wsId),
                ),
              )
              .limit(1);

            if (!job) return errorResult(`Scan job "${jobId}" not found`);
            return textResult({ job });
          }

          // List recent jobs
          const jobs = await conn.db
            .select()
            .from(conn.schema.piiScanJobs)
            .where(eq(conn.schema.piiScanJobs.workspaceId, wsId))
            .orderBy(desc(conn.schema.piiScanJobs.createdAt))
            .limit(10);

          return textResult({ count: jobs.length, jobs });
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : 'Failed to get scan status');
        }
      }

      // action === 'start'
      const types = entityTypes ?? ['message'];
      const size = batchSize ?? 100;

      const result = withConfirmation(confirm, {
        description: `Start retroactive PII scan for ${types.join(', ')} entities`,
        preview: { entityTypes: types, batchSize: size },
        execute: async () => {
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return { error: 'Database not available' };

          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

          const [job] = await conn.db
            .insert(conn.schema.piiScanJobs)
            .values({
              workspaceId: wsId,
              startedBy: '00000000-0000-0000-0000-000000000000',
              entityTypes: types,
              status: 'queued',
              totalRecords: 0,
              scannedRecords: 0,
              detectionsFound: 0,
            })
            .returning();

          // Enqueue scan for each entity type
          const { enqueuePiiScan } = await import('@/lib/queue/dispatch.js');
          let enqueued = false;
          for (const entityType of types) {
            enqueued = await enqueuePiiScan({
              scanJobId: job.id,
              entityType,
              batchOffset: 0,
              batchSize: size,
              workspaceId: wsId,
            }) || enqueued;
          }

          recordMCPAction({
            tool: 'retroactive_scan', action: 'start',
            params: { entityTypes: types, batchSize: size },
            timestamp: new Date().toISOString(), result: 'success',
          });

          return {
            jobId: job.id,
            entityTypes: types,
            batchSize: size,
            status: enqueued ? 'queued' : 'queued (no worker available)',
          };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );
}

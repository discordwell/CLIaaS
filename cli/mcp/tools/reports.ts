import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { scopeGuard } from './scopes.js';

export function registerReportTools(server: McpServer): void {
  server.tool(
    'report_list',
    'List saved reports and templates',
    { templateOnly: z.boolean().optional().describe('Show only templates') },
    async ({ templateOnly }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq, and, desc } = await import('drizzle-orm');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const conditions = [eq(conn.schema.reports.workspaceId, wsId)];
          if (templateOnly) conditions.push(eq(conn.schema.reports.isTemplate, true));

          const rows = await conn.db.select().from(conn.schema.reports)
            .where(and(...conditions))
            .orderBy(desc(conn.schema.reports.updatedAt));

          return textResult({
            count: rows.length,
            reports: rows.map(r => ({
              id: r.id, name: r.name, metric: r.metric,
              visualization: r.visualization, isTemplate: r.isTemplate,
            })),
          });
        }

        const { REPORT_TEMPLATES } = await import('@/lib/reports/templates.js');
        return textResult({
          count: REPORT_TEMPLATES.length,
          reports: REPORT_TEMPLATES.map((t, i) => ({
            id: `template-${i}`, name: t.name, metric: t.metric,
            visualization: t.visualization, isTemplate: true,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list reports');
      }
    },
  );

  server.tool(
    'report_run',
    'Execute a report by ID or metric key and return results',
    {
      idOrMetric: z.string().describe('Report ID or metric key (e.g. ticket_volume)'),
      from: z.string().optional().describe('Start date YYYY-MM-DD'),
      to: z.string().optional().describe('End date YYYY-MM-DD'),
      groupBy: z.array(z.string()).optional().describe('Override group-by dimensions'),
    },
    async ({ idOrMetric, from, to, groupBy }) => {
      try {
        const { executeReport } = await import('@/lib/reports/engine.js');
        const { getMetric } = await import('@/lib/reports/metrics.js');

        let reportDef;
        const metric = getMetric(idOrMetric);

        if (metric) {
          reportDef = {
            metric: idOrMetric,
            groupBy: groupBy ?? metric.validGroupBy.slice(0, 1),
          };
        } else {
          const { tryDb } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return errorResult('Report not found (use metric key in JSONL mode)');

          const { eq } = await import('drizzle-orm');
          const [row] = await conn.db.select().from(conn.schema.reports)
            .where(eq(conn.schema.reports.id, idOrMetric)).limit(1);
          if (!row) return errorResult('Report not found');
          reportDef = {
            metric: row.metric,
            groupBy: groupBy ?? (row.groupBy as string[]) ?? [],
            filters: (row.filters ?? {}) as Record<string, unknown>,
          };
        }

        const dateRange = from && to ? { from, to } : undefined;
        const result = await executeReport(reportDef, dateRange);

        return textResult({
          metric: result.metric,
          summary: result.summary,
          rowCount: result.rows.length,
          rows: result.rows.slice(0, 50),
          dateRange: result.dateRange,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to run report');
      }
    },
  );

  server.tool(
    'report_create',
    'Create a new report definition (requires confirm=true)',
    {
      name: z.string().describe('Report name'),
      metric: z.string().describe('Metric key'),
      groupBy: z.array(z.string()).optional().describe('Group-by dimensions'),
      visualization: z.enum(['bar', 'line', 'pie', 'number']).optional().describe('Chart type'),
      description: z.string().optional(),
      confirm: z.boolean().optional(),
    },
    async ({ name, metric, groupBy, visualization, description, confirm }) => {
      const guard = scopeGuard('report_create');
      if (guard) return guard;

      if (!confirm) {
        return textResult({
          needsConfirmation: true,
          preview: { name, metric, groupBy: groupBy ?? [], visualization: visualization ?? 'bar' },
        });
      }

      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [row] = await conn.db.insert(conn.schema.reports).values({
            workspaceId: wsId,
            name,
            description: description ?? null,
            metric,
            groupBy: groupBy ?? [],
            visualization: visualization ?? 'bar',
          }).returning();
          return textResult({ created: true, reportId: row.id, name });
        }

        return errorResult('Report creation requires DATABASE_URL');
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to create report');
      }
    },
  );

  server.tool(
    'report_export',
    'Export a report as CSV or JSON',
    {
      idOrMetric: z.string().describe('Report ID or metric key'),
      format: z.enum(['csv', 'json']).optional().describe('Export format (default: csv)'),
      from: z.string().optional().describe('Start date YYYY-MM-DD'),
      to: z.string().optional().describe('End date YYYY-MM-DD'),
    },
    async ({ idOrMetric, format, from, to }) => {
      try {
        const { executeReport } = await import('@/lib/reports/engine.js');
        const { formatCSV, formatJSON } = await import('@/lib/reports/formatters.js');
        const { getMetric } = await import('@/lib/reports/metrics.js');

        let reportDef;
        const metric = getMetric(idOrMetric);

        if (metric) {
          reportDef = { metric: idOrMetric, groupBy: metric.validGroupBy.slice(0, 1) };
        } else {
          const { tryDb } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return errorResult('Report not found');
          const { eq } = await import('drizzle-orm');
          const [row] = await conn.db.select().from(conn.schema.reports)
            .where(eq(conn.schema.reports.id, idOrMetric)).limit(1);
          if (!row) return errorResult('Report not found');
          reportDef = { metric: row.metric, groupBy: (row.groupBy as string[]) ?? [], filters: (row.filters ?? {}) as Record<string, unknown> };
        }

        const dateRange = from && to ? { from, to } : undefined;
        const result = await executeReport(reportDef, dateRange);
        const output = format === 'json' ? formatJSON(result) : formatCSV(result);

        return textResult({ format: format ?? 'csv', content: output });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to export report');
      }
    },
  );

  server.tool(
    'dashboard_live',
    'Get real-time live dashboard metrics snapshot',
    {},
    async () => {
      try {
        const { computeLiveSnapshot } = await import('@/lib/reports/live-metrics.js');
        const snapshot = await computeLiveSnapshot();
        return textResult(snapshot);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get live metrics');
      }
    },
  );

  server.tool(
    'report_schedule',
    'Create a scheduled report export (requires confirm=true)',
    {
      reportId: z.string().describe('Report ID'),
      frequency: z.enum(['daily', 'weekly', 'monthly']).describe('Export frequency'),
      recipients: z.array(z.string()).describe('Email addresses'),
      format: z.enum(['csv', 'json']).optional().describe('Export format'),
      hourUtc: z.number().optional().describe('Hour to send (UTC, 0-23)'),
      confirm: z.boolean().optional(),
    },
    async ({ reportId, frequency, recipients, format, hourUtc, confirm }) => {
      const guard = scopeGuard('report_schedule');
      if (guard) return guard;

      if (!confirm) {
        return textResult({
          needsConfirmation: true,
          preview: { reportId, frequency, recipients, format: format ?? 'csv' },
        });
      }

      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) return errorResult('Scheduling requires DATABASE_URL');

        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
        const [row] = await conn.db.insert(conn.schema.reportSchedules).values({
          workspaceId: wsId,
          reportId,
          frequency,
          recipients,
          format: format ?? 'csv',
          hourUtc: hourUtc ?? 9,
          enabled: true,
        }).returning();

        return textResult({ created: true, scheduleId: row.id, frequency, recipients });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to create schedule');
      }
    },
  );
}

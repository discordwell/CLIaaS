import type { Command } from 'commander';

export function registerReportsCommands(program: Command): void {
  const reports = program.command('reports').description('Manage custom reports');

  reports
    .command('list')
    .description('List all reports')
    .option('--template', 'Show only templates')
    .option('--json', 'JSON output')
    .action(async (opts: { template?: boolean; json?: boolean }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq, and, desc } = await import('drizzle-orm');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const conditions = [eq(conn.schema.reports.workspaceId, wsId)];
          if (opts.template) conditions.push(eq(conn.schema.reports.isTemplate, true));

          const rows = await conn.db.select().from(conn.schema.reports)
            .where(and(...conditions))
            .orderBy(desc(conn.schema.reports.updatedAt));

          if (opts.json) {
            console.log(JSON.stringify(rows, null, 2));
          } else {
            console.log(`\n  Reports (${rows.length}):\n`);
            for (const r of rows) {
              const tag = r.isTemplate ? '[template]' : '';
              console.log(`  ${tag} ${r.name} — ${r.metric} (${r.id.slice(0, 8)})`);
            }
            console.log('');
          }
        } else {
          const { REPORT_TEMPLATES } = await import('@/lib/reports/templates.js');
          if (opts.json) {
            console.log(JSON.stringify(REPORT_TEMPLATES, null, 2));
          } else {
            console.log(`\n  Report Templates (${REPORT_TEMPLATES.length}):\n`);
            for (const t of REPORT_TEMPLATES) {
              console.log(`  [template] ${t.name} — ${t.metric}`);
            }
            console.log('');
          }
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  reports
    .command('run <idOrKey>')
    .description('Execute a report')
    .option('--from <date>', 'Start date (YYYY-MM-DD)')
    .option('--to <date>', 'End date (YYYY-MM-DD)')
    .option('--format <fmt>', 'Output format: table, csv, json', 'table')
    .action(async (idOrKey: string, opts: { from?: string; to?: string; format?: string }) => {
      try {
        const { executeReport } = await import('@/lib/reports/engine.js');
        const { formatCSV, formatJSON } = await import('@/lib/reports/formatters.js');
        const { getMetric } = await import('@/lib/reports/metrics.js');

        let reportDef;
        const metric = getMetric(idOrKey);

        if (metric) {
          reportDef = { metric: idOrKey, groupBy: metric.validGroupBy.slice(0, 1) };
        } else {
          const { tryDb } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (conn) {
            const { eq } = await import('drizzle-orm');
            const [row] = await conn.db.select().from(conn.schema.reports)
              .where(eq(conn.schema.reports.id, idOrKey)).limit(1);
            if (!row) { console.error('Report not found'); return; }
            reportDef = {
              metric: row.metric,
              groupBy: (row.groupBy as string[]) ?? [],
              filters: (row.filters ?? {}) as Record<string, unknown>,
            };
          } else {
            console.error('Report not found (use metric key in JSONL mode)');
            return;
          }
        }

        const dateRange = opts.from && opts.to ? { from: opts.from, to: opts.to } : undefined;
        const result = await executeReport(reportDef, dateRange);

        if (opts.format === 'csv') {
          console.log(formatCSV(result));
        } else if (opts.format === 'json') {
          console.log(formatJSON(result));
        } else {
          console.log(`\n  Report: ${result.metric}`);
          if (result.dateRange) console.log(`  Range: ${result.dateRange.from} to ${result.dateRange.to}`);
          console.log(`  Summary: ${JSON.stringify(result.summary)}\n`);
          if (result.rows.length > 0) {
            console.log(`  ${result.columns.join('\t')}`);
            console.log(`  ${'—'.repeat(result.columns.length * 12)}`);
            for (const row of result.rows.slice(0, 25)) {
              console.log(`  ${result.columns.map(c => String(row[c] ?? '')).join('\t')}`);
            }
            if (result.rows.length > 25) console.log(`  ... and ${result.rows.length - 25} more rows`);
          }
          console.log('');
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  reports
    .command('create')
    .description('Create a new report')
    .requiredOption('-n, --name <name>', 'Report name')
    .requiredOption('-m, --metric <metric>', 'Metric key')
    .option('-g, --group-by <dims>', 'Group-by dimensions (comma-separated)')
    .option('-v, --viz <type>', 'Visualization: bar, line, pie, number', 'bar')
    .action(async (opts: { name: string; metric: string; groupBy?: string; viz?: string }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [row] = await conn.db.insert(conn.schema.reports).values({
            workspaceId: wsId,
            name: opts.name,
            metric: opts.metric,
            groupBy: opts.groupBy?.split(',') ?? [],
            visualization: opts.viz ?? 'bar',
          }).returning();
          console.log(`Created report: ${row.id}`);
        } else {
          console.error('Report creation requires DATABASE_URL');
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  reports
    .command('export <id>')
    .description('Export a report to file')
    .option('--format <fmt>', 'Format: csv or json', 'csv')
    .option('--from <date>', 'Start date')
    .option('--to <date>', 'End date')
    .action(async (id: string, opts: { format?: string; from?: string; to?: string }) => {
      try {
        const { executeReport } = await import('@/lib/reports/engine.js');
        const { formatCSV, formatJSON } = await import('@/lib/reports/formatters.js');

        let reportDef;
        const { getMetric } = await import('@/lib/reports/metrics.js');
        const metric = getMetric(id);

        if (metric) {
          reportDef = { metric: id, groupBy: metric.validGroupBy.slice(0, 1) };
        } else {
          const { tryDb } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) { console.error('Report not found'); return; }
          const { eq } = await import('drizzle-orm');
          const [row] = await conn.db.select().from(conn.schema.reports)
            .where(eq(conn.schema.reports.id, id)).limit(1);
          if (!row) { console.error('Report not found'); return; }
          reportDef = { metric: row.metric, groupBy: (row.groupBy as string[]) ?? [], filters: (row.filters ?? {}) as Record<string, unknown> };
        }

        const dateRange = opts.from && opts.to ? { from: opts.from, to: opts.to } : undefined;
        const result = await executeReport(reportDef, dateRange);
        const output = opts.format === 'json' ? formatJSON(result) : formatCSV(result);
        console.log(output);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  reports
    .command('schedule <id>')
    .description('Create a scheduled export')
    .requiredOption('--frequency <freq>', 'Frequency: daily, weekly, monthly')
    .requiredOption('--recipients <emails>', 'Comma-separated email addresses')
    .option('--format <fmt>', 'Format: csv or json', 'csv')
    .option('--hour <h>', 'Hour UTC (0-23)', '9')
    .action(async (id: string, opts: { frequency: string; recipients: string; format?: string; hour?: string }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) { console.error('Scheduling requires DATABASE_URL'); return; }

        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
        const [row] = await conn.db.insert(conn.schema.reportSchedules).values({
          workspaceId: wsId,
          reportId: id,
          frequency: opts.frequency,
          recipients: opts.recipients.split(',').map(e => e.trim()),
          format: opts.format ?? 'csv',
          hourUtc: parseInt(opts.hour ?? '9', 10),
          enabled: true,
        }).returning();
        console.log(`Created schedule: ${row.id}`);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });
}

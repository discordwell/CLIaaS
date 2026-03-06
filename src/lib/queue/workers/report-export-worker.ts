/**
 * BullMQ worker: processes report export jobs.
 *
 * Executes the report, formats as CSV/JSON, and sends the result
 * to recipients via email.
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getRedisConnectionOpts } from '../connection';
import { QUEUE_NAMES, type ReportExportJob } from '../types';
import { createLogger } from '../../logger';

const logger = createLogger('queue:report-export-worker');

export function createReportExportWorker(): Worker | null {
  const opts = getRedisConnectionOpts();
  if (!opts) return null;

  const worker = new Worker<ReportExportJob>(
    QUEUE_NAMES.REPORT_EXPORT,
    async (job: Job<ReportExportJob>) => {
      const { scheduleId, reportId, format, recipients, dateRange } = job.data;
      logger.info({ scheduleId, reportId, format, recipients }, 'Processing report export');

      // Execute the report
      const { executeReport } = await import('../../reports/engine');
      const result = await executeReport(
        { metric: reportId },
        dateRange ? { from: dateRange.from, to: dateRange.to } : undefined,
      );

      // Format the result
      const { formatCSV, formatJSON } = await import('../../reports/formatters');
      const content = format === 'json' ? formatJSON(result) : formatCSV(result);
      const ext = format === 'json' ? 'json' : 'csv';

      // Send to each recipient via email
      try {
        const { sendEmail } = await import('../../email/sender');
        for (const to of recipients) {
          await sendEmail({
            to,
            subject: `[CLIaaS] Scheduled Report Export: ${result.metric}`,
            text: [
              `Your scheduled report "${result.metric}" is ready.`,
              '',
              `Format: ${format.toUpperCase()}`,
              `Rows: ${result.rows.length}`,
              dateRange ? `Date range: ${dateRange.from} to ${dateRange.to}` : '',
              '',
              '--- Report Data ---',
              content,
            ].filter(Boolean).join('\n'),
            html: [
              `<h2>Scheduled Report: ${result.metric}</h2>`,
              `<p>Format: ${format.toUpperCase()} | Rows: ${result.rows.length}</p>`,
              dateRange ? `<p>Date range: ${dateRange.from} to ${dateRange.to}</p>` : '',
              `<pre style="background:#f4f4f5;padding:16px;font-size:12px;overflow:auto">${content}</pre>`,
            ].filter(Boolean).join('\n'),
          }, true); // _skipQueue=true since we're already in a worker
        }
      } catch (emailErr) {
        logger.warn({ error: emailErr instanceof Error ? emailErr.message : String(emailErr) }, 'Email send failed, logging export');
        // Fallback: log the export content
        logger.info({ scheduleId, reportId, format, ext, rowCount: result.rows.length }, 'Report exported (email unavailable)');
      }

      return { scheduleId, reportId, rowCount: result.rows.length, recipientCount: recipients.length };
    },
    {
      ...opts,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, scheduleId: job.data.scheduleId }, 'Report export completed');
  });

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, scheduleId: job?.data.scheduleId, error: err.message }, 'Report export failed');
  });

  return worker;
}

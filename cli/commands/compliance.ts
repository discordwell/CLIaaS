/**
 * CLI commands for PII masking and HIPAA compliance management.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { output, outputError, isJsonMode } from '../output.js';

export function registerComplianceCommands(program: Command): void {
  const compliance = program
    .command('compliance')
    .description('PII masking & HIPAA compliance');

  // ---- compliance pii-scan ----
  compliance
    .command('pii-scan')
    .description('Scan an entity for PII or start a retroactive scan')
    .option('--entity-type <type>', 'Entity type (message, ticket, customer)', 'message')
    .option('--entity-id <id>', 'Entity ID to scan')
    .option('--workspace-id <id>', 'Workspace ID', 'default')
    .option('--retroactive', 'Start a retroactive batch scan')
    .option('--batch-size <n>', 'Batch size for retroactive scan', '100')
    .action(async (opts) => {
      try {
        if (opts.retroactive) {
          // Retroactive batch scan
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) {
            outputError('Database not available. Retroactive scan requires a database connection.');
            process.exitCode = 1;
            return;
          }

          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const batchSize = parseInt(opts.batchSize, 10) || 100;

          // Create a scan job record
          const [job] = await conn.db
            .insert(conn.schema.piiScanJobs)
            .values({
              workspaceId: wsId,
              startedBy: '00000000-0000-0000-0000-000000000000', // CLI user placeholder
              entityTypes: [opts.entityType],
              status: 'queued',
              totalRecords: 0,
              scannedRecords: 0,
              detectionsFound: 0,
            })
            .returning();

          // Try to enqueue, otherwise run inline
          const { enqueuePiiScan } = await import('@/lib/queue/dispatch.js');
          const enqueued = await enqueuePiiScan({
            scanJobId: job.id,
            entityType: opts.entityType,
            batchOffset: 0,
            batchSize,
            workspaceId: wsId,
          });

          const data = {
            jobId: job.id,
            entityType: opts.entityType,
            batchSize,
            status: enqueued ? 'queued' : 'queued (no worker — run manually)',
          };

          output(data, () => {
            console.log(chalk.bold.cyan('\n  Retroactive PII Scan Started\n'));
            console.log(`  ${'Job ID:'.padEnd(16)} ${chalk.bold(job.id)}`);
            console.log(`  ${'Entity Type:'.padEnd(16)} ${opts.entityType}`);
            console.log(`  ${'Batch Size:'.padEnd(16)} ${batchSize}`);
            console.log(`  ${'Status:'.padEnd(16)} ${enqueued ? chalk.green('Queued') : chalk.yellow('Queued (no worker)')}`);
            console.log();
          });
          return;
        }

        // Single entity scan
        if (!opts.entityId) {
          outputError('Either --entity-id or --retroactive is required.');
          process.exitCode = 1;
          return;
        }

        const { scanEntity } = await import('@/lib/compliance/pii-masking.js');

        // Resolve workspace ID
        let wsId = opts.workspaceId;
        if (wsId === 'default') {
          try {
            const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
            const conn = await tryDb();
            if (conn) wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          } catch { /* keep 'default' */ }
        }

        const detections = await scanEntity(opts.entityType, opts.entityId, wsId);

        const data = {
          entityType: opts.entityType,
          entityId: opts.entityId,
          detectionsFound: detections.length,
          detections,
        };

        output(data, () => {
          console.log(chalk.bold.cyan('\n  PII Scan Results\n'));
          console.log(`  ${'Entity:'.padEnd(16)} ${opts.entityType}:${opts.entityId}`);
          console.log(`  ${'Detections:'.padEnd(16)} ${chalk.bold(String(detections.length))}`);

          if (detections.length > 0) {
            console.log(chalk.bold('\n  Findings:'));
            for (const d of detections) {
              const conf = Math.round(d.confidence * 100);
              console.log(`    ${chalk.yellow(d.piiType.padEnd(18))} ${d.fieldName.padEnd(12)} conf=${conf}% ${chalk.gray(d.maskedValue)}`);
            }
          }
          console.log();
        });
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'PII scan failed');
        process.exitCode = 1;
      }
    });

  // ---- compliance detections ----
  compliance
    .command('detections')
    .description('List PII detections')
    .option('--status <status>', 'Filter by status (pending, confirmed, redacted, dismissed, auto_redacted)')
    .option('--type <type>', 'Filter by PII type')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) {
          outputError('Database not available.');
          process.exitCode = 1;
          return;
        }

        const { eq, and, desc } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
        const limit = parseInt(opts.limit, 10) || 50;

        const conditions = [eq(conn.schema.piiDetections.workspaceId, wsId)];
        if (opts.status) {
          conditions.push(eq(conn.schema.piiDetections.status, opts.status));
        }
        if (opts.type) {
          conditions.push(eq(conn.schema.piiDetections.piiType, opts.type));
        }

        const rows = await conn.db
          .select()
          .from(conn.schema.piiDetections)
          .where(and(...conditions))
          .orderBy(desc(conn.schema.piiDetections.createdAt))
          .limit(limit);

        const data = { count: rows.length, detections: rows };

        output(data, () => {
          console.log(chalk.bold(`\n  PII Detections (${rows.length})\n`));
          if (rows.length === 0) {
            console.log('  No detections found.\n');
            return;
          }
          console.log(`  ${'ID'.padEnd(38)} ${'TYPE'.padEnd(16)} ${'STATUS'.padEnd(14)} ${'ENTITY'.padEnd(20)} CONF`);
          console.log('  ' + '\u2500'.repeat(100));
          for (const r of rows) {
            const conf = Math.round(r.confidence * 100);
            const statusColor = r.status === 'pending' ? chalk.yellow : r.status === 'confirmed' ? chalk.blue : r.status === 'redacted' || r.status === 'auto_redacted' ? chalk.green : chalk.gray;
            console.log(`  ${chalk.gray(r.id.padEnd(38))} ${r.piiType.padEnd(16)} ${statusColor(r.status.padEnd(14))} ${(r.entityType + ':' + r.entityId.slice(0, 8)).padEnd(20)} ${conf}%`);
          }
          console.log();
        });
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Failed to list detections');
        process.exitCode = 1;
      }
    });

  // ---- compliance redact ----
  compliance
    .command('redact')
    .description('Redact PII detections')
    .option('--detection-id <id>', 'Specific detection ID to redact')
    .option('--all-confirmed', 'Redact all confirmed detections')
    .option('--dry-run', 'Preview without applying')
    .action(async (opts) => {
      try {
        if (!opts.detectionId && !opts.allConfirmed) {
          outputError('Either --detection-id or --all-confirmed is required.');
          process.exitCode = 1;
          return;
        }

        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) {
          outputError('Database not available.');
          process.exitCode = 1;
          return;
        }

        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        if (opts.dryRun) {
          const data = {
            dryRun: true,
            action: opts.allConfirmed ? 'redact all confirmed' : `redact detection ${opts.detectionId}`,
            message: 'No changes applied.',
          };
          output(data, () => {
            console.log(chalk.yellow('\n  [DRY RUN] No changes applied.'));
            console.log(`  Action: ${data.action}\n`);
          });
          return;
        }

        const { redactDetection, redactAllConfirmed } = await import('@/lib/compliance/pii-masking.js');

        if (opts.allConfirmed) {
          const count = await redactAllConfirmed(wsId, 'cli-user');
          const data = { redacted: count };
          output(data, () => {
            console.log(chalk.bold.green(`\n  Redacted ${count} confirmed detection(s).\n`));
          });
        } else {
          await redactDetection(opts.detectionId, 'cli-user', wsId);
          const data = { redacted: 1, detectionId: opts.detectionId };
          output(data, () => {
            console.log(chalk.bold.green(`\n  Detection ${opts.detectionId} redacted.\n`));
          });
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Redaction failed');
        process.exitCode = 1;
      }
    });

  // ---- compliance rules ----
  compliance
    .command('rules')
    .description('List or set PII sensitivity rules')
    .option('--set <rule>', 'Set a rule (format: piiType:field:value, e.g. ssn:autoRedact:true)')
    .action(async (opts) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (opts.set) {
          // Parse rule: piiType:field:value
          const parts = opts.set.split(':');
          if (parts.length !== 3) {
            outputError('Rule format must be piiType:field:value (e.g. ssn:autoRedact:true, email:enabled:false, credit_card:maskingStyle:partial)');
            process.exitCode = 1;
            return;
          }

          const [piiType, field, value] = parts;
          const validFields = ['enabled', 'autoRedact', 'maskingStyle'];
          if (!validFields.includes(field)) {
            outputError(`Invalid field "${field}". Valid fields: ${validFields.join(', ')}`);
            process.exitCode = 1;
            return;
          }

          const { getSensitivityRules, upsertSensitivityRules } = await import('@/lib/compliance/pii-rules.js');

          let wsId = 'default';
          if (conn) wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

          const currentRules = await getSensitivityRules(wsId);
          const rule = currentRules.find(r => r.piiType === piiType) || {
            piiType: piiType as import('@/lib/compliance/pii-detector.js').PiiType,
            enabled: true,
            autoRedact: false,
            maskingStyle: 'full' as const,
          };

          if (field === 'enabled') (rule as any).enabled = value === 'true';
          else if (field === 'autoRedact') (rule as any).autoRedact = value === 'true';
          else if (field === 'maskingStyle') (rule as any).maskingStyle = value;

          const updated = await upsertSensitivityRules(wsId, [rule]);
          const data = { updated: updated[0] };
          output(data, () => {
            console.log(chalk.bold.green(`\n  Rule updated: ${piiType}.${field} = ${value}\n`));
          });
          return;
        }

        // List rules
        const { getSensitivityRules } = await import('@/lib/compliance/pii-rules.js');

        let wsId = 'default';
        if (conn) wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        const rules = await getSensitivityRules(wsId);
        const data = { count: rules.length, rules };

        output(data, () => {
          console.log(chalk.bold('\n  PII Sensitivity Rules\n'));
          console.log(`  ${'TYPE'.padEnd(18)} ${'ENABLED'.padEnd(10)} ${'AUTO-REDACT'.padEnd(14)} MASKING`);
          console.log('  ' + '\u2500'.repeat(60));
          for (const r of rules) {
            const enabledStr = r.enabled ? chalk.green('yes') : chalk.red('no');
            const autoStr = r.autoRedact ? chalk.green('yes') : chalk.gray('no');
            console.log(`  ${r.piiType.padEnd(18)} ${enabledStr.padEnd(10 + (r.enabled ? 10 : 9))} ${autoStr.padEnd(14 + (r.autoRedact ? 10 : 5))} ${r.maskingStyle}`);
          }
          console.log();
        });
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Failed to manage rules');
        process.exitCode = 1;
      }
    });

  // ---- compliance hipaa-status ----
  compliance
    .command('hipaa-status')
    .description('Show HIPAA readiness checklist')
    .action(async () => {
      try {
        const { evaluateHipaaReadiness, getHipaaScore } = await import('@/lib/compliance/hipaa.js');

        let wsId = 'default';
        try {
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (conn) wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
        } catch { /* keep default */ }

        const controls = await evaluateHipaaReadiness(wsId);
        const score = getHipaaScore(controls);

        const data = { controls, score };

        output(data, () => {
          console.log(chalk.bold('\n  HIPAA Readiness Checklist\n'));
          console.log(`  Score: ${chalk.bold(String(score.percentage))}% (${score.score}/${score.total})\n`);

          for (const c of controls) {
            const icon = c.status === 'pass' ? chalk.green('\u2713') : c.status === 'partial' ? chalk.yellow('~') : c.status === 'fail' ? chalk.red('\u2717') : chalk.gray('-');
            console.log(`  ${icon} ${chalk.bold(c.name)} ${chalk.gray(`[${c.category}]`)}`);
            console.log(`    ${c.description}`);
            for (const e of c.evidence) {
              console.log(`    ${chalk.gray('\u2022 ' + e)}`);
            }
            if (c.remediation) {
              console.log(`    ${chalk.yellow('\u2192 ' + c.remediation)}`);
            }
          }
          console.log();
        });
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Failed to evaluate HIPAA status');
        process.exitCode = 1;
      }
    });

  // ---- compliance access-log ----
  compliance
    .command('access-log')
    .description('List PII access log entries')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) {
          outputError('Database not available.');
          process.exitCode = 1;
          return;
        }

        const { eq, desc } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
        const limit = parseInt(opts.limit, 10) || 50;

        const rows = await conn.db
          .select()
          .from(conn.schema.piiAccessLog)
          .where(eq(conn.schema.piiAccessLog.workspaceId, wsId))
          .orderBy(desc(conn.schema.piiAccessLog.createdAt))
          .limit(limit);

        const data = { count: rows.length, entries: rows };

        output(data, () => {
          console.log(chalk.bold(`\n  PII Access Log (${rows.length})\n`));
          if (rows.length === 0) {
            console.log('  No access log entries found.\n');
            return;
          }
          console.log(`  ${'TIMESTAMP'.padEnd(22)} ${'USER'.padEnd(38)} ${'TYPE'.padEnd(12)} ${'PII TYPE'.padEnd(16)} ENTITY`);
          console.log('  ' + '\u2500'.repeat(100));
          for (const r of rows) {
            const ts = r.createdAt instanceof Date ? r.createdAt.toISOString().slice(0, 19) : String(r.createdAt).slice(0, 19);
            console.log(`  ${chalk.gray(ts.padEnd(22))} ${r.userId.slice(0, 36).padEnd(38)} ${r.accessType.padEnd(12)} ${r.piiType.padEnd(16)} ${r.entityType}:${r.entityId.slice(0, 8)}`);
          }
          console.log();
        });
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Failed to list access log');
        process.exitCode = 1;
      }
    });

  // ---- compliance scan-status ----
  compliance
    .command('scan-status')
    .description('Show scan job status')
    .option('--job-id <id>', 'Specific scan job ID')
    .action(async (opts) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) {
          outputError('Database not available.');
          process.exitCode = 1;
          return;
        }

        const { eq, and, desc } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        if (opts.jobId) {
          const [job] = await conn.db
            .select()
            .from(conn.schema.piiScanJobs)
            .where(
              and(
                eq(conn.schema.piiScanJobs.id, opts.jobId),
                eq(conn.schema.piiScanJobs.workspaceId, wsId),
              ),
            )
            .limit(1);

          if (!job) {
            outputError(`Scan job "${opts.jobId}" not found.`);
            process.exitCode = 1;
            return;
          }

          output(job, () => {
            console.log(chalk.bold('\n  PII Scan Job\n'));
            console.log(`  ${'ID:'.padEnd(18)} ${job.id}`);
            console.log(`  ${'Status:'.padEnd(18)} ${job.status}`);
            console.log(`  ${'Entity Types:'.padEnd(18)} ${(job.entityTypes as string[]).join(', ')}`);
            console.log(`  ${'Scanned:'.padEnd(18)} ${job.scannedRecords} / ${job.totalRecords}`);
            console.log(`  ${'Detections:'.padEnd(18)} ${job.detectionsFound}`);
            if (job.error) console.log(`  ${'Error:'.padEnd(18)} ${chalk.red(job.error)}`);
            console.log();
          });
          return;
        }

        // List recent scan jobs
        const jobs = await conn.db
          .select()
          .from(conn.schema.piiScanJobs)
          .where(eq(conn.schema.piiScanJobs.workspaceId, wsId))
          .orderBy(desc(conn.schema.piiScanJobs.createdAt))
          .limit(10);

        const data = { count: jobs.length, jobs };

        output(data, () => {
          console.log(chalk.bold(`\n  Recent PII Scan Jobs (${jobs.length})\n`));
          if (jobs.length === 0) {
            console.log('  No scan jobs found.\n');
            return;
          }
          console.log(`  ${'ID'.padEnd(38)} ${'STATUS'.padEnd(12)} ${'SCANNED'.padEnd(10)} DETECTIONS`);
          console.log('  ' + '\u2500'.repeat(80));
          for (const j of jobs) {
            const statusColor = j.status === 'completed' ? chalk.green : j.status === 'running' ? chalk.blue : j.status === 'failed' ? chalk.red : chalk.yellow;
            console.log(`  ${chalk.gray(j.id.padEnd(38))} ${statusColor(j.status.padEnd(12))} ${String(j.scannedRecords).padEnd(10)} ${j.detectionsFound}`);
          }
          console.log();
        });
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Failed to get scan status');
        process.exitCode = 1;
      }
    });
}

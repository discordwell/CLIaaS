import type { Command } from 'commander';
import chalk from 'chalk';
import { runSyncCycle, getSyncStatus, listConnectors } from '../sync/engine.js';
import { syncAndIngest } from '../sync/pull.js';
import { startSyncWorker } from '../sync/worker.js';
import { output, outputError, isJsonMode } from '../output.js';

export function registerSyncCommands(program: Command): void {
  const sync = program
    .command('sync')
    .description('Connector sync + hybrid pull/push/conflicts');

  sync
    .command('run')
    .description('Run a single sync cycle for a connector')
    .requiredOption('--connector <name>', 'Connector name (zendesk, kayako, kayako-classic, ...)')
    .option('--full', 'Force full sync (ignore existing cursor)', false)
    .option('--out <dir>', 'Output directory override')
    .option('--ingest', 'Ingest exported data into Postgres after sync', false)
    .option('--tenant <name>', 'Tenant name for ingest (default: env or "default")')
    .option('--workspace <name>', 'Workspace name for ingest (default: env or "default")')
    .action(async (opts: { connector: string; full: boolean; out?: string; ingest: boolean; tenant?: string; workspace?: string }) => {
      try {
        if (!isJsonMode()) {
          console.log(chalk.cyan(`\nRunning sync cycle for ${opts.connector}...${opts.ingest ? ' (with ingest)' : ''}\n`));
        }

        const stats = opts.ingest
          ? await syncAndIngest(opts.connector, {
              fullSync: opts.full,
              outDir: opts.out,
              ingest: true,
              tenant: opts.tenant,
              workspace: opts.workspace,
            })
          : await runSyncCycle(opts.connector, {
              fullSync: opts.full,
              outDir: opts.out,
            });

        if (stats.error) {
          outputError(`Sync error: ${stats.error}`);
          process.exit(1);
        }

        const ingestInfo = 'ingested' in stats
          ? {
              ingested: (stats as { ingested: boolean }).ingested,
              ingestSkipped: (stats as { ingestSkipped: boolean }).ingestSkipped,
              ingestError: (stats as { ingestError?: string }).ingestError,
            }
          : undefined;

        output(
          {
            connector: stats.connector,
            mode: stats.fullSync ? 'full' : 'incremental',
            durationMs: stats.durationMs,
            counts: stats.counts,
            cursors: stats.cursorState ? Object.keys(stats.cursorState).length : 0,
            ...ingestInfo,
          },
          () => {
            console.log(chalk.green('\nSync complete:'));
            console.log(`  Connector:     ${stats.connector}`);
            console.log(`  Mode:          ${stats.fullSync ? 'full' : 'incremental'}`);
            console.log(`  Duration:      ${stats.durationMs}ms`);
            console.log(`  Tickets:       ${stats.counts.tickets}`);
            console.log(`  Messages:      ${stats.counts.messages}`);
            console.log(`  Customers:     ${stats.counts.customers}`);
            console.log(`  Organizations: ${stats.counts.organizations}`);
            console.log(`  KB Articles:   ${stats.counts.kbArticles}`);
            console.log(`  Rules:         ${stats.counts.rules}`);
            if (stats.cursorState) {
              console.log(`  Cursors:       ${Object.keys(stats.cursorState).length} saved`);
            }
            if (ingestInfo) {
              if (ingestInfo.ingested) {
                console.log(chalk.green(`  Ingest:        ingested to DB`));
              } else if (ingestInfo.ingestSkipped) {
                console.log(chalk.yellow(`  Ingest:        skipped (no DB available)`));
              } else if (ingestInfo.ingestError) {
                console.log(chalk.red(`  Ingest:        failed — ${ingestInfo.ingestError}`));
              }
            }
          },
        );
      } catch (err) {
        outputError(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  sync
    .command('start')
    .description('Start continuous sync worker for a connector')
    .requiredOption('--connector <name>', 'Connector name')
    .option('--interval <ms>', 'Sync interval in milliseconds', '300000')
    .option('--out <dir>', 'Output directory override')
    .option('--ingest', 'Ingest exported data into Postgres after each cycle', false)
    .option('--tenant <name>', 'Tenant name for ingest (default: env or "default")')
    .option('--workspace <name>', 'Workspace name for ingest (default: env or "default")')
    .action(async (opts: { connector: string; interval: string; out?: string; ingest: boolean; tenant?: string; workspace?: string }) => {
      const intervalMs = parseInt(opts.interval, 10);
      if (isNaN(intervalMs) || intervalMs < 10000) {
        outputError('Interval must be at least 10000ms (10 seconds)');
        process.exit(1);
      }

      console.log(chalk.cyan(`\nStarting sync worker for ${opts.connector}`));
      console.log(chalk.gray(`  Interval: ${intervalMs}ms (${Math.round(intervalMs / 1000)}s)`));
      if (opts.ingest) console.log(chalk.gray('  Auto-ingest: enabled'));
      console.log(chalk.gray('  Press Ctrl+C to stop\n'));

      const handle = startSyncWorker(opts.connector, {
        intervalMs,
        outDir: opts.out,
        onCycle: async (stats) => {
          console.log(
            chalk.green(`[${new Date().toISOString()}] Sync: ${stats.counts.tickets} tickets, ${stats.counts.messages} messages (${stats.durationMs}ms)`),
          );
          if (opts.ingest) {
            try {
              const { syncAndIngest: pullIngest } = await import('../sync/pull.js');
              const result = await pullIngest(opts.connector, {
                ingest: true,
                outDir: opts.out,
                tenant: opts.tenant,
                workspace: opts.workspace,
              });
              if (result.ingested) {
                console.log(chalk.green(`[${new Date().toISOString()}] Ingest: complete`));
              } else if (result.ingestSkipped) {
                console.log(chalk.yellow(`[${new Date().toISOString()}] Ingest: skipped (no DB)`));
              } else if (result.ingestError) {
                console.log(chalk.red(`[${new Date().toISOString()}] Ingest error: ${result.ingestError}`));
              }
            } catch (err) {
              console.error(chalk.red(`[${new Date().toISOString()}] Ingest failed: ${err instanceof Error ? err.message : err}`));
            }
          }
        },
        onError: (err) => {
          console.error(chalk.yellow(`[${new Date().toISOString()}] Sync error: ${err.message}`));
        },
      });

      // Keep process alive and handle graceful shutdown
      const shutdown = () => {
        console.log(chalk.gray('\nStopping sync worker...'));
        handle.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });

  sync
    .command('status')
    .description('Show sync cursor state for all connectors')
    .option('--connector <name>', 'Filter by connector name')
    .action((opts: { connector?: string }) => {
      const statuses = getSyncStatus(opts.connector);
      const connectors = listConnectors();

      if (statuses.length === 0) {
        if (isJsonMode()) {
          output({ connectors: [], supported: connectors }, () => {});
        } else {
          console.log(chalk.yellow('No connector data found.'));
          console.log(chalk.gray(`Supported connectors: ${connectors.join(', ')}`));
        }
        return;
      }

      output(
        {
          connectors: statuses.map(s => ({
            connector: s.connector,
            lastSyncedAt: s.lastSyncedAt,
            ticketCount: s.ticketCount,
            cursors: s.cursorState ? Object.keys(s.cursorState) : [],
          })),
        },
        () => {
          console.log(chalk.cyan('\nSync Status:\n'));
          for (const s of statuses) {
            const synced = s.lastSyncedAt
              ? chalk.green(s.lastSyncedAt)
              : chalk.gray('never');

            console.log(`  ${chalk.bold(s.connector)}`);
            console.log(`    Last synced:  ${synced}`);
            console.log(`    Tickets:      ${s.ticketCount}`);
            if (s.cursorState) {
              const cursorKeys = Object.keys(s.cursorState);
              console.log(`    Cursors:      ${cursorKeys.length > 0 ? cursorKeys.join(', ') : 'none'}`);
            } else {
              console.log(`    Cursors:      none`);
            }
            console.log('');
          }
        },
      );
    });

  sync
    .command('capabilities')
    .description('Show read/write capability matrix for all connectors')
    .option('--connector <name>', 'Filter by connector name')
    .action(async (opts: { connector?: string }) => {
      const { getAllCapabilities, getCapabilities, getSyncTier } = await import('../sync/capabilities.js');

      if (opts.connector) {
        const cap = getCapabilities(opts.connector);
        if (!cap) {
          outputError(`Unknown connector: ${opts.connector}`);
          process.exit(1);
        }
        output(
          { connector: opts.connector, capabilities: cap, tier: getSyncTier(cap) },
          () => {
            console.log(chalk.cyan(`\nCapabilities for ${chalk.bold(opts.connector)}:\n`));
            console.log(`  Tier:             ${getSyncTier(cap)}`);
            console.log(`  Read:             ${cap.read ? chalk.green('yes') : chalk.red('no')}`);
            console.log(`  Incremental Sync: ${cap.incrementalSync ? chalk.green('yes') : chalk.gray('no')}`);
            console.log(`  Update:           ${cap.update ? chalk.green('yes') : chalk.red('no')}`);
            console.log(`  Reply:            ${cap.reply ? chalk.green('yes') : chalk.red('no')}`);
            console.log(`  Note:             ${cap.note ? chalk.green('yes') : chalk.red('no')}`);
            console.log(`  Create:           ${cap.create ? chalk.green('yes') : chalk.red('no')}`);
          },
        );
        return;
      }

      const all = getAllCapabilities();
      const rows = Object.entries(all).map(([name, cap]) => ({
        connector: name,
        tier: getSyncTier(cap),
        ...cap,
      }));

      output(
        { connectors: rows },
        () => {
          console.log(chalk.cyan('\nConnector Capability Matrix:\n'));
          const hdr = '  Connector        Tier         Read  Inc   Upd   Reply Note  Create';
          console.log(chalk.bold(hdr));
          console.log('  ' + '─'.repeat(hdr.length - 2));
          for (const r of rows) {
            const yn = (v: boolean) => v ? chalk.green('✓') : chalk.gray('·');
            const name = r.connector.padEnd(17);
            const tier = r.tier.padEnd(13);
            console.log(`  ${name}${tier}${yn(r.read)}     ${yn(r.incrementalSync)}     ${yn(r.update)}     ${yn(r.reply)}     ${yn(r.note)}     ${yn(r.create)}`);
          }
          console.log('');
        },
      );
    });

  // ---- Upstream sync commands (push changes back to source platforms) ----

  const upstream = sync
    .command('upstream')
    .description('Push changes back to source helpdesk platforms');

  upstream
    .command('push')
    .description('Push pending upstream changes to source platforms')
    .option('--connector <name>', 'Filter by connector name')
    .action(async (opts: { connector?: string }) => {
      try {
        if (!isJsonMode()) {
          console.log(chalk.cyan('\nPushing upstream changes to source platforms...\n'));
        }
        const { upstreamPush } = await import('../sync/upstream.js');
        const result = await upstreamPush(opts.connector);

        output(
          {
            pushed: result.pushed,
            skipped: result.skipped,
            failed: result.failed,
            errors: result.errors,
          },
          () => {
            console.log(chalk.green('Upstream push complete:'));
            console.log(`  Pushed:   ${result.pushed}`);
            console.log(`  Skipped:  ${result.skipped}`);
            console.log(`  Failed:   ${result.failed}`);

            if (result.errors.length > 0) {
              console.log(chalk.yellow('\nErrors:'));
              for (const err of result.errors) {
                console.log(chalk.yellow(`  - ${err}`));
              }
            }
          },
        );
      } catch (err) {
        outputError(`Upstream push failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  upstream
    .command('status')
    .description('Show upstream outbox counts by connector and status')
    .option('--connector <name>', 'Filter by connector name')
    .action(async (opts: { connector?: string }) => {
      try {
        const { upstreamStatus } = await import('../sync/upstream.js');
        const statuses = await upstreamStatus(opts.connector);

        if (statuses.length === 0) {
          if (isJsonMode()) {
            output({ connectors: [] }, () => {});
          } else {
            console.log(chalk.yellow('\nNo upstream outbox entries.'));
          }
          return;
        }

        output(
          { connectors: statuses },
          () => {
            console.log(chalk.cyan('\nUpstream Outbox Status:\n'));
            for (const s of statuses) {
              console.log(`  ${chalk.bold(s.connector)}`);
              console.log(`    Pending:  ${s.pending}`);
              console.log(`    Pushed:   ${s.pushed}`);
              console.log(`    Failed:   ${s.failed}`);
              console.log(`    Skipped:  ${s.skipped}`);
              console.log('');
            }
          },
        );
      } catch (err) {
        outputError(`Failed to get upstream status: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  upstream
    .command('retry')
    .description('Retry failed upstream entries (max 3 retries per entry)')
    .option('--connector <name>', 'Filter by connector name')
    .action(async (opts: { connector?: string }) => {
      try {
        if (!isJsonMode()) {
          console.log(chalk.cyan('\nRetrying failed upstream entries...\n'));
        }
        const { upstreamRetryFailed } = await import('../sync/upstream.js');
        const result = await upstreamRetryFailed(opts.connector);

        output(
          {
            pushed: result.pushed,
            skipped: result.skipped,
            failed: result.failed,
            errors: result.errors,
          },
          () => {
            console.log(chalk.green('Upstream retry complete:'));
            console.log(`  Pushed:   ${result.pushed}`);
            console.log(`  Skipped:  ${result.skipped}`);
            console.log(`  Failed:   ${result.failed}`);

            if (result.errors.length > 0) {
              console.log(chalk.yellow('\nErrors:'));
              for (const err of result.errors) {
                console.log(chalk.yellow(`  - ${err}`));
              }
            }
          },
        );
      } catch (err) {
        outputError(`Upstream retry failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // ---- Hybrid sync commands ----

  sync
    .command('pull')
    .description('Pull data from hosted API into local DB (hybrid mode)')
    .action(async () => {
      try {
        if (!isJsonMode()) {
          console.log(chalk.cyan('\nPulling from hosted API...\n'));
        }
        const { syncPull } = await import('../sync/hybrid.js');
        const result = await syncPull();

        output(
          {
            ticketsPulled: result.ticketsPulled,
            articlesPulled: result.articlesPulled,
            conflicts: result.conflicts,
            errors: result.errors,
          },
          () => {
            console.log(chalk.green('Pull complete:'));
            console.log(`  Tickets pulled:  ${result.ticketsPulled}`);
            console.log(`  Articles pulled: ${result.articlesPulled}`);
            console.log(`  Conflicts:       ${result.conflicts}`);

            if (result.errors.length > 0) {
              console.log(chalk.yellow('\nWarnings:'));
              for (const err of result.errors) {
                console.log(chalk.yellow(`  - ${err}`));
              }
            }
          },
        );
      } catch (err) {
        outputError(`Pull failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  sync
    .command('push')
    .description('Push pending outbox changes to hosted API (hybrid mode)')
    .action(async () => {
      try {
        if (!isJsonMode()) {
          console.log(chalk.cyan('\nPushing outbox to hosted API...\n'));
        }
        const { syncPush } = await import('../sync/hybrid.js');
        const result = await syncPush();

        output(
          {
            pushed: result.pushed,
            conflicts: result.conflicts,
            failed: result.failed,
            errors: result.errors,
          },
          () => {
            console.log(chalk.green('Push complete:'));
            console.log(`  Pushed:     ${result.pushed}`);
            console.log(`  Conflicts:  ${result.conflicts}`);
            console.log(`  Failed:     ${result.failed}`);

            if (result.errors.length > 0) {
              console.log(chalk.yellow('\nWarnings:'));
              for (const err of result.errors) {
                console.log(chalk.yellow(`  - ${err}`));
              }
            }

            if (result.conflicts > 0) {
              console.log(chalk.yellow(`\nRun ${chalk.bold('cliaas sync conflicts')} to view and resolve conflicts.`));
            }
          },
        );
      } catch (err) {
        outputError(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  sync
    .command('conflicts')
    .description('List unresolved sync conflicts (hybrid mode)')
    .action(async () => {
      try {
        const { listConflicts } = await import('../sync/hybrid.js');
        const conflicts = await listConflicts();

        if (conflicts.length === 0) {
          if (isJsonMode()) {
            output({ conflicts: [] }, () => {});
          } else {
            console.log(chalk.green('\nNo unresolved conflicts.'));
          }
          return;
        }

        output(
          {
            conflicts: conflicts.map((c: { id: string; entityType: string; entityId: string; localUpdatedAt: string; hostedUpdatedAt: string; createdAt: string }) => ({
              id: c.id,
              entityType: c.entityType,
              entityId: c.entityId,
              localUpdatedAt: c.localUpdatedAt,
              hostedUpdatedAt: c.hostedUpdatedAt,
              detectedAt: c.createdAt,
            })),
          },
          () => {
            console.log(chalk.cyan(`\nUnresolved Conflicts (${conflicts.length}):\n`));
            for (const c of conflicts) {
              console.log(`  ${chalk.bold(c.id)}`);
              console.log(`    Entity:       ${c.entityType}/${c.entityId}`);
              console.log(`    Local at:     ${c.localUpdatedAt}`);
              console.log(`    Hosted at:    ${c.hostedUpdatedAt}`);
              console.log(`    Detected at:  ${c.createdAt}`);
              console.log('');
            }

            console.log(chalk.gray(`Resolve with: cliaas sync resolve <id> --keep local|hosted`));
          },
        );
      } catch (err) {
        outputError(`Failed to list conflicts: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  sync
    .command('resolve <id>')
    .description('Resolve a sync conflict by keeping local or hosted version')
    .requiredOption('--keep <version>', 'Which version to keep: local or hosted')
    .action(async (id: string, opts: { keep: string }) => {
      if (opts.keep !== 'local' && opts.keep !== 'hosted') {
        outputError('--keep must be "local" or "hosted"');
        process.exit(1);
      }

      try {
        const { resolveConflict } = await import('../sync/hybrid.js');
        const result = await resolveConflict(id, opts.keep as 'local' | 'hosted');

        if (result.resolved) {
          output(
            { resolved: true, id, kept: opts.keep },
            () => {
              console.log(chalk.green(`\nConflict ${id} resolved \u2014 keeping ${opts.keep} version.`));
              if (opts.keep === 'local') {
                console.log(chalk.gray('The local change has been re-queued. Run "cliaas sync push" to send it.'));
              }
            },
          );
        } else {
          outputError(`Failed to resolve: ${result.error}`);
          process.exit(1);
        }
      } catch (err) {
        outputError(`Resolve failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

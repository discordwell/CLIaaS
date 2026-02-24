import type { Command } from 'commander';
import chalk from 'chalk';
import { runSyncCycle, getSyncStatus, listConnectors } from '../sync/engine.js';
import { startSyncWorker } from '../sync/worker.js';

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
    .action(async (opts: { connector: string; full: boolean; out?: string }) => {
      try {
        console.log(chalk.cyan(`\nRunning sync cycle for ${opts.connector}...\n`));
        const stats = await runSyncCycle(opts.connector, {
          fullSync: opts.full,
          outDir: opts.out,
        });

        if (stats.error) {
          console.error(chalk.red(`\nSync error: ${stats.error}`));
          process.exit(1);
        }

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
      } catch (err) {
        console.error(chalk.red(`Sync failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  sync
    .command('start')
    .description('Start continuous sync worker for a connector')
    .requiredOption('--connector <name>', 'Connector name')
    .option('--interval <ms>', 'Sync interval in milliseconds', '300000')
    .option('--out <dir>', 'Output directory override')
    .action(async (opts: { connector: string; interval: string; out?: string }) => {
      const intervalMs = parseInt(opts.interval, 10);
      if (isNaN(intervalMs) || intervalMs < 10000) {
        console.error(chalk.red('Interval must be at least 10000ms (10 seconds)'));
        process.exit(1);
      }

      console.log(chalk.cyan(`\nStarting sync worker for ${opts.connector}`));
      console.log(chalk.gray(`  Interval: ${intervalMs}ms (${Math.round(intervalMs / 1000)}s)`));
      console.log(chalk.gray('  Press Ctrl+C to stop\n'));

      const handle = startSyncWorker(opts.connector, {
        intervalMs,
        outDir: opts.out,
        onCycle: (stats) => {
          console.log(
            chalk.green(`[${new Date().toISOString()}] Sync: ${stats.counts.tickets} tickets, ${stats.counts.messages} messages (${stats.durationMs}ms)`),
          );
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
        console.log(chalk.yellow('No connector data found.'));
        console.log(chalk.gray(`Supported connectors: ${connectors.join(', ')}`));
        return;
      }

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
    });

  // ---- Hybrid sync commands ----

  sync
    .command('pull')
    .description('Pull data from hosted API into local DB (hybrid mode)')
    .action(async () => {
      try {
        console.log(chalk.cyan('\nPulling from hosted API...\n'));
        const { syncPull } = await import('../sync/hybrid.js');
        const result = await syncPull();

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
      } catch (err) {
        console.error(chalk.red(`Pull failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  sync
    .command('push')
    .description('Push pending outbox changes to hosted API (hybrid mode)')
    .action(async () => {
      try {
        console.log(chalk.cyan('\nPushing outbox to hosted API...\n'));
        const { syncPush } = await import('../sync/hybrid.js');
        const result = await syncPush();

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
      } catch (err) {
        console.error(chalk.red(`Push failed: ${err instanceof Error ? err.message : err}`));
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
          console.log(chalk.green('\nNo unresolved conflicts.'));
          return;
        }

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
      } catch (err) {
        console.error(chalk.red(`Failed to list conflicts: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  sync
    .command('resolve <id>')
    .description('Resolve a sync conflict by keeping local or hosted version')
    .requiredOption('--keep <version>', 'Which version to keep: local or hosted')
    .action(async (id: string, opts: { keep: string }) => {
      if (opts.keep !== 'local' && opts.keep !== 'hosted') {
        console.error(chalk.red('--keep must be "local" or "hosted"'));
        process.exit(1);
      }

      try {
        const { resolveConflict } = await import('../sync/hybrid.js');
        const result = await resolveConflict(id, opts.keep as 'local' | 'hosted');

        if (result.resolved) {
          console.log(chalk.green(`\nConflict ${id} resolved — keeping ${opts.keep} version.`));
          if (opts.keep === 'local') {
            console.log(chalk.gray('The local change has been re-queued. Run "cliaas sync push" to send it.'));
          }
        } else {
          console.error(chalk.red(`\nFailed to resolve: ${result.error}`));
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(`Resolve failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

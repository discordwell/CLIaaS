import type { Command } from 'commander';
import chalk from 'chalk';
import { runZendeskIngest } from '../db/ingest-zendesk.js';

export function registerDbCommands(program: Command): void {
  const db = program
    .command('db')
    .description('Database operations: ingest exports into Postgres');

  db
    .command('ingest-zendesk')
    .description('Ingest a Zendesk export directory into Postgres')
    .option('--dir <dir>', 'Export directory', './exports/zendesk')
    .option('--tenant <name>', 'Tenant name', 'default')
    .option('--workspace <name>', 'Workspace name', 'default')
    .action(async (opts: { dir: string; tenant: string; workspace: string }) => {
      try {
        await runZendeskIngest(opts);
      } catch (err) {
        console.error(chalk.red(`Zendesk ingest failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

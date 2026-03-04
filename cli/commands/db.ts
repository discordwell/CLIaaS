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

  db
    .command('ingest')
    .description('Ingest any connector export directory into Postgres')
    .requiredOption('--dir <dir>', 'Export directory (e.g. ./exports/groove)')
    .requiredOption('--provider <name>', 'Provider name (e.g. groove, intercom, helpscout, zoho-desk, freshdesk)')
    .option('--tenant <name>', 'Tenant name', 'demo')
    .option('--workspace <name>', 'Workspace name', 'demo')
    .action(async (opts: { dir: string; provider: string; tenant: string; workspace: string }) => {
      const validProviders = ['zendesk','kayako','kayako-classic','helpcrunch','freshdesk','groove','intercom','helpscout','zoho-desk','hubspot'] as const;
      type Provider = typeof validProviders[number];
      if (!validProviders.includes(opts.provider as Provider)) {
        console.error(chalk.red(`Invalid provider: ${opts.provider}. Must be one of: ${validProviders.join(', ')}`));
        process.exit(1);
      }
      try {
        await runZendeskIngest({ dir: opts.dir, tenant: opts.tenant, workspace: opts.workspace, provider: opts.provider as Provider });
      } catch (err) {
        console.error(chalk.red(`Ingest failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

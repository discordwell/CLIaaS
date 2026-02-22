import type { Command } from 'commander';
import chalk from 'chalk';
import { exportZendesk, loadManifest } from '../connectors/zendesk.js';

export function registerZendeskCommands(program: Command): void {
  const zendesk = program
    .command('zendesk')
    .description('Zendesk data export and sync');

  zendesk
    .command('export')
    .description('Export all data from a Zendesk instance')
    .requiredOption('--subdomain <subdomain>', 'Zendesk subdomain (e.g., acme)')
    .requiredOption('--email <email>', 'Agent email address')
    .requiredOption('--token <token>', 'Zendesk API token')
    .option('--out <dir>', 'Output directory', './exports/zendesk')
    .action(async (opts: { subdomain: string; email: string; token: string; out: string }) => {
      try {
        const manifest = await exportZendesk(
          { subdomain: opts.subdomain, email: opts.email, token: opts.token },
          opts.out,
        );
        console.log(chalk.green('\nExport summary:'));
        console.log(`  Tickets:       ${manifest.counts.tickets}`);
        console.log(`  Messages:      ${manifest.counts.messages}`);
        console.log(`  Users:         ${manifest.counts.customers}`);
        console.log(`  Organizations: ${manifest.counts.organizations}`);
        console.log(`  KB Articles:   ${manifest.counts.kbArticles}`);
        console.log(`  Rules:         ${manifest.counts.rules}`);
      } catch (err) {
        console.error(chalk.red(`Export failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  zendesk
    .command('sync')
    .description('Incremental sync from cursor state')
    .requiredOption('--subdomain <subdomain>', 'Zendesk subdomain')
    .requiredOption('--email <email>', 'Agent email address')
    .requiredOption('--token <token>', 'Zendesk API token')
    .option('--out <dir>', 'Output directory', './exports/zendesk')
    .action(async (opts: { subdomain: string; email: string; token: string; out: string }) => {
      try {
        const existing = loadManifest(opts.out);
        if (!existing) {
          console.log(chalk.yellow('No previous export found. Running full export...'));
        }
        await exportZendesk(
          { subdomain: opts.subdomain, email: opts.email, token: opts.token },
          opts.out,
          existing?.cursorState,
        );
      } catch (err) {
        console.error(chalk.red(`Sync failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

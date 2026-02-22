import type { Command } from 'commander';
import chalk from 'chalk';
import { exportZendesk, loadManifest } from '../connectors/zendesk.js';

function resolveAuth(opts: { subdomain?: string; email?: string; token?: string }) {
  const subdomain = opts.subdomain ?? process.env.ZENDESK_SUBDOMAIN;
  const email = opts.email ?? process.env.ZENDESK_EMAIL;
  const token = opts.token ?? process.env.ZENDESK_TOKEN;

  if (!subdomain) { console.error(chalk.red('Missing --subdomain or ZENDESK_SUBDOMAIN env var')); process.exit(1); }
  if (!email) { console.error(chalk.red('Missing --email or ZENDESK_EMAIL env var')); process.exit(1); }
  if (!token) { console.error(chalk.red('Missing --token or ZENDESK_TOKEN env var')); process.exit(1); }

  return { subdomain, email, token };
}

export function registerZendeskCommands(program: Command): void {
  const zendesk = program
    .command('zendesk')
    .description('Zendesk data export and sync');

  zendesk
    .command('export')
    .description('Export all data from a Zendesk instance')
    .option('--subdomain <subdomain>', 'Zendesk subdomain (or ZENDESK_SUBDOMAIN env)')
    .option('--email <email>', 'Agent email (or ZENDESK_EMAIL env)')
    .option('--token <token>', 'API token (or ZENDESK_TOKEN env)')
    .option('--out <dir>', 'Output directory', './exports/zendesk')
    .action(async (opts: { subdomain?: string; email?: string; token?: string; out: string }) => {
      const auth = resolveAuth(opts);
      try {
        const manifest = await exportZendesk(auth, opts.out);
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
    .option('--subdomain <subdomain>', 'Zendesk subdomain (or ZENDESK_SUBDOMAIN env)')
    .option('--email <email>', 'Agent email (or ZENDESK_EMAIL env)')
    .option('--token <token>', 'API token (or ZENDESK_TOKEN env)')
    .option('--out <dir>', 'Output directory', './exports/zendesk')
    .action(async (opts: { subdomain?: string; email?: string; token?: string; out: string }) => {
      const auth = resolveAuth(opts);
      try {
        const existing = loadManifest(opts.out);
        if (!existing) {
          console.log(chalk.yellow('No previous export found. Running full export...'));
        }
        await exportZendesk(auth, opts.out, existing?.cursorState);
      } catch (err) {
        console.error(chalk.red(`Sync failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

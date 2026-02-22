import type { Command } from 'commander';
import chalk from 'chalk';
import { exportKayako } from '../connectors/kayako.js';

export function registerKayakoCommands(program: Command): void {
  const kayako = program
    .command('kayako')
    .description('Kayako data export');

  kayako
    .command('export')
    .description('Export all data from a Kayako instance')
    .requiredOption('--domain <domain>', 'Kayako domain (e.g., support.acme.com)')
    .requiredOption('--email <email>', 'Agent email address')
    .requiredOption('--password <password>', 'Kayako password')
    .option('--out <dir>', 'Output directory', './exports/kayako')
    .action(async (opts: { domain: string; email: string; password: string; out: string }) => {
      try {
        const manifest = await exportKayako(
          { domain: opts.domain, email: opts.email, password: opts.password },
          opts.out,
        );
        console.log(chalk.green('\nExport summary:'));
        console.log(`  Cases:         ${manifest.counts.tickets}`);
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
}

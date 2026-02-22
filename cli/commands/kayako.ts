import type { Command } from 'commander';
import chalk from 'chalk';
import { exportKayako } from '../connectors/kayako.js';

function resolveAuth(opts: { domain?: string; email?: string; password?: string }) {
  const domain = opts.domain ?? process.env.KAYAKO_DOMAIN;
  const email = opts.email ?? process.env.KAYAKO_EMAIL;
  const password = opts.password ?? process.env.KAYAKO_PASSWORD;

  if (!domain) { console.error(chalk.red('Missing --domain or KAYAKO_DOMAIN env var')); process.exit(1); }
  if (!email) { console.error(chalk.red('Missing --email or KAYAKO_EMAIL env var')); process.exit(1); }
  if (!password) { console.error(chalk.red('Missing --password or KAYAKO_PASSWORD env var')); process.exit(1); }

  return { domain, email, password };
}

export function registerKayakoCommands(program: Command): void {
  const kayako = program
    .command('kayako')
    .description('Kayako data export');

  kayako
    .command('export')
    .description('Export all data from a Kayako instance')
    .option('--domain <domain>', 'Kayako domain (or KAYAKO_DOMAIN env)')
    .option('--email <email>', 'Agent email (or KAYAKO_EMAIL env)')
    .option('--password <password>', 'Password (or KAYAKO_PASSWORD env)')
    .option('--out <dir>', 'Output directory', './exports/kayako')
    .action(async (opts: { domain?: string; email?: string; password?: string; out: string }) => {
      const auth = resolveAuth(opts);
      try {
        const manifest = await exportKayako(auth, opts.out);
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

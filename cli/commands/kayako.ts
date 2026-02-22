import type { Command } from 'commander';
import chalk from 'chalk';
import { exportKayako, kayakoUpdateCase, kayakoPostReply, kayakoPostNote, kayakoCreateCase, kayakoVerifyConnection } from '../connectors/kayako.js';
import type { KayakoAuth } from '../connectors/kayako.js';

function resolveAuth(opts: { domain?: string; email?: string; password?: string }): KayakoAuth {
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
    .description('Kayako operations: export, update, reply, create');

  kayako
    .command('verify')
    .description('Test Kayako API connectivity and authentication')
    .option('--domain <domain>', 'Kayako domain (or KAYAKO_DOMAIN env)')
    .option('--email <email>', 'Agent email (or KAYAKO_EMAIL env)')
    .option('--password <password>', 'Password (or KAYAKO_PASSWORD env)')
    .action(async (opts: { domain?: string; email?: string; password?: string }) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan(`\nVerifying connection to ${auth.domain}...\n`));

      const result = await kayakoVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  User:  ${result.userName}`);
        console.log(`  Cases: ${result.caseCount}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

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

  kayako
    .command('update')
    .description('Update a Kayako case')
    .requiredOption('--case <id>', 'Case ID')
    .option('--domain <domain>', 'Kayako domain (or KAYAKO_DOMAIN env)')
    .option('--email <email>', 'Agent email (or KAYAKO_EMAIL env)')
    .option('--password <password>', 'Password (or KAYAKO_PASSWORD env)')
    .option('--status <status>', 'New status (NEW, OPEN, PENDING, COMPLETED, CLOSED)')
    .option('--priority <priority>', 'New priority (LOW, NORMAL, HIGH, URGENT)')
    .option('--assignee <id>', 'Assigned agent ID')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (opts: {
      case: string; domain?: string; email?: string; password?: string;
      status?: string; priority?: string; assignee?: string; tags?: string;
    }) => {
      const auth = resolveAuth(opts);
      const caseId = parseInt(opts.case, 10);
      const updates: Parameters<typeof kayakoUpdateCase>[2] = {};
      if (opts.status) updates.status = opts.status;
      if (opts.priority) updates.priority = opts.priority;
      if (opts.assignee) updates.assigned_agent = parseInt(opts.assignee, 10);
      if (opts.tags) updates.tags = opts.tags.split(',').map(t => t.trim());

      if (!opts.status && !opts.priority && !opts.assignee && !opts.tags) {
        console.error(chalk.red('No updates specified. Use --status, --priority, --assignee, or --tags'));
        process.exit(1);
      }

      try {
        await kayakoUpdateCase(auth, caseId, updates);
        console.log(chalk.green(`Case #${caseId} updated successfully`));
      } catch (err) {
        console.error(chalk.red(`Update failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  kayako
    .command('reply')
    .description('Post a reply to a Kayako case')
    .requiredOption('--case <id>', 'Case ID')
    .requiredOption('--body <text>', 'Reply body text')
    .option('--domain <domain>', 'Kayako domain (or KAYAKO_DOMAIN env)')
    .option('--email <email>', 'Agent email (or KAYAKO_EMAIL env)')
    .option('--password <password>', 'Password (or KAYAKO_PASSWORD env)')
    .action(async (opts: {
      case: string; body: string; domain?: string; email?: string; password?: string;
    }) => {
      const auth = resolveAuth(opts);
      const caseId = parseInt(opts.case, 10);
      try {
        await kayakoPostReply(auth, caseId, opts.body);
        console.log(chalk.green(`Reply posted to case #${caseId}`));
      } catch (err) {
        console.error(chalk.red(`Reply failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  kayako
    .command('note')
    .description('Post an internal note to a Kayako case')
    .requiredOption('--case <id>', 'Case ID')
    .requiredOption('--body <text>', 'Note body text')
    .option('--domain <domain>', 'Kayako domain (or KAYAKO_DOMAIN env)')
    .option('--email <email>', 'Agent email (or KAYAKO_EMAIL env)')
    .option('--password <password>', 'Password (or KAYAKO_PASSWORD env)')
    .action(async (opts: {
      case: string; body: string; domain?: string; email?: string; password?: string;
    }) => {
      const auth = resolveAuth(opts);
      const caseId = parseInt(opts.case, 10);
      try {
        await kayakoPostNote(auth, caseId, opts.body);
        console.log(chalk.green(`Internal note posted to case #${caseId}`));
      } catch (err) {
        console.error(chalk.red(`Note failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  kayako
    .command('create')
    .description('Create a new Kayako case')
    .requiredOption('--subject <subject>', 'Case subject')
    .requiredOption('--body <text>', 'Case body')
    .option('--domain <domain>', 'Kayako domain (or KAYAKO_DOMAIN env)')
    .option('--email <email>', 'Agent email (or KAYAKO_EMAIL env)')
    .option('--password <password>', 'Password (or KAYAKO_PASSWORD env)')
    .option('--priority <priority>', 'Priority (LOW, NORMAL, HIGH, URGENT)')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (opts: {
      subject: string; body: string; domain?: string; email?: string; password?: string;
      priority?: string; tags?: string;
    }) => {
      const auth = resolveAuth(opts);
      try {
        const result = await kayakoCreateCase(auth, opts.subject, opts.body, {
          priority: opts.priority,
          tags: opts.tags?.split(',').map(t => t.trim()),
        });
        console.log(chalk.green(`Case #${result.id} created successfully`));
      } catch (err) {
        console.error(chalk.red(`Create failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

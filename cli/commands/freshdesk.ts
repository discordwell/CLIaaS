import type { Command } from 'commander';
import chalk from 'chalk';
import {
  exportFreshdesk, freshdeskVerifyConnection, freshdeskUpdateTicket,
  freshdeskReply, freshdeskAddNote, freshdeskCreateTicket,
} from '../connectors/freshdesk.js';
import type { FreshdeskAuth } from '../connectors/freshdesk.js';

function resolveAuth(opts: { subdomain?: string; apiKey?: string }): FreshdeskAuth {
  const subdomain = opts.subdomain ?? process.env.FRESHDESK_SUBDOMAIN;
  const apiKey = opts.apiKey ?? process.env.FRESHDESK_API_KEY;
  if (!subdomain) { console.error(chalk.red('Missing --subdomain or FRESHDESK_SUBDOMAIN env var')); process.exit(1); }
  if (!apiKey) { console.error(chalk.red('Missing --api-key or FRESHDESK_API_KEY env var')); process.exit(1); }
  return { subdomain, apiKey };
}

export function registerFreshdeskCommands(program: Command): void {
  const fd = program
    .command('freshdesk')
    .description('Freshdesk operations: export, verify, update, reply, note, create');

  fd.command('verify')
    .description('Test Freshdesk API connectivity')
    .option('--subdomain <subdomain>', 'Freshdesk subdomain (or FRESHDESK_SUBDOMAIN env)')
    .option('--api-key <key>', 'API key (or FRESHDESK_API_KEY env)')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan(`\nVerifying connection to ${auth.subdomain}.freshdesk.com...\n`));
      const result = await freshdeskVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  User:    ${result.userName}`);
        console.log(`  Tickets: ${result.ticketCount}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

  fd.command('export')
    .description('Export all data from Freshdesk')
    .option('--subdomain <subdomain>', 'Freshdesk subdomain (or FRESHDESK_SUBDOMAIN env)')
    .option('--api-key <key>', 'API key (or FRESHDESK_API_KEY env)')
    .option('--out <dir>', 'Output directory', './exports/freshdesk')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      try {
        const manifest = await exportFreshdesk(auth, opts.out);
        console.log(chalk.green('\nExport summary:'));
        console.log(`  Tickets:       ${manifest.counts.tickets}`);
        console.log(`  Messages:      ${manifest.counts.messages}`);
        console.log(`  Contacts:      ${manifest.counts.customers}`);
        console.log(`  Companies:     ${manifest.counts.organizations}`);
        console.log(`  KB Articles:   ${manifest.counts.kbArticles}`);
        console.log(`  Rules:         ${manifest.counts.rules}`);
      } catch (err) {
        console.error(chalk.red(`Export failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  fd.command('update')
    .description('Update a Freshdesk ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .option('--subdomain <subdomain>', 'Freshdesk subdomain (or FRESHDESK_SUBDOMAIN env)')
    .option('--api-key <key>', 'API key (or FRESHDESK_API_KEY env)')
    .option('--status <code>', 'Status code (2=Open, 3=Pending, 4=Resolved, 5=Closed)')
    .option('--priority <code>', 'Priority code (1=Low, 2=Medium, 3=High, 4=Urgent)')
    .option('--assignee <id>', 'Responder agent ID')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      const ticketId = parseInt(opts.ticket, 10);
      if (isNaN(ticketId)) { console.error(chalk.red('Invalid ticket ID')); process.exit(1); }
      const updates: Record<string, unknown> = {};
      if (opts.status) updates.status = parseInt(opts.status, 10);
      if (opts.priority) updates.priority = parseInt(opts.priority, 10);
      if (opts.assignee) updates.responder_id = parseInt(opts.assignee, 10);
      if (opts.tags) updates.tags = opts.tags.split(',').map((t: string) => t.trim());
      if (Object.keys(updates).length === 0) {
        console.error(chalk.red('No updates specified.')); process.exit(1);
      }
      try {
        await freshdeskUpdateTicket(auth, ticketId, updates);
        console.log(chalk.green(`Ticket #${ticketId} updated`));
      } catch (err) {
        console.error(chalk.red(`Update failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  fd.command('reply')
    .description('Reply to a Freshdesk ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .requiredOption('--body <text>', 'Reply body')
    .option('--subdomain <subdomain>', 'Freshdesk subdomain (or FRESHDESK_SUBDOMAIN env)')
    .option('--api-key <key>', 'API key (or FRESHDESK_API_KEY env)')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      try {
        await freshdeskReply(auth, parseInt(opts.ticket, 10), opts.body);
        console.log(chalk.green(`Reply posted to ticket #${opts.ticket}`));
      } catch (err) {
        console.error(chalk.red(`Reply failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  fd.command('note')
    .description('Add an internal note to a Freshdesk ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .requiredOption('--body <text>', 'Note body')
    .option('--subdomain <subdomain>', 'Freshdesk subdomain (or FRESHDESK_SUBDOMAIN env)')
    .option('--api-key <key>', 'API key (or FRESHDESK_API_KEY env)')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      try {
        await freshdeskAddNote(auth, parseInt(opts.ticket, 10), opts.body);
        console.log(chalk.green(`Note added to ticket #${opts.ticket}`));
      } catch (err) {
        console.error(chalk.red(`Note failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  fd.command('create')
    .description('Create a new Freshdesk ticket')
    .requiredOption('--subject <subject>', 'Ticket subject')
    .requiredOption('--body <text>', 'Ticket description')
    .option('--subdomain <subdomain>', 'Freshdesk subdomain (or FRESHDESK_SUBDOMAIN env)')
    .option('--api-key <key>', 'API key (or FRESHDESK_API_KEY env)')
    .option('--email <email>', 'Requester email')
    .option('--priority <code>', 'Priority (1=Low, 2=Medium, 3=High, 4=Urgent)')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      try {
        const result = await freshdeskCreateTicket(auth, opts.subject, opts.body, {
          email: opts.email,
          priority: opts.priority ? parseInt(opts.priority, 10) : undefined,
          tags: opts.tags?.split(',').map((t: string) => t.trim()),
        });
        console.log(chalk.green(`Ticket #${result.id} created`));
      } catch (err) {
        console.error(chalk.red(`Create failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

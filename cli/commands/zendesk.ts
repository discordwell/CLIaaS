import type { Command } from 'commander';
import chalk from 'chalk';
import { exportZendesk, loadManifest, zendeskUpdateTicket, zendeskPostComment, zendeskCreateTicket, zendeskVerifyConnection } from '../connectors/zendesk.js';
import type { ZendeskAuth } from '../connectors/zendesk.js';

function resolveAuth(opts: { subdomain?: string; email?: string; token?: string }): ZendeskAuth {
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
    .description('Zendesk operations: export, sync, update, reply, create');

  zendesk
    .command('verify')
    .description('Test Zendesk API connectivity and authentication')
    .option('--subdomain <subdomain>', 'Zendesk subdomain (or ZENDESK_SUBDOMAIN env)')
    .option('--email <email>', 'Agent email (or ZENDESK_EMAIL env)')
    .option('--token <token>', 'API token (or ZENDESK_TOKEN env)')
    .action(async (opts: { subdomain?: string; email?: string; token?: string }) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan(`\nVerifying connection to ${auth.subdomain}.zendesk.com...\n`));

      const result = await zendeskVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  User:    ${result.userName}`);
        console.log(`  Tickets: ${result.ticketCount}`);
        if (result.plan) console.log(`  Plan:    ${result.plan}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

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
        if (manifest.counts.attachments !== undefined) {
          console.log(`  Attachments:   ${manifest.counts.attachments}`);
        }
        console.log(`  Users:         ${manifest.counts.customers}`);
        console.log(`  Organizations: ${manifest.counts.organizations}`);
        console.log(`  KB Articles:   ${manifest.counts.kbArticles}`);
        console.log(`  Rules:         ${manifest.counts.rules}`);
        if (manifest.counts.groups !== undefined) {
          console.log(`  Groups:        ${manifest.counts.groups}`);
        }
        if (manifest.counts.customFields !== undefined) {
          console.log(`  Fields:        ${manifest.counts.customFields}`);
        }
        if (manifest.counts.views !== undefined) {
          console.log(`  Views:         ${manifest.counts.views}`);
        }
        if (manifest.counts.slaPolicies !== undefined) {
          console.log(`  SLA Policies:  ${manifest.counts.slaPolicies}`);
        }
        if (manifest.counts.ticketForms !== undefined) {
          console.log(`  Ticket Forms:  ${manifest.counts.ticketForms}`);
        }
        if (manifest.counts.brands !== undefined) {
          console.log(`  Brands:        ${manifest.counts.brands}`);
        }
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

  zendesk
    .command('update')
    .description('Update a Zendesk ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .option('--subdomain <subdomain>', 'Zendesk subdomain (or ZENDESK_SUBDOMAIN env)')
    .option('--email <email>', 'Agent email (or ZENDESK_EMAIL env)')
    .option('--token <token>', 'API token (or ZENDESK_TOKEN env)')
    .option('--status <status>', 'New status (open, pending, hold, solved, closed)')
    .option('--priority <priority>', 'New priority (low, normal, high, urgent)')
    .option('--assignee <id>', 'Assignee user ID')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (opts: {
      ticket: string; subdomain?: string; email?: string; token?: string;
      status?: string; priority?: string; assignee?: string; tags?: string;
    }) => {
      const auth = resolveAuth(opts);
      const ticketId = parseInt(opts.ticket, 10);
      const updates: Record<string, unknown> = {};
      if (opts.status) updates.status = opts.status;
      if (opts.priority) updates.priority = opts.priority;
      if (opts.assignee) updates.assignee_id = parseInt(opts.assignee, 10);
      if (opts.tags) updates.tags = opts.tags.split(',').map(t => t.trim());

      if (Object.keys(updates).length === 0) {
        console.error(chalk.red('No updates specified. Use --status, --priority, --assignee, or --tags'));
        process.exit(1);
      }

      try {
        await zendeskUpdateTicket(auth, ticketId, updates);
        console.log(chalk.green(`Ticket #${ticketId} updated successfully`));
      } catch (err) {
        console.error(chalk.red(`Update failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  zendesk
    .command('reply')
    .description('Post a reply or internal note to a Zendesk ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .requiredOption('--body <text>', 'Reply body text')
    .option('--subdomain <subdomain>', 'Zendesk subdomain (or ZENDESK_SUBDOMAIN env)')
    .option('--email <email>', 'Agent email (or ZENDESK_EMAIL env)')
    .option('--token <token>', 'API token (or ZENDESK_TOKEN env)')
    .option('--internal', 'Post as internal note (not visible to customer)', false)
    .action(async (opts: {
      ticket: string; body: string; subdomain?: string; email?: string; token?: string;
      internal: boolean;
    }) => {
      const auth = resolveAuth(opts);
      const ticketId = parseInt(opts.ticket, 10);
      try {
        await zendeskPostComment(auth, ticketId, opts.body, !opts.internal);
        console.log(chalk.green(`${opts.internal ? 'Internal note' : 'Reply'} posted to ticket #${ticketId}`));
      } catch (err) {
        console.error(chalk.red(`Reply failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  zendesk
    .command('create')
    .description('Create a new Zendesk ticket')
    .requiredOption('--subject <subject>', 'Ticket subject')
    .requiredOption('--body <text>', 'Ticket body')
    .option('--subdomain <subdomain>', 'Zendesk subdomain (or ZENDESK_SUBDOMAIN env)')
    .option('--email <email>', 'Agent email (or ZENDESK_EMAIL env)')
    .option('--token <token>', 'API token (or ZENDESK_TOKEN env)')
    .option('--priority <priority>', 'Priority (low, normal, high, urgent)')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--assignee <id>', 'Assignee user ID')
    .action(async (opts: {
      subject: string; body: string; subdomain?: string; email?: string; token?: string;
      priority?: string; tags?: string; assignee?: string;
    }) => {
      const auth = resolveAuth(opts);
      try {
        const result = await zendeskCreateTicket(auth, opts.subject, opts.body, {
          priority: opts.priority,
          tags: opts.tags?.split(',').map(t => t.trim()),
          assignee_id: opts.assignee ? parseInt(opts.assignee, 10) : undefined,
        });
        console.log(chalk.green(`Ticket #${result.id} created successfully`));
      } catch (err) {
        console.error(chalk.red(`Create failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

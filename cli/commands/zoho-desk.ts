import type { Command } from 'commander';
import chalk from 'chalk';
import { exportZohoDesk, zodeskVerifyConnection, zodeskCreateTicket, zodeskSendReply, zodeskAddComment } from '../connectors/zoho-desk.js';
import type { ZohoDeskAuth } from '../connectors/zoho-desk.js';

function resolveAuth(opts: { orgId?: string; accessToken?: string }): ZohoDeskAuth {
  const orgId = opts.orgId ?? process.env.ZOHO_DESK_ORG_ID;
  const accessToken = opts.accessToken ?? process.env.ZOHO_DESK_ACCESS_TOKEN;
  if (!orgId) { console.error(chalk.red('Missing --org-id or ZOHO_DESK_ORG_ID env var')); process.exit(1); }
  if (!accessToken) { console.error(chalk.red('Missing --access-token or ZOHO_DESK_ACCESS_TOKEN env var')); process.exit(1); }
  return { orgId, accessToken };
}

export function registerZohoDeskCommands(program: Command): void {
  const zoho = program
    .command('zoho-desk')
    .description('Zoho Desk operations: export, verify, create, reply, note');

  zoho
    .command('verify')
    .description('Test Zoho Desk API connectivity')
    .option('--org-id <id>', 'Organization ID (or ZOHO_DESK_ORG_ID env)')
    .option('--access-token <token>', 'OAuth access token (or ZOHO_DESK_ACCESS_TOKEN env)')
    .action(async (opts: { orgId?: string; accessToken?: string }) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan('\nVerifying Zoho Desk connection...\n'));

      const result = await zodeskVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  Org:    ${result.orgName}`);
        console.log(`  Agents: ${result.agentCount}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

  zoho
    .command('export')
    .description('Export all data from Zoho Desk')
    .option('--org-id <id>', 'Organization ID (or ZOHO_DESK_ORG_ID env)')
    .option('--access-token <token>', 'OAuth access token (or ZOHO_DESK_ACCESS_TOKEN env)')
    .option('-o, --out <dir>', 'Output directory', './exports/zoho-desk')
    .action(async (opts: { orgId?: string; accessToken?: string; out: string }) => {
      const auth = resolveAuth(opts);
      await exportZohoDesk(auth, opts.out);
    });

  zoho
    .command('create')
    .description('Create a new ticket')
    .option('--org-id <id>', 'Organization ID (or ZOHO_DESK_ORG_ID env)')
    .option('--access-token <token>', 'OAuth access token (or ZOHO_DESK_ACCESS_TOKEN env)')
    .requiredOption('--subject <text>', 'Ticket subject')
    .requiredOption('--body <text>', 'Ticket description')
    .option('--contact-id <id>', 'Contact ID')
    .option('--priority <level>', 'Priority (Low, Medium, High, Urgent)')
    .action(async (opts: { orgId?: string; accessToken?: string; subject: string; body: string; contactId?: string; priority?: string }) => {
      const auth = resolveAuth(opts);
      const result = await zodeskCreateTicket(auth, opts.subject, opts.body, {
        contactId: opts.contactId,
        priority: opts.priority,
      });
      console.log(chalk.green(`Ticket created: ${result.id}`));
    });

  zoho
    .command('reply')
    .description('Reply to a ticket')
    .option('--org-id <id>', 'Organization ID (or ZOHO_DESK_ORG_ID env)')
    .option('--access-token <token>', 'OAuth access token (or ZOHO_DESK_ACCESS_TOKEN env)')
    .requiredOption('--ticket-id <id>', 'Ticket ID')
    .requiredOption('--body <text>', 'Reply body')
    .action(async (opts: { orgId?: string; accessToken?: string; ticketId: string; body: string }) => {
      const auth = resolveAuth(opts);
      await zodeskSendReply(auth, opts.ticketId, opts.body);
      console.log(chalk.green('Reply sent'));
    });

  zoho
    .command('note')
    .description('Add an internal comment/note')
    .option('--org-id <id>', 'Organization ID (or ZOHO_DESK_ORG_ID env)')
    .option('--access-token <token>', 'OAuth access token (or ZOHO_DESK_ACCESS_TOKEN env)')
    .requiredOption('--ticket-id <id>', 'Ticket ID')
    .requiredOption('--body <text>', 'Note body')
    .action(async (opts: { orgId?: string; accessToken?: string; ticketId: string; body: string }) => {
      const auth = resolveAuth(opts);
      await zodeskAddComment(auth, opts.ticketId, opts.body, false);
      console.log(chalk.green('Note added'));
    });
}

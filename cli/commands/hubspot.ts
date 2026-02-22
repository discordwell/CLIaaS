import type { Command } from 'commander';
import chalk from 'chalk';
import { exportHubSpot, hubspotVerifyConnection, hubspotCreateTicket, hubspotCreateNote } from '../connectors/hubspot.js';
import type { HubSpotAuth } from '../connectors/hubspot.js';

function resolveAuth(opts: { accessToken?: string }): HubSpotAuth {
  const accessToken = opts.accessToken ?? process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) { console.error(chalk.red('Missing --access-token or HUBSPOT_ACCESS_TOKEN env var')); process.exit(1); }
  return { accessToken };
}

export function registerHubSpotCommands(program: Command): void {
  const hubspot = program
    .command('hubspot')
    .description('HubSpot Service Hub operations: export, verify, create, note');

  hubspot
    .command('verify')
    .description('Test HubSpot API connectivity')
    .option('--access-token <token>', 'Private app access token (or HUBSPOT_ACCESS_TOKEN env)')
    .action(async (opts: { accessToken?: string }) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan('\nVerifying HubSpot connection...\n'));

      const result = await hubspotVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  Portal: ${result.portalId}`);
        console.log(`  Owners: ${result.ownerCount}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

  hubspot
    .command('export')
    .description('Export all data from HubSpot Service Hub')
    .option('--access-token <token>', 'Private app access token (or HUBSPOT_ACCESS_TOKEN env)')
    .option('-o, --out <dir>', 'Output directory', './exports/hubspot')
    .action(async (opts: { accessToken?: string; out: string }) => {
      const auth = resolveAuth(opts);
      await exportHubSpot(auth, opts.out);
    });

  hubspot
    .command('create')
    .description('Create a new ticket')
    .option('--access-token <token>', 'Private app access token (or HUBSPOT_ACCESS_TOKEN env)')
    .requiredOption('--subject <text>', 'Ticket subject')
    .requiredOption('--body <text>', 'Ticket content')
    .option('--priority <level>', 'Priority (LOW, MEDIUM, HIGH)')
    .option('--owner-id <id>', 'Owner ID')
    .action(async (opts: { accessToken?: string; subject: string; body: string; priority?: string; ownerId?: string }) => {
      const auth = resolveAuth(opts);
      const result = await hubspotCreateTicket(auth, opts.subject, opts.body, {
        priority: opts.priority,
        ownerId: opts.ownerId,
      });
      console.log(chalk.green(`Ticket created: ${result.id}`));
    });

  hubspot
    .command('note')
    .description('Add a note to a ticket')
    .option('--access-token <token>', 'Private app access token (or HUBSPOT_ACCESS_TOKEN env)')
    .requiredOption('--ticket-id <id>', 'Ticket ID')
    .requiredOption('--body <text>', 'Note body')
    .option('--owner-id <id>', 'Owner ID')
    .action(async (opts: { accessToken?: string; ticketId: string; body: string; ownerId?: string }) => {
      const auth = resolveAuth(opts);
      const result = await hubspotCreateNote(auth, opts.ticketId, opts.body, {
        ownerId: opts.ownerId,
      });
      console.log(chalk.green(`Note added: ${result.id}`));
    });
}

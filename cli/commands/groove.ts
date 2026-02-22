import type { Command } from 'commander';
import chalk from 'chalk';
import {
  exportGroove, grooveVerifyConnection, grooveUpdateTicket,
  groovePostMessage, grooveCreateTicket,
} from '../connectors/groove.js';
import type { GrooveAuth } from '../connectors/groove.js';

function resolveAuth(opts: { apiToken?: string }): GrooveAuth {
  const apiToken = opts.apiToken ?? process.env.GROOVE_API_TOKEN;
  if (!apiToken) {
    console.error(chalk.red('Missing --api-token or GROOVE_API_TOKEN env var'));
    process.exit(1);
  }
  return { apiToken };
}

export function registerGrooveCommands(program: Command): void {
  const gv = program
    .command('groove')
    .description('Groove operations: export, verify, update, reply, create');

  gv.command('verify')
    .description('Test Groove API connectivity')
    .option('--api-token <token>', 'API token (or GROOVE_API_TOKEN env)')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan('\nVerifying Groove connection...\n'));
      const result = await grooveVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  Agents: ${result.agentCount}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

  gv.command('export')
    .description('Export all data from Groove')
    .option('--api-token <token>', 'API token (or GROOVE_API_TOKEN env)')
    .option('--out <dir>', 'Output directory', './exports/groove')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      try {
        const manifest = await exportGroove(auth, opts.out);
        console.log(chalk.green('\nExport summary:'));
        console.log(`  Tickets:       ${manifest.counts.tickets}`);
        console.log(`  Messages:      ${manifest.counts.messages}`);
        console.log(`  Customers:     ${manifest.counts.customers}`);
        console.log(`  Organizations: ${manifest.counts.organizations}`);
        console.log(`  KB Articles:   ${manifest.counts.kbArticles}`);
        console.log(`  Rules:         ${manifest.counts.rules}`);
      } catch (err) {
        console.error(chalk.red(`Export failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  gv.command('update')
    .description('Update a Groove ticket')
    .requiredOption('--ticket <number>', 'Ticket number')
    .option('--api-token <token>', 'API token (or GROOVE_API_TOKEN env)')
    .option('--state <state>', 'State (unread, opened, pending, closed)')
    .option('--assignee <email>', 'Assignee agent email')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      const ticketNum = parseInt(opts.ticket, 10);
      if (isNaN(ticketNum)) { console.error(chalk.red('Invalid ticket number')); process.exit(1); }
      const updates: { state?: string; assignee?: string; tags?: string[] } = {};
      if (opts.state) updates.state = opts.state;
      if (opts.assignee) updates.assignee = opts.assignee;
      if (opts.tags) updates.tags = opts.tags.split(',').map((t: string) => t.trim());
      if (Object.keys(updates).length === 0) {
        console.error(chalk.red('No updates specified.')); process.exit(1);
      }
      try {
        await grooveUpdateTicket(auth, ticketNum, updates);
        console.log(chalk.green(`Ticket #${ticketNum} updated`));
      } catch (err) {
        console.error(chalk.red(`Update failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  gv.command('reply')
    .description('Reply to a Groove ticket')
    .requiredOption('--ticket <number>', 'Ticket number')
    .requiredOption('--body <text>', 'Message body')
    .option('--api-token <token>', 'API token (or GROOVE_API_TOKEN env)')
    .option('--note', 'Post as internal note', false)
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      try {
        await groovePostMessage(auth, parseInt(opts.ticket, 10), opts.body, opts.note);
        console.log(chalk.green(`${opts.note ? 'Note' : 'Reply'} posted to ticket #${opts.ticket}`));
      } catch (err) {
        console.error(chalk.red(`Reply failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  gv.command('create')
    .description('Create a new Groove ticket')
    .requiredOption('--to <email>', 'Customer email')
    .requiredOption('--body <text>', 'Message body')
    .option('--api-token <token>', 'API token (or GROOVE_API_TOKEN env)')
    .option('--subject <subject>', 'Ticket subject')
    .option('--assignee <email>', 'Assignee agent email')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (opts) => {
      const auth = resolveAuth(opts);
      try {
        const result = await grooveCreateTicket(auth, opts.to, opts.body, {
          subject: opts.subject,
          assignee: opts.assignee,
          tags: opts.tags?.split(',').map((t: string) => t.trim()),
        });
        console.log(chalk.green(`Ticket #${result.number} created`));
      } catch (err) {
        console.error(chalk.red(`Create failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

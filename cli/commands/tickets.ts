import type { Command } from 'commander';
import chalk from 'chalk';
import { loadTickets, loadMessages, getTicketMessages } from '../data.js';

export function registerTicketCommands(program: Command): void {
  const tickets = program
    .command('tickets')
    .description('View and manage exported tickets');

  tickets
    .command('list')
    .description('List tickets from exported data')
    .option('--dir <dir>', 'Export directory')
    .option('--status <status>', 'Filter by status (open, pending, solved, closed)')
    .option('--priority <priority>', 'Filter by priority (low, normal, high, urgent)')
    .option('--assignee <name>', 'Filter by assignee')
    .option('--limit <n>', 'Max tickets to show', '25')
    .action((opts: { dir?: string; status?: string; priority?: string; assignee?: string; limit: string }) => {
      let tickets = loadTickets(opts.dir);

      if (opts.status) tickets = tickets.filter(t => t.status === opts.status);
      if (opts.priority) tickets = tickets.filter(t => t.priority === opts.priority);
      if (opts.assignee) tickets = tickets.filter(t => t.assignee?.toLowerCase().includes(opts.assignee!.toLowerCase()));

      const limit = parseInt(opts.limit, 10);
      const display = tickets.slice(0, limit);

      if (display.length === 0) {
        console.log(chalk.yellow('No tickets found matching filters.'));
        return;
      }

      console.log(chalk.cyan(`Showing ${display.length} of ${tickets.length} tickets\n`));

      // Table header
      const header = `${'ID'.padEnd(14)} ${'STATUS'.padEnd(10)} ${'PRI'.padEnd(8)} ${'ASSIGNEE'.padEnd(16)} SUBJECT`;
      console.log(chalk.bold(header));
      console.log('─'.repeat(80));

      for (const t of display) {
        const priColor = t.priority === 'urgent' ? chalk.red : t.priority === 'high' ? chalk.yellow : chalk.white;
        const statusColor = t.status === 'open' ? chalk.green : t.status === 'pending' ? chalk.yellow : chalk.gray;

        console.log(
          `${t.id.padEnd(14)} ${statusColor(t.status.padEnd(10))} ${priColor(t.priority.padEnd(8))} ${(t.assignee ?? '—').padEnd(16)} ${t.subject.slice(0, 40)}`
        );
      }
    });

  tickets
    .command('show')
    .description('Show ticket details with conversation thread')
    .argument('<id>', 'Ticket ID')
    .option('--dir <dir>', 'Export directory')
    .action((id: string, opts: { dir?: string }) => {
      const tickets = loadTickets(opts.dir);
      const messages = loadMessages(opts.dir);

      const ticket = tickets.find(t => t.id === id || t.externalId === id);
      if (!ticket) {
        console.error(chalk.red(`Ticket not found: ${id}`));
        process.exit(1);
      }

      console.log(chalk.cyan.bold(`\n${ticket.subject}`));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(`ID:         ${ticket.id} (external: ${ticket.externalId})`);
      console.log(`Source:     ${ticket.source}`);
      console.log(`Status:     ${ticket.status}`);
      console.log(`Priority:   ${ticket.priority}`);
      console.log(`Requester:  ${ticket.requester}`);
      console.log(`Assignee:   ${ticket.assignee ?? 'Unassigned'}`);
      console.log(`Tags:       ${ticket.tags.join(', ') || 'none'}`);
      console.log(`Created:    ${ticket.createdAt}`);
      console.log(`Updated:    ${ticket.updatedAt}`);

      const threadMessages = getTicketMessages(ticket.id, messages);
      if (threadMessages.length > 0) {
        console.log(chalk.cyan(`\n--- Conversation (${threadMessages.length} messages) ---\n`));
        for (const m of threadMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
          const typeTag = m.type === 'note' ? chalk.yellow('[NOTE]') : chalk.blue('[REPLY]');
          console.log(`${typeTag} ${chalk.bold(m.author)} — ${chalk.gray(m.createdAt)}`);
          console.log(m.body);
          console.log(chalk.gray('---'));
        }
      }
    });
}

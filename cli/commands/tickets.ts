import type { Command } from 'commander';
import chalk from 'chalk';
import { loadTickets, loadMessages, getTicketMessages } from '../data.js';
import { output, outputError, isJsonMode } from '../output.js';

export function registerTicketCommands(program: Command): void {
  const tickets = program
    .command('tickets')
    .description('View, search, and manage exported tickets');

  tickets
    .command('list')
    .description('List tickets from exported data')
    .option('--dir <dir>', 'Export directory')
    .option('--status <status>', 'Filter by status (open, pending, solved, closed)')
    .option('--priority <priority>', 'Filter by priority (low, normal, high, urgent)')
    .option('--assignee <name>', 'Filter by assignee')
    .option('--tag <tag>', 'Filter by tag')
    .option('--source <source>', 'Filter by source (zendesk, kayako)')
    .option('--sort <field>', 'Sort by field: created, updated, priority', 'updated')
    .option('--limit <n>', 'Max tickets to show', '25')
    .action((opts: { dir?: string; status?: string; priority?: string; assignee?: string; tag?: string; source?: string; sort: string; limit: string }) => {
      let filtered = loadTickets(opts.dir);

      if (opts.status) filtered = filtered.filter(t => t.status === opts.status);
      if (opts.priority) filtered = filtered.filter(t => t.priority === opts.priority);
      if (opts.assignee) filtered = filtered.filter(t => t.assignee?.toLowerCase().includes(opts.assignee!.toLowerCase()));
      if (opts.tag) filtered = filtered.filter(t => t.tags.some(tag => tag.toLowerCase().includes(opts.tag!.toLowerCase())));
      if (opts.source) filtered = filtered.filter(t => t.source === opts.source);

      // Sort
      const priWeight: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      if (opts.sort === 'priority') {
        filtered.sort((a, b) => (priWeight[a.priority] ?? 2) - (priWeight[b.priority] ?? 2));
      } else if (opts.sort === 'created') {
        filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      } else {
        filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      }

      const limit = parseInt(opts.limit, 10);
      const display = filtered.slice(0, limit);

      if (display.length === 0) {
        if (isJsonMode()) {
          output({ tickets: [], total: 0 }, () => {});
        } else {
          console.log(chalk.yellow('No tickets found matching filters.'));
        }
        return;
      }

      output(
        {
          tickets: display.map(t => ({
            id: t.id,
            externalId: t.externalId,
            status: t.status,
            priority: t.priority,
            assignee: t.assignee ?? null,
            subject: t.subject,
            requester: t.requester,
            source: t.source,
            tags: t.tags,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
          })),
          total: filtered.length,
          showing: display.length,
        },
        () => {
          console.log(chalk.cyan(`Showing ${display.length} of ${filtered.length} tickets\n`));

          const header = `${'ID'.padEnd(14)} ${'STATUS'.padEnd(10)} ${'PRI'.padEnd(8)} ${'ASSIGNEE'.padEnd(20)} SUBJECT`;
          console.log(chalk.bold(header));
          console.log('\u2500'.repeat(90));

          for (const t of display) {
            const priColor = t.priority === 'urgent' ? chalk.red : t.priority === 'high' ? chalk.yellow : chalk.white;
            const statusColor = t.status === 'open' ? chalk.green : t.status === 'pending' ? chalk.yellow : chalk.gray;

            console.log(
              `${t.id.padEnd(14)} ${statusColor(t.status.padEnd(10))} ${priColor(t.priority.padEnd(8))} ${(t.assignee ?? '\u2014').padEnd(20)} ${t.subject.slice(0, 40)}`
            );
          }
        },
      );
    });

  tickets
    .command('search')
    .description('Full-text search across tickets and messages')
    .argument('<query>', 'Search query')
    .option('--dir <dir>', 'Export directory')
    .option('--limit <n>', 'Max results', '20')
    .action((query: string, opts: { dir?: string; limit: string }) => {
      const allTickets = loadTickets(opts.dir);
      const allMessages = loadMessages(opts.dir);
      const lower = query.toLowerCase();
      const limit = parseInt(opts.limit, 10);

      // Search tickets by subject, tags, requester
      const ticketMatches = allTickets.filter(t =>
        t.subject.toLowerCase().includes(lower) ||
        t.tags.some(tag => tag.toLowerCase().includes(lower)) ||
        t.requester.toLowerCase().includes(lower) ||
        (t.assignee?.toLowerCase().includes(lower) ?? false)
      );

      // Search messages by body content
      const messageMatches = allMessages.filter(m =>
        m.body.toLowerCase().includes(lower)
      );

      // Unique ticket IDs from message matches
      const messageTicketIds = new Set(messageMatches.map(m => m.ticketId));
      const fromMessages = allTickets.filter(t => messageTicketIds.has(t.id) && !ticketMatches.find(tm => tm.id === t.id));

      const combined = [...ticketMatches, ...fromMessages].slice(0, limit);

      if (combined.length === 0) {
        if (isJsonMode()) {
          output({ results: [], query, ticketMatches: 0, messageMatches: 0 }, () => {});
        } else {
          console.log(chalk.yellow(`No results for "${query}"`));
        }
        return;
      }

      output(
        {
          results: combined.map(t => ({
            id: t.id,
            externalId: t.externalId,
            status: t.status,
            priority: t.priority,
            matchType: ticketMatches.includes(t) ? 'ticket' : 'message',
            subject: t.subject,
            assignee: t.assignee ?? null,
          })),
          query,
          ticketMatches: ticketMatches.length,
          messageMatches: fromMessages.length,
        },
        () => {
          console.log(chalk.cyan(`Found ${ticketMatches.length} ticket matches + ${fromMessages.length} message matches for "${query}"\n`));

          const header = `${'ID'.padEnd(14)} ${'STATUS'.padEnd(10)} ${'PRI'.padEnd(8)} ${'MATCH'.padEnd(8)} SUBJECT`;
          console.log(chalk.bold(header));
          console.log('\u2500'.repeat(80));

          for (const t of combined) {
            const isDirectMatch = ticketMatches.includes(t);
            const matchType = isDirectMatch ? chalk.green('ticket') : chalk.blue('msg');
            const priColor = t.priority === 'urgent' ? chalk.red : t.priority === 'high' ? chalk.yellow : chalk.white;
            const statusColor = t.status === 'open' ? chalk.green : t.status === 'pending' ? chalk.yellow : chalk.gray;

            console.log(
              `${t.id.padEnd(14)} ${statusColor(t.status.padEnd(10))} ${priColor(t.priority.padEnd(8))} ${matchType.padEnd(8)} ${t.subject.slice(0, 40)}`
            );

            // Show matching message snippet
            if (!isDirectMatch) {
              const matchingMsg = messageMatches.find(m => m.ticketId === t.id);
              if (matchingMsg) {
                const idx = matchingMsg.body.toLowerCase().indexOf(lower);
                const start = Math.max(0, idx - 30);
                const end = Math.min(matchingMsg.body.length, idx + query.length + 30);
                const snippet = (start > 0 ? '...' : '') + matchingMsg.body.slice(start, end) + (end < matchingMsg.body.length ? '...' : '');
                console.log(chalk.gray(`  \u2514\u2500 "${snippet.replace(/\n/g, ' ')}"`));
              }
            }
          }
        },
      );
    });

  tickets
    .command('show')
    .description('Show ticket details with conversation thread')
    .argument('<id>', 'Ticket ID')
    .option('--dir <dir>', 'Export directory')
    .action((id: string, opts: { dir?: string }) => {
      const allTickets = loadTickets(opts.dir);
      const messages = loadMessages(opts.dir);

      const ticket = allTickets.find(t => t.id === id || t.externalId === id);
      if (!ticket) {
        outputError(`Ticket not found: ${id}`);
        process.exit(1);
      }

      const threadMessages = getTicketMessages(ticket.id, messages)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      output(
        {
          ticket: {
            id: ticket.id,
            externalId: ticket.externalId,
            source: ticket.source,
            subject: ticket.subject,
            status: ticket.status,
            priority: ticket.priority,
            requester: ticket.requester,
            assignee: ticket.assignee ?? null,
            tags: ticket.tags,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
          },
          messages: threadMessages.map(m => ({
            id: m.id,
            author: m.author,
            type: m.type,
            body: m.body,
            createdAt: m.createdAt,
          })),
        },
        () => {
          console.log(chalk.cyan.bold(`\n${ticket.subject}`));
          console.log(chalk.gray('\u2500'.repeat(60)));
          console.log(`ID:         ${ticket.id} (external: ${ticket.externalId})`);
          console.log(`Source:     ${ticket.source}`);
          console.log(`Status:     ${ticket.status}`);
          console.log(`Priority:   ${ticket.priority}`);
          console.log(`Requester:  ${ticket.requester}`);
          console.log(`Assignee:   ${ticket.assignee ?? 'Unassigned'}`);
          console.log(`Tags:       ${ticket.tags.join(', ') || 'none'}`);
          console.log(`Created:    ${ticket.createdAt}`);
          console.log(`Updated:    ${ticket.updatedAt}`);

          if (threadMessages.length > 0) {
            console.log(chalk.cyan(`\n--- Conversation (${threadMessages.length} messages) ---\n`));
            for (const m of threadMessages) {
              const typeTag = m.type === 'note' ? chalk.yellow('[NOTE]') : chalk.blue('[REPLY]');
              console.log(`${typeTag} ${chalk.bold(m.author)} \u2014 ${chalk.gray(m.createdAt)}`);
              console.log(m.body);
              console.log(chalk.gray('---'));
            }
          }
        },
      );
    });
}

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

  tickets
    .command('merge')
    .description('Merge duplicate tickets into one primary ticket')
    .requiredOption('--ids <ids>', 'Comma-separated ticket IDs to merge')
    .option('--primary <id>', 'Primary ticket ID (default: oldest)')
    .option('--dry-run', 'Show what would be merged without executing')
    .option('--json', 'Output as JSON')
    .action(async (opts: { ids: string; primary?: string; dryRun?: boolean; json?: boolean }) => {
      const allIds = opts.ids.split(',').map(id => id.trim()).filter(Boolean);
      if (allIds.length < 2) {
        outputError('At least 2 ticket IDs are required for merge.');
        process.exit(1);
      }

      const allTickets = loadTickets();
      const matched = allIds.map(id => allTickets.find(t => t.id === id || t.externalId === id));
      const missing = allIds.filter((_, i) => !matched[i]);
      if (missing.length > 0) {
        outputError(`Tickets not found: ${missing.join(', ')}`);
        process.exit(1);
      }

      // Determine primary (oldest by default)
      const tickets = matched.filter(Boolean) as typeof allTickets;
      let primaryId = opts.primary;
      if (!primaryId) {
        tickets.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        primaryId = tickets[0].id;
      }

      const mergedIds = tickets.filter(t => t.id !== primaryId).map(t => t.id);
      const primary = tickets.find(t => t.id === primaryId)!;

      if (opts.dryRun) {
        const preview = {
          action: 'merge',
          primaryTicket: { id: primary.id, externalId: primary.externalId, subject: primary.subject },
          merging: mergedIds.map(id => {
            const t = tickets.find(tt => tt.id === id)!;
            return { id: t.id, externalId: t.externalId, subject: t.subject };
          }),
        };

        if (opts.json || isJsonMode()) {
          output(preview, () => {});
        } else {
          console.log(chalk.cyan('DRY RUN — Merge Preview'));
          console.log(`Primary: #${primary.externalId} — ${primary.subject}`);
          for (const id of mergedIds) {
            const t = tickets.find(tt => tt.id === id)!;
            console.log(`  Merge: #${t.externalId} — ${t.subject}`);
          }
        }
        return;
      }

      try {
        const { getDataProvider } = await import('@/lib/data-provider/index.js');
        const provider = await getDataProvider();
        const result = await provider.mergeTickets({
          primaryTicketId: primaryId,
          mergedTicketIds: mergedIds,
        });

        output(result, () => {
          console.log(chalk.green(`Merged ${result.mergedCount} ticket(s) into #${primary.externalId}`));
          console.log(`Messages moved: ${result.movedMessageCount}`);
          if (result.mergedTags.length > 0) {
            console.log(`Tags merged: ${result.mergedTags.join(', ')}`);
          }
        });
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Merge failed');
        process.exit(1);
      }
    });

  tickets
    .command('split')
    .description('Split messages from a ticket into a new ticket')
    .requiredOption('--ticket <id>', 'Source ticket ID')
    .requiredOption('--messages <ids>', 'Comma-separated message IDs to move')
    .option('--subject <subject>', 'Subject for the new ticket')
    .option('--dry-run', 'Show what would be split without executing')
    .option('--json', 'Output as JSON')
    .action(async (opts: { ticket: string; messages: string; subject?: string; dryRun?: boolean; json?: boolean }) => {
      const messageIds = opts.messages.split(',').map(id => id.trim()).filter(Boolean);
      if (messageIds.length === 0) {
        outputError('At least one message ID is required for split.');
        process.exit(1);
      }

      const allTickets = loadTickets();
      const ticket = allTickets.find(t => t.id === opts.ticket || t.externalId === opts.ticket);
      if (!ticket) {
        outputError(`Ticket not found: ${opts.ticket}`);
        process.exit(1);
      }

      if (opts.dryRun) {
        const preview = {
          action: 'split',
          sourceTicket: { id: ticket.id, externalId: ticket.externalId, subject: ticket.subject },
          messageCount: messageIds.length,
          newSubject: opts.subject ?? `Split from: ${ticket.subject}`,
        };

        if (opts.json || isJsonMode()) {
          output(preview, () => {});
        } else {
          console.log(chalk.cyan('DRY RUN — Split Preview'));
          console.log(`Source: #${ticket.externalId} — ${ticket.subject}`);
          console.log(`Messages to split: ${messageIds.length}`);
          console.log(`New subject: ${opts.subject ?? `Split from: ${ticket.subject}`}`);
        }
        return;
      }

      try {
        const { getDataProvider } = await import('@/lib/data-provider/index.js');
        const provider = await getDataProvider();
        const result = await provider.splitTicket({
          ticketId: ticket.id,
          messageIds,
          newSubject: opts.subject,
        });

        output(result, () => {
          console.log(chalk.green(`Split ${result.movedMessageCount} message(s) into new ticket ${result.newTicketId}`));
        });
      } catch (err) {
        outputError(err instanceof Error ? err.message : 'Split failed');
        process.exit(1);
      }
    });
}

import type { Command } from 'commander';
import { writeFileSync } from 'fs';
import ora from 'ora';
import { loadTickets, loadMessages, loadKBArticles } from '../data.js';

export function registerExportCommand(program: Command): void {
  const exp = program
    .command('export')
    .description('Export local data to CSV or Markdown');

  exp
    .command('csv')
    .description('Export tickets to CSV')
    .option('--dir <dir>', 'Export directory (source)')
    .option('--out <file>', 'Output CSV file', './tickets.csv')
    .option('--include-messages', 'Include message bodies as additional rows')
    .action((opts: { dir?: string; out: string; includeMessages?: boolean }) => {
      const spinner = ora('Exporting to CSV...').start();
      const tickets = loadTickets(opts.dir);

      if (tickets.length === 0) {
        spinner.fail('No tickets found.');
        return;
      }

      const headers = ['id', 'external_id', 'source', 'subject', 'status', 'priority', 'assignee', 'requester', 'tags', 'created_at', 'updated_at'];
      const rows = [headers.join(',')];

      for (const t of tickets) {
        rows.push([
          csvEscape(t.id),
          csvEscape(t.externalId),
          t.source,
          csvEscape(t.subject),
          t.status,
          t.priority,
          csvEscape(t.assignee ?? ''),
          csvEscape(t.requester),
          csvEscape(t.tags.join('; ')),
          t.createdAt,
          t.updatedAt,
        ].join(','));
      }

      if (opts.includeMessages) {
        const messages = loadMessages(opts.dir);
        rows.push('');
        rows.push(['message_id', 'ticket_id', 'author', 'type', 'body', 'created_at'].join(','));
        for (const m of messages) {
          rows.push([
            csvEscape(m.id),
            csvEscape(m.ticketId),
            csvEscape(m.author),
            m.type,
            csvEscape(m.body),
            m.createdAt,
          ].join(','));
        }
      }

      writeFileSync(opts.out, rows.join('\n') + '\n');
      spinner.succeed(`${tickets.length} tickets exported to ${opts.out}`);
    });

  exp
    .command('markdown')
    .description('Export tickets to a Markdown report')
    .option('--dir <dir>', 'Export directory (source)')
    .option('--out <file>', 'Output Markdown file', './report.md')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Max tickets', '50')
    .action((opts: { dir?: string; out: string; status?: string; limit: string }) => {
      const spinner = ora('Generating Markdown report...').start();
      let tickets = loadTickets(opts.dir);
      const messages = loadMessages(opts.dir);
      const articles = loadKBArticles(opts.dir);

      if (opts.status) tickets = tickets.filter(t => t.status === opts.status);
      const limit = parseInt(opts.limit, 10);
      tickets = tickets.slice(0, limit);

      if (tickets.length === 0) {
        spinner.fail('No tickets found.');
        return;
      }

      const lines: string[] = [
        '# CLIaaS Ticket Report',
        '',
        `Generated: ${new Date().toISOString()}`,
        `Total tickets: ${tickets.length}`,
        '',
        '## Summary',
        '',
        `| Status | Count |`,
        `|--------|-------|`,
      ];

      const statusCounts: Record<string, number> = {};
      for (const t of tickets) statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
      for (const [s, c] of Object.entries(statusCounts)) {
        lines.push(`| ${s} | ${c} |`);
      }

      lines.push('', '## Tickets', '');

      for (const t of tickets) {
        lines.push(`### #${t.externalId}: ${t.subject}`);
        lines.push('');
        lines.push(`- **Status:** ${t.status}`);
        lines.push(`- **Priority:** ${t.priority}`);
        lines.push(`- **Assignee:** ${t.assignee ?? 'Unassigned'}`);
        lines.push(`- **Requester:** ${t.requester}`);
        lines.push(`- **Tags:** ${t.tags.join(', ') || 'none'}`);
        lines.push(`- **Created:** ${t.createdAt}`);
        lines.push('');

        const ticketMessages = messages.filter(m => m.ticketId === t.id);
        if (ticketMessages.length > 0) {
          lines.push('**Conversation:**');
          lines.push('');
          for (const m of ticketMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
            lines.push(`> **${m.author}** (${m.type}) — ${m.createdAt}`);
            lines.push(`> ${m.body.replace(/\n/g, '\n> ')}`);
            lines.push('');
          }
        }

        lines.push('---');
        lines.push('');
      }

      if (articles.length > 0) {
        lines.push('## Knowledge Base Articles', '');
        for (const a of articles) {
          lines.push(`### ${a.title}`);
          lines.push(`*Category: ${a.categoryPath.join(' → ')}*`);
          lines.push('');
          lines.push(a.body);
          lines.push('');
        }
      }

      writeFileSync(opts.out, lines.join('\n'));
      spinner.succeed(`Report with ${tickets.length} tickets exported to ${opts.out}`);
    });
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

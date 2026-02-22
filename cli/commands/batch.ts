import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets, loadMessages, getTicketMessages } from '../data.js';
import { getProvider } from '../providers/index.js';

export function registerBatchCommand(program: Command): void {
  const batch = program
    .command('batch')
    .description('Batch operations on multiple tickets');

  batch
    .command('assign')
    .description('Assign multiple tickets to an agent')
    .requiredOption('--agent <name>', 'Agent name to assign to')
    .option('--dir <dir>', 'Export directory')
    .option('--status <status>', 'Filter by status', 'open')
    .option('--priority <priority>', 'Filter by priority')
    .option('--tag <tag>', 'Filter by tag')
    .option('--limit <n>', 'Max tickets to assign', '20')
    .action((opts: { agent: string; dir?: string; status: string; priority?: string; tag?: string; limit: string }) => {
      let tickets = loadTickets(opts.dir);
      tickets = tickets.filter(t => t.status === opts.status);
      if (opts.priority) tickets = tickets.filter(t => t.priority === opts.priority);
      if (opts.tag) tickets = tickets.filter(t => t.tags.includes(opts.tag!));
      tickets = tickets.slice(0, parseInt(opts.limit, 10));

      if (tickets.length === 0) {
        console.log(chalk.yellow('No matching tickets found.'));
        return;
      }

      console.log(chalk.cyan(`\nAssigning ${tickets.length} tickets to ${chalk.bold(opts.agent)}:\n`));

      for (const t of tickets) {
        const prev = t.assignee ?? 'unassigned';
        console.log(
          `  #${t.externalId} ${t.subject.slice(0, 40).padEnd(40)} ${chalk.gray(prev)} → ${chalk.green(opts.agent)}`
        );
      }

      console.log(chalk.gray(`\n(In a production deployment, this would update tickets via the Zendesk/Kayako API)`));
    });

  batch
    .command('tag')
    .description('Add or remove tags on multiple tickets')
    .requiredOption('--add <tags>', 'Comma-separated tags to add')
    .option('--remove <tags>', 'Comma-separated tags to remove')
    .option('--dir <dir>', 'Export directory')
    .option('--status <status>', 'Filter by status')
    .option('--assignee <name>', 'Filter by assignee')
    .option('--limit <n>', 'Max tickets', '20')
    .action((opts: { add: string; remove?: string; dir?: string; status?: string; assignee?: string; limit: string }) => {
      let tickets = loadTickets(opts.dir);
      if (opts.status) tickets = tickets.filter(t => t.status === opts.status);
      if (opts.assignee) tickets = tickets.filter(t => t.assignee === opts.assignee);
      tickets = tickets.slice(0, parseInt(opts.limit, 10));

      if (tickets.length === 0) {
        console.log(chalk.yellow('No matching tickets found.'));
        return;
      }

      const addTags = opts.add.split(',').map(s => s.trim());
      const removeTags = opts.remove?.split(',').map(s => s.trim()) ?? [];

      console.log(chalk.cyan(`\nTagging ${tickets.length} tickets:`));
      if (addTags.length > 0) console.log(chalk.green(`  + Adding: ${addTags.join(', ')}`));
      if (removeTags.length > 0) console.log(chalk.red(`  - Removing: ${removeTags.join(', ')}`));
      console.log('');

      for (const t of tickets) {
        console.log(`  #${t.externalId} ${t.subject.slice(0, 50)}`);
      }

      console.log(chalk.gray(`\n(In production, this would update tags via the helpdesk API)`));
    });

  batch
    .command('close')
    .description('Close multiple tickets matching criteria')
    .option('--dir <dir>', 'Export directory')
    .option('--status <status>', 'Filter by status', 'solved')
    .option('--older-than <days>', 'Only tickets older than N days', '7')
    .option('--limit <n>', 'Max tickets to close', '50')
    .action((opts: { dir?: string; status: string; olderThan: string; limit: string }) => {
      let tickets = loadTickets(opts.dir);
      const cutoff = Date.now() - parseInt(opts.olderThan, 10) * 86400000;

      tickets = tickets
        .filter(t => t.status === opts.status)
        .filter(t => new Date(t.updatedAt).getTime() < cutoff)
        .slice(0, parseInt(opts.limit, 10));

      if (tickets.length === 0) {
        console.log(chalk.yellow(`No ${opts.status} tickets older than ${opts.olderThan} days found.`));
        return;
      }

      console.log(chalk.cyan(`\nWould close ${tickets.length} ${opts.status} tickets (older than ${opts.olderThan}d):\n`));

      for (const t of tickets) {
        const age = Math.floor((Date.now() - new Date(t.updatedAt).getTime()) / 86400000);
        console.log(`  #${t.externalId} ${t.subject.slice(0, 40).padEnd(40)} ${chalk.gray(`${age}d ago`)} ${chalk.gray(t.assignee ?? 'unassigned')}`);
      }

      console.log(chalk.gray(`\n(In production, this would close tickets via the helpdesk API)`));
    });

  batch
    .command('auto-triage')
    .description('Triage all open tickets and output a CSV report')
    .option('--dir <dir>', 'Export directory')
    .option('--limit <n>', 'Max tickets to triage', '50')
    .option('--out <file>', 'Output CSV file', './triage_report.csv')
    .action(async (opts: { dir?: string; limit: string; out: string }) => {
      const provider = getProvider();
      const allTickets = loadTickets(opts.dir);
      const allMessages = loadMessages(opts.dir);

      const queue = allTickets
        .filter(t => t.status === 'open' || t.status === 'pending')
        .slice(0, parseInt(opts.limit, 10));

      if (queue.length === 0) {
        console.log(chalk.yellow('No open/pending tickets found.'));
        return;
      }

      console.log(chalk.cyan(`\nAuto-triaging ${queue.length} tickets with ${provider.name}...\n`));

      const rows: string[] = ['ticket_id,external_id,subject,current_priority,suggested_priority,suggested_category,suggested_assignee,reasoning'];

      for (const ticket of queue) {
        const spinner = ora(`Triaging #${ticket.externalId}...`).start();
        try {
          const messages = getTicketMessages(ticket.id, allMessages);
          const result = await provider.triageTicket(ticket, messages);

          rows.push([
            ticket.id,
            ticket.externalId,
            `"${ticket.subject.replace(/"/g, '""')}"`,
            ticket.priority,
            result.suggestedPriority,
            result.suggestedCategory,
            result.suggestedAssignee ?? '',
            `"${result.reasoning.replace(/"/g, '""')}"`,
          ].join(','));

          spinner.succeed(`#${ticket.externalId} → ${result.suggestedPriority}, ${result.suggestedCategory}`);
        } catch (err) {
          spinner.fail(`#${ticket.externalId}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }

      const { writeFileSync } = await import('fs');
      writeFileSync(opts.out, rows.join('\n') + '\n');
      console.log(chalk.green(`\nTriage report saved to ${opts.out}`));
    });
}

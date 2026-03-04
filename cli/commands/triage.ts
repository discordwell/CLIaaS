import type { Command } from 'commander';
import chalk from 'chalk';
import { loadTickets, loadMessages, getTicketMessages } from '../data.js';
import { getProvider } from '../providers/index.js';
import { output, isJsonMode, createSpinner } from '../output.js';

export function registerTriageCommand(program: Command): void {
  program
    .command('triage')
    .description('LLM-powered ticket triage: prioritize and categorize open tickets')
    .option('--dir <dir>', 'Export directory')
    .option('--queue <status>', 'Filter queue by status', 'open')
    .option('--limit <n>', 'Number of tickets to triage', '10')
    .action(async (opts: { dir?: string; queue: string; limit: string }) => {
      const provider = getProvider();
      const allTickets = loadTickets(opts.dir);
      const allMessages = loadMessages(opts.dir);

      const queue = allTickets
        .filter(t => t.status === opts.queue)
        .slice(0, parseInt(opts.limit, 10));

      if (queue.length === 0) {
        if (isJsonMode()) {
          output({ results: [], queue: opts.queue, provider: provider.name }, () => {});
        } else {
          console.log(chalk.yellow(`No ${opts.queue} tickets found.`));
        }
        return;
      }

      if (!isJsonMode()) {
        console.log(chalk.cyan(`Triaging ${queue.length} ${opts.queue} tickets with ${provider.name}...\n`));
      }

      const results: Array<{
        ticketId: string;
        externalId: string;
        subject: string;
        suggestedPriority: string;
        suggestedAssignee: string | null;
        suggestedCategory: string;
        reasoning: string;
        error?: string;
      }> = [];

      for (const ticket of queue) {
        const spinner = createSpinner(`Triaging #${ticket.externalId}: ${ticket.subject.slice(0, 40)}...`).start();
        try {
          const messages = getTicketMessages(ticket.id, allMessages);
          const result = await provider.triageTicket(ticket, messages);

          results.push({
            ticketId: ticket.id,
            externalId: ticket.externalId,
            subject: ticket.subject,
            suggestedPriority: result.suggestedPriority,
            suggestedAssignee: result.suggestedAssignee ?? null,
            suggestedCategory: result.suggestedCategory,
            reasoning: result.reasoning,
          });

          const priColor = result.suggestedPriority === 'urgent' ? chalk.red.bold :
            result.suggestedPriority === 'high' ? chalk.yellow : chalk.white;

          spinner.succeed(
            `#${ticket.externalId} [${priColor(result.suggestedPriority.toUpperCase())}] "${ticket.subject.slice(0, 35)}" \u2192 ${result.suggestedAssignee ?? 'unassigned'}, ${chalk.blue(result.suggestedCategory)}`
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'triage failed';
          results.push({
            ticketId: ticket.id,
            externalId: ticket.externalId,
            subject: ticket.subject,
            suggestedPriority: 'normal',
            suggestedAssignee: null,
            suggestedCategory: 'unknown',
            reasoning: '',
            error: errorMsg,
          });
          spinner.fail(`#${ticket.externalId}: ${errorMsg}`);
        }
      }

      if (isJsonMode()) {
        output({ results, queue: opts.queue, provider: provider.name }, () => {});
      }
    });
}

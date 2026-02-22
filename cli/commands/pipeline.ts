import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets, loadMessages, loadKBArticles, getTicketMessages } from '../data.js';
import { getProvider } from '../providers/index.js';
import type { Ticket, TriageResult } from '../schema/types.js';

interface TriagedTicket {
  ticket: Ticket;
  triage: TriageResult;
}

export function registerPipelineCommand(program: Command): void {
  program
    .command('pipeline')
    .description('One-shot pipeline: triage open tickets, then draft replies for top-priority items')
    .option('--dir <dir>', 'Export directory')
    .option('--limit <n>', 'Number of tickets to triage', '10')
    .option('--draft-top <n>', 'Auto-draft replies for the top N triaged tickets', '3')
    .option('--tone <tone>', 'Reply tone: concise, friendly, formal, professional', 'professional')
    .option('--dry-run', 'Show what would happen without calling LLM')
    .option('--queue <status>', 'Filter tickets by status', 'open')
    .action(async (opts: {
      dir?: string;
      limit: string;
      draftTop: string;
      tone: string;
      dryRun?: boolean;
      queue: string;
    }) => {
      const limit = parseInt(opts.limit, 10);
      const draftTop = parseInt(opts.draftTop, 10);

      console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════╗'));
      console.log(chalk.bold.cyan('║     CLIaaS Pipeline: Triage → Draft      ║'));
      console.log(chalk.bold.cyan('╚══════════════════════════════════════════╝\n'));

      // Step 1: Load data
      const loadSpinner = ora('Loading ticket data...').start();
      const allTickets = loadTickets(opts.dir);
      const allMessages = loadMessages(opts.dir);
      const articles = loadKBArticles(opts.dir);

      const queue = allTickets.filter(t => t.status === opts.queue).slice(0, limit);

      if (queue.length === 0) {
        loadSpinner.fail(`No ${opts.queue} tickets found.`);
        return;
      }

      loadSpinner.succeed(`Loaded ${allTickets.length} tickets, ${allMessages.length} messages, ${articles.length} KB articles`);
      console.log(chalk.gray(`  Queue: ${queue.length} ${opts.queue} tickets → triage ${limit}, draft top ${draftTop}\n`));

      if (opts.dryRun) {
        console.log(chalk.yellow.bold('DRY RUN — no LLM calls will be made\n'));
        console.log(chalk.bold('Would triage:'));
        for (const t of queue) {
          console.log(`  #${t.externalId} [${t.priority.toUpperCase()}] ${t.subject}`);
        }
        console.log(chalk.bold(`\nWould draft replies for top ${draftTop} after triage.`));
        return;
      }

      // Step 2: Triage
      const provider = getProvider();
      console.log(chalk.bold(`\n── Step 1: Triage (${provider.name}) ──\n`));

      const triaged: TriagedTicket[] = [];

      for (const ticket of queue) {
        const spinner = ora(`Triaging #${ticket.externalId}: ${ticket.subject.slice(0, 45)}...`).start();
        try {
          const messages = getTicketMessages(ticket.id, allMessages);
          const result = await provider.triageTicket(ticket, messages);
          triaged.push({ ticket, triage: result });

          const priColor = result.suggestedPriority === 'urgent' ? chalk.red.bold :
            result.suggestedPriority === 'high' ? chalk.yellow : chalk.white;

          spinner.succeed(
            `#${ticket.externalId} [${priColor(result.suggestedPriority.toUpperCase())}] → ${result.suggestedCategory}, ${result.suggestedAssignee ?? 'unassigned'}`
          );
        } catch (err) {
          spinner.fail(`#${ticket.externalId}: ${err instanceof Error ? err.message : 'triage failed'}`);
        }
      }

      if (triaged.length === 0) {
        console.log(chalk.red('\nNo tickets were successfully triaged.'));
        return;
      }

      // Sort by priority for drafting (urgent first)
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
      triaged.sort((a, b) =>
        (priorityOrder[a.triage.suggestedPriority as keyof typeof priorityOrder] ?? 9) -
        (priorityOrder[b.triage.suggestedPriority as keyof typeof priorityOrder] ?? 9)
      );

      // Step 3: Draft replies for top-priority tickets
      const toDraft = triaged.slice(0, draftTop);
      console.log(chalk.bold(`\n── Step 2: Draft Replies (top ${toDraft.length}) ──\n`));

      for (const { ticket, triage } of toDraft) {
        const spinner = ora(`Drafting reply for #${ticket.externalId}...`).start();
        try {
          const messages = getTicketMessages(ticket.id, allMessages);

          // Find relevant KB articles if available
          let contextText: string | undefined;
          if (articles.length > 0) {
            const kbSuggestions = await provider.suggestKB(ticket, articles);
            if (kbSuggestions.length > 0) {
              const topArticles = kbSuggestions.slice(0, 2);
              const matched = topArticles
                .map(s => articles.find(a => a.id === s.articleId))
                .filter(Boolean);
              if (matched.length > 0) {
                contextText = matched.map(a => `## ${a!.title}\n${a!.body}`).join('\n\n');
              }
            }
          }

          const reply = await provider.generateReply(ticket, messages, {
            tone: opts.tone,
            context: contextText,
          });

          spinner.succeed(`#${ticket.externalId}: Draft generated`);

          console.log(chalk.gray(`  Category: ${triage.suggestedCategory} | Priority: ${triage.suggestedPriority} | Assignee: ${triage.suggestedAssignee ?? 'unassigned'}`));
          console.log(chalk.green('  ─── Draft ───'));
          for (const line of reply.split('\n')) {
            console.log(chalk.white(`  ${line}`));
          }
          console.log(chalk.green('  ──────────────\n'));
        } catch (err) {
          spinner.fail(`#${ticket.externalId}: ${err instanceof Error ? err.message : 'draft failed'}`);
        }
      }

      // Summary
      console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════╗'));
      console.log(chalk.bold.cyan('║            Pipeline Complete              ║'));
      console.log(chalk.bold.cyan('╚══════════════════════════════════════════╝'));
      console.log(chalk.gray(`  Triaged: ${triaged.length} tickets`));
      console.log(chalk.gray(`  Drafted: ${toDraft.length} replies`));
      console.log(chalk.gray(`  Provider: ${provider.name}\n`));
    });
}

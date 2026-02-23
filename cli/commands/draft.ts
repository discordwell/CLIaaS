import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets, loadMessages, loadKBArticles, getTicketMessages } from '../data.js';
import { getProvider } from '../providers/index.js';
import { buildRagReplyPrompt } from '../providers/base.js';

export function registerDraftCommand(program: Command): void {
  const draft = program
    .command('draft')
    .description('LLM-powered draft generation');

  draft
    .command('reply')
    .description('Generate a draft reply for a ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .option('--dir <dir>', 'Export directory')
    .option('--tone <tone>', 'Reply tone: concise, friendly, formal, professional', 'professional')
    .option('--context <ids>', 'Comma-separated KB article IDs to include as context')
    .option('--rag', 'Use RAG to automatically retrieve relevant context')
    .option('--rag-top <n>', 'Number of RAG context chunks', '5')
    .action(async (opts: { ticket: string; dir?: string; tone: string; context?: string; rag?: boolean; ragTop?: string }) => {
      const provider = getProvider();
      const tickets = loadTickets(opts.dir);
      const allMessages = loadMessages(opts.dir);

      const ticket = tickets.find(t => t.id === opts.ticket || t.externalId === opts.ticket);
      if (!ticket) {
        console.error(chalk.red(`Ticket not found: ${opts.ticket}`));
        process.exit(1);
      }

      const messages = getTicketMessages(ticket.id, allMessages);
      let contextText: string | undefined;

      if (opts.rag) {
        try {
          const { retrieve, formatRetrievedContext } = await import('../rag/retriever.js');
          const query = `${ticket.subject} ${messages[0]?.body ?? ''}`.slice(0, 500);
          const ragSpinner = ora('Retrieving RAG context...').start();
          const results = await retrieve({
            query,
            topK: parseInt(opts.ragTop ?? '5', 10),
          });
          if (results.length > 0) {
            contextText = formatRetrievedContext(results) + '\n\nIMPORTANT: Cite source titles when referencing specific information from the retrieved context.';
            ragSpinner.succeed(`Retrieved ${results.length} context chunks`);
          } else {
            ragSpinner.warn('No RAG context found, proceeding without');
          }
        } catch (err) {
          console.warn(chalk.yellow(`RAG unavailable: ${err instanceof Error ? err.message : err}`));
          console.warn(chalk.yellow('Proceeding without RAG context...\n'));
        }
      } else if (opts.context) {
        const articles = loadKBArticles(opts.dir);
        const contextIds = opts.context.split(',').map(s => s.trim());
        const matched = articles.filter(a => contextIds.includes(a.id) || contextIds.includes(a.externalId));
        if (matched.length > 0) {
          contextText = matched.map(a => `## ${a.title}\n${a.body}`).join('\n\n');
        }
      }

      console.log(chalk.cyan(`\nDrafting reply for: ${ticket.subject}`));
      console.log(chalk.gray(`Tone: ${opts.tone} | Provider: ${provider.name}${opts.rag ? ' | RAG: enabled' : ''}\n`));

      const spinner = ora('Generating draft...').start();
      try {
        const reply = await provider.generateReply(ticket, messages, { tone: opts.tone, context: contextText });
        spinner.succeed('Draft generated\n');

        console.log(chalk.green('─── Draft Reply ───'));
        console.log(reply);
        console.log(chalk.green('───────────────────'));
        console.log(chalk.gray('\n[approve] [edit] [discard]'));
      } catch (err) {
        spinner.fail(`Draft generation failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

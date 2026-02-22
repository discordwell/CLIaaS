import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets, loadMessages, loadKBArticles, getTicketMessages } from '../data.js';
import { getProvider } from '../providers/index.js';

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
    .action(async (opts: { ticket: string; dir?: string; tone: string; context?: string }) => {
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

      if (opts.context) {
        const articles = loadKBArticles(opts.dir);
        const contextIds = opts.context.split(',').map(s => s.trim());
        const matched = articles.filter(a => contextIds.includes(a.id) || contextIds.includes(a.externalId));
        if (matched.length > 0) {
          contextText = matched.map(a => `## ${a.title}\n${a.body}`).join('\n\n');
        }
      }

      console.log(chalk.cyan(`\nDrafting reply for: ${ticket.subject}`));
      console.log(chalk.gray(`Tone: ${opts.tone} | Provider: ${provider.name}\n`));

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

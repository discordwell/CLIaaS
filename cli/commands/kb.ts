import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets, loadKBArticles } from '../data.js';
import { getProvider } from '../providers/index.js';

export function registerKBCommand(program: Command): void {
  const kb = program
    .command('kb')
    .description('Knowledge base operations');

  kb
    .command('suggest')
    .description('Suggest relevant KB articles for a ticket')
    .requiredOption('--ticket <id>', 'Ticket ID')
    .option('--dir <dir>', 'Export directory')
    .option('--top <n>', 'Number of suggestions', '3')
    .action(async (opts: { ticket: string; dir?: string; top: string }) => {
      const provider = getProvider();
      const tickets = loadTickets(opts.dir);
      const articles = loadKBArticles(opts.dir);

      const ticket = tickets.find(t => t.id === opts.ticket || t.externalId === opts.ticket);
      if (!ticket) {
        console.error(chalk.red(`Ticket not found: ${opts.ticket}`));
        process.exit(1);
      }

      if (articles.length === 0) {
        console.log(chalk.yellow('No KB articles found in export data.'));
        return;
      }

      console.log(chalk.cyan(`\nFinding relevant articles for: ${ticket.subject}\n`));

      const spinner = ora('Analyzing with LLM...').start();
      try {
        const suggestions = await provider.suggestKB(ticket, articles);
        const top = parseInt(opts.top, 10);
        const display = suggestions.slice(0, top);
        spinner.succeed(`Found ${display.length} suggestions\n`);

        for (const [i, s] of display.entries()) {
          const score = Math.round(s.relevanceScore * 100);
          const scoreColor = score >= 80 ? chalk.green : score >= 50 ? chalk.yellow : chalk.gray;
          console.log(`${chalk.bold(`${i + 1}.`)} ${s.title}`);
          console.log(`   ID: ${s.articleId} | Relevance: ${scoreColor(`${score}%`)}`);
          console.log(`   ${chalk.gray(s.reasoning)}\n`);
        }
      } catch (err) {
        spinner.fail(`KB suggestion failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

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
    .option('--rag', 'Use RAG semantic search instead of LLM-based matching')
    .action(async (opts: { ticket: string; dir?: string; top: string; rag?: boolean }) => {
      const tickets = loadTickets(opts.dir);

      const ticket = tickets.find(t => t.id === opts.ticket || t.externalId === opts.ticket);
      if (!ticket) {
        console.error(chalk.red(`Ticket not found: ${opts.ticket}`));
        process.exit(1);
      }

      const top = parseInt(opts.top, 10);

      if (opts.rag) {
        // RAG-based semantic search
        console.log(chalk.cyan(`\nFinding relevant articles for: ${ticket.subject}`));
        console.log(chalk.gray('Mode: RAG semantic search\n'));

        const spinner = ora('Searching RAG store...').start();
        try {
          const { retrieve } = await import('../rag/retriever.js');
          const results = await retrieve({
            query: ticket.subject,
            topK: top * 2, // fetch extra to group by source
            sourceType: 'kb_article',
          });

          if (results.length === 0) {
            spinner.warn('No results. Import KB articles first: cliaas rag import source --type kb');
            return;
          }

          // Group by source article, keep highest score per article
          const articleMap = new Map<string, { title: string; score: number; content: string }>();
          for (const r of results) {
            const existing = articleMap.get(r.chunk.sourceId);
            if (!existing || r.combinedScore > existing.score) {
              articleMap.set(r.chunk.sourceId, {
                title: r.chunk.sourceTitle,
                score: r.combinedScore,
                content: r.chunk.content.slice(0, 200),
              });
            }
          }

          const articles = [...articleMap.entries()].slice(0, top);
          spinner.succeed(`Found ${articles.length} relevant articles\n`);

          for (const [i, [id, a]] of articles.entries()) {
            const score = Math.round(a.score * 1000);
            const scoreColor = score >= 12 ? chalk.green : score >= 8 ? chalk.yellow : chalk.gray;
            console.log(`${chalk.bold(`${i + 1}.`)} ${a.title}`);
            console.log(`   ID: ${id} | Score: ${scoreColor(String(score))}`);
            console.log(`   ${chalk.gray(a.content.replace(/\n/g, ' '))}...\n`);
          }
        } catch (err) {
          spinner.fail(`RAG search failed: ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
        return;
      }

      // Original LLM-based matching
      const provider = getProvider();
      const articles = loadKBArticles(opts.dir);

      if (articles.length === 0) {
        console.log(chalk.yellow('No KB articles found in export data.'));
        return;
      }

      console.log(chalk.cyan(`\nFinding relevant articles for: ${ticket.subject}\n`));

      const spinner = ora('Analyzing with LLM...').start();
      try {
        const suggestions = await provider.suggestKB(ticket, articles);
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

import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadTickets } from '../data.js';
import { getProvider } from '../providers/index.js';

export function registerSummarizeCommand(program: Command): void {
  program
    .command('summarize')
    .description('LLM-powered queue/shift summary')
    .option('--dir <dir>', 'Export directory')
    .option('--period <period>', 'Summary period: today, shift, week', 'today')
    .action(async (opts: { dir?: string; period: string }) => {
      const provider = getProvider();
      const tickets = loadTickets(opts.dir);

      if (tickets.length === 0) {
        console.log(chalk.yellow('No tickets found. Run an export first.'));
        return;
      }

      // Filter by period
      const now = new Date();
      let filtered = tickets;
      if (opts.period === 'today') {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filtered = tickets.filter(t => new Date(t.updatedAt) >= startOfDay);
      } else if (opts.period === 'shift') {
        const eightHoursAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000);
        filtered = tickets.filter(t => new Date(t.updatedAt) >= eightHoursAgo);
      } else if (opts.period === 'week') {
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filtered = tickets.filter(t => new Date(t.updatedAt) >= oneWeekAgo);
      }

      // If period filter yields nothing, use all tickets
      if (filtered.length === 0) filtered = tickets;

      console.log(chalk.cyan(`\nGenerating ${opts.period} summary for ${filtered.length} tickets...\n`));

      const spinner = ora('Analyzing with LLM...').start();
      try {
        const summary = await provider.summarize(filtered, opts.period);
        spinner.succeed('Summary generated\n');
        console.log(summary);
      } catch (err) {
        spinner.fail(`Summary failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });
}

import type { Command } from 'commander';
import chalk from 'chalk';
import { loadTickets, loadMessages, loadKBArticles } from '../data.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ExportManifest } from '../schema/types.js';

export function registerStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Show queue metrics and data summary')
    .option('--dir <dir>', 'Export directory')
    .action((opts: { dir?: string }) => {
      const tickets = loadTickets(opts.dir);
      const messages = loadMessages(opts.dir);
      const articles = loadKBArticles(opts.dir);

      if (tickets.length === 0) {
        console.log(chalk.yellow('No ticket data found. Run an export or `cliaas demo` first.'));
        return;
      }

      // Load manifest if available
      const dir = opts.dir ?? './exports/zendesk';
      const manifestPath = join(dir, 'manifest.json');
      let manifest: ExportManifest | null = null;
      if (existsSync(manifestPath)) {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      }

      // Status breakdown
      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      const byAssignee: Record<string, number> = {};
      const bySource: Record<string, number> = {};

      for (const t of tickets) {
        byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
        byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
        bySource[t.source] = (bySource[t.source] ?? 0) + 1;
        const assignee = t.assignee ?? 'unassigned';
        byAssignee[assignee] = (byAssignee[assignee] ?? 0) + 1;
      }

      // Time analysis
      const now = Date.now();
      const today = tickets.filter(t => now - new Date(t.updatedAt).getTime() < 86400000);
      const thisWeek = tickets.filter(t => now - new Date(t.updatedAt).getTime() < 7 * 86400000);

      // Tag frequency
      const tagCounts: Record<string, number> = {};
      for (const t of tickets) {
        for (const tag of t.tags) {
          tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
        }
      }
      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      console.log(chalk.bold.cyan('\n  CLIaaS Queue Statistics\n'));

      if (manifest) {
        console.log(chalk.gray(`  Source: ${manifest.source} | Exported: ${manifest.exportedAt}`));
      }

      console.log(chalk.bold('\n  Overview'));
      console.log(`  ${'Tickets:'.padEnd(20)} ${chalk.bold(String(tickets.length))}`);
      console.log(`  ${'Messages:'.padEnd(20)} ${messages.length}`);
      console.log(`  ${'KB Articles:'.padEnd(20)} ${articles.length}`);
      console.log(`  ${'Updated today:'.padEnd(20)} ${today.length}`);
      console.log(`  ${'Updated this week:'.padEnd(20)} ${thisWeek.length}`);

      console.log(chalk.bold('\n  By Status'));
      for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
        const bar = '█'.repeat(Math.ceil(count / tickets.length * 30));
        const pct = Math.round(count / tickets.length * 100);
        const color = status === 'open' ? chalk.green : status === 'pending' ? chalk.yellow : chalk.gray;
        console.log(`  ${color(status.padEnd(12))} ${String(count).padStart(5)}  ${color(bar)} ${pct}%`);
      }

      console.log(chalk.bold('\n  By Priority'));
      const priOrder = ['urgent', 'high', 'normal', 'low'];
      for (const pri of priOrder) {
        const count = byPriority[pri] ?? 0;
        if (count === 0) continue;
        const bar = '█'.repeat(Math.ceil(count / tickets.length * 30));
        const pct = Math.round(count / tickets.length * 100);
        const color = pri === 'urgent' ? chalk.red : pri === 'high' ? chalk.yellow : chalk.white;
        console.log(`  ${color(pri.padEnd(12))} ${String(count).padStart(5)}  ${color(bar)} ${pct}%`);
      }

      console.log(chalk.bold('\n  By Assignee (top 10)'));
      const sortedAssignees = Object.entries(byAssignee).sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [assignee, count] of sortedAssignees) {
        const bar = '█'.repeat(Math.ceil(count / tickets.length * 20));
        console.log(`  ${assignee.padEnd(20)} ${String(count).padStart(4)}  ${chalk.cyan(bar)}`);
      }

      if (topTags.length > 0) {
        console.log(chalk.bold('\n  Top Tags'));
        for (const [tag, count] of topTags) {
          console.log(`  ${chalk.blue(tag.padEnd(20))} ${count}`);
        }
      }

      // Alert section
      const urgentOpen = tickets.filter(t => t.status === 'open' && (t.priority === 'urgent' || t.priority === 'high'));
      if (urgentOpen.length > 0) {
        console.log(chalk.bold.red(`\n  ⚠ ${urgentOpen.length} high/urgent tickets still open:`));
        for (const t of urgentOpen.slice(0, 5)) {
          console.log(chalk.red(`    #${t.externalId} [${t.priority.toUpperCase()}] ${t.subject.slice(0, 50)}`));
        }
        if (urgentOpen.length > 5) {
          console.log(chalk.red(`    ... and ${urgentOpen.length - 5} more`));
        }
      }

      console.log();
    });
}

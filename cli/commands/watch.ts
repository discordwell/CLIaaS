import type { Command } from 'commander';
import chalk from 'chalk';
import { loadTickets, loadMessages } from '../data.js';
import type { Ticket } from '../schema/types.js';

export function registerWatchCommand(program: Command): void {
  program
    .command('watch')
    .description('Live ticket queue monitor — polls local data and shows a refreshing dashboard')
    .option('--dir <dir>', 'Export directory')
    .option('--interval <seconds>', 'Refresh interval in seconds', '5')
    .option('--status <status>', 'Filter by status')
    .action(async (opts: { dir?: string; interval: string; status?: string }) => {
      const interval = Math.max(2, parseInt(opts.interval, 10)) * 1000;
      let lastCount = 0;

      console.log(chalk.bold.cyan('\nCLIaaS Watch Mode'));
      console.log(chalk.gray(`Refreshing every ${opts.interval}s — press Ctrl+C to exit\n`));

      const render = () => {
        let tickets = loadTickets(opts.dir);
        const messages = loadMessages(opts.dir);

        if (opts.status) {
          tickets = tickets.filter(t => t.status === opts.status);
        }

        // Clear screen
        process.stdout.write('\x1B[2J\x1B[H');

        const now = new Date().toLocaleTimeString();
        console.log(chalk.bold.cyan(`CLIaaS Watch  │  ${now}  │  ${tickets.length} tickets`));
        console.log(chalk.gray('─'.repeat(60)));

        // Status counts
        const statusCounts: Record<string, number> = {};
        const priorityCounts: Record<string, number> = {};
        for (const t of tickets) {
          statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
          priorityCounts[t.priority] = (priorityCounts[t.priority] ?? 0) + 1;
        }

        const statusLine = Object.entries(statusCounts)
          .map(([s, c]) => {
            const color = s === 'open' ? chalk.blue : s === 'pending' ? chalk.yellow : s === 'solved' ? chalk.green : chalk.gray;
            return `${color(s)}: ${chalk.bold(String(c))}`;
          })
          .join('  │  ');

        const priorityLine = ['urgent', 'high', 'normal', 'low']
          .filter(p => priorityCounts[p])
          .map(p => {
            const color = p === 'urgent' ? chalk.red.bold : p === 'high' ? chalk.yellow : p === 'normal' ? chalk.white : chalk.gray;
            return `${color(p)}: ${chalk.bold(String(priorityCounts[p]))}`;
          })
          .join('  │  ');

        console.log(`\n  Status:   ${statusLine}`);
        console.log(`  Priority: ${priorityLine}`);

        // Urgent alerts
        const urgent = tickets.filter(t => t.priority === 'urgent' && (t.status === 'open' || t.status === 'pending'));
        if (urgent.length > 0) {
          console.log(chalk.red.bold(`\n  ⚠ ${urgent.length} URGENT ticket${urgent.length > 1 ? 's' : ''} require attention:`));
          for (const t of urgent.slice(0, 5)) {
            console.log(chalk.red(`    #${t.externalId} ${t.subject.slice(0, 50)} (${t.assignee ?? 'unassigned'})`));
          }
        }

        // Recent activity (tickets updated in last hour for demo, or just most recent)
        const sorted = [...tickets].sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );

        console.log(chalk.bold('\n  Recently Updated:'));
        console.log(chalk.gray('  ' + '─'.repeat(56)));

        for (const t of sorted.slice(0, 8)) {
          const priTag = formatPriority(t);
          const statusTag = formatStatus(t);
          const age = timeAgo(t.updatedAt);
          const msgCount = messages.filter(m => m.ticketId === t.id).length;

          console.log(
            `  ${priTag} ${statusTag} #${chalk.bold(t.externalId)} ${t.subject.slice(0, 30).padEnd(30)} ${chalk.gray(`${msgCount}msg`)} ${chalk.gray(age)}`
          );
        }

        // New tickets alert
        if (lastCount > 0 && tickets.length > lastCount) {
          const diff = tickets.length - lastCount;
          console.log(chalk.green.bold(`\n  ✓ ${diff} new ticket${diff > 1 ? 's' : ''} since last refresh`));
        }
        lastCount = tickets.length;

        console.log(chalk.gray(`\n${'─'.repeat(60)}`));
        console.log(chalk.gray(`Refreshing every ${opts.interval}s — Ctrl+C to exit`));
      };

      render();
      const timer = setInterval(render, interval);

      // Graceful exit
      process.on('SIGINT', () => {
        clearInterval(timer);
        console.log(chalk.gray('\n\nWatch mode stopped.'));
        process.exit(0);
      });

      // Keep process alive
      await new Promise(() => {});
    });
}

function formatPriority(t: Ticket): string {
  switch (t.priority) {
    case 'urgent': return chalk.bgRed.white.bold(' URG ');
    case 'high': return chalk.bgYellow.black(' HI  ');
    case 'normal': return chalk.bgWhite.black(' NRM ');
    case 'low': return chalk.bgGray.white(' LOW ');
    default: return chalk.gray(' --- ');
  }
}

function formatStatus(t: Ticket): string {
  switch (t.status) {
    case 'open': return chalk.blue('OPEN');
    case 'pending': return chalk.yellow('PEND');
    case 'solved': return chalk.green('SLVD');
    case 'closed': return chalk.gray('CLSD');
    default: return chalk.gray(t.status.slice(0, 4).toUpperCase());
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

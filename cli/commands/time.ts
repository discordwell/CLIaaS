import type { Command } from 'commander';
import chalk from 'chalk';
import { output, isJsonMode } from '../output.js';

export function registerTimeCommands(program: Command): void {
  const time = program
    .command('time')
    .description('Track and report time spent on tickets');

  time
    .command('log')
    .description('Log a manual time entry')
    .argument('<ticketId>', 'Ticket ID')
    .argument('<minutes>', 'Duration in minutes')
    .option('--user <userId>', 'User/agent ID', 'cli-user')
    .option('--user-name <name>', 'User display name', 'CLI User')
    .option('--billable', 'Mark as billable (default: true)')
    .option('--no-billable', 'Mark as non-billable')
    .option('--notes <notes>', 'Notes about the work', '')
    .option('--customer <customerId>', 'Customer ID to associate')
    .option('--group <groupId>', 'Group/team ID to associate')
    .action(async (ticketId: string, minutes: string, opts: {
      user: string;
      userName: string;
      billable: boolean;
      notes: string;
      customer?: string;
      group?: string;
    }) => {
      const durationMinutes = parseInt(minutes, 10);
      if (isNaN(durationMinutes) || durationMinutes <= 0) {
        console.error(chalk.red('Minutes must be a positive number.'));
        process.exit(1);
      }

      // Dynamic import to avoid pulling in Next.js deps at CLI load time
      const { logManualTime } = await import('@/lib/time-tracking');

      const entry = logManualTime({
        ticketId,
        userId: opts.user,
        userName: opts.userName,
        durationMinutes,
        billable: opts.billable,
        notes: opts.notes,
        ...(opts.customer ? { customerId: opts.customer } : {}),
        ...(opts.group ? { groupId: opts.group } : {}),
      });

      output(
        { entry },
        () => {
          console.log(chalk.green(`Logged ${durationMinutes}m for ticket ${ticketId}`));
          console.log(chalk.gray(`  ID:       ${entry.id}`));
          console.log(chalk.gray(`  Billable: ${entry.billable}`));
          if (entry.notes) console.log(chalk.gray(`  Notes:    ${entry.notes}`));
          if (entry.customerId) console.log(chalk.gray(`  Customer: ${entry.customerId}`));
          if (entry.groupId) console.log(chalk.gray(`  Group:    ${entry.groupId}`));
        },
      );
    });

  time
    .command('report')
    .description('Show a time tracking report')
    .option('--ticket <ticketId>', 'Filter by ticket ID')
    .option('--user <userId>', 'Filter by user/agent ID')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--customer <customerId>', 'Filter by customer ID')
    .option('--group <groupId>', 'Filter by group/team ID')
    .action(async (opts: {
      ticket?: string;
      user?: string;
      from?: string;
      to?: string;
      customer?: string;
      group?: string;
    }) => {
      const { getTimeReport } = await import('@/lib/time-tracking');

      const filters = {
        ...(opts.ticket ? { ticketId: opts.ticket } : {}),
        ...(opts.user ? { userId: opts.user } : {}),
        ...(opts.from ? { from: opts.from } : {}),
        ...(opts.to ? { to: opts.to } : {}),
        ...(opts.customer ? { customerId: opts.customer } : {}),
        ...(opts.group ? { groupId: opts.group } : {}),
      };

      const report = getTimeReport(filters);

      output(
        report,
        () => {
          console.log(chalk.bold.cyan('\nTime Tracking Report\n'));

          console.log(chalk.bold('Summary:'));
          console.log(`  Total:    ${formatMinutes(report.totalMinutes)}`);
          console.log(`  Billable: ${formatMinutes(report.billableMinutes)}`);
          console.log('');

          if (report.byAgent.length > 0) {
            console.log(chalk.bold('By Agent:'));
            const header = `  ${'AGENT'.padEnd(20)} ${'TOTAL'.padEnd(10)} BILLABLE`;
            console.log(chalk.gray(header));
            for (const a of report.byAgent) {
              console.log(
                `  ${a.userName.padEnd(20)} ${formatMinutes(a.totalMinutes).padEnd(10)} ${formatMinutes(a.billableMinutes)}`,
              );
            }
            console.log('');
          }

          if (report.byTicket.length > 0) {
            console.log(chalk.bold('By Ticket:'));
            const header = `  ${'TICKET'.padEnd(20)} ${'TOTAL'.padEnd(10)} BILLABLE`;
            console.log(chalk.gray(header));
            for (const t of report.byTicket) {
              console.log(
                `  ${t.ticketId.padEnd(20)} ${formatMinutes(t.totalMinutes).padEnd(10)} ${formatMinutes(t.billableMinutes)}`,
              );
            }
            console.log('');
          }

          if (report.byCustomer.length > 0) {
            console.log(chalk.bold('By Customer:'));
            const header = `  ${'CUSTOMER'.padEnd(20)} ${'TOTAL'.padEnd(10)} BILLABLE`;
            console.log(chalk.gray(header));
            for (const c of report.byCustomer) {
              console.log(
                `  ${c.customerId.padEnd(20)} ${formatMinutes(c.totalMinutes).padEnd(10)} ${formatMinutes(c.billableMinutes)}`,
              );
            }
            console.log('');
          }

          if (report.byGroup.length > 0) {
            console.log(chalk.bold('By Group:'));
            const header = `  ${'GROUP'.padEnd(20)} ${'TOTAL'.padEnd(10)} BILLABLE`;
            console.log(chalk.gray(header));
            for (const g of report.byGroup) {
              console.log(
                `  ${g.groupId.padEnd(20)} ${formatMinutes(g.totalMinutes).padEnd(10)} ${formatMinutes(g.billableMinutes)}`,
              );
            }
            console.log('');
          }

          if (report.byDay.length > 0) {
            console.log(chalk.bold('By Day:'));
            const header = `  ${'DATE'.padEnd(12)} ${'TOTAL'.padEnd(10)} BILLABLE`;
            console.log(chalk.gray(header));
            for (const d of report.byDay) {
              console.log(
                `  ${d.date.padEnd(12)} ${formatMinutes(d.totalMinutes).padEnd(10)} ${formatMinutes(d.billableMinutes)}`,
              );
            }
          }
        },
      );
    });
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

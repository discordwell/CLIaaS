import type { Command } from 'commander';
import chalk from 'chalk';
import { loadTickets, loadMessages, getTicketMessages } from '../data.js';
import { output, isJsonMode } from '../output.js';

interface SLAPolicy {
  priority: string;
  firstResponseHrs: number;
  resolutionHrs: number;
}

const DEFAULT_SLAS: SLAPolicy[] = [
  { priority: 'urgent', firstResponseHrs: 1, resolutionHrs: 4 },
  { priority: 'high', firstResponseHrs: 4, resolutionHrs: 8 },
  { priority: 'normal', firstResponseHrs: 8, resolutionHrs: 24 },
  { priority: 'low', firstResponseHrs: 24, resolutionHrs: 72 },
];

export function registerSLACommand(program: Command): void {
  program
    .command('sla')
    .description('SLA compliance monitor \u2014 shows breach status for open tickets')
    .option('--dir <dir>', 'Export directory')
    .option('--status <status>', 'Filter by status (default: open,pending)')
    .action((opts: { dir?: string; status?: string }) => {
      const tickets = loadTickets(opts.dir);
      const messages = loadMessages(opts.dir);
      const statuses = opts.status?.split(',') ?? ['open', 'pending'];

      const active = tickets.filter(t => statuses.includes(t.status));

      if (active.length === 0) {
        if (isJsonMode()) {
          output({ summary: { breached: 0, atRisk: 0, compliant: 0, total: 0 }, tickets: [] }, () => {});
        } else {
          console.log(chalk.yellow('No active tickets found.'));
        }
        return;
      }

      let breached = 0;
      let atRisk = 0;
      let compliant = 0;

      const results: Array<{
        ticketId: string;
        externalId: string;
        subject: string;
        priority: string;
        assignee: string | null;
        ageMs: number;
        firstResponseMs: number | null;
        firstResponseStatus: 'breached' | 'at-risk' | 'ok';
        resolutionStatus: 'breached' | 'at-risk' | 'ok';
        slaTargetFirstResponseHrs: number;
        slaTargetResolutionHrs: number;
      }> = [];

      for (const ticket of active) {
        const sla = DEFAULT_SLAS.find(s => s.priority === ticket.priority) ?? DEFAULT_SLAS[2];
        const ticketMessages = getTicketMessages(ticket.id, messages)
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const createdAt = new Date(ticket.createdAt).getTime();
        const now = Date.now();
        const ageMs = now - createdAt;

        // Find first agent reply (not the requester's initial message)
        const firstAgentReply = ticketMessages.find((m, idx) => idx > 0 && m.type === 'reply');
        const firstResponseMs = firstAgentReply
          ? new Date(firstAgentReply.createdAt).getTime() - createdAt
          : null;

        const frTargetMs = sla.firstResponseHrs * 3600000;
        const resTargetMs = sla.resolutionHrs * 3600000;

        let frStatus: 'breached' | 'at-risk' | 'ok';
        if (firstResponseMs !== null) {
          frStatus = firstResponseMs > frTargetMs ? 'breached' : 'ok';
        } else {
          // No response yet
          frStatus = ageMs > frTargetMs ? 'breached' : ageMs > frTargetMs * 0.75 ? 'at-risk' : 'ok';
        }

        const resStatus = ageMs > resTargetMs ? 'breached' : ageMs > resTargetMs * 0.75 ? 'at-risk' : 'ok';

        if (frStatus === 'breached' || resStatus === 'breached') breached++;
        else if (frStatus === 'at-risk' || resStatus === 'at-risk') atRisk++;
        else compliant++;

        results.push({
          ticketId: ticket.id,
          externalId: ticket.externalId,
          subject: ticket.subject,
          priority: ticket.priority,
          assignee: ticket.assignee ?? null,
          ageMs,
          firstResponseMs,
          firstResponseStatus: frStatus,
          resolutionStatus: resStatus,
          slaTargetFirstResponseHrs: sla.firstResponseHrs,
          slaTargetResolutionHrs: sla.resolutionHrs,
        });
      }

      output(
        {
          summary: { breached, atRisk, compliant, total: active.length },
          policies: DEFAULT_SLAS,
          tickets: results,
        },
        () => {
          console.log(chalk.bold.cyan('\nSLA Compliance Report\n'));

          // Print SLA policies
          console.log(chalk.bold('SLA Policies:'));
          for (const sla of DEFAULT_SLAS) {
            console.log(chalk.gray(`  ${sla.priority.toUpperCase().padEnd(7)} \u2014 First response: ${sla.firstResponseHrs}h, Resolution: ${sla.resolutionHrs}h`));
          }
          console.log('');

          // Summary
          console.log(chalk.bold('Summary:'));
          console.log(chalk.red(`  Breached: ${breached}`));
          console.log(chalk.yellow(`  At Risk:  ${atRisk}`));
          console.log(chalk.green(`  OK:       ${compliant}`));
          console.log(chalk.gray(`  Total:    ${active.length}`));
          console.log('');

          // Show breached first, then at-risk
          const showFirst = results
            .filter(r => r.firstResponseStatus === 'breached' || r.resolutionStatus === 'breached')
            .sort((a, b) => b.ageMs - a.ageMs);

          const showRisk = results
            .filter(r => (r.firstResponseStatus === 'at-risk' || r.resolutionStatus === 'at-risk') && r.firstResponseStatus !== 'breached' && r.resolutionStatus !== 'breached')
            .sort((a, b) => b.ageMs - a.ageMs);

          if (showFirst.length > 0) {
            console.log(chalk.red.bold('BREACHED:\n'));
            for (const r of showFirst.slice(0, 10)) {
              const age = formatDuration(r.ageMs);
              const fr = r.firstResponseMs !== null ? formatDuration(r.firstResponseMs) : 'NO RESPONSE';
              console.log(
                `  ${chalk.red('\u25CF')} #${r.externalId} [${r.priority.toUpperCase()}] ${r.subject.slice(0, 40)}`
              );
              console.log(
                `    Age: ${chalk.bold(age)} | FR: ${r.firstResponseStatus === 'breached' ? chalk.red(fr) : chalk.green(fr)} | Target: ${r.slaTargetFirstResponseHrs}h/${r.slaTargetResolutionHrs}h | ${chalk.gray(r.assignee ?? 'unassigned')}`
              );
            }
            console.log('');
          }

          if (showRisk.length > 0) {
            console.log(chalk.yellow.bold('AT RISK:\n'));
            for (const r of showRisk.slice(0, 10)) {
              const age = formatDuration(r.ageMs);
              const fr = r.firstResponseMs !== null ? formatDuration(r.firstResponseMs) : 'PENDING';
              console.log(
                `  ${chalk.yellow('\u25CF')} #${r.externalId} [${r.priority.toUpperCase()}] ${r.subject.slice(0, 40)}`
              );
              console.log(
                `    Age: ${chalk.bold(age)} | FR: ${fr} | Target: ${r.slaTargetFirstResponseHrs}h/${r.slaTargetResolutionHrs}h | ${chalk.gray(r.assignee ?? 'unassigned')}`
              );
            }
          }
        },
      );
    });
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  return `${hours}h ${mins}m`;
}

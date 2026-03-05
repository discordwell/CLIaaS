import type { Command } from 'commander';
import chalk from 'chalk';
import {
  getCampaigns,
  getCampaign,
  createCampaign,
  sendCampaign,
} from '../../src/lib/campaigns/campaign-store';

export function registerCampaignCommands(program: Command): void {
  const campaigns = program
    .command('campaigns')
    .description('Proactive/outbound messaging campaigns');

  campaigns
    .command('list')
    .description('List campaigns')
    .option('--status <status>', 'Filter by status (draft, scheduled, sending, sent, cancelled)')
    .option('--channel <channel>', 'Filter by channel (email, sms, whatsapp)')
    .option('--json', 'Output as JSON')
    .action(async (opts: { status?: string; channel?: string; json?: boolean }) => {
      try {
        const list = getCampaigns(opts.status, opts.channel);

        if (opts.json) {
          console.log(JSON.stringify({ campaigns: list }, null, 2));
          return;
        }

        console.log(chalk.bold.cyan(`\n${list.length} campaign(s)\n`));

        for (const c of list) {
          const statusColor =
            c.status === 'sent' ? chalk.green :
            c.status === 'draft' ? chalk.gray :
            c.status === 'sending' ? chalk.yellow :
            c.status === 'scheduled' ? chalk.blue :
            chalk.red;

          console.log(
            `  ${statusColor(`[${c.status.toUpperCase()}]`)} ${c.name}`,
          );
          console.log(
            `    ${chalk.dim(`ID: ${c.id} | Channel: ${c.channel} | Subject: ${c.subject ?? '—'}`)}`,
          );
        }
        console.log('');
      } catch (err) {
        console.error(
          chalk.red(`Failed to list campaigns: ${err instanceof Error ? err.message : 'Unknown error'}`),
        );
        process.exitCode = 1;
      }
    });

  campaigns
    .command('create')
    .description('Create a new campaign')
    .requiredOption('--name <name>', 'Campaign name')
    .requiredOption('--channel <channel>', 'Channel (email, sms, whatsapp)')
    .option('--subject <subject>', 'Subject line (for email)')
    .option('--body <body>', 'Template body')
    .option('--json', 'Output as JSON')
    .action(async (opts: {
      name: string;
      channel: string;
      subject?: string;
      body?: string;
      json?: boolean;
    }) => {
      try {
        const c = createCampaign({
          name: opts.name,
          channel: opts.channel as 'email' | 'sms' | 'whatsapp',
          status: 'draft',
          subject: opts.subject,
          templateBody: opts.body,
        });

        if (opts.json) {
          console.log(JSON.stringify({ campaign: c }, null, 2));
          return;
        }

        console.log(chalk.bold.green(`\nCampaign created: ${c.name}`));
        console.log(`  ID:      ${c.id}`);
        console.log(`  Channel: ${c.channel}`);
        console.log(`  Status:  ${c.status}`);
        if (c.subject) console.log(`  Subject: ${c.subject}`);
        console.log('');
      } catch (err) {
        console.error(
          chalk.red(`Failed to create campaign: ${err instanceof Error ? err.message : 'Unknown error'}`),
        );
        process.exitCode = 1;
      }
    });

  campaigns
    .command('send <id>')
    .description('Trigger sending a campaign')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const existing = getCampaign(id);
        if (!existing) {
          throw new Error(`Campaign not found: ${id}`);
        }

        const c = sendCampaign(id);
        if (!c) {
          throw new Error(`Failed to send campaign ${id} (may already be sent)`);
        }

        if (opts.json) {
          console.log(JSON.stringify({ campaign: c }, null, 2));
          return;
        }

        console.log(chalk.bold.green(`\nCampaign sent: ${c.name}`));
        console.log(`  ID:      ${c.id}`);
        console.log(`  Status:  ${c.status}`);
        console.log(`  Sent at: ${c.sentAt}`);
        console.log('');
      } catch (err) {
        console.error(
          chalk.red(`Failed to send campaign: ${err instanceof Error ? err.message : 'Unknown error'}`),
        );
        process.exitCode = 1;
      }
    });
}

import type { Command } from 'commander';
import chalk from 'chalk';

const BASE_URL = () => process.env.CLIAAS_API_URL || 'http://localhost:3000';

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
        const baseUrl = BASE_URL();
        const params = new URLSearchParams();
        if (opts.status) params.set('status', opts.status);
        if (opts.channel) params.set('channel', opts.channel);

        const res = await fetch(`${baseUrl}/api/campaigns?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const campaigns = data.campaigns ?? [];
        console.log(chalk.bold.cyan(`\n${campaigns.length} campaign(s)\n`));

        for (const c of campaigns) {
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
        const baseUrl = BASE_URL();
        const res = await fetch(`${baseUrl}/api/campaigns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: opts.name,
            channel: opts.channel,
            subject: opts.subject,
            templateBody: opts.body,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const c = data.campaign;
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
        const baseUrl = BASE_URL();
        const res = await fetch(`${baseUrl}/api/campaigns/${id}/send`, {
          method: 'POST',
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        const data = await res.json();

        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const c = data.campaign;
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

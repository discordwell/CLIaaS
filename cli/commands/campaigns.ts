import type { Command } from 'commander';
import chalk from 'chalk';
import {
  getCampaigns,
  getCampaign,
  createCampaign,
  sendCampaign,
  getCampaignSteps,
  addCampaignStep,
  removeCampaignStep,
  getCampaignFunnel,
  type Campaign,
  type CampaignStepType,
} from '../../src/lib/campaigns/campaign-store';
import { enrollCampaign, pauseCampaign, resumeCampaign } from '../../src/lib/campaigns/orchestration';

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
        const list = await getCampaigns({ status: opts.status as Campaign['status'], channel: opts.channel as Campaign['channel'] });

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
          channel: opts.channel as Campaign['channel'],
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
        const existing = await getCampaign(id);
        if (!existing) {
          throw new Error(`Campaign not found: ${id}`);
        }

        const c = await sendCampaign(id);
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

  campaigns
    .command('steps <campaignId>')
    .description('List steps in a campaign')
    .option('--json', 'Output as JSON')
    .action(async (campaignId: string, opts: { json?: boolean }) => {
      try {
        const list = await getCampaignSteps(campaignId);
        if (opts.json) { console.log(JSON.stringify({ steps: list }, null, 2)); return; }
        console.log(chalk.bold.cyan(`\n${list.length} step(s) for campaign ${campaignId}\n`));
        for (const s of list) {
          console.log(`  ${chalk.dim(`${s.position + 1}.`)} [${s.stepType}] ${s.name}`);
          console.log(`    ${chalk.dim(`ID: ${s.id}`)}`);
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`));
        process.exitCode = 1;
      }
    });

  campaigns
    .command('add-step <campaignId>')
    .description('Add a step to a campaign')
    .requiredOption('--type <type>', 'Step type (send_email, send_sms, wait_delay, condition, webhook, etc.)')
    .requiredOption('--name <name>', 'Step name')
    .option('--delay <seconds>', 'Delay in seconds (for wait_delay)')
    .option('--json', 'Output as JSON')
    .action(async (campaignId: string, opts: { type: string; name: string; delay?: string; json?: boolean }) => {
      try {
        const step = await addCampaignStep({
          campaignId,
          stepType: opts.type as CampaignStepType,
          name: opts.name,
          delaySeconds: opts.delay ? parseInt(opts.delay) : undefined,
        });
        if (opts.json) { console.log(JSON.stringify({ step }, null, 2)); return; }
        console.log(chalk.bold.green(`\nStep added: ${step.name} (${step.stepType})`));
        console.log(`  ID: ${step.id}`);
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`));
        process.exitCode = 1;
      }
    });

  campaigns
    .command('remove-step <stepId>')
    .description('Remove a step from a campaign')
    .action(async (stepId: string) => {
      const removed = removeCampaignStep(stepId);
      if (removed) console.log(chalk.green(`Step ${stepId} removed`));
      else { console.error(chalk.red('Step not found')); process.exitCode = 1; }
    });

  campaigns
    .command('activate <campaignId>')
    .description('Activate a campaign and enroll matching customers')
    .option('--json', 'Output as JSON')
    .action(async (campaignId: string, opts: { json?: boolean }) => {
      try {
        const result = await enrollCampaign(campaignId, []);
        if (!result.campaign) throw new Error('Campaign not found');
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        console.log(chalk.bold.green(`\nCampaign activated: ${result.campaign.name}`));
        console.log(`  Enrolled: ${result.enrolled} customer(s)`);
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`));
        process.exitCode = 1;
      }
    });

  campaigns
    .command('pause <campaignId>')
    .description('Pause an active campaign')
    .action(async (campaignId: string) => {
      const c = await pauseCampaign(campaignId);
      if (c) console.log(chalk.yellow(`Campaign paused: ${c.name}`));
      else { console.error(chalk.red('Campaign not found or not active')); process.exitCode = 1; }
    });

  campaigns
    .command('resume <campaignId>')
    .description('Resume a paused campaign')
    .action(async (campaignId: string) => {
      const c = await resumeCampaign(campaignId);
      if (c) console.log(chalk.green(`Campaign resumed: ${c.name}`));
      else { console.error(chalk.red('Campaign not found or not paused')); process.exitCode = 1; }
    });

  campaigns
    .command('funnel <campaignId>')
    .description('Show step-by-step funnel analytics')
    .option('--json', 'Output as JSON')
    .action(async (campaignId: string, opts: { json?: boolean }) => {
      try {
        const funnel = await getCampaignFunnel(campaignId);
        if (opts.json) { console.log(JSON.stringify({ funnel }, null, 2)); return; }
        console.log(chalk.bold.cyan(`\nFunnel for campaign ${campaignId}\n`));
        for (const entry of funnel) {
          console.log(`  ${entry.position + 1}. ${entry.stepName} (${entry.stepType})`);
          console.log(`     Executed: ${entry.executed} | Completed: ${entry.completed} | Failed: ${entry.failed} | Skipped: ${entry.skipped}`);
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`));
        process.exitCode = 1;
      }
    });
}

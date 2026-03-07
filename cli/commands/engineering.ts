import type { Command } from 'commander';
import chalk from 'chalk';
import { output, isJsonMode } from '../output.js';
import * as linkStore from '@/lib/integrations/link-store.js';
import { JiraClient } from '@/lib/integrations/jira-client.js';
import { LinearClient } from '@/lib/integrations/linear-client.js';
import {
  createIssueFromTicket,
  linkExistingIssue,
  syncWorkspaceLinks,
  type EngineeringProvider,
} from '@/lib/integrations/engineering-sync.js';

async function getJiraClient(workspaceId: string): Promise<JiraClient> {
  const creds = await linkStore.getCredentials(workspaceId, 'jira');
  if (!creds) throw new Error('Jira not configured. Run: cliaas jira configure');
  const c = creds.credentials as Record<string, string>;
  return new JiraClient({ baseUrl: c.baseUrl, email: c.email, apiToken: c.apiToken });
}

async function getLinearClient(workspaceId: string): Promise<LinearClient> {
  const creds = await linkStore.getCredentials(workspaceId, 'linear');
  if (!creds) throw new Error('Linear not configured. Run: cliaas linear configure');
  const c = creds.credentials as Record<string, string>;
  return new LinearClient({ apiKey: c.apiKey });
}

export function registerJiraCommands(program: Command): void {
  const jira = program.command('jira').description('Jira integration');

  jira
    .command('configure')
    .description('Set Jira credentials')
    .requiredOption('--base-url <url>', 'Jira Cloud URL (e.g. https://acme.atlassian.net)')
    .requiredOption('--email <email>', 'Jira email')
    .requiredOption('--token <token>', 'Jira API token')
    .action(async (opts: { baseUrl: string; email: string; token: string }) => {
      try {
        const client = new JiraClient({ baseUrl: opts.baseUrl, email: opts.email, apiToken: opts.token });
        const info = await client.verify();
        linkStore.saveCredentials({
          workspaceId: 'default',
          provider: 'jira',
          authType: 'api_token',
          credentials: { baseUrl: opts.baseUrl, email: opts.email, apiToken: opts.token },
          scopes: ['read', 'write'],
        });
        output({ ok: true, serverTitle: info.serverTitle }, () => {
          console.log(chalk.green(`Connected to ${info.serverTitle}`));
        });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  jira
    .command('create')
    .description('Create Jira issue from ticket')
    .requiredOption('--ticket <id>', 'CLIaaS ticket ID')
    .requiredOption('--project <key>', 'Jira project key (e.g. PROJ)')
    .option('--type <type>', 'Issue type', 'Task')
    .option('--subject <subject>', 'Issue summary')
    .action(async (opts: { ticket: string; project: string; type: string; subject?: string }) => {
      try {
        const client = await getJiraClient('default');
        const provider: EngineeringProvider = { provider: 'jira', jira: client };
        const link = await createIssueFromTicket(provider, {
          workspaceId: 'default',
          ticketId: opts.ticket,
          ticketSubject: opts.subject ?? `Ticket ${opts.ticket}`,
          projectKey: opts.project,
          issueType: opts.type,
        });
        output(link, () => {
          console.log(chalk.green(`Created Jira issue: ${link.externalId}`));
          console.log(`  URL: ${link.externalUrl}`);
        });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  jira
    .command('link')
    .description('Link existing Jira issue to ticket')
    .requiredOption('--ticket <id>', 'CLIaaS ticket ID')
    .requiredOption('--issue <key>', 'Jira issue key (e.g. PROJ-123)')
    .action(async (opts: { ticket: string; issue: string }) => {
      try {
        const client = await getJiraClient('default');
        const provider: EngineeringProvider = { provider: 'jira', jira: client };
        const link = await linkExistingIssue(provider, {
          workspaceId: 'default',
          ticketId: opts.ticket,
          issueKey: opts.issue,
        });
        output(link, () => {
          console.log(chalk.green(`Linked ${opts.issue} to ticket ${opts.ticket}`));
          console.log(`  Status: ${link.externalStatus}`);
        });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  jira
    .command('sync')
    .description('Sync all linked Jira issues')
    .action(async () => {
      try {
        const client = await getJiraClient('default');
        const provider: EngineeringProvider = { provider: 'jira', jira: client };
        const result = await syncWorkspaceLinks(provider, 'default');
        output(result, () => {
          console.log(chalk.bold('Jira Sync Complete'));
          console.log(`  Links: ${result.linksProcessed}, Status updates: ${result.statusUpdates}, Comments: ${result.commentsSync}`);
          if (result.errors.length) console.log(chalk.red(`  Errors: ${result.errors.length}`));
        });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  jira
    .command('status')
    .description('Show linked Jira issues')
    .action(async () => {
      const links = (await linkStore.listExternalLinks()).filter(l => l.provider === 'jira');
      output(links, () => {
        if (!links.length) { console.log('No Jira links found.'); return; }
        console.log(chalk.bold(`\nJira Links (${links.length})`));
        for (const l of links) {
          console.log(`  ${l.externalId} → ticket ${l.ticketId} [${l.externalStatus ?? 'unknown'}] ${l.externalUrl}`);
        }
      });
    });
}

export function registerLinearCommands(program: Command): void {
  const linear = program.command('linear').description('Linear integration');

  linear
    .command('configure')
    .description('Set Linear API key')
    .requiredOption('--api-key <key>', 'Linear API key')
    .action(async (opts: { apiKey: string }) => {
      try {
        const client = new LinearClient({ apiKey: opts.apiKey });
        const viewer = await client.verify();
        linkStore.saveCredentials({
          workspaceId: 'default',
          provider: 'linear',
          authType: 'pat',
          credentials: { apiKey: opts.apiKey },
          scopes: ['read', 'write'],
        });
        output({ ok: true, user: viewer.name }, () => {
          console.log(chalk.green(`Connected as ${viewer.name} (${viewer.email})`));
        });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  linear
    .command('create')
    .description('Create Linear issue from ticket')
    .requiredOption('--ticket <id>', 'CLIaaS ticket ID')
    .requiredOption('--team <id>', 'Linear team ID')
    .option('--title <title>', 'Issue title')
    .action(async (opts: { ticket: string; team: string; title?: string }) => {
      try {
        const client = await getLinearClient('default');
        const provider: EngineeringProvider = { provider: 'linear', linear: client };
        const link = await createIssueFromTicket(provider, {
          workspaceId: 'default',
          ticketId: opts.ticket,
          ticketSubject: opts.title ?? `Ticket ${opts.ticket}`,
          teamId: opts.team,
        });
        output(link, () => {
          console.log(chalk.green(`Created Linear issue: ${(link.metadata as Record<string, string>).identifier}`));
          console.log(`  URL: ${link.externalUrl}`);
        });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  linear
    .command('link')
    .description('Link existing Linear issue to ticket')
    .requiredOption('--ticket <id>', 'CLIaaS ticket ID')
    .requiredOption('--issue <id>', 'Linear issue identifier (e.g. ENG-42)')
    .action(async (opts: { ticket: string; issue: string }) => {
      try {
        const client = await getLinearClient('default');
        const provider: EngineeringProvider = { provider: 'linear', linear: client };
        const link = await linkExistingIssue(provider, {
          workspaceId: 'default',
          ticketId: opts.ticket,
          issueKey: opts.issue,
        });
        output(link, () => {
          console.log(chalk.green(`Linked ${opts.issue} to ticket ${opts.ticket}`));
          console.log(`  Status: ${link.externalStatus}`);
        });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  linear
    .command('sync')
    .description('Sync all linked Linear issues')
    .action(async () => {
      try {
        const client = await getLinearClient('default');
        const provider: EngineeringProvider = { provider: 'linear', linear: client };
        const result = await syncWorkspaceLinks(provider, 'default');
        output(result, () => {
          console.log(chalk.bold('Linear Sync Complete'));
          console.log(`  Links: ${result.linksProcessed}, Status updates: ${result.statusUpdates}, Comments: ${result.commentsSync}`);
          if (result.errors.length) console.log(chalk.red(`  Errors: ${result.errors.length}`));
        });
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
      }
    });

  linear
    .command('status')
    .description('Show linked Linear issues')
    .action(async () => {
      const links = (await linkStore.listExternalLinks()).filter(l => l.provider === 'linear');
      output(links, () => {
        if (!links.length) { console.log('No Linear links found.'); return; }
        console.log(chalk.bold(`\nLinear Links (${links.length})`));
        for (const l of links) {
          const identifier = (l.metadata as Record<string, string>)?.identifier ?? l.externalId;
          console.log(`  ${identifier} → ticket ${l.ticketId} [${l.externalStatus ?? 'unknown'}] ${l.externalUrl}`);
        }
      });
    });
}

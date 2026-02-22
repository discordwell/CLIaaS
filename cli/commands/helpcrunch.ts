import type { Command } from 'commander';
import chalk from 'chalk';
import {
  exportHelpcrunch,
  helpcrunchVerifyConnection,
  helpcrunchUpdateChat,
  helpcrunchPostMessage,
  helpcrunchCreateChat,
} from '../connectors/helpcrunch.js';
import type { HelpcrunchAuth } from '../connectors/helpcrunch.js';

function resolveAuth(opts: { apiKey?: string }): HelpcrunchAuth {
  const apiKey = opts.apiKey ?? process.env.HELPCRUNCH_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('Missing --api-key or HELPCRUNCH_API_KEY env var'));
    process.exit(1);
  }
  return { apiKey };
}

export function registerHelpcrunchCommands(program: Command): void {
  const hc = program
    .command('helpcrunch')
    .description('HelpCrunch operations: export, verify, update, reply, create');

  hc
    .command('verify')
    .description('Test HelpCrunch API connectivity and authentication')
    .option('--api-key <key>', 'API key (or HELPCRUNCH_API_KEY env)')
    .action(async (opts: { apiKey?: string }) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan('\nVerifying HelpCrunch connection...\n'));

      const result = await helpcrunchVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  Agents: ${result.agentCount}`);
        console.log(`  Chats:  ${result.chatCount}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

  hc
    .command('export')
    .description('Export all data from HelpCrunch')
    .option('--api-key <key>', 'API key (or HELPCRUNCH_API_KEY env)')
    .option('--out <dir>', 'Output directory', './exports/helpcrunch')
    .action(async (opts: { apiKey?: string; out: string }) => {
      const auth = resolveAuth(opts);
      try {
        const manifest = await exportHelpcrunch(auth, opts.out);
        console.log(chalk.green('\nExport summary:'));
        console.log(`  Chats:         ${manifest.counts.tickets}`);
        console.log(`  Messages:      ${manifest.counts.messages}`);
        console.log(`  Customers:     ${manifest.counts.customers}`);
        console.log(`  Organizations: ${manifest.counts.organizations}`);
        console.log(`  KB Articles:   ${manifest.counts.kbArticles}`);
        console.log(`  Rules:         ${manifest.counts.rules}`);
      } catch (err) {
        console.error(chalk.red(`Export failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  hc
    .command('update')
    .description('Update a HelpCrunch chat')
    .requiredOption('--chat <id>', 'Chat ID')
    .option('--api-key <key>', 'API key (or HELPCRUNCH_API_KEY env)')
    .option('--status <status>', 'Chat status (1=New, 2=Opened, 3=Pending, 4=On-hold, 5=Closed)')
    .option('--assignee <id>', 'Assignee agent ID')
    .option('--department <id>', 'Department ID')
    .action(async (opts: {
      chat: string; apiKey?: string;
      status?: string; assignee?: string; department?: string;
    }) => {
      const auth = resolveAuth(opts);
      const chatId = parseInt(opts.chat, 10);
      if (isNaN(chatId)) { console.error(chalk.red('Invalid chat ID')); process.exit(1); }
      const updates: { status?: number; assignee?: number; department?: number } = {};
      if (opts.status) updates.status = parseInt(opts.status, 10);
      if (opts.assignee) updates.assignee = parseInt(opts.assignee, 10);
      if (opts.department) updates.department = parseInt(opts.department, 10);

      if (Object.keys(updates).length === 0) {
        console.error(chalk.red('No updates specified. Use --status, --assignee, or --department'));
        process.exit(1);
      }

      try {
        await helpcrunchUpdateChat(auth, chatId, updates);
        console.log(chalk.green(`Chat #${chatId} updated successfully`));
      } catch (err) {
        console.error(chalk.red(`Update failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  hc
    .command('reply')
    .description('Post a message to a HelpCrunch chat')
    .requiredOption('--chat <id>', 'Chat ID')
    .requiredOption('--body <text>', 'Message text')
    .option('--api-key <key>', 'API key (or HELPCRUNCH_API_KEY env)')
    .action(async (opts: { chat: string; body: string; apiKey?: string }) => {
      const auth = resolveAuth(opts);
      const chatId = parseInt(opts.chat, 10);
      if (isNaN(chatId)) { console.error(chalk.red('Invalid chat ID')); process.exit(1); }
      try {
        await helpcrunchPostMessage(auth, chatId, opts.body);
        console.log(chalk.green(`Message posted to chat #${chatId}`));
      } catch (err) {
        console.error(chalk.red(`Reply failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });

  hc
    .command('create')
    .description('Create a new HelpCrunch chat')
    .requiredOption('--customer <id>', 'Customer ID')
    .requiredOption('--body <text>', 'Initial message text')
    .option('--api-key <key>', 'API key (or HELPCRUNCH_API_KEY env)')
    .action(async (opts: { customer: string; body: string; apiKey?: string }) => {
      const auth = resolveAuth(opts);
      const customerId = parseInt(opts.customer, 10);
      if (isNaN(customerId)) { console.error(chalk.red('Invalid customer ID')); process.exit(1); }
      try {
        const result = await helpcrunchCreateChat(auth, customerId, opts.body);
        console.log(chalk.green(`Chat #${result.id} created successfully`));
      } catch (err) {
        console.error(chalk.red(`Create failed: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

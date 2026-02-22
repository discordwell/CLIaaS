import type { Command } from 'commander';
import chalk from 'chalk';
import { exportIntercom, intercomVerifyConnection, intercomCreateConversation, intercomReplyToConversation, intercomAddNote } from '../connectors/intercom.js';
import type { IntercomAuth } from '../connectors/intercom.js';

function resolveAuth(opts: { accessToken?: string }): IntercomAuth {
  const accessToken = opts.accessToken ?? process.env.INTERCOM_ACCESS_TOKEN;
  if (!accessToken) { console.error(chalk.red('Missing --access-token or INTERCOM_ACCESS_TOKEN env var')); process.exit(1); }
  return { accessToken };
}

export function registerIntercomCommands(program: Command): void {
  const intercom = program
    .command('intercom')
    .description('Intercom operations: export, verify, create, reply, note');

  intercom
    .command('verify')
    .description('Test Intercom API connectivity')
    .option('--access-token <token>', 'Access token (or INTERCOM_ACCESS_TOKEN env)')
    .action(async (opts: { accessToken?: string }) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan('\nVerifying Intercom connection...\n'));

      const result = await intercomVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  App:    ${result.appName}`);
        console.log(`  Admins: ${result.adminCount}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

  intercom
    .command('export')
    .description('Export all data from Intercom')
    .option('--access-token <token>', 'Access token (or INTERCOM_ACCESS_TOKEN env)')
    .option('-o, --out <dir>', 'Output directory', './exports/intercom')
    .action(async (opts: { accessToken?: string; out: string }) => {
      const auth = resolveAuth(opts);
      await exportIntercom(auth, opts.out);
    });

  intercom
    .command('create')
    .description('Create a new conversation')
    .option('--access-token <token>', 'Access token (or INTERCOM_ACCESS_TOKEN env)')
    .requiredOption('--contact-id <id>', 'Contact ID')
    .requiredOption('--body <text>', 'Message body')
    .action(async (opts: { accessToken?: string; contactId: string; body: string }) => {
      const auth = resolveAuth(opts);
      const result = await intercomCreateConversation(auth, opts.contactId, opts.body);
      console.log(chalk.green(`Conversation created: ${result.id}`));
    });

  intercom
    .command('reply')
    .description('Reply to a conversation')
    .option('--access-token <token>', 'Access token (or INTERCOM_ACCESS_TOKEN env)')
    .requiredOption('--conversation-id <id>', 'Conversation ID')
    .requiredOption('--admin-id <id>', 'Admin ID')
    .requiredOption('--body <text>', 'Reply body')
    .action(async (opts: { accessToken?: string; conversationId: string; adminId: string; body: string }) => {
      const auth = resolveAuth(opts);
      await intercomReplyToConversation(auth, opts.conversationId, opts.body, opts.adminId);
      console.log(chalk.green('Reply posted'));
    });

  intercom
    .command('note')
    .description('Add an internal note to a conversation')
    .option('--access-token <token>', 'Access token (or INTERCOM_ACCESS_TOKEN env)')
    .requiredOption('--conversation-id <id>', 'Conversation ID')
    .requiredOption('--admin-id <id>', 'Admin ID')
    .requiredOption('--body <text>', 'Note body')
    .action(async (opts: { accessToken?: string; conversationId: string; adminId: string; body: string }) => {
      const auth = resolveAuth(opts);
      await intercomAddNote(auth, opts.conversationId, opts.body, opts.adminId);
      console.log(chalk.green('Note added'));
    });
}

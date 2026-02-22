import type { Command } from 'commander';
import chalk from 'chalk';
import { exportHelpScout, helpscoutVerifyConnection, helpscoutCreateConversation, helpscoutReply, helpscoutAddNote } from '../connectors/helpscout.js';
import type { HelpScoutAuth } from '../connectors/helpscout.js';

function resolveAuth(opts: { appId?: string; appSecret?: string }): HelpScoutAuth {
  const appId = opts.appId ?? process.env.HELPSCOUT_APP_ID;
  const appSecret = opts.appSecret ?? process.env.HELPSCOUT_APP_SECRET;
  if (!appId) { console.error(chalk.red('Missing --app-id or HELPSCOUT_APP_ID env var')); process.exit(1); }
  if (!appSecret) { console.error(chalk.red('Missing --app-secret or HELPSCOUT_APP_SECRET env var')); process.exit(1); }
  return { appId, appSecret };
}

export function registerHelpScoutCommands(program: Command): void {
  const helpscout = program
    .command('helpscout')
    .description('Help Scout operations: export, verify, create, reply, note');

  helpscout
    .command('verify')
    .description('Test Help Scout API connectivity')
    .option('--app-id <id>', 'OAuth App ID (or HELPSCOUT_APP_ID env)')
    .option('--app-secret <secret>', 'OAuth App Secret (or HELPSCOUT_APP_SECRET env)')
    .action(async (opts: { appId?: string; appSecret?: string }) => {
      const auth = resolveAuth(opts);
      console.log(chalk.cyan('\nVerifying Help Scout connection...\n'));

      const result = await helpscoutVerifyConnection(auth);
      if (result.success) {
        console.log(chalk.green('  ✓ Connection successful'));
        console.log(`  User:      ${result.userName}`);
        console.log(`  Mailboxes: ${result.mailboxCount}`);
        console.log('');
      } else {
        console.error(chalk.red(`  ✗ Connection failed: ${result.error}\n`));
        process.exit(1);
      }
    });

  helpscout
    .command('export')
    .description('Export all data from Help Scout')
    .option('--app-id <id>', 'OAuth App ID (or HELPSCOUT_APP_ID env)')
    .option('--app-secret <secret>', 'OAuth App Secret (or HELPSCOUT_APP_SECRET env)')
    .option('-o, --out <dir>', 'Output directory', './exports/helpscout')
    .action(async (opts: { appId?: string; appSecret?: string; out: string }) => {
      const auth = resolveAuth(opts);
      await exportHelpScout(auth, opts.out);
    });

  helpscout
    .command('create')
    .description('Create a new conversation')
    .option('--app-id <id>', 'OAuth App ID (or HELPSCOUT_APP_ID env)')
    .option('--app-secret <secret>', 'OAuth App Secret (or HELPSCOUT_APP_SECRET env)')
    .requiredOption('--mailbox-id <id>', 'Mailbox ID', parseInt)
    .requiredOption('--subject <text>', 'Conversation subject')
    .requiredOption('--body <text>', 'Message body')
    .option('--email <email>', 'Customer email')
    .action(async (opts: { appId?: string; appSecret?: string; mailboxId: number; subject: string; body: string; email?: string }) => {
      const auth = resolveAuth(opts);
      await helpscoutCreateConversation(auth, opts.mailboxId, opts.subject, opts.body, {
        customerEmail: opts.email,
      });
      console.log(chalk.green('Conversation created'));
    });

  helpscout
    .command('reply')
    .description('Reply to a conversation')
    .option('--app-id <id>', 'OAuth App ID (or HELPSCOUT_APP_ID env)')
    .option('--app-secret <secret>', 'OAuth App Secret (or HELPSCOUT_APP_SECRET env)')
    .requiredOption('--conversation-id <id>', 'Conversation ID', parseInt)
    .requiredOption('--body <text>', 'Reply body')
    .action(async (opts: { appId?: string; appSecret?: string; conversationId: number; body: string }) => {
      const auth = resolveAuth(opts);
      await helpscoutReply(auth, opts.conversationId, opts.body);
      console.log(chalk.green('Reply posted'));
    });

  helpscout
    .command('note')
    .description('Add an internal note')
    .option('--app-id <id>', 'OAuth App ID (or HELPSCOUT_APP_ID env)')
    .option('--app-secret <secret>', 'OAuth App Secret (or HELPSCOUT_APP_SECRET env)')
    .requiredOption('--conversation-id <id>', 'Conversation ID', parseInt)
    .requiredOption('--body <text>', 'Note body')
    .action(async (opts: { appId?: string; appSecret?: string; conversationId: number; body: string }) => {
      const auth = resolveAuth(opts);
      await helpscoutAddNote(auth, opts.conversationId, opts.body);
      console.log(chalk.green('Note added'));
    });
}

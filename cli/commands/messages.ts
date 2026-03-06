import type { Command } from 'commander';
import chalk from 'chalk';
import { getMessages, getMessage, createMessage, deleteMessage, toggleMessage, getMessageAnalytics } from '../../src/lib/messages/message-store';

export function registerMessageCommands(program: Command): void {
  const messages = program
    .command('messages')
    .description('In-app message management');

  messages
    .command('list')
    .description('List in-app messages')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const list = getMessages();
      if (opts.json) { console.log(JSON.stringify({ messages: list }, null, 2)); return; }
      console.log(chalk.bold.cyan(`\n${list.length} message(s)\n`));
      for (const m of list) {
        const status = m.isActive ? chalk.green('[ACTIVE]') : chalk.gray('[INACTIVE]');
        console.log(`  ${status} ${m.name} (${m.messageType})`);
        console.log(`    ${chalk.dim(`ID: ${m.id} | Title: ${m.title}`)}`);
      }
      console.log('');
    });

  messages
    .command('show <id>')
    .description('Show message details and analytics')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const msg = getMessage(id);
      if (!msg) { console.error(chalk.red('Message not found')); process.exitCode = 1; return; }
      const analytics = getMessageAnalytics(id);
      if (opts.json) { console.log(JSON.stringify({ message: msg, analytics }, null, 2)); return; }
      console.log(chalk.bold.cyan(`\n${msg.name}`));
      console.log(`  Type: ${msg.messageType} | Status: ${msg.isActive ? 'Active' : 'Inactive'}`);
      console.log(`  Title: ${msg.title}`);
      console.log(`  Body: ${msg.body}`);
      if (msg.ctaText) console.log(`  CTA: ${msg.ctaText} → ${msg.ctaUrl}`);
      console.log(`\n  Analytics:`);
      console.log(`    Displayed: ${analytics.displayed} | Clicked: ${analytics.clicked} | Dismissed: ${analytics.dismissed} | CTA Clicked: ${analytics.ctaClicked}`);
      console.log('');
    });

  messages
    .command('create')
    .description('Create a new in-app message')
    .requiredOption('--name <name>', 'Message name')
    .requiredOption('--type <type>', 'Type (banner, modal, tooltip, slide_in)')
    .requiredOption('--title <title>', 'Message title')
    .option('--body <body>', 'Message body')
    .option('--cta-text <text>', 'CTA button text')
    .option('--cta-url <url>', 'CTA button URL')
    .option('--url <pattern>', 'Target URL pattern', '*')
    .option('--json', 'Output as JSON')
    .action(async (opts: { name: string; type: string; title: string; body?: string; ctaText?: string; ctaUrl?: string; url: string; json?: boolean }) => {
      const msg = createMessage({
        name: opts.name,
        messageType: opts.type as 'banner' | 'modal' | 'tooltip' | 'slide_in',
        title: opts.title,
        body: opts.body,
        ctaText: opts.ctaText,
        ctaUrl: opts.ctaUrl,
        targetUrlPattern: opts.url,
      });
      if (opts.json) { console.log(JSON.stringify({ message: msg }, null, 2)); return; }
      console.log(chalk.bold.green(`\nMessage created: ${msg.name}`));
      console.log(`  ID: ${msg.id}`);
      console.log('');
    });

  messages
    .command('toggle <id>')
    .description('Toggle message active/inactive')
    .action(async (id: string) => {
      const msg = toggleMessage(id);
      if (msg) console.log(chalk.green(`Message ${msg.isActive ? 'activated' : 'deactivated'}: ${msg.name}`));
      else { console.error(chalk.red('Message not found')); process.exitCode = 1; }
    });

  messages
    .command('delete <id>')
    .description('Delete an in-app message')
    .action(async (id: string) => {
      const deleted = deleteMessage(id);
      if (deleted) console.log(chalk.green('Message deleted'));
      else { console.error(chalk.red('Message not found')); process.exitCode = 1; }
    });
}

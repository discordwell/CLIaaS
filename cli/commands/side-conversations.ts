import type { Command } from 'commander';

export function registerSideConversationCommands(program: Command): void {
  const sc = program
    .command('side-conversation')
    .alias('sc')
    .description('Manage side conversations on tickets');

  sc
    .command('list <ticketId>')
    .description('List side conversations for a ticket')
    .action(async (ticketId: string) => {
      try {
        const { listSideConversations } = await import('../../src/lib/side-conversations.js');
        const conversations = await listSideConversations(ticketId);

        if (conversations.length === 0) {
          console.log('No side conversations found.');
          return;
        }

        for (const c of conversations) {
          const status = c.status === 'open' ? '[OPEN]' : '[CLOSED]';
          console.log(`${status} ${c.id.slice(0, 8)} — ${c.subject ?? 'Untitled'} (${c.messageCount} msgs)`);
          if (c.externalEmail) console.log(`  Email: ${c.externalEmail}`);
        }
      } catch (err) {
        console.error('Failed:', err instanceof Error ? err.message : err);
      }
    });

  sc
    .command('create <ticketId>')
    .description('Create a side conversation')
    .requiredOption('-s, --subject <subject>', 'Subject')
    .requiredOption('-b, --body <body>', 'Message body')
    .option('-e, --email <email>', 'External email')
    .option('--send-email', 'Send email to external party')
    .action(async (ticketId: string, opts: { subject: string; body: string; email?: string; sendEmail?: boolean }) => {
      try {
        const { createSideConversation } = await import('../../src/lib/side-conversations.js');
        const result = await createSideConversation({
          ticketId,
          subject: opts.subject,
          body: opts.body,
          externalEmail: opts.email,
          authorId: 'cli-user',
          workspaceId: '',
          sendEmail: opts.sendEmail,
        });

        console.log(`Side conversation created: ${result.conversationId}`);
      } catch (err) {
        console.error('Failed:', err instanceof Error ? err.message : err);
      }
    });

  sc
    .command('reply <conversationId>')
    .description('Reply to a side conversation')
    .requiredOption('-b, --body <body>', 'Reply body')
    .option('--send-email', 'Send email to external party')
    .action(async (conversationId: string, opts: { body: string; sendEmail?: boolean }) => {
      try {
        const { replySideConversation } = await import('../../src/lib/side-conversations.js');
        const result = await replySideConversation({
          conversationId,
          body: opts.body,
          authorId: 'cli-user',
          sendEmail: opts.sendEmail,
        });

        console.log(`Reply sent: ${result.messageId}`);
      } catch (err) {
        console.error('Failed:', err instanceof Error ? err.message : err);
      }
    });

  sc
    .command('close <conversationId>')
    .description('Close a side conversation')
    .action(async (conversationId: string) => {
      try {
        const { closeSideConversation } = await import('../../src/lib/side-conversations.js');
        await closeSideConversation(conversationId);
        console.log('Side conversation closed.');
      } catch (err) {
        console.error('Failed:', err instanceof Error ? err.message : err);
      }
    });
}

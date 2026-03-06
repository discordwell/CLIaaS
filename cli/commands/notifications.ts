import type { Command } from 'commander';

export function registerNotificationCommands(program: Command): void {
  const notif = program
    .command('notifications')
    .description('Manage agent notifications');

  notif
    .command('list')
    .description('List notifications')
    .option('--unread', 'Only show unread notifications')
    .option('--limit <n>', 'Max notifications', '20')
    .action(async (opts: { unread?: boolean; limit: string }) => {
      try {
        const { tryDb } = await import('../../src/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) {
          console.log('No database configured. Notifications require a database.');
          return;
        }

        const { desc, isNull, and } = await import('drizzle-orm');
        const conditions = [];

        if (opts.unread) {
          conditions.push(isNull(conn.schema.notifications.readAt));
        }

        const rows = await conn.db
          .select()
          .from(conn.schema.notifications)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(conn.schema.notifications.createdAt))
          .limit(parseInt(opts.limit, 10));

        if (rows.length === 0) {
          console.log('No notifications found.');
          return;
        }

        for (const row of rows) {
          const readMark = row.readAt ? '  ' : '* ';
          const time = new Date(row.createdAt).toLocaleString();
          console.log(`${readMark}[${row.id.slice(0, 8)}] ${row.title} (${time})`);
          if (row.body) console.log(`   ${row.body.slice(0, 100)}`);
        }

        console.log(`\n${rows.length} notification(s) shown.`);
      } catch (err) {
        console.error('Failed to list notifications:', err instanceof Error ? err.message : err);
      }
    });

  notif
    .command('read <id>')
    .description('Mark a notification as read')
    .action(async (id: string) => {
      try {
        const { tryDb } = await import('../../src/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) {
          console.log('No database configured.');
          return;
        }

        const { eq } = await import('drizzle-orm');
        await conn.db
          .update(conn.schema.notifications)
          .set({ readAt: new Date() })
          .where(eq(conn.schema.notifications.id, id));

        console.log(`Notification ${id} marked as read.`);
      } catch (err) {
        console.error('Failed:', err instanceof Error ? err.message : err);
      }
    });

  notif
    .command('read-all')
    .description('Mark all notifications as read')
    .action(async () => {
      try {
        const { tryDb } = await import('../../src/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) {
          console.log('No database configured.');
          return;
        }

        const { isNull } = await import('drizzle-orm');
        const result = await conn.db
          .update(conn.schema.notifications)
          .set({ readAt: new Date() })
          .where(isNull(conn.schema.notifications.readAt))
          .returning({ id: conn.schema.notifications.id });

        console.log(`${result.length} notification(s) marked as read.`);
      } catch (err) {
        console.error('Failed:', err instanceof Error ? err.message : err);
      }
    });
}

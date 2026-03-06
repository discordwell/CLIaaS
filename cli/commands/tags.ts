import type { Command } from 'commander';

export function registerTagCommands(program: Command): void {
  const tags = program.command('tags').description('Manage tags');

  tags
    .command('list')
    .description('List all tags with usage counts')
    .action(async () => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) { console.error('DB not available'); return; }

        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
        const { eq, sql } = await import('drizzle-orm');

        const rows = await conn.db
          .select({
            id: conn.schema.tags.id,
            name: conn.schema.tags.name,
            color: conn.schema.tags.color,
            usageCount: sql<number>`(SELECT COUNT(*) FROM ticket_tags WHERE tag_id = ${conn.schema.tags.id})`,
          })
          .from(conn.schema.tags)
          .where(eq(conn.schema.tags.workspaceId, wsId))
          .orderBy(conn.schema.tags.name);

        console.log(`\n  Tags (${rows.length}):\n`);
        for (const t of rows) {
          console.log(`  ${t.name} (${t.color}) — ${t.usageCount} tickets`);
        }
        console.log('');
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  tags
    .command('create <name>')
    .description('Create a tag')
    .option('-c, --color <hex>', 'Tag color', '#71717a')
    .option('-d, --description <desc>', 'Tag description')
    .action(async (name: string, opts: { color: string; description?: string }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) { console.error('DB not available'); return; }

        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
        const [row] = await conn.db.insert(conn.schema.tags).values({
          workspaceId: wsId,
          name: name.trim(),
          color: opts.color,
          description: opts.description ?? null,
        }).onConflictDoNothing().returning();

        console.log(row ? `Created tag: ${row.id}` : 'Tag already exists');
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  tags
    .command('delete <id>')
    .description('Delete a tag')
    .action(async (id: string) => {
      try {
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) { console.error('DB not available'); return; }

        const { eq } = await import('drizzle-orm');

        let found = false;
        await conn.db.transaction(async (tx) => {
          const affected = await tx
            .select({ ticketId: conn.schema.ticketTags.ticketId })
            .from(conn.schema.ticketTags)
            .where(eq(conn.schema.ticketTags.tagId, id));

          await tx.delete(conn.schema.ticketTags).where(eq(conn.schema.ticketTags.tagId, id));
          const [deleted] = await tx.delete(conn.schema.tags)
            .where(eq(conn.schema.tags.id, id)).returning({ id: conn.schema.tags.id });
          if (!deleted) return;
          found = true;

          for (const { ticketId } of affected) {
            const remaining = await tx
              .select({ name: conn.schema.tags.name })
              .from(conn.schema.ticketTags)
              .innerJoin(conn.schema.tags, eq(conn.schema.tags.id, conn.schema.ticketTags.tagId))
              .where(eq(conn.schema.ticketTags.ticketId, ticketId));
            await tx
              .update(conn.schema.tickets)
              .set({ tags: remaining.map((r: { name: string }) => r.name) })
              .where(eq(conn.schema.tickets.id, ticketId));
          }
        });

        console.log(found ? `Deleted tag: ${id}` : 'Tag not found');
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  tags
    .command('add')
    .description('Add tags to a ticket')
    .requiredOption('-t, --ticket <id>', 'Ticket ID')
    .requiredOption('--tags <tags>', 'Comma-separated tag names')
    .action(async (opts: { ticket: string; tags: string }) => {
      try {
        const tagList = opts.tags.split(',').map((t) => t.trim()).filter(Boolean);
        const { getDataProvider } = await import('@/lib/data-provider/index.js');
        const provider = await getDataProvider();
        await provider.updateTicket(opts.ticket, { addTags: tagList });
        console.log(`Added tags [${tagList.join(', ')}] to ticket ${opts.ticket}`);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  tags
    .command('remove')
    .description('Remove tags from a ticket')
    .requiredOption('-t, --ticket <id>', 'Ticket ID')
    .requiredOption('--tags <tags>', 'Comma-separated tag names')
    .action(async (opts: { ticket: string; tags: string }) => {
      try {
        const tagList = opts.tags.split(',').map((t) => t.trim()).filter(Boolean);
        const { getDataProvider } = await import('@/lib/data-provider/index.js');
        const provider = await getDataProvider();
        await provider.updateTicket(opts.ticket, { removeTags: tagList });
        console.log(`Removed tags [${tagList.join(', ')}] from ticket ${opts.ticket}`);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });
}

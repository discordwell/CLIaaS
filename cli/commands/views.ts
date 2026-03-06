import type { Command } from 'commander';

export function registerViewCommands(program: Command): void {
  const views = program.command('views').description('Manage saved views');

  views
    .command('list')
    .description('List all views')
    .action(async () => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq } = await import('drizzle-orm');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const rows = await conn.db
            .select()
            .from(conn.schema.views)
            .where(eq(conn.schema.views.workspaceId, wsId))
            .orderBy(conn.schema.views.position);

          console.log(`\n  Views (${rows.length}):\n`);
          for (const v of rows) {
            const type = (v as Record<string, unknown>).viewType ?? 'shared';
            console.log(`  [${type}] ${v.name} (${v.id.slice(0, 8)})`);
          }
        } else {
          const { listViews } = await import('@/lib/views/store.js');
          const all = listViews();
          console.log(`\n  Views (${all.length}):\n`);
          for (const v of all) {
            console.log(`  [${v.viewType}] ${v.name} (${v.id.slice(0, 8)})`);
          }
        }
        console.log('');
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  views
    .command('show <id>')
    .description('Show view details')
    .action(async (id: string) => {
      try {
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq } = await import('drizzle-orm');
          const [row] = await conn.db.select().from(conn.schema.views)
            .where(eq(conn.schema.views.id, id)).limit(1);
          if (!row) { console.error('View not found'); return; }
          console.log(JSON.stringify(row, null, 2));
        } else {
          const { getView } = await import('@/lib/views/store.js');
          const view = getView(id);
          if (!view) { console.error('View not found'); return; }
          console.log(JSON.stringify(view, null, 2));
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  views
    .command('create')
    .description('Create a new view')
    .requiredOption('-n, --name <name>', 'View name')
    .option('-d, --description <desc>', 'View description')
    .option('--field <field>', 'Condition field (status, priority, tag, etc.)')
    .option('--op <operator>', 'Condition operator (is, is_not, contains, etc.)')
    .option('--val <value>', 'Condition value')
    .option('--type <type>', 'View type: shared or personal', 'shared')
    .action(async (opts: { name: string; description?: string; field?: string; op?: string; val?: string; type?: string }) => {
      try {
        const conditions = [];
        if (opts.field && opts.op) {
          conditions.push({ field: opts.field, operator: opts.op, value: opts.val });
        }
        const query = { conditions, combineMode: 'and' as const };

        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [row] = await conn.db.insert(conn.schema.views).values({
            workspaceId: wsId,
            name: opts.name,
            description: opts.description ?? null,
            query,
            viewType: opts.type ?? 'shared',
            position: 0,
          }).returning();
          console.log(`Created view: ${row.id}`);
        } else {
          const { createView } = await import('@/lib/views/store.js');
          const view = createView({ name: opts.name, description: opts.description, query, viewType: (opts.type ?? 'shared') as 'shared' | 'personal' });
          console.log(`Created view: ${view.id}`);
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  views
    .command('execute <id>')
    .description('Execute a view and list matching tickets')
    .option('--limit <n>', 'Max tickets', '20')
    .action(async (id: string, opts: { limit: string }) => {
      try {
        const { getDataProvider } = await import('@/lib/data-provider/index.js');
        const provider = await getDataProvider();
        const tickets = await provider.loadTickets();

        let query;
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq } = await import('drizzle-orm');
          const [row] = await conn.db.select({ query: conn.schema.views.query })
            .from(conn.schema.views).where(eq(conn.schema.views.id, id)).limit(1);
          if (!row) { console.error('View not found'); return; }
          query = row.query;
        } else {
          const { getView } = await import('@/lib/views/store.js');
          const view = getView(id);
          if (!view) { console.error('View not found'); return; }
          query = view.query;
        }

        const { executeViewQuery } = await import('@/lib/views/executor.js');
        const result = executeViewQuery(query as import('@/lib/views/types.js').ViewQuery, tickets);
        const limited = result.slice(0, parseInt(opts.limit, 10));

        console.log(`\n  ${result.length} tickets match (showing ${limited.length}):\n`);
        for (const t of limited) {
          console.log(`  [${t.status}] ${t.priority} - ${t.subject} (${t.id.slice(0, 8)})`);
        }
        console.log('');
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });

  views
    .command('delete <id>')
    .description('Delete a view')
    .action(async (id: string) => {
      try {
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq, and, ne } = await import('drizzle-orm');
          const { getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [deleted] = await conn.db.delete(conn.schema.views)
            .where(and(eq(conn.schema.views.id, id), eq(conn.schema.views.workspaceId, wsId), ne(conn.schema.views.viewType, 'system')))
            .returning({ id: conn.schema.views.id });
          if (!deleted) { console.error('View not found or system view'); return; }
          console.log(`Deleted view: ${id}`);
        } else {
          const { deleteView } = await import('@/lib/views/store.js');
          if (!deleteView(id)) { console.error('View not found or system view'); return; }
          console.log(`Deleted view: ${id}`);
        }
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    });
}

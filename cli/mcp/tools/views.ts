import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { scopeGuard } from './scopes.js';

export function registerViewTools(server: McpServer): void {
  server.tool(
    'view_list',
    'List saved views',
    {},
    async () => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq } = await import('drizzle-orm');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const rows = await conn.db.select().from(conn.schema.views)
            .where(eq(conn.schema.views.workspaceId, wsId))
            .orderBy(conn.schema.views.position);

          return textResult({
            count: rows.length,
            views: rows.map((r: Record<string, unknown>) => ({
              id: r.id, name: r.name, viewType: r.viewType ?? 'shared',
              description: r.description, active: r.active,
            })),
          });
        }

        const { listViews } = await import('@/lib/views/store.js');
        const all = listViews();
        return textResult({
          count: all.length,
          views: all.map(v => ({ id: v.id, name: v.name, viewType: v.viewType, description: v.description })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list views');
      }
    },
  );

  server.tool(
    'view_create',
    'Create a saved view with filter conditions (requires confirm=true)',
    {
      name: z.string().describe('View name'),
      description: z.string().optional().describe('View description'),
      conditions: z.array(z.object({
        field: z.string().describe('Field: status, priority, tag, assignee, requester, source, subject, created_at, updated_at'),
        operator: z.string().describe('Operator: is, is_not, contains, not_contains, is_empty, is_not_empty, greater_than, less_than'),
        value: z.string().optional().describe('Filter value'),
      })).describe('Filter conditions'),
      combineMode: z.enum(['and', 'or']).optional().describe('Combine mode (default: and)'),
      viewType: z.enum(['shared', 'personal']).optional().describe('View type'),
      confirm: z.boolean().optional(),
    },
    async ({ name, description, conditions, combineMode, viewType, confirm }) => {
      const guard = scopeGuard('view_create');
      if (guard) return guard;

      if (!confirm) {
        return textResult({
          needsConfirmation: true,
          preview: { name, conditions, combineMode: combineMode ?? 'and', viewType: viewType ?? 'shared' },
        });
      }

      try {
        const query = { conditions, combineMode: combineMode ?? 'and' };
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [row] = await conn.db.insert(conn.schema.views).values({
            workspaceId: wsId,
            name,
            description: description ?? null,
            query,
            viewType: viewType ?? 'shared',
            position: 0,
          }).returning();
          return textResult({ created: true, viewId: row.id, name });
        }

        const { createView } = await import('@/lib/views/store.js');
        const view = createView({ name, description, query: query as import('@/lib/views/types.js').ViewQuery, viewType });
        return textResult({ created: true, viewId: view.id, name });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to create view');
      }
    },
  );

  server.tool(
    'view_get',
    'Get details of a saved view',
    { viewId: z.string().describe('View ID') },
    async ({ viewId }) => {
      try {
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq, and } = await import('drizzle-orm');
          const { getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [row] = await conn.db.select().from(conn.schema.views)
            .where(and(eq(conn.schema.views.id, viewId), eq(conn.schema.views.workspaceId, wsId))).limit(1);
          if (!row) return errorResult('View not found');
          return textResult(row);
        }

        const { getView } = await import('@/lib/views/store.js');
        const view = getView(viewId);
        if (!view) return errorResult('View not found');
        return textResult(view);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  server.tool(
    'view_execute',
    'Execute a saved view and return matching tickets',
    {
      viewId: z.string().describe('View ID'),
      limit: z.number().optional().describe('Max tickets to return (default 50)'),
    },
    async ({ viewId, limit }) => {
      try {
        let query;
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq, and } = await import('drizzle-orm');
          const { getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [row] = await conn.db.select({ query: conn.schema.views.query })
            .from(conn.schema.views).where(and(eq(conn.schema.views.id, viewId), eq(conn.schema.views.workspaceId, wsId))).limit(1);
          if (!row) return errorResult('View not found');
          query = row.query;
        } else {
          const { getView } = await import('@/lib/views/store.js');
          const view = getView(viewId);
          if (!view) return errorResult('View not found');
          query = view.query;
        }

        const { getDataProvider } = await import('@/lib/data-provider/index.js');
        const provider = await getDataProvider();
        const tickets = await provider.loadTickets();

        const { executeViewQuery } = await import('@/lib/views/executor.js');
        const result = executeViewQuery(query as import('@/lib/views/types.js').ViewQuery, tickets);
        const limited = result.slice(0, limit ?? 50);

        return textResult({
          totalMatches: result.length,
          returned: limited.length,
          tickets: limited.map(t => ({
            id: t.id, subject: t.subject, status: t.status,
            priority: t.priority, assignee: t.assignee, tags: t.tags,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  server.tool(
    'view_delete',
    'Delete a saved view (requires confirm=true)',
    {
      viewId: z.string().describe('View ID'),
      confirm: z.boolean().optional(),
    },
    async ({ viewId, confirm }) => {
      const guard = scopeGuard('view_delete');
      if (guard) return guard;

      if (!confirm) {
        return textResult({ needsConfirmation: true, preview: { viewId } });
      }

      try {
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (conn) {
          const { eq, and, ne } = await import('drizzle-orm');
          const { getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [deleted] = await conn.db.delete(conn.schema.views)
            .where(and(eq(conn.schema.views.id, viewId), eq(conn.schema.views.workspaceId, wsId), ne(conn.schema.views.viewType, 'system')))
            .returning({ id: conn.schema.views.id });
          if (!deleted) return errorResult('View not found or system view');
          return textResult({ deleted: true, viewId });
        }

        const { deleteView } = await import('@/lib/views/store.js');
        if (!deleteView(viewId)) return errorResult('View not found or system view');
        return textResult({ deleted: true, viewId });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );
}

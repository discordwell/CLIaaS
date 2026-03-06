import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeLoadTickets, findTicket } from '../util.js';
import { scopeGuard } from './scopes.js';
import { withConfirmation, recordMCPAction } from './confirm.js';

export function registerTagTools(server: McpServer): void {
  server.tool(
    'tag_list',
    'List all tags with usage counts',
    {},
    async () => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) return textResult({ tags: [], message: 'DB not available' });

        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
        const { eq, sql } = await import('drizzle-orm');

        const rows = await conn.db
          .select({
            id: conn.schema.tags.id,
            name: conn.schema.tags.name,
            color: conn.schema.tags.color,
            description: conn.schema.tags.description,
            usageCount: sql<number>`(SELECT COUNT(*) FROM ticket_tags WHERE tag_id = ${conn.schema.tags.id})`,
          })
          .from(conn.schema.tags)
          .where(eq(conn.schema.tags.workspaceId, wsId))
          .orderBy(conn.schema.tags.name);

        return textResult({ count: rows.length, tags: rows });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  server.tool(
    'tag_create',
    'Create a new tag (requires confirm=true)',
    {
      name: z.string().describe('Tag name'),
      color: z.string().optional().describe('Tag color hex (default #71717a)'),
      description: z.string().optional().describe('Tag description'),
      confirm: z.boolean().optional(),
    },
    async ({ name, color, description, confirm }) => {
      const guard = scopeGuard('tag_create');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create tag "${name}"`,
        preview: { name, color: color ?? '#71717a', description },
        execute: async () => {
          const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return { error: 'DB not available' };

          const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
          const [row] = await conn.db.insert(conn.schema.tags).values({
            workspaceId: wsId,
            name: name.trim(),
            color: color ?? '#71717a',
            description: description ?? null,
          }).onConflictDoNothing().returning();

          recordMCPAction({
            tool: 'tag_create', action: 'create',
            params: { name }, timestamp: new Date().toISOString(), result: 'success',
          });

          return row ? { created: true, tag: row } : { created: false, message: 'Tag already exists' };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  server.tool(
    'tag_add',
    'Add tags to a ticket (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID'),
      tags: z.array(z.string()).describe('Tag names to add'),
      confirm: z.boolean().optional(),
      dir: z.string().optional(),
    },
    async ({ ticketId, tags, confirm, dir }) => {
      const guard = scopeGuard('tag_add');
      if (guard) return guard;

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const result = withConfirmation(confirm, {
        description: `Add tags [${tags.join(', ')}] to ticket ${ticket.id}`,
        preview: { ticketId: ticket.id, subject: ticket.subject, tags },
        execute: async () => {
          const { getDataProvider } = await import('@/lib/data-provider/index.js');
          const provider = await getDataProvider(dir);
          await provider.updateTicket(ticket.id, { addTags: tags });

          recordMCPAction({
            tool: 'tag_add', action: 'add',
            params: { ticketId: ticket.id, tags },
            timestamp: new Date().toISOString(), result: 'success',
          });
          return { added: true, ticketId: ticket.id, tags };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  server.tool(
    'tag_remove',
    'Remove tags from a ticket (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID'),
      tags: z.array(z.string()).describe('Tag names to remove'),
      confirm: z.boolean().optional(),
      dir: z.string().optional(),
    },
    async ({ ticketId, tags, confirm, dir }) => {
      const guard = scopeGuard('tag_remove');
      if (guard) return guard;

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const result = withConfirmation(confirm, {
        description: `Remove tags [${tags.join(', ')}] from ticket ${ticket.id}`,
        preview: { ticketId: ticket.id, subject: ticket.subject, tags },
        execute: async () => {
          const { getDataProvider } = await import('@/lib/data-provider/index.js');
          const provider = await getDataProvider(dir);
          await provider.updateTicket(ticket.id, { removeTags: tags });

          recordMCPAction({
            tool: 'tag_remove', action: 'remove',
            params: { ticketId: ticket.id, tags },
            timestamp: new Date().toISOString(), result: 'success',
          });
          return { removed: true, ticketId: ticket.id, tags };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  server.tool(
    'tag_delete',
    'Delete a tag entirely (requires confirm=true)',
    {
      tagId: z.string().describe('Tag ID'),
      confirm: z.boolean().optional(),
    },
    async ({ tagId, confirm }) => {
      const guard = scopeGuard('tag_delete');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Delete tag ${tagId}`,
        preview: { tagId },
        execute: async () => {
          const { tryDb } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return { error: 'DB not available' };

          const { eq } = await import('drizzle-orm');
          await conn.db.delete(conn.schema.ticketTags).where(eq(conn.schema.ticketTags.tagId, tagId));
          const [deleted] = await conn.db.delete(conn.schema.tags)
            .where(eq(conn.schema.tags.id, tagId)).returning({ id: conn.schema.tags.id });

          if (!deleted) return { error: 'Tag not found' };

          recordMCPAction({
            tool: 'tag_delete', action: 'delete',
            params: { tagId }, timestamp: new Date().toISOString(), result: 'success',
          });
          return { deleted: true, tagId };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );
}

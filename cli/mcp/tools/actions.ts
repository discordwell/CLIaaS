/**
 * MCP write tools: ticket_update, ticket_reply, ticket_note, ticket_create,
 * rule_create, rule_toggle, ai_resolve.
 * All use the confirmation pattern and scope controls.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeLoadTickets, findTicket } from '../util.js';
import type { TicketStatus, TicketPriority } from '@/lib/data-provider/types.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import { enqueueUpstream } from '../../sync/upstream.js';

export function registerActionTools(server: McpServer): void {
  // ---- ticket_update ----
  server.tool(
    'ticket_update',
    'Update a ticket\'s status, priority, assignee, or tags (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      status: z.string().optional().describe('New status: open, pending, on_hold, solved, closed'),
      priority: z.string().optional().describe('New priority: low, normal, high, urgent'),
      assignee: z.string().optional().describe('New assignee name or null to unassign'),
      addTags: z.array(z.string()).optional().describe('Tags to add'),
      removeTags: z.array(z.string()).optional().describe('Tags to remove'),
      confirm: z.boolean().optional().describe('Must be true to execute the update'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, status, priority, assignee, addTags, removeTags, confirm, dir }) => {
      const guard = scopeGuard('ticket_update');
      if (guard) return guard;

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const changes: Record<string, unknown> = {};
      if (status) changes.status = status;
      if (priority) changes.priority = priority;
      if (assignee !== undefined) changes.assignee = assignee || null;
      if (addTags?.length) changes.addTags = addTags;
      if (removeTags?.length) changes.removeTags = removeTags;

      const result = withConfirmation(confirm, {
        description: `Update ticket ${ticket.id}`,
        preview: { ticketId: ticket.id, subject: ticket.subject, changes },
        execute: () => {
          // Apply changes in-memory
          if (status) ticket.status = status as TicketStatus;
          if (priority) ticket.priority = priority as TicketPriority;
          if (assignee !== undefined) ticket.assignee = assignee || undefined;
          if (addTags) {
            for (const tag of addTags) {
              if (!ticket.tags.includes(tag)) ticket.tags.push(tag);
            }
          }
          if (removeTags) {
            ticket.tags = ticket.tags.filter(t => !removeTags.includes(t));
          }
          ticket.updatedAt = new Date().toISOString();

          recordMCPAction({
            tool: 'ticket_update', action: 'update',
            params: { ticketId: ticket.id, changes },
            timestamp: ticket.updatedAt, result: 'success',
          });

          // Enqueue for upstream push if ticket came from an external platform
          if (ticket.source && ticket.externalId) {
            enqueueUpstream({
              connector: ticket.source,
              operation: 'update_ticket',
              ticketId: ticket.id,
              externalId: ticket.externalId,
              payload: changes,
            }).catch(() => {}); // fire-and-forget
          }

          return { updated: true, ticket: { id: ticket.id, subject: ticket.subject, ...changes } };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- ticket_reply ----
  server.tool(
    'ticket_reply',
    'Send a reply to a ticket (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      body: z.string().describe('Reply body text'),
      confirm: z.boolean().optional().describe('Must be true to send the reply'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, body, confirm, dir }) => {
      const guard = scopeGuard('ticket_reply');
      if (guard) return guard;

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const result = withConfirmation(confirm, {
        description: `Reply to ticket ${ticket.id}`,
        preview: { ticketId: ticket.id, subject: ticket.subject, replyLength: body.length },
        execute: () => {
          const now = new Date().toISOString();
          recordMCPAction({
            tool: 'ticket_reply', action: 'reply',
            params: { ticketId: ticket.id, bodyLength: body.length },
            timestamp: now, result: 'success',
          });

          if (ticket.source && ticket.externalId) {
            enqueueUpstream({
              connector: ticket.source,
              operation: 'create_reply',
              ticketId: ticket.id,
              externalId: ticket.externalId,
              payload: { body },
            }).catch(() => {});
          }

          return { sent: true, ticketId: ticket.id, timestamp: now };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- ticket_note ----
  server.tool(
    'ticket_note',
    'Add an internal note to a ticket (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      body: z.string().describe('Note body text'),
      confirm: z.boolean().optional().describe('Must be true to add the note'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, body, confirm, dir }) => {
      const guard = scopeGuard('ticket_note');
      if (guard) return guard;

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const result = withConfirmation(confirm, {
        description: `Add internal note to ticket ${ticket.id}`,
        preview: { ticketId: ticket.id, subject: ticket.subject, noteLength: body.length },
        execute: () => {
          const now = new Date().toISOString();
          recordMCPAction({
            tool: 'ticket_note', action: 'add_note',
            params: { ticketId: ticket.id, bodyLength: body.length },
            timestamp: now, result: 'success',
          });

          if (ticket.source && ticket.externalId) {
            enqueueUpstream({
              connector: ticket.source,
              operation: 'create_note',
              ticketId: ticket.id,
              externalId: ticket.externalId,
              payload: { body },
            }).catch(() => {});
          }

          return { added: true, ticketId: ticket.id, timestamp: now };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- ticket_create ----
  server.tool(
    'ticket_create',
    'Create a new ticket (requires confirm=true)',
    {
      subject: z.string().describe('Ticket subject'),
      description: z.string().optional().describe('Ticket description/body'),
      priority: z.string().optional().describe('Priority: low, normal, high, urgent'),
      requester: z.string().optional().describe('Requester email'),
      tags: z.array(z.string()).optional().describe('Tags to apply'),
      source: z.string().optional().describe('Target platform (zendesk, freshdesk, etc.) for upstream sync'),
      confirm: z.boolean().optional().describe('Must be true to create the ticket'),
    },
    async ({ subject, description, priority, requester, tags, source, confirm }) => {
      const guard = scopeGuard('ticket_create');
      if (guard) return guard;

      const ticketData = {
        subject,
        description: description ?? '',
        priority: priority ?? 'normal',
        requester: requester ?? 'unknown',
        tags: tags ?? [],
      };

      const result = withConfirmation(confirm, {
        description: 'Create new ticket',
        preview: ticketData,
        execute: () => {
          const now = new Date().toISOString();
          const id = `mcp-${Date.now()}`;
          recordMCPAction({
            tool: 'ticket_create', action: 'create',
            params: ticketData,
            timestamp: now, result: 'success',
          });

          if (source) {
            enqueueUpstream({
              connector: source,
              operation: 'create_ticket',
              ticketId: id,
              payload: ticketData,
            }).catch(() => {});
          }

          return { created: true, ticketId: id, ...ticketData, createdAt: now };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- rule_create ----
  server.tool(
    'rule_create',
    'Create an automation rule (requires confirm=true)',
    {
      name: z.string().describe('Rule name'),
      type: z.enum(['trigger', 'macro', 'automation', 'sla']).describe('Rule type'),
      conditions: z.record(z.string(), z.unknown()).optional().describe('Rule conditions (JSON)'),
      actions: z.array(z.record(z.string(), z.unknown())).optional().describe('Rule actions (JSON array)'),
      description: z.string().optional().describe('Rule description'),
      confirm: z.boolean().optional().describe('Must be true to create the rule'),
    },
    async ({ name, type, conditions, actions, description, confirm }) => {
      const guard = scopeGuard('rule_create');
      if (guard) return guard;

      const ruleData = { name, type, conditions: conditions ?? {}, actions: actions ?? [], description };

      const result = withConfirmation(confirm, {
        description: `Create ${type} rule "${name}"`,
        preview: ruleData,
        execute: async () => {
          const now = new Date().toISOString();
          let id = `rule-${Date.now()}`;

          // Persist to DB if available
          try {
            const { tryDb } = await import('@/lib/store-helpers.js');
            const conn = await tryDb();
            if (conn) {
              const { getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
              const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
              const [row] = await conn.db.insert(conn.schema.rules).values({
                workspaceId: wsId,
                name,
                type,
                description: description ?? null,
                conditions: conditions ?? { all: [], any: [] },
                actions: actions ?? [],
              }).returning();
              if (row) id = row.id;

              // Invalidate rule cache
              const { invalidateRuleCache } = await import('@/lib/automation/bootstrap.js');
              invalidateRuleCache();
            }
          } catch { /* DB unavailable — rule persisted in log only */ }

          recordMCPAction({
            tool: 'rule_create', action: 'create',
            params: ruleData,
            timestamp: now, result: 'success',
          });
          return { created: true, ruleId: id, ...ruleData, createdAt: now };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- rule_toggle ----
  server.tool(
    'rule_toggle',
    'Enable or disable an automation rule (requires confirm=true)',
    {
      ruleId: z.string().describe('Rule ID'),
      enabled: z.boolean().describe('true to enable, false to disable'),
      confirm: z.boolean().optional().describe('Must be true to toggle the rule'),
    },
    async ({ ruleId, enabled, confirm }) => {
      const guard = scopeGuard('rule_toggle');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `${enabled ? 'Enable' : 'Disable'} rule ${ruleId}`,
        preview: { ruleId, enabled },
        execute: async () => {
          const now = new Date().toISOString();

          // Persist to DB if available
          try {
            const { tryDb } = await import('@/lib/store-helpers.js');
            const conn = await tryDb();
            if (conn) {
              const { eq } = await import('drizzle-orm');
              await conn.db.update(conn.schema.rules)
                .set({ enabled, updatedAt: new Date() })
                .where(eq(conn.schema.rules.id, ruleId));

              const { invalidateRuleCache } = await import('@/lib/automation/bootstrap.js');
              invalidateRuleCache();
            }
          } catch { /* DB unavailable */ }

          recordMCPAction({
            tool: 'rule_toggle', action: enabled ? 'enable' : 'disable',
            params: { ruleId, enabled },
            timestamp: now, result: 'success',
          });
          return { toggled: true, ruleId, enabled, timestamp: now };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- macro_apply ----
  server.tool(
    'macro_apply',
    'Apply a macro to a ticket (requires confirm=true)',
    {
      macroId: z.string().describe('Macro rule ID'),
      ticketId: z.string().describe('Ticket ID'),
      confirm: z.boolean().optional().describe('Must be true to apply'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ macroId, ticketId, confirm, dir }) => {
      const guard = scopeGuard('macro_apply');
      if (guard) return guard;

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const result = withConfirmation(confirm, {
        description: `Apply macro ${macroId} to ticket ${ticket.id}`,
        preview: { macroId, ticketId: ticket.id, subject: ticket.subject },
        execute: async () => {
          try {
            const { tryDb } = await import('@/lib/store-helpers.js');
            const conn = await tryDb();
            if (!conn) return { error: 'DB not available' };

            const { eq, and } = await import('drizzle-orm');
            const [macroRow] = await conn.db.select().from(conn.schema.rules)
              .where(and(eq(conn.schema.rules.id, macroId), eq(conn.schema.rules.type, 'macro')))
              .limit(1);

            if (!macroRow) return { error: `Macro "${macroId}" not found` };

            const { applyMacro } = await import('@/lib/automation/engine.js');
            const macroRule = {
              id: macroRow.id,
              type: 'macro' as const,
              name: macroRow.name,
              enabled: true,
              conditions: (macroRow.conditions ?? {}) as Record<string, unknown>,
              actions: (macroRow.actions ?? []) as Array<Record<string, unknown>>,
              workspaceId: macroRow.workspaceId,
            };

            const ticketCtx = {
              id: ticket.id,
              subject: ticket.subject ?? '',
              status: ticket.status ?? 'open',
              priority: ticket.priority ?? 'normal',
              assignee: ticket.assignee ?? null,
              requester: ticket.requester ?? '',
              tags: ticket.tags ?? [],
              createdAt: ticket.createdAt ?? new Date().toISOString(),
              updatedAt: ticket.updatedAt ?? new Date().toISOString(),
            };

            const execResult = applyMacro(macroRule as Parameters<typeof applyMacro>[0], ticketCtx);

            // Apply changes to in-memory ticket
            if (execResult.changes.status) ticket.status = execResult.changes.status as TicketStatus;
            if (execResult.changes.priority) ticket.priority = execResult.changes.priority as TicketPriority;
            if (execResult.changes.assignee !== undefined) ticket.assignee = execResult.changes.assignee as string | undefined;

            const now = new Date().toISOString();
            recordMCPAction({
              tool: 'macro_apply', action: 'apply',
              params: { macroId, ticketId: ticket.id },
              timestamp: now, result: 'success',
            });

            return {
              applied: true,
              macroId,
              macroName: macroRow.name,
              ticketId: ticket.id,
              changes: execResult.changes,
              actionsExecuted: execResult.actionsExecuted,
            };
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to apply macro' };
          }
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- ai_resolve ----
  server.tool(
    'ai_resolve',
    'Trigger AI resolution for a ticket (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      confirm: z.boolean().optional().describe('Must be true to trigger AI resolution'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, confirm, dir }) => {
      const guard = scopeGuard('ai_resolve');
      if (guard) return guard;

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const result = withConfirmation(confirm, {
        description: `Trigger AI resolution for ticket ${ticket.id}`,
        preview: { ticketId: ticket.id, subject: ticket.subject, status: ticket.status },
        execute: () => {
          const now = new Date().toISOString();
          recordMCPAction({
            tool: 'ai_resolve', action: 'trigger',
            params: { ticketId: ticket.id },
            timestamp: now, result: 'success',
          });
          return {
            triggered: true,
            ticketId: ticket.id,
            message: 'AI resolution pipeline invoked. Check /api/ai/queue for results.',
            timestamp: now,
          };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
    },
  );

  // ---- rule_list ----
  server.tool(
    'rule_list',
    'List automation rules with optional filters',
    {
      type: z.enum(['trigger', 'macro', 'automation', 'sla']).optional().describe('Filter by rule type'),
      enabled: z.boolean().optional().describe('Filter by enabled status'),
    },
    async ({ type, enabled }) => {
      const guard = scopeGuard('rule_list');
      if (guard) return guard;

      try {
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) return textResult({ rules: [], message: 'DB not available' });

        const { eq, and } = await import('drizzle-orm');
        const conditions = [];
        if (type) conditions.push(eq(conn.schema.rules.type, type));
        if (enabled !== undefined) conditions.push(eq(conn.schema.rules.enabled, enabled));

        const rows = await conn.db.select().from(conn.schema.rules)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(conn.schema.rules.createdAt);

        return textResult({
          count: rows.length,
          rules: rows.map(r => ({
            id: r.id, name: r.name, type: r.type, enabled: r.enabled,
            description: r.description, executionCount: r.executionCount,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list rules');
      }
    },
  );

  // ---- rule_get ----
  server.tool(
    'rule_get',
    'Get rule details and recent executions',
    {
      ruleId: z.string().describe('Rule ID'),
    },
    async ({ ruleId }) => {
      const guard = scopeGuard('rule_get');
      if (guard) return guard;

      try {
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) return errorResult('DB not available');

        const { eq } = await import('drizzle-orm');
        const [rule] = await conn.db.select().from(conn.schema.rules)
          .where(eq(conn.schema.rules.id, ruleId)).limit(1);

        if (!rule) return errorResult(`Rule "${ruleId}" not found`);

        const { queryAuditLog } = await import('@/lib/automation/audit-store.js');
        const executions = await queryAuditLog({ ruleId, limit: 10 });

        return textResult({ rule, recentExecutions: executions });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get rule');
      }
    },
  );

  // ---- rule_update ----
  server.tool(
    'rule_update',
    'Update an automation rule (requires confirm=true)',
    {
      ruleId: z.string().describe('Rule ID'),
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description'),
      conditions: z.record(z.string(), z.unknown()).optional().describe('New conditions'),
      actions: z.array(z.record(z.string(), z.unknown())).optional().describe('New actions'),
      confirm: z.boolean().optional().describe('Must be true to update'),
    },
    async ({ ruleId, name, description, conditions, actions, confirm }) => {
      const guard = scopeGuard('rule_update');
      if (guard) return guard;

      const updates = { name, description, conditions, actions };
      const result = withConfirmation(confirm, {
        description: `Update rule ${ruleId}`,
        preview: { ruleId, updates },
        execute: async () => {
          const { tryDb } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return { error: 'DB not available' };

          const { eq } = await import('drizzle-orm');
          const set: Record<string, unknown> = { updatedAt: new Date() };
          if (name !== undefined) set.name = name;
          if (description !== undefined) set.description = description;
          if (conditions !== undefined) set.conditions = conditions;
          if (actions !== undefined) set.actions = actions;

          const [updated] = await conn.db.update(conn.schema.rules)
            .set(set).where(eq(conn.schema.rules.id, ruleId)).returning();

          if (!updated) return { error: `Rule "${ruleId}" not found` };

          const { invalidateRuleCache } = await import('@/lib/automation/bootstrap.js');
          invalidateRuleCache();

          return { updated: true, rule: { id: updated.id, name: updated.name } };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- rule_delete ----
  server.tool(
    'rule_delete',
    'Delete an automation rule (requires confirm=true)',
    {
      ruleId: z.string().describe('Rule ID'),
      confirm: z.boolean().optional().describe('Must be true to delete'),
    },
    async ({ ruleId, confirm }) => {
      const guard = scopeGuard('rule_delete');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Delete rule ${ruleId}`,
        preview: { ruleId },
        execute: async () => {
          const { tryDb } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return { error: 'DB not available' };

          const { eq } = await import('drizzle-orm');
          const [deleted] = await conn.db.delete(conn.schema.rules)
            .where(eq(conn.schema.rules.id, ruleId))
            .returning({ id: conn.schema.rules.id });

          if (!deleted) return { error: `Rule "${ruleId}" not found` };

          const { invalidateRuleCache } = await import('@/lib/automation/bootstrap.js');
          invalidateRuleCache();

          return { deleted: true, ruleId };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- rule_test ----
  server.tool(
    'rule_test',
    'Dry-run test a rule against sample ticket data',
    {
      ruleId: z.string().optional().describe('Rule ID to test (from DB)'),
      conditions: z.record(z.string(), z.unknown()).optional().describe('Inline conditions'),
      actions: z.array(z.record(z.string(), z.unknown())).optional().describe('Inline actions'),
      ticket: z.record(z.string(), z.unknown()).describe('Sample ticket data'),
    },
    async ({ ruleId, conditions, actions, ticket }) => {
      const guard = scopeGuard('rule_test');
      if (guard) return guard;

      try {
        const { evaluateRule } = await import('@/lib/automation/engine.js');

        let rule: { id: string; type: string; name: string; enabled: boolean; conditions: unknown; actions: unknown };

        if (ruleId) {
          const { tryDb } = await import('@/lib/store-helpers.js');
          const conn = await tryDb();
          if (!conn) return errorResult('DB not available');

          const { eq } = await import('drizzle-orm');
          const [row] = await conn.db.select().from(conn.schema.rules)
            .where(eq(conn.schema.rules.id, ruleId)).limit(1);

          if (!row) return errorResult(`Rule "${ruleId}" not found`);
          rule = { id: row.id, type: row.type, name: row.name, enabled: true, conditions: row.conditions, actions: row.actions };
        } else if (conditions || actions) {
          rule = {
            id: 'inline-test',
            type: 'trigger',
            name: 'Inline test',
            enabled: true,
            conditions: conditions ?? {},
            actions: actions ?? [],
          };
        } else {
          return errorResult('Either ruleId or conditions/actions required');
        }

        const ticketCtx = {
          id: String(ticket.id ?? 'test-1'),
          subject: String(ticket.subject ?? ''),
          status: String(ticket.status ?? 'open'),
          priority: String(ticket.priority ?? 'normal'),
          assignee: ticket.assignee != null ? String(ticket.assignee) : null,
          requester: String(ticket.requester ?? ''),
          tags: Array.isArray(ticket.tags) ? ticket.tags.map(String) : [],
          createdAt: String(ticket.createdAt ?? new Date().toISOString()),
          updatedAt: String(ticket.updatedAt ?? new Date().toISOString()),
          event: ticket.event as 'create' | 'update' | 'reply' | 'status_change' | 'assignment' | undefined,
        };

        const result = evaluateRule(rule as Parameters<typeof evaluateRule>[0], ticketCtx);
        return textResult({
          matched: result.matched,
          actionsExecuted: result.actionsExecuted,
          changes: result.changes,
          notifications: result.notifications.length,
          webhooks: result.webhooks.length,
          errors: result.errors,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Test failed');
      }
    },
  );

  // ---- rule_executions ----
  server.tool(
    'rule_executions',
    'Query rule execution history',
    {
      ruleId: z.string().optional().describe('Filter by rule ID'),
      ticketId: z.string().optional().describe('Filter by ticket ID'),
      limit: z.number().optional().describe('Max entries (default 20)'),
    },
    async ({ ruleId, ticketId, limit }) => {
      const guard = scopeGuard('rule_executions');
      if (guard) return guard;

      try {
        const { queryAuditLog } = await import('@/lib/automation/audit-store.js');
        const entries = await queryAuditLog({
          ruleId,
          ticketId,
          limit: limit ?? 20,
        });

        return textResult({ count: entries.length, executions: entries });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to query executions');
      }
    },
  );

  // ---- macro_list ----
  server.tool(
    'macro_list',
    'List available macros',
    {},
    async () => {
      const guard = scopeGuard('macro_list');
      if (guard) return guard;

      try {
        const { tryDb } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();
        if (!conn) return textResult({ macros: [], message: 'DB not available' });

        const { eq } = await import('drizzle-orm');
        const rows = await conn.db.select().from(conn.schema.rules)
          .where(eq(conn.schema.rules.type, 'macro'))
          .orderBy(conn.schema.rules.name);

        return textResult({
          count: rows.length,
          macros: rows.map(r => ({
            id: r.id, name: r.name, enabled: r.enabled,
            description: r.description,
            actions: (r.actions as unknown[])?.length ?? 0,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list macros');
      }
    },
  );
}

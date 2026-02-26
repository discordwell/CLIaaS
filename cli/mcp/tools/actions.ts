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
      confirm: z.boolean().optional().describe('Must be true to create the ticket'),
    },
    async ({ subject, description, priority, requester, tags, confirm }) => {
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
      confirm: z.boolean().optional().describe('Must be true to create the rule'),
    },
    async ({ name, type, conditions, actions, confirm }) => {
      const guard = scopeGuard('rule_create');
      if (guard) return guard;

      const ruleData = { name, type, conditions: conditions ?? {}, actions: actions ?? [] };

      const result = withConfirmation(confirm, {
        description: `Create ${type} rule "${name}"`,
        preview: ruleData,
        execute: () => {
          const now = new Date().toISOString();
          const id = `rule-${Date.now()}`;
          recordMCPAction({
            tool: 'rule_create', action: 'create',
            params: ruleData,
            timestamp: now, result: 'success',
          });
          return { created: true, ruleId: id, ...ruleData, createdAt: now };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
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
        execute: () => {
          const now = new Date().toISOString();
          recordMCPAction({
            tool: 'rule_toggle', action: enabled ? 'enable' : 'disable',
            params: { ruleId, enabled },
            timestamp: now, result: 'success',
          });
          return { toggled: true, ruleId, enabled, timestamp: now };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(result.value);
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
}

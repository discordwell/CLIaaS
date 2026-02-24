import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeLoadTickets, safeLoadMessages, getTicketMessages, findTicket } from '../util.js';

export function registerTicketTools(server: McpServer): void {
  server.tool(
    'tickets_list',
    'List tickets from exported data with optional filters',
    {
      status: z.string().optional().describe('Filter by status: open, pending, on_hold, solved, closed'),
      priority: z.string().optional().describe('Filter by priority: low, normal, high, urgent'),
      assignee: z.string().optional().describe('Filter by assignee name (partial match)'),
      tag: z.string().optional().describe('Filter by tag (partial match)'),
      limit: z.number().default(25).describe('Max tickets to return'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ status, priority, assignee, tag, limit, dir }) => {
      let tickets = await safeLoadTickets(dir);

      if (tickets.length === 0) {
        return errorResult('No ticket data found. Run an export or `cliaas demo` first.');
      }

      if (status) tickets = tickets.filter(t => t.status === status);
      if (priority) tickets = tickets.filter(t => t.priority === priority);
      if (assignee) tickets = tickets.filter(t => t.assignee?.toLowerCase().includes(assignee.toLowerCase()));
      if (tag) tickets = tickets.filter(t => t.tags.some(tg => tg.toLowerCase().includes(tag.toLowerCase())));

      // Sort by updated descending
      tickets.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      const display = tickets.slice(0, limit);

      return textResult({
        total: tickets.length,
        showing: display.length,
        tickets: display.map(t => ({
          id: t.id,
          externalId: t.externalId,
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          assignee: t.assignee ?? null,
          requester: t.requester,
          tags: t.tags,
          source: t.source,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      });
    },
  );

  server.tool(
    'tickets_show',
    'Show a single ticket with its full conversation thread',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, dir }) => {
      const tickets = await safeLoadTickets(dir);
      const messages = await safeLoadMessages(dir);

      const ticket = findTicket(tickets, ticketId);
      if (!ticket) {
        return errorResult(`Ticket not found: ${ticketId}`);
      }

      const thread = getTicketMessages(ticket.id, messages)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      return textResult({
        ticket: {
          id: ticket.id,
          externalId: ticket.externalId,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          assignee: ticket.assignee ?? null,
          requester: ticket.requester,
          tags: ticket.tags,
          source: ticket.source,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          customFields: ticket.customFields,
        },
        messages: thread.map(m => ({
          id: m.id,
          author: m.author,
          type: m.type,
          body: m.body,
          createdAt: m.createdAt,
        })),
      });
    },
  );

  server.tool(
    'tickets_search',
    'Full-text search across tickets and messages',
    {
      query: z.string().describe('Search query'),
      limit: z.number().default(20).describe('Max results'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ query, limit, dir }) => {
      const allTickets = await safeLoadTickets(dir);
      const allMessages = await safeLoadMessages(dir);
      const lower = query.toLowerCase();

      // Search tickets by subject, tags, requester
      const ticketMatches = allTickets.filter(t =>
        t.subject.toLowerCase().includes(lower) ||
        t.tags.some(tg => tg.toLowerCase().includes(lower)) ||
        t.requester.toLowerCase().includes(lower) ||
        (t.assignee?.toLowerCase().includes(lower) ?? false),
      );

      // Search messages by body
      const messageMatches = allMessages.filter(m =>
        m.body.toLowerCase().includes(lower),
      );

      const messageTicketIds = new Set(messageMatches.map(m => m.ticketId));
      const fromMessages = allTickets.filter(
        t => messageTicketIds.has(t.id) && !ticketMatches.find(tm => tm.id === t.id),
      );

      const combined = [...ticketMatches, ...fromMessages].slice(0, limit);

      return textResult({
        ticketMatches: ticketMatches.length,
        ticketsFromMessageMatches: fromMessages.length,
        results: combined.map(t => ({
          id: t.id,
          externalId: t.externalId,
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          assignee: t.assignee ?? null,
          matchType: ticketMatches.includes(t) ? 'ticket' : 'message',
        })),
      });
    },
  );
}

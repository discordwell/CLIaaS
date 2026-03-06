/**
 * MCP presence tools for agent collision detection.
 * ticket_presence: see who's viewing/typing on a ticket
 * ticket_collision_check: check for new replies since a timestamp
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeLoadTickets, findTicket } from '../util.js';

export function registerPresenceTools(server: McpServer): void {
  // ---- ticket_presence ----
  server.tool(
    'ticket_presence',
    "Show who is currently viewing or typing on a ticket. Returns active viewers with their activity status (viewing/typing).",
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
    },
    async ({ ticketId }) => {
      try {
        const { presence } = await import('@/lib/realtime/presence.js');
        const viewers = presence.getViewers(ticketId);

        // Also try by external ID
        if (viewers.length === 0) {
          const tickets = await safeLoadTickets();
          const ticket = findTicket(tickets, ticketId);
          if (ticket && ticket.id !== ticketId) {
            const viewersById = presence.getViewers(ticket.id);
            return textResult({
              ticketId: ticket.id,
              externalId: ticket.externalId,
              viewers: viewersById,
              count: viewersById.length,
            });
          }
        }

        return textResult({
          ticketId,
          viewers,
          count: viewers.length,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get presence');
      }
    },
  );

  // ---- ticket_collision_check ----
  server.tool(
    'ticket_collision_check',
    "Check if new replies have been added to a ticket since a given timestamp. Use before replying to avoid duplicate responses.",
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      since: z.string().describe('ISO timestamp — check for replies after this time'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, since, dir }) => {
      try {
        const sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
          return errorResult('Invalid since timestamp');
        }

        const tickets = await safeLoadTickets(dir);
        const ticket = findTicket(tickets, ticketId);
        if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

        const { checkForNewReplies } = await import('@/lib/realtime/collision.js');
        const { hasNewReplies, newReplies } = await checkForNewReplies(ticket.id, sinceDate, dir);

        // Get active viewers
        const { presence } = await import('@/lib/realtime/presence.js');
        const activeViewers = presence.getViewers(ticket.id);

        return textResult({
          ticketId: ticket.id,
          since,
          hasNewReplies,
          newReplyCount: newReplies.length,
          newReplies,
          activeViewers,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Collision check failed');
      }
    },
  );
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeLoadTickets, safeLoadMessages, safeLoadKBArticles, getTicketMessages } from '../util.js';

export function registerQueueTools(server: McpServer): void {
  server.tool(
    'queue_stats',
    'Show queue metrics: ticket counts by status, priority, assignee, and alerts',
    {
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ dir }) => {
      const tickets = safeLoadTickets(dir);
      const messages = safeLoadMessages(dir);
      const articles = safeLoadKBArticles(dir);

      if (tickets.length === 0) return errorResult('No ticket data found.');

      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      const byAssignee: Record<string, number> = {};

      for (const t of tickets) {
        byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
        byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
        const assignee = t.assignee ?? 'unassigned';
        byAssignee[assignee] = (byAssignee[assignee] ?? 0) + 1;
      }

      const now = Date.now();
      const updatedToday = tickets.filter(t => now - new Date(t.updatedAt).getTime() < 86400000).length;
      const updatedThisWeek = tickets.filter(t => now - new Date(t.updatedAt).getTime() < 7 * 86400000).length;

      // Top tags
      const tagCounts: Record<string, number> = {};
      for (const t of tickets) {
        for (const tag of t.tags) {
          tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
        }
      }
      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));

      // Urgent/high open alerts
      const urgentOpen = tickets
        .filter(t => t.status === 'open' && (t.priority === 'urgent' || t.priority === 'high'))
        .map(t => ({
          id: t.id,
          externalId: t.externalId,
          priority: t.priority,
          subject: t.subject,
        }));

      return textResult({
        overview: {
          totalTickets: tickets.length,
          totalMessages: messages.length,
          kbArticles: articles.length,
          updatedToday,
          updatedThisWeek,
        },
        byStatus,
        byPriority,
        byAssignee: Object.entries(byAssignee)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([assignee, count]) => ({ assignee, count })),
        topTags,
        alerts: urgentOpen,
      });
    },
  );

  server.tool(
    'sla_report',
    'SLA compliance report — shows breach status for active tickets',
    {
      status: z.string().optional().describe('Comma-separated statuses to check (default: open,pending)'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ status, dir }) => {
      const tickets = safeLoadTickets(dir);
      const messages = safeLoadMessages(dir);
      const statuses = status?.split(',') ?? ['open', 'pending'];

      const active = tickets.filter(t => statuses.includes(t.status));
      if (active.length === 0) return errorResult('No active tickets found.');

      const DEFAULT_SLAS = [
        { priority: 'urgent', firstResponseHrs: 1, resolutionHrs: 4 },
        { priority: 'high', firstResponseHrs: 4, resolutionHrs: 8 },
        { priority: 'normal', firstResponseHrs: 8, resolutionHrs: 24 },
        { priority: 'low', firstResponseHrs: 24, resolutionHrs: 72 },
      ];

      let breached = 0;
      let atRisk = 0;
      let compliant = 0;

      const results = [];

      for (const ticket of active) {
        const sla = DEFAULT_SLAS.find(s => s.priority === ticket.priority) ?? DEFAULT_SLAS[2];
        const ticketMsgs = getTicketMessages(ticket.id, messages)
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const createdAt = new Date(ticket.createdAt).getTime();
        const now = Date.now();
        const ageMs = now - createdAt;

        const firstAgentReply = ticketMsgs.find((m, idx) => idx > 0 && m.type === 'reply');
        const firstResponseMs = firstAgentReply
          ? new Date(firstAgentReply.createdAt).getTime() - createdAt
          : null;

        const frTargetMs = sla.firstResponseHrs * 3600000;
        const resTargetMs = sla.resolutionHrs * 3600000;

        let frStatus: 'breached' | 'at-risk' | 'ok';
        if (firstResponseMs !== null) {
          frStatus = firstResponseMs > frTargetMs ? 'breached' : 'ok';
        } else {
          frStatus = ageMs > frTargetMs ? 'breached' : ageMs > frTargetMs * 0.75 ? 'at-risk' : 'ok';
        }

        const resStatus = ageMs > resTargetMs ? 'breached' : ageMs > resTargetMs * 0.75 ? 'at-risk' : 'ok';

        if (frStatus === 'breached' || resStatus === 'breached') breached++;
        else if (frStatus === 'at-risk' || resStatus === 'at-risk') atRisk++;
        else compliant++;

        results.push({
          ticketId: ticket.id,
          externalId: ticket.externalId,
          subject: ticket.subject,
          priority: ticket.priority,
          ageHours: Math.round(ageMs / 3600000),
          firstResponse: frStatus,
          resolution: resStatus,
          slaTarget: `${sla.firstResponseHrs}h / ${sla.resolutionHrs}h`,
        });
      }

      // Sort: breached first, then at-risk
      results.sort((a, b) => {
        const order: Record<string, number> = { breached: 0, 'at-risk': 1, ok: 2 };
        const aWorst = Math.min(order[a.firstResponse], order[a.resolution]);
        const bWorst = Math.min(order[b.firstResponse], order[b.resolution]);
        return aWorst - bWorst || b.ageHours - a.ageHours;
      });

      return textResult({
        summary: { breached, atRisk, compliant, total: active.length },
        slaPolicy: DEFAULT_SLAS,
        tickets: results,
      });
    },
  );
}

/**
 * MCP routing tools: route_ticket, routing_status, agent_availability, agent_skills, queue_depth
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeLoadTickets, findTicket, safeLoadMessages } from '../util.js';
import { withConfirmation } from './confirm.js';
import { routeTicket } from '@/lib/routing/engine.js';
import {
  getRoutingConfig,
  getRoutingQueues,
  getRoutingRules,
  getRoutingLog,
  getAgentSkills,
  setAgentSkills,
  getAgentCapacity,
} from '@/lib/routing/store.js';
import { availability } from '@/lib/routing/availability.js';

export function registerRoutingTools(server: McpServer): void {
  // ---- route_ticket ----
  server.tool(
    'route_ticket',
    'Route a ticket to the best available agent using skill-based, capacity-aware routing',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      confirm: z.boolean().optional().describe('Must be true to apply the assignment'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, confirm, dir }) => {
      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const messages = await safeLoadMessages(dir);
      const ticketMessages = messages.filter(m => m.ticketId === ticket.id);
      const allAvail = availability.getAllAvailability();
      const allAgents = allAvail.map(a => ({ userId: a.userId, userName: a.userName }));

      const result = await routeTicket(ticket, { allAgents, messages: ticketMessages });

      const resultObj = withConfirmation(confirm, {
        description: `Route ticket ${ticket.id} → ${result.suggestedAgentName}`,
        preview: {
          ticketId: ticket.id,
          suggestedAgent: result.suggestedAgentName,
          strategy: result.strategy,
          confidence: `${(result.confidence * 100).toFixed(0)}%`,
          matchedSkills: result.matchedSkills,
        },
        execute: () => result,
      });

      if (resultObj.needsConfirmation) return resultObj.result;
      return textResult(resultObj.value);
    },
  );

  // ---- routing_status ----
  server.tool(
    'routing_status',
    'Get routing engine status: config, queue count, agent availability, recent log',
    {},
    async () => {
      const config = getRoutingConfig();
      const queues = getRoutingQueues();
      const rules = getRoutingRules();
      const allAvail = availability.getAllAvailability();
      const log = getRoutingLog(undefined, 5);

      return textResult({
        config,
        queueCount: queues.length,
        ruleCount: rules.length,
        agentAvailability: {
          online: allAvail.filter(a => a.status === 'online').length,
          away: allAvail.filter(a => a.status === 'away').length,
          offline: allAvail.filter(a => a.status === 'offline').length,
        },
        recentLog: log.map(l => ({
          ticketId: l.ticketId,
          assignedUserId: l.assignedUserId,
          strategy: l.strategy,
          durationMs: l.durationMs,
          createdAt: l.createdAt,
        })),
      });
    },
  );

  // ---- agent_availability ----
  server.tool(
    'agent_availability',
    'Get or set agent availability status (online, away, offline)',
    {
      userId: z.string().optional().describe('Agent user ID (omit to list all)'),
      status: z.enum(['online', 'away', 'offline']).optional().describe('New status to set'),
      userName: z.string().optional().describe('Agent name (for display)'),
    },
    async ({ userId, status, userName }) => {
      if (userId && status) {
        availability.setAvailability(userId, userName ?? userId, status);
        return textResult({ userId, status, updated: true });
      }
      return textResult(availability.getAllAvailability());
    },
  );

  // ---- agent_skills ----
  server.tool(
    'agent_skills',
    'Get or set agent skills for routing',
    {
      userId: z.string().optional().describe('Agent user ID (omit to list all)'),
      skills: z.array(z.string()).optional().describe('Skill names to set (replaces existing)'),
    },
    async ({ userId, skills }) => {
      if (userId && skills) {
        const result = setAgentSkills(userId, '', skills.map(s => ({ skillName: s })));
        return textResult({ userId, skills: result, updated: true });
      }
      return textResult(getAgentSkills(userId));
    },
  );

  // ---- queue_depth ----
  server.tool(
    'queue_depth',
    'Get routing queue depths and status',
    {},
    async () => {
      const queues = getRoutingQueues();
      const log = getRoutingLog(undefined, 1000);

      const queueDepths = queues.map(q => {
        const queueLog = log.filter(l => l.queueId === q.id);
        return {
          id: q.id,
          name: q.name,
          strategy: q.strategy,
          enabled: q.enabled,
          totalRouted: queueLog.length,
        };
      });

      return textResult(queueDepths);
    },
  );
}

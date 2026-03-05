import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';

export function registerTimeTools(server: McpServer): void {
  // ---- time_log ----
  server.tool(
    'time_log',
    'Log a manual time entry for a ticket (requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID'),
      userId: z.string().describe('User/agent ID'),
      userName: z.string().describe('User/agent display name'),
      durationMinutes: z.number().describe('Duration in minutes'),
      billable: z.boolean().optional().default(true).describe('Whether the time is billable'),
      notes: z.string().optional().default('').describe('Notes about the work done'),
      customerId: z.string().optional().describe('Customer ID to associate'),
      groupId: z.string().optional().describe('Group/team ID to associate'),
      confirm: z.boolean().optional().describe('Must be true to log the entry'),
    },
    async ({ ticketId, userId, userName, durationMinutes, billable, notes, customerId, groupId, confirm }) => {
      const guard = scopeGuard('time_log');
      if (guard) return guard;

      if (durationMinutes <= 0) {
        return errorResult('durationMinutes must be greater than 0.');
      }

      const entryData = {
        ticketId,
        userId,
        userName,
        durationMinutes,
        billable,
        notes: notes ?? '',
        ...(customerId ? { customerId } : {}),
        ...(groupId ? { groupId } : {}),
      };

      const result = withConfirmation(confirm, {
        description: `Log ${durationMinutes}m for ticket ${ticketId}`,
        preview: entryData,
        execute: async () => {
          const { logManualTime } = await import('@/lib/time-tracking');
          const entry = logManualTime(entryData);
          const now = new Date().toISOString();

          recordMCPAction({
            tool: 'time_log',
            action: 'log',
            params: entryData,
            timestamp: now,
            result: 'success',
          });

          return { logged: true, entry };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- time_report ----
  server.tool(
    'time_report',
    'Get a time tracking report with optional filters',
    {
      ticketId: z.string().optional().describe('Filter by ticket ID'),
      userId: z.string().optional().describe('Filter by user/agent ID'),
      customerId: z.string().optional().describe('Filter by customer ID'),
      groupId: z.string().optional().describe('Filter by group/team ID'),
      from: z.string().optional().describe('Start date (ISO 8601)'),
      to: z.string().optional().describe('End date (ISO 8601)'),
      billable: z.boolean().optional().describe('Filter by billable status'),
    },
    async ({ ticketId, userId, customerId, groupId, from, to, billable }) => {
      try {
        const { getTimeReport } = await import('@/lib/time-tracking');
        const filters = {
          ...(ticketId ? { ticketId } : {}),
          ...(userId ? { userId } : {}),
          ...(customerId ? { customerId } : {}),
          ...(groupId ? { groupId } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(billable !== undefined ? { billable } : {}),
        };

        const report = getTimeReport(filters);
        return textResult(report);
      } catch (err) {
        return errorResult(
          err instanceof Error ? err.message : 'Failed to generate time report',
        );
      }
    },
  );
}

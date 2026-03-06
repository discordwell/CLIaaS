import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';

export function registerWfmTools(server: McpServer): void {
  // ---- wfm_schedule_list ----
  server.tool(
    'wfm_schedule_list',
    'List agent schedules, optionally filtered by user',
    {
      userId: z.string().optional().describe('Filter by user ID'),
      from: z.string().optional().describe('Effective from date (ISO 8601)'),
      to: z.string().optional().describe('Effective to date (ISO 8601)'),
    },
    async ({ userId }) => {
      try {
        const { getSchedules } = await import('@/lib/wfm/schedules');
        const schedules = getSchedules(userId);
        return textResult({ schedules, total: schedules.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list schedules');
      }
    },
  );

  // ---- wfm_schedule_create ----
  server.tool(
    'wfm_schedule_create',
    'Create an agent schedule (requires confirm=true)',
    {
      userId: z.string().describe('User/agent ID'),
      userName: z.string().describe('User display name'),
      templateId: z.string().optional().describe('Schedule template ID to apply'),
      effectiveFrom: z.string().describe('Effective from date (YYYY-MM-DD)'),
      effectiveTo: z.string().optional().describe('Effective to date (YYYY-MM-DD)'),
      timezone: z.string().optional().default('UTC').describe('Agent timezone'),
      shifts: z.array(z.object({
        dayOfWeek: z.number().min(0).max(6),
        startTime: z.string(),
        endTime: z.string(),
        activity: z.string().optional().default('work'),
        label: z.string().optional(),
      })).optional().describe('Shift blocks (if not using template)'),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ userId, userName, templateId, effectiveFrom, effectiveTo, timezone, shifts, confirm }) => {
      const guard = scopeGuard('wfm_schedule_create');
      if (guard) return guard;

      const preview = { userId, userName, templateId, effectiveFrom, effectiveTo, timezone, shiftsCount: shifts?.length ?? 0 };

      const result = withConfirmation(confirm, {
        description: `Create schedule for ${userName} from ${effectiveFrom}`,
        preview,
        execute: async () => {
          const { createSchedule, applyTemplate } = await import('@/lib/wfm/schedules');
          const schedule = createSchedule({
            userId, userName, templateId, effectiveFrom, effectiveTo, timezone: timezone ?? 'UTC', shifts: shifts ?? [],
          });
          if (templateId) applyTemplate(schedule.id, templateId);

          recordMCPAction({ tool: 'wfm_schedule_create', action: 'create', params: preview, timestamp: new Date().toISOString(), result: 'success' });
          return { created: true, schedule };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- wfm_template_list ----
  server.tool(
    'wfm_template_list',
    'List schedule templates',
    {},
    async () => {
      try {
        const { getTemplates } = await import('@/lib/wfm/schedules');
        const templates = getTemplates();
        return textResult({ templates, total: templates.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list templates');
      }
    },
  );

  // ---- wfm_template_create ----
  server.tool(
    'wfm_template_create',
    'Create a schedule template (requires confirm=true)',
    {
      name: z.string().describe('Template name'),
      shifts: z.array(z.object({
        dayOfWeek: z.number().min(0).max(6),
        startTime: z.string(),
        endTime: z.string(),
        activity: z.string().optional().default('work'),
        label: z.string().optional(),
      })).describe('Shift blocks'),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ name, shifts, confirm }) => {
      const guard = scopeGuard('wfm_template_create');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create template "${name}" with ${shifts.length} shifts`,
        preview: { name, shiftsCount: shifts.length },
        execute: async () => {
          const { createTemplate } = await import('@/lib/wfm/schedules');
          const template = createTemplate({ name, shifts });

          recordMCPAction({ tool: 'wfm_template_create', action: 'create', params: { name }, timestamp: new Date().toISOString(), result: 'success' });
          return { created: true, template };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- wfm_agent_status ----
  server.tool(
    'wfm_agent_status',
    'Get current agent status(es)',
    {
      userId: z.string().optional().describe('Get status for a specific user'),
    },
    async ({ userId }) => {
      try {
        const { agentStatusTracker } = await import('@/lib/wfm/agent-status');
        if (userId) {
          const status = agentStatusTracker.getStatus(userId);
          return textResult({ status: status ?? null });
        }
        const statuses = agentStatusTracker.getAllStatuses();
        return textResult({ statuses, total: statuses.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get agent status');
      }
    },
  );

  // ---- wfm_agent_status_set ----
  server.tool(
    'wfm_agent_status_set',
    'Set agent availability status (requires confirm=true)',
    {
      userId: z.string().describe('User/agent ID'),
      userName: z.string().describe('User display name'),
      status: z.enum(['online', 'away', 'offline', 'on_break']).describe('New status'),
      reason: z.string().optional().describe('Reason for status change'),
      confirm: z.boolean().optional().describe('Must be true to set'),
    },
    async ({ userId, userName, status, reason, confirm }) => {
      const guard = scopeGuard('wfm_agent_status_set');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Set ${userName} status to ${status}`,
        preview: { userId, userName, status, reason },
        execute: async () => {
          const { agentStatusTracker } = await import('@/lib/wfm/agent-status');
          agentStatusTracker.setStatus(userId, userName, status, reason);

          recordMCPAction({ tool: 'wfm_agent_status_set', action: 'set', params: { userId, status }, timestamp: new Date().toISOString(), result: 'success' });
          return { updated: true, status: agentStatusTracker.getStatus(userId) };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- wfm_time_off_list ----
  server.tool(
    'wfm_time_off_list',
    'List time-off requests',
    {
      userId: z.string().optional().describe('Filter by user ID'),
      status: z.enum(['pending', 'approved', 'denied']).optional().describe('Filter by status'),
    },
    async ({ userId, status }) => {
      try {
        const { getTimeOffRequests } = await import('@/lib/wfm/time-off');
        const requests = getTimeOffRequests(userId, status);
        return textResult({ requests, total: requests.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list time-off requests');
      }
    },
  );

  // ---- wfm_time_off_request ----
  server.tool(
    'wfm_time_off_request',
    'Submit a time-off request (requires confirm=true)',
    {
      userId: z.string().describe('User/agent ID'),
      userName: z.string().describe('User display name'),
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
      reason: z.string().optional().describe('Reason for time off'),
      confirm: z.boolean().optional().describe('Must be true to submit'),
    },
    async ({ userId, userName, startDate, endDate, reason, confirm }) => {
      const guard = scopeGuard('wfm_time_off_request');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Request time off for ${userName}: ${startDate} to ${endDate}`,
        preview: { userId, userName, startDate, endDate, reason },
        execute: async () => {
          const { requestTimeOff } = await import('@/lib/wfm/time-off');
          const req = requestTimeOff({ userId, userName, startDate, endDate, reason });

          recordMCPAction({ tool: 'wfm_time_off_request', action: 'request', params: { userId, startDate, endDate }, timestamp: new Date().toISOString(), result: 'success' });
          return { created: true, request: req };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- wfm_time_off_decide ----
  server.tool(
    'wfm_time_off_decide',
    'Approve or deny a time-off request (requires confirm=true)',
    {
      requestId: z.string().describe('Time-off request ID'),
      decision: z.enum(['approved', 'denied']).describe('Decision'),
      confirm: z.boolean().optional().describe('Must be true to decide'),
    },
    async ({ requestId, decision, confirm }) => {
      const guard = scopeGuard('wfm_time_off_decide');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `${decision === 'approved' ? 'Approve' : 'Deny'} time-off request ${requestId}`,
        preview: { requestId, decision },
        execute: async () => {
          const { decideTimeOff } = await import('@/lib/wfm/time-off');
          const req = decideTimeOff(requestId, decision, 'mcp-user');

          if (!req) throw new Error(`Time-off request ${requestId} not found`);

          recordMCPAction({ tool: 'wfm_time_off_decide', action: decision, params: { requestId }, timestamp: new Date().toISOString(), result: 'success' });
          return { decided: true, request: req };
        },
      });

      if (result.needsConfirmation) return result.result;
      try {
        return textResult(await result.value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to decide time-off request');
      }
    },
  );

  // ---- wfm_forecast ----
  server.tool(
    'wfm_forecast',
    'Get volume forecast based on historical data',
    {
      from: z.string().optional().describe('Forecast start date'),
      to: z.string().optional().describe('Forecast end date'),
      channel: z.string().optional().describe('Filter by channel'),
      daysAhead: z.number().optional().default(7).describe('Days ahead to forecast'),
    },
    async ({ channel, daysAhead }) => {
      try {
        const { getVolumeSnapshots } = await import('@/lib/wfm/store');
        const { generateForecast } = await import('@/lib/wfm/forecast');

        let snapshots = getVolumeSnapshots();
        if (channel) snapshots = snapshots.filter(s => s.channel === channel);

        const forecast = generateForecast(snapshots, { daysAhead: daysAhead ?? 7 });
        return textResult({ forecast, total: forecast.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to generate forecast');
      }
    },
  );

  // ---- wfm_staffing ----
  server.tool(
    'wfm_staffing',
    'Get staffing recommendations based on forecast and schedules',
    {
      from: z.string().optional().describe('Start date'),
      to: z.string().optional().describe('End date'),
    },
    async () => {
      try {
        const { getVolumeSnapshots } = await import('@/lib/wfm/store');
        const { generateForecast, calculateStaffing } = await import('@/lib/wfm/forecast');
        const { getSchedules } = await import('@/lib/wfm/schedules');

        const forecast = generateForecast(getVolumeSnapshots());
        const staffing = calculateStaffing(forecast, getSchedules());
        return textResult({ staffing, total: staffing.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to calculate staffing');
      }
    },
  );

  // ---- wfm_adherence ----
  server.tool(
    'wfm_adherence',
    'Get real-time schedule adherence for agents',
    {
      userId: z.string().optional().describe('Filter by user ID'),
    },
    async ({ userId }) => {
      try {
        const { getSchedules } = await import('@/lib/wfm/schedules');
        const { agentStatusTracker } = await import('@/lib/wfm/agent-status');
        const { getCurrentAdherence } = await import('@/lib/wfm/adherence');

        const schedules = userId ? getSchedules(userId) : getSchedules();
        const statuses = agentStatusTracker.getAllStatuses();
        const adherence = getCurrentAdherence(schedules, statuses);

        return textResult({ adherence, total: adherence.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get adherence');
      }
    },
  );

  // ---- wfm_utilization ----
  server.tool(
    'wfm_utilization',
    'Get agent utilization/occupancy metrics',
    {
      userId: z.string().optional().describe('Filter by user ID'),
      from: z.string().optional().describe('Start date (ISO 8601)'),
      to: z.string().optional().describe('End date (ISO 8601)'),
    },
    async ({ userId, from, to }) => {
      try {
        const { getTimeEntries } = await import('@/lib/time-tracking');
        const { getStatusLog } = await import('@/lib/wfm/store');
        const { getSchedules } = await import('@/lib/wfm/schedules');
        const { calculateUtilization } = await import('@/lib/wfm/utilization');

        const utilization = calculateUtilization(
          getTimeEntries({ userId, from, to }),
          getStatusLog(),
          getSchedules(userId),
          { userId, from, to },
        );

        return textResult({ utilization, total: utilization.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to calculate utilization');
      }
    },
  );
}

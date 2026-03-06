import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';

export function registerBusinessHoursTools(server: McpServer): void {
  // ---- business_hours_list ----
  server.tool(
    'business_hours_list',
    'List business hours schedules',
    {},
    async () => {
      try {
        const { getBusinessHours } = await import('@/lib/wfm/business-hours');
        const configs = getBusinessHours();
        return textResult({ businessHours: configs, total: configs.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to list business hours');
      }
    },
  );

  // ---- business_hours_show ----
  server.tool(
    'business_hours_show',
    'Show a specific business hours schedule',
    {
      id: z.string().describe('Schedule ID'),
    },
    async ({ id }) => {
      try {
        const { getBusinessHours } = await import('@/lib/wfm/business-hours');
        const configs = getBusinessHours(id);
        if (configs.length === 0) return errorResult('Schedule not found');
        return textResult({ businessHours: configs[0] });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to show business hours');
      }
    },
  );

  // ---- business_hours_check ----
  server.tool(
    'business_hours_check',
    'Check if a timestamp is within business hours',
    {
      id: z.string().describe('Schedule ID'),
      timestamp: z.string().optional().describe('ISO timestamp (default: now)'),
    },
    async ({ id, timestamp }) => {
      try {
        const { getBusinessHours, isWithinBusinessHours, nextBusinessHourStart, nextBusinessHourClose } =
          await import('@/lib/wfm/business-hours');
        const configs = getBusinessHours(id);
        if (configs.length === 0) return errorResult('Schedule not found');
        const config = configs[0];
        const ts = timestamp ? new Date(timestamp) : new Date();
        const open = isWithinBusinessHours(config, ts);
        const result: Record<string, unknown> = {
          schedule: config.name,
          timezone: config.timezone,
          checkedAt: ts.toISOString(),
          isOpen: open,
          nextOpen: nextBusinessHourStart(config, ts).toISOString(),
        };
        if (open) result.nextClose = nextBusinessHourClose(config, ts).toISOString();
        return textResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to check business hours');
      }
    },
  );

  // ---- business_hours_next_open ----
  server.tool(
    'business_hours_next_open',
    'Find when business hours next open',
    {
      id: z.string().describe('Schedule ID'),
      from: z.string().optional().describe('Start from (ISO timestamp, default: now)'),
    },
    async ({ id, from }) => {
      try {
        const { getBusinessHours, nextBusinessHourStart } = await import('@/lib/wfm/business-hours');
        const configs = getBusinessHours(id);
        if (configs.length === 0) return errorResult('Schedule not found');
        const ts = from ? new Date(from) : new Date();
        return textResult({ nextOpen: nextBusinessHourStart(configs[0], ts).toISOString() });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  // ---- business_hours_elapsed ----
  server.tool(
    'business_hours_elapsed',
    'Calculate elapsed business minutes between two timestamps',
    {
      id: z.string().describe('Schedule ID'),
      from: z.string().describe('Start ISO timestamp'),
      to: z.string().describe('End ISO timestamp'),
    },
    async ({ id, from, to }) => {
      try {
        const { getBusinessHours, getElapsedBusinessMinutes } = await import('@/lib/wfm/business-hours');
        const configs = getBusinessHours(id);
        if (configs.length === 0) return errorResult('Schedule not found');
        const minutes = getElapsedBusinessMinutes(configs[0], new Date(from), new Date(to));
        return textResult({ elapsedBusinessMinutes: minutes, from, to });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  // ---- business_hours_create ----
  server.tool(
    'business_hours_create',
    'Create a business hours schedule (requires confirm=true)',
    {
      name: z.string().describe('Schedule name'),
      timezone: z.string().optional().default('UTC').describe('Timezone (IANA)'),
      schedule: z.record(z.string(), z.array(z.object({
        start: z.string(),
        end: z.string(),
      }))).optional().describe('Day-keyed windows (defaults to Mon-Fri 9-5)'),
      isDefault: z.boolean().optional().describe('Set as default schedule'),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ name, timezone, schedule, isDefault, confirm }) => {
      const guard = scopeGuard('business_hours_create');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create business hours "${name}"`,
        preview: { name, timezone },
        execute: async () => {
          const { createBusinessHours } = await import('@/lib/wfm/business-hours');
          const defaultSchedule = {
            '1': [{ start: '09:00', end: '17:00' }],
            '2': [{ start: '09:00', end: '17:00' }],
            '3': [{ start: '09:00', end: '17:00' }],
            '4': [{ start: '09:00', end: '17:00' }],
            '5': [{ start: '09:00', end: '17:00' }],
          };
          const config = createBusinessHours({
            name,
            timezone: timezone ?? 'UTC',
            schedule: schedule ?? defaultSchedule,
            holidays: [],
            isDefault: isDefault ?? false,
          });
          recordMCPAction({ tool: 'business_hours_create', action: 'create', params: { name }, timestamp: new Date().toISOString(), result: 'success' });
          return { created: true, businessHours: config };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- business_hours_update ----
  server.tool(
    'business_hours_update',
    'Update a business hours schedule (requires confirm=true)',
    {
      id: z.string().describe('Schedule ID'),
      name: z.string().optional().describe('New name'),
      timezone: z.string().optional().describe('New timezone'),
      schedule: z.record(z.string(), z.array(z.object({
        start: z.string(),
        end: z.string(),
      }))).optional().describe('New schedule windows'),
      confirm: z.boolean().optional().describe('Must be true to update'),
    },
    async ({ id, name, timezone, schedule, confirm }) => {
      const guard = scopeGuard('business_hours_update');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Update business hours ${id}`,
        preview: { id, name, timezone },
        execute: async () => {
          const { updateBusinessHours } = await import('@/lib/wfm/business-hours');
          const updates: Record<string, unknown> = {};
          if (name) updates.name = name;
          if (timezone) updates.timezone = timezone;
          if (schedule) updates.schedule = schedule;
          const updated = updateBusinessHours(id, updates);
          if (!updated) throw new Error('Schedule not found');
          recordMCPAction({ tool: 'business_hours_update', action: 'update', params: { id }, timestamp: new Date().toISOString(), result: 'success' });
          return { updated: true, businessHours: updated };
        },
      });

      if (result.needsConfirmation) return result.result;
      try {
        return textResult(await result.value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  // ---- business_hours_delete ----
  server.tool(
    'business_hours_delete',
    'Delete a business hours schedule (requires confirm=true)',
    {
      id: z.string().describe('Schedule ID'),
      confirm: z.boolean().optional().describe('Must be true to delete'),
    },
    async ({ id, confirm }) => {
      const guard = scopeGuard('business_hours_delete');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Delete business hours ${id}`,
        preview: { id },
        execute: async () => {
          const { deleteBusinessHours } = await import('@/lib/wfm/business-hours');
          const deleted = deleteBusinessHours(id);
          if (!deleted) throw new Error('Schedule not found');
          recordMCPAction({ tool: 'business_hours_delete', action: 'delete', params: { id }, timestamp: new Date().toISOString(), result: 'success' });
          return { deleted: true };
        },
      });

      if (result.needsConfirmation) return result.result;
      try {
        return textResult(await result.value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  // ---- holiday_calendar_list ----
  server.tool(
    'holiday_calendar_list',
    'List holiday calendars',
    {},
    async () => {
      try {
        const { listHolidayCalendars } = await import('@/lib/wfm/holidays');
        const calendars = listHolidayCalendars();
        return textResult({ calendars, total: calendars.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  // ---- holiday_calendar_show ----
  server.tool(
    'holiday_calendar_show',
    'Show a specific holiday calendar with its entries',
    {
      id: z.string().describe('Calendar ID'),
    },
    async ({ id }) => {
      try {
        const { listHolidayCalendars } = await import('@/lib/wfm/holidays');
        const cals = listHolidayCalendars(id);
        if (cals.length === 0) return errorResult('Calendar not found');
        return textResult({ calendar: cals[0] });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  // ---- holiday_presets_list ----
  server.tool(
    'holiday_presets_list',
    'List available holiday calendar presets (US Federal, UK Bank, etc.)',
    {},
    async () => {
      try {
        const { listPresets } = await import('@/lib/wfm/presets');
        return textResult({ presets: listPresets() });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );

  // ---- holiday_calendar_create ----
  server.tool(
    'holiday_calendar_create',
    'Create a holiday calendar, optionally from a preset (requires confirm=true)',
    {
      name: z.string().describe('Calendar name'),
      description: z.string().optional().describe('Description'),
      presetId: z.string().optional().describe('Import from a preset (e.g., us-federal)'),
      year: z.number().optional().describe('Year for preset generation'),
      confirm: z.boolean().optional().describe('Must be true to create'),
    },
    async ({ name, description, presetId, year, confirm }) => {
      const guard = scopeGuard('holiday_calendar_create');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Create holiday calendar "${name}"${presetId ? ` from preset ${presetId}` : ''}`,
        preview: { name, presetId },
        execute: async () => {
          let entries: Array<{ name: string; date: string; recurring?: boolean }> = [];
          if (presetId) {
            const { generatePresetEntries } = await import('@/lib/wfm/presets');
            entries = generatePresetEntries(presetId, year);
          }
          const { createHolidayCalendar } = await import('@/lib/wfm/holidays');
          const cal = createHolidayCalendar({ name, description, entries });
          recordMCPAction({ tool: 'holiday_calendar_create', action: 'create', params: { name, presetId }, timestamp: new Date().toISOString(), result: 'success' });
          return { created: true, calendar: cal };
        },
      });

      if (result.needsConfirmation) return result.result;
      return textResult(await result.value);
    },
  );

  // ---- holiday_add_date ----
  server.tool(
    'holiday_add_date',
    'Add a holiday date to a calendar (requires confirm=true)',
    {
      calendarId: z.string().describe('Calendar ID'),
      name: z.string().describe('Holiday name'),
      date: z.string().describe('Date (YYYY-MM-DD)'),
      recurring: z.boolean().optional().describe('Repeat every year'),
      startTime: z.string().optional().describe('Partial-day start (HH:MM)'),
      endTime: z.string().optional().describe('Partial-day end (HH:MM)'),
      confirm: z.boolean().optional().describe('Must be true to add'),
    },
    async ({ calendarId, name, date, recurring, startTime, endTime, confirm }) => {
      const guard = scopeGuard('holiday_add_date');
      if (guard) return guard;

      const result = withConfirmation(confirm, {
        description: `Add "${name}" (${date}) to calendar ${calendarId}`,
        preview: { calendarId, name, date, recurring },
        execute: async () => {
          const { addEntryToCalendar } = await import('@/lib/wfm/holidays');
          const cal = addEntryToCalendar(calendarId, { name, date, recurring, startTime, endTime });
          if (!cal) throw new Error('Calendar not found');
          recordMCPAction({ tool: 'holiday_add_date', action: 'add', params: { calendarId, name, date }, timestamp: new Date().toISOString(), result: 'success' });
          return { added: true, calendar: cal };
        },
      });

      if (result.needsConfirmation) return result.result;
      try {
        return textResult(await result.value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed');
      }
    },
  );
}

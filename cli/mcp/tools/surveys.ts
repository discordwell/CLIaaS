/**
 * MCP survey tools: survey_stats, survey_config, survey_send.
 * survey_config and survey_send use the confirmation pattern.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeLoadTickets, findTicket } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import { getDataProvider } from '@/lib/data-provider/index.js';
import type { SurveyType, SurveyTrigger } from '@/lib/data-provider/types.js';
import { randomBytes } from 'crypto';

export function registerSurveyTools(server: McpServer): void {
  // ---- survey_stats ----
  server.tool(
    'survey_stats',
    'Get metrics for a survey type (CSAT/NPS/CES)',
    {
      type: z.enum(['csat', 'nps', 'ces']).describe('Survey type'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ type, dir }) => {
      try {
        const provider = await getDataProvider(dir);
        const responses = await provider.loadSurveyResponses(type as SurveyType);
        const completed = responses.filter(r => r.rating !== null);
        const ratings = completed.map(r => r.rating!);

        if (ratings.length === 0) {
          return textResult({
            type,
            totalResponses: 0,
            message: `No ${type.toUpperCase()} responses found.`,
          });
        }

        if (type === 'nps') {
          let promoters = 0, passives = 0, detractors = 0;
          for (const r of ratings) {
            if (r >= 9) promoters++;
            else if (r >= 7) passives++;
            else detractors++;
          }
          const npsScore = Math.round(((promoters - detractors) / ratings.length) * 100);
          return textResult({
            type, totalResponses: ratings.length, npsScore,
            promoters, passives, detractors,
          });
        }

        if (type === 'ces') {
          const sum = ratings.reduce((a, b) => a + b, 0);
          const avgEffort = Math.round((sum / ratings.length) * 100) / 100;
          const lowEffort = ratings.filter(r => r <= 3).length;
          const highEffort = ratings.filter(r => r >= 5).length;
          return textResult({
            type, totalResponses: ratings.length, avgEffort,
            lowEffort, highEffort,
          });
        }

        // CSAT
        const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;
        for (const r of ratings) {
          distribution[r] = (distribution[r] ?? 0) + 1;
          sum += r;
        }
        const averageRating = Math.round((sum / ratings.length) * 100) / 100;
        const satisfied = (distribution[4] ?? 0) + (distribution[5] ?? 0);
        const satisfactionPercent = Math.round((satisfied / ratings.length) * 10000) / 100;

        return textResult({
          type, totalResponses: ratings.length, averageRating,
          distribution, satisfactionPercent,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to load survey stats');
      }
    },
  );

  // ---- survey_config ----
  server.tool(
    'survey_config',
    'View or update survey configuration (requires confirm=true to update)',
    {
      type: z.enum(['csat', 'nps', 'ces']).describe('Survey type'),
      enabled: z.boolean().optional().describe('Enable or disable the survey'),
      trigger: z.enum(['ticket_solved', 'ticket_closed', 'manual']).optional().describe('When to send the survey'),
      delayMinutes: z.number().optional().describe('Delay in minutes before sending'),
      question: z.string().optional().describe('Custom question text'),
      confirm: z.boolean().optional().describe('Must be true to update config'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ type, enabled, trigger, delayMinutes, question, confirm, dir }) => {
      const guard = scopeGuard('survey_config');
      if (guard) return guard;

      try {
        const provider = await getDataProvider(dir);
        const configs = await provider.loadSurveyConfigs();
        const existing = configs.find(c => c.surveyType === type);

        // If no update params, just show current config
        const isUpdate = enabled !== undefined || trigger !== undefined ||
          delayMinutes !== undefined || question !== undefined;

        if (!isUpdate) {
          if (existing) {
            return textResult(existing);
          }
          return textResult({
            surveyType: type,
            enabled: false,
            trigger: 'ticket_solved',
            delayMinutes: 0,
            question: null,
            message: 'No configuration found. Use update params to create one.',
          });
        }

        const changes: Record<string, unknown> = {};
        if (enabled !== undefined) changes.enabled = enabled;
        if (trigger) changes.trigger = trigger;
        if (delayMinutes !== undefined) changes.delayMinutes = delayMinutes;
        if (question !== undefined) changes.question = question;

        const result = withConfirmation(confirm, {
          description: `Update ${type.toUpperCase()} survey config`,
          preview: { surveyType: type, changes, current: existing ?? null },
          execute: async () => {
            await provider.updateSurveyConfig({
              surveyType: type as SurveyType,
              enabled: enabled,
              trigger: trigger as SurveyTrigger | undefined,
              delayMinutes,
              question,
            });

            const now = new Date().toISOString();
            recordMCPAction({
              tool: 'survey_config', action: 'update',
              params: { surveyType: type, changes },
              timestamp: now, result: 'success',
            });
            return { updated: true, surveyType: type, changes, timestamp: now };
          },
        });

        if (result.needsConfirmation) return result.result;
        const value = await result.value;
        return textResult(value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to manage survey config');
      }
    },
  );

  // ---- survey_send ----
  server.tool(
    'survey_send',
    'Manually trigger a survey for a ticket (generates token and portal link, requires confirm=true)',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      type: z.enum(['csat', 'nps', 'ces']).describe('Survey type to send'),
      confirm: z.boolean().optional().describe('Must be true to send'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, type, confirm, dir }) => {
      const guard = scopeGuard('survey_send');
      if (guard) return guard;

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket "${ticketId}" not found.`);

      const token = randomBytes(32).toString('hex');
      const portalUrl = `/portal/survey/${token}#${type}`;

      const result = withConfirmation(confirm, {
        description: `Send ${type.toUpperCase()} survey for ticket ${ticket.id}`,
        preview: { ticketId: ticket.id, subject: ticket.subject, surveyType: type, portalUrl },
        execute: async () => {
          const now = new Date().toISOString();

          // Try to create a pending survey response with the token
          try {
            const provider = await getDataProvider(dir);
            await provider.createSurveyResponse({
              ticketId: ticket.id,
              surveyType: type as SurveyType,
              token,
            });
          } catch {
            // Non-DB mode — token still works via URL hash fallback
          }

          recordMCPAction({
            tool: 'survey_send', action: 'send',
            params: { ticketId: ticket.id, surveyType: type },
            timestamp: now, result: 'success',
          });

          return {
            sent: true,
            ticketId: ticket.id,
            surveyType: type,
            token,
            portalUrl,
            message: `Survey link generated. Share this URL with the customer: ${portalUrl}`,
            timestamp: now,
          };
        },
      });

      if (result.needsConfirmation) return result.result;
      const value = await result.value;
      return textResult(value);
    },
  );
}

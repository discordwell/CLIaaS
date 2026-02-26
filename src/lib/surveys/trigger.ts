/**
 * Survey auto-trigger logic.
 *
 * When a ticket is resolved or closed, checks if any survey configs are enabled
 * for that trigger event, generates a token, creates a pending survey_response,
 * and returns the portal link for the customer.
 */

import { randomBytes } from 'crypto';
import { getDataProvider } from '@/lib/data-provider/index';
import type { SurveyType, SurveyTrigger } from '@/lib/data-provider/types';
import { dispatch } from '@/lib/events/dispatcher';

export interface SurveyTriggerResult {
  surveyType: SurveyType;
  token: string;
  portalUrl: string;
  delayMinutes: number;
}

/**
 * Map canonical event names to survey trigger types.
 */
const EVENT_TO_TRIGGER: Record<string, SurveyTrigger> = {
  'ticket.resolved': 'ticket_solved',
  'ticket.closed': 'ticket_closed',
};

/**
 * Check enabled survey configs and generate pending survey responses for
 * any matching triggers. Returns an array of triggered surveys (may be 0+).
 *
 * Callers should use the returned portalUrl to notify the customer.
 */
export async function maybeTriggerSurvey(
  ticketId: string,
  event: string,
  customerId?: string,
): Promise<SurveyTriggerResult[]> {
  const triggerType = EVENT_TO_TRIGGER[event];
  if (!triggerType) return [];

  const provider = await getDataProvider();
  const configs = await provider.loadSurveyConfigs();

  const matching = configs.filter(
    c => c.enabled && c.trigger === triggerType,
  );

  if (matching.length === 0) return [];

  const results: SurveyTriggerResult[] = [];

  for (const config of matching) {
    const token = randomBytes(32).toString('hex');
    const portalUrl = `/portal/survey/${token}#${config.surveyType}`;

    try {
      await provider.createSurveyResponse({
        ticketId,
        customerId,
        surveyType: config.surveyType,
        token,
      });
    } catch {
      // If we can't persist (e.g. JSONL mode), still return the link
    }

    dispatch('survey.sent', {
      surveyType: config.surveyType,
      ticketId,
      token,
    });

    results.push({
      surveyType: config.surveyType,
      token,
      portalUrl,
      delayMinutes: config.delayMinutes,
    });
  }

  return results;
}

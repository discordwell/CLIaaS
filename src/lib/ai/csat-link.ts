/**
 * CSAT → AI Resolution link.
 * When a CSAT survey is submitted for a ticket that has an AI resolution,
 * updates the ai_resolutions record with the CSAT score for future analysis.
 */

import { listResolutions, updateResolutionStatus } from './store';
import { createLogger } from '../logger';

const logger = createLogger('ai:csat-link');

export async function linkCSATToResolution(data: {
  ticketId: string;
  rating: number;
  comment?: string;
}): Promise<boolean> {
  try {
    const { records } = await listResolutions({
      ticketId: data.ticketId,
      limit: 1,
    });

    if (records.length === 0) return false;

    const resolution = records[0];
    // Only link to resolutions that were actually AI-resolved
    if (resolution.status !== 'auto_resolved' && resolution.status !== 'approved') {
      return false;
    }

    await updateResolutionStatus(resolution.id, resolution.status, {
      csatScore: data.rating,
      csatComment: data.comment,
    });

    logger.info({ ticketId: data.ticketId, resolutionId: resolution.id, score: data.rating }, 'Linked CSAT to AI resolution');
    return true;
  } catch (err) {
    logger.debug({ err }, 'Failed to link CSAT to AI resolution');
    return false;
  }
}

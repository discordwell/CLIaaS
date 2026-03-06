/**
 * AutoQA scoring BullMQ worker.
 * Processes autoqa-scoring jobs: loads ticket data, runs AutoQA engine, persists results.
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getRedisConnectionOpts } from '../connection';
import { QUEUE_NAMES, type AutoQAScoringJob } from '../types';
import { createLogger } from '../../logger';

const logger = createLogger('queue:autoqa-worker');

export function createAutoQAWorker() {
  const opts = getRedisConnectionOpts();
  if (!opts) return null;

  const worker = new Worker<AutoQAScoringJob>(
    QUEUE_NAMES.AUTOQA_SCORING,
    async (job: Job<AutoQAScoringJob>) => {
      const { ticketId, workspaceId, trigger } = job.data;
      logger.info({ ticketId, workspaceId, trigger }, 'Processing AutoQA scoring job');

      try {
        // Dynamic imports to avoid circular dependencies
        const { getDataProvider } = await import('../../data-provider/index');
        const { runAutoQA } = await import('../../ai/autoqa');
        const { createPrediction } = await import('../../predictions/csat-prediction-store');
        const { dispatch } = await import('../../events/dispatcher');

        const provider = await getDataProvider();
        const tickets = await provider.loadTickets();
        const ticket = tickets.find(t => t.id === ticketId);

        if (!ticket) {
          logger.warn({ ticketId }, 'Ticket not found, skipping AutoQA');
          return { ticketId, status: 'skipped', reason: 'ticket_not_found' };
        }

        const messages = await provider.loadMessages(ticketId);
        if (messages.length === 0) {
          logger.warn({ ticketId }, 'No messages found, skipping AutoQA');
          return { ticketId, status: 'skipped', reason: 'no_messages' };
        }

        // Find the last agent reply to evaluate
        const agentReplies = messages.filter(m => m.type === 'reply' && m.author !== ticket.requester);
        const responseText = agentReplies.length > 0
          ? agentReplies[agentReplies.length - 1].body
          : messages[messages.length - 1].body;

        const result = await runAutoQA(ticketId, workspaceId, {
          ticket,
          messages,
          responseText,
          messageId: agentReplies.length > 0 ? agentReplies[agentReplies.length - 1].id : undefined,
        });

        if (result.skipped) {
          logger.info({ ticketId, reason: result.skipReason }, 'AutoQA skipped');
          return { ticketId, status: 'skipped', reason: result.skipReason };
        }

        // Persist CSAT prediction
        if (result.csatPrediction) {
          createPrediction({
            workspaceId,
            ticketId,
            predictedScore: result.csatPrediction.score,
            confidence: result.csatPrediction.confidence,
            riskLevel: result.csatPrediction.riskLevel,
            factors: result.csatPrediction.factors,
          });
        }

        // Dispatch events
        dispatch('qa.review_completed', {
          workspaceId,
          ticketId,
          reviewId: result.review.id,
          totalScore: result.review.totalScore,
          maxPossibleScore: result.review.maxPossibleScore,
          flagsCreated: result.flagsCreated,
          reviewType: 'auto',
        });

        // Dispatch critical flag event if any
        if (result.flagsCreated > 0 && result.report.flags.some(f => f.severity === 'critical')) {
          dispatch('qa.review_created', {
            workspaceId,
            ticketId,
            reviewId: result.review.id,
            severity: 'critical',
            flagCount: result.flagsCreated,
          });
        }

        logger.info({
          ticketId,
          reviewId: result.review.id,
          score: `${result.review.totalScore}/${result.review.maxPossibleScore}`,
          flags: result.flagsCreated,
        }, 'AutoQA scoring completed');

        return {
          ticketId,
          status: 'completed',
          reviewId: result.review.id,
          totalScore: result.review.totalScore,
          maxPossibleScore: result.review.maxPossibleScore,
          flagsCreated: result.flagsCreated,
        };
      } catch (err) {
        logger.error({ ticketId, error: err instanceof Error ? err.message : 'Unknown' }, 'AutoQA scoring failed');
        throw err;
      }
    },
    {
      ...opts,
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'AutoQA worker job failed');
  });

  logger.info('AutoQA scoring worker started');
  return worker;
}

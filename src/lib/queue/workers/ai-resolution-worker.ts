/**
 * BullMQ worker: processes AI resolution jobs.
 * Loads config, ticket, messages, KB articles, and runs the pipeline.
 */

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getRedisConnectionOpts } from '../connection';
import { QUEUE_NAMES, type AIResolutionJob } from '../types';
import { createLogger } from '../../logger';

const logger = createLogger('queue:ai-resolution-worker');

// Rate limiter: track auto-resolves per workspace per hour
const autoResolveCounters = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(workspaceId: string, maxPerHour: number): boolean {
  const now = Date.now();
  const key = workspaceId;
  const entry = autoResolveCounters.get(key);

  if (!entry || now >= entry.resetAt) {
    autoResolveCounters.set(key, { count: 1, resetAt: now + 3600_000 });
    return true;
  }

  if (entry.count >= maxPerHour) return false;
  entry.count++;
  return true;
}

export function createAIResolutionWorker(): Worker | null {
  const opts = getRedisConnectionOpts();
  if (!opts) return null;

  const worker = new Worker<AIResolutionJob>(
    QUEUE_NAMES.AI_RESOLUTION,
    async (job: Job<AIResolutionJob>) => {
      const { ticketId, event, data } = job.data;
      const workspaceId = (data?.workspaceId as string) ?? 'default';
      logger.info({ ticketId, event, workspaceId }, 'AI resolution job received');

      // 1. Load AI config
      const { getAgentConfig } = await import('../../ai/store');
      const config = await getAgentConfig(workspaceId);

      if (!config.enabled) {
        logger.info({ ticketId, workspaceId }, 'AI resolution disabled for workspace');
        return { ticketId, status: 'disabled' };
      }

      // 2. Rate limit check for auto mode
      if (config.mode === 'auto') {
        const maxPerHour = config.maxAutoResolvesPerHour ?? 50;
        if (!checkRateLimit(workspaceId, maxPerHour)) {
          logger.warn({ ticketId, workspaceId, maxPerHour }, 'AI auto-resolve rate limit exceeded');
          return { ticketId, status: 'rate_limited' };
        }
      }

      // 3. Duplicate prevention: check for existing pending resolution
      const { listResolutions } = await import('../../ai/store');
      const { records: existing } = await listResolutions({
        workspaceId,
        ticketId,
        status: 'pending',
        limit: 1,
      });
      if (existing.length > 0) {
        logger.info({ ticketId, existingId: existing[0].id }, 'Pending resolution already exists, skipping');
        return { ticketId, status: 'duplicate', existingId: existing[0].id };
      }

      // 4. Load ticket + messages via DataProvider
      const { getDataProvider } = await import('../../data-provider/index');
      const provider = await getDataProvider();
      const tickets = await provider.loadTickets();
      const ticket = tickets.find(t => t.id === ticketId);
      if (!ticket) {
        logger.warn({ ticketId }, 'Ticket not found for AI resolution');
        return { ticketId, status: 'not_found' };
      }

      const messages = await provider.loadMessages(ticketId);

      // 5. Load KB articles
      let kbArticles: Awaited<ReturnType<typeof provider.loadKBArticles>> = [];
      try { kbArticles = await provider.loadKBArticles(); } catch { /* no KB */ }

      // 6. Run the pipeline
      const { resolveTicket } = await import('../../ai/resolution-pipeline');
      const outcome = await resolveTicket(ticket, messages, kbArticles, {
        configOverride: config,
        workspaceId,
      });

      logger.info({
        ticketId,
        action: outcome.action,
        resolutionId: outcome.resolutionId,
        confidence: outcome.result.confidence,
      }, 'AI resolution completed');

      return {
        ticketId,
        status: outcome.action,
        resolutionId: outcome.resolutionId,
        confidence: outcome.result.confidence,
      };
    },
    {
      ...opts,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, ticketId: job.data.ticketId }, 'AI resolution completed');
  });

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, ticketId: job?.data.ticketId, error: err.message }, 'AI resolution failed');
  });

  return worker;
}

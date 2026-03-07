/**
 * Customer Health Score computation engine.
 * Aggregates signals from CSAT, sentiment, ticket effort, resolution quality, and engagement.
 * Designed as a scheduled/on-demand batch computation.
 */

import type { Ticket, Message, Customer } from '@/lib/data';
import { upsertHealthScore, getHealthScore, type CustomerHealthScore } from './health-score-store';
import { createLogger } from '../logger';

const logger = createLogger('customers:health-engine');

// Component weights (must sum to 1.0)
const WEIGHTS = {
  csat: 0.30,
  sentiment: 0.20,
  effort: 0.20,
  resolution: 0.15,
  engagement: 0.15,
} as const;

// Lookback period in days
const LOOKBACK_DAYS = 90;

export interface HealthComputeInput {
  customer: Customer;
  tickets: Ticket[];
  messages: Message[];
  csatRatings: Array<{ rating: number; createdAt: string }>;
  workspaceId: string;
}

/**
 * Compute health score for a single customer.
 */
export async function computeHealthScore(input: HealthComputeInput): Promise<CustomerHealthScore> {
  const { customer, tickets, messages, csatRatings, workspaceId } = input;
  const now = Date.now();
  const cutoff = now - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  // Filter to lookback period
  const recentTickets = tickets.filter(t => new Date(t.createdAt).getTime() > cutoff);
  const recentRatings = csatRatings.filter(r => new Date(r.createdAt).getTime() > cutoff);

  // 1. CSAT component (0-100)
  let csatScore = 70; // default neutral
  if (recentRatings.length > 0) {
    const avgRating = recentRatings.reduce((s, r) => s + r.rating, 0) / recentRatings.length;
    csatScore = Math.round(((avgRating - 1) / 4) * 100); // 1-5 → 0-100
  }

  // 2. Sentiment component (0-100)
  // Heuristic: analyze last messages from customer in recent tickets
  const customerMessages = messages.filter(m =>
    m.author === customer.name || m.author === customer.email,
  );
  let sentimentScore = 60; // neutral default
  if (customerMessages.length > 0) {
    const lastMessages = customerMessages.slice(-10);
    let posCount = 0;
    let negCount = 0;
    for (const msg of lastMessages) {
      const lower = msg.body.toLowerCase();
      if (/(thank|great|awesome|excellent|love|perfect|helpful)/i.test(lower)) posCount++;
      if (/(frustrated|angry|terrible|worst|broken|hate|unacceptable)/i.test(lower)) negCount++;
    }
    const total = posCount + negCount;
    if (total > 0) {
      sentimentScore = Math.round((posCount / total) * 100);
    }
  }

  // 3. Effort component (0-100, inverse of effort = less effort is better)
  let effortScore = 80; // default good
  if (recentTickets.length > 0) {
    const recentTicketIds = new Set(recentTickets.map(t => t.id));
    const recentMessages = messages.filter(m => recentTicketIds.has(m.ticketId));
    const avgMessagesPerTicket = recentMessages.length / recentTickets.length;
    const reopenedCount = recentTickets.filter(t =>
      messages.some(m => m.ticketId === t.id && m.type === 'system' && /reopen/i.test(m.body)),
    ).length;

    // High message count = high effort = low score
    if (avgMessagesPerTicket > 10) effortScore -= 30;
    else if (avgMessagesPerTicket > 5) effortScore -= 15;

    // Reopens are bad
    effortScore -= reopenedCount * 15;

    // Lots of tickets = potentially high effort customer
    if (recentTickets.length > 10) effortScore -= 20;
    else if (recentTickets.length > 5) effortScore -= 10;

    effortScore = Math.max(0, Math.min(100, effortScore));
  }

  // 4. Resolution component (0-100)
  let resolutionScore = 70;
  if (recentTickets.length > 0) {
    const resolved = recentTickets.filter(t => t.status === 'solved' || t.status === 'closed');
    const resolutionRate = resolved.length / recentTickets.length;
    resolutionScore = Math.round(resolutionRate * 100);

    // First-contact resolution bonus
    const fcrTickets = resolved.filter(t => {
      const ticketMsgs = messages.filter(m => m.ticketId === t.id && m.type === 'reply');
      const agentReplies = ticketMsgs.filter(m => m.author !== customer.name && m.author !== customer.email);
      return agentReplies.length <= 1;
    });
    if (resolved.length > 0) {
      const fcrRate = fcrTickets.length / resolved.length;
      resolutionScore = Math.round(resolutionScore * 0.7 + fcrRate * 100 * 0.3);
    }
  }

  // 5. Engagement component (0-100)
  let engagementScore = 50;
  if (recentTickets.length > 0) {
    // Recency: how recent was the last interaction?
    const lastTicketDate = Math.max(...recentTickets.map(t => new Date(t.updatedAt).getTime()));
    const daysSinceLastInteraction = (now - lastTicketDate) / (1000 * 60 * 60 * 24);
    if (daysSinceLastInteraction < 7) engagementScore = 90;
    else if (daysSinceLastInteraction < 30) engagementScore = 70;
    else if (daysSinceLastInteraction < 60) engagementScore = 50;
    else engagementScore = 30;
  }

  // Weighted overall score
  const overallScore = Math.round(
    csatScore * WEIGHTS.csat +
    sentimentScore * WEIGHTS.sentiment +
    effortScore * WEIGHTS.effort +
    resolutionScore * WEIGHTS.resolution +
    engagementScore * WEIGHTS.engagement,
  );

  // Trend: compare to previous score
  const previous = await getHealthScore(workspaceId, customer.id);
  let trend: 'improving' | 'declining' | 'stable' = 'stable';
  if (previous) {
    const delta = overallScore - previous.overallScore;
    if (delta > 5) trend = 'improving';
    else if (delta < -5) trend = 'declining';
  }

  const result = upsertHealthScore({
    workspaceId,
    customerId: customer.id,
    overallScore,
    csatScore,
    sentimentScore,
    effortScore,
    resolutionScore,
    engagementScore,
    trend,
    previousScore: previous?.overallScore,
    signals: {
      ticketCount: recentTickets.length,
      csatRatingCount: recentRatings.length,
      messageCount: customerMessages.length,
      lookbackDays: LOOKBACK_DAYS,
    },
  });

  logger.info({
    customerId: customer.id,
    overallScore,
    trend,
    components: { csatScore, sentimentScore, effortScore, resolutionScore, engagementScore },
  }, 'Health score computed');

  return result;
}

/**
 * Batch compute health scores for all customers in a workspace.
 */
export async function computeHealthScoresBatch(
  inputs: HealthComputeInput[],
): Promise<{ computed: number; avgScore: number; atRisk: number }> {
  let totalScore = 0;
  let atRisk = 0;

  for (const input of inputs) {
    const result = await computeHealthScore(input);
    totalScore += result.overallScore;
    if (result.overallScore <= 40) atRisk++;
  }

  return {
    computed: inputs.length,
    avgScore: inputs.length > 0 ? Math.round(totalScore / inputs.length) : 0,
    atRisk,
  };
}

/**
 * MCP QA tools: qa_review, qa_dashboard, autoqa_config, autoqa_run, qa_flags, qa_coaching,
 * csat_predict, customer_health, customer_at_risk, qa_agent_performance.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult } from '../util.js';
import { withConfirmation, recordMCPAction } from './confirm.js';
import { scopeGuard } from './scopes.js';
import {
  getScorecards,
  getReviews,
  createReview,
  getQADashboard,
} from '@/lib/qa/qa-store.js';
import { getAutoQAConfig, upsertAutoQAConfig } from '@/lib/qa/autoqa-config-store.js';
import { getFlags, dismissFlag } from '@/lib/qa/qa-flags-store.js';
import { getCoachingAssignments, createCoachingAssignment, updateCoachingAssignment } from '@/lib/qa/qa-coaching-store.js';
import { getPredictions, getAccuracyStats } from '@/lib/predictions/csat-prediction-store.js';
import { getHealthScore, getAtRiskCustomers } from '@/lib/customers/health-score-store.js';

export function registerQATools(server: McpServer): void {
  // ---- qa_review ----
  server.tool(
    'qa_review',
    'Create or list QA reviews. Omit ticketId/scores to list, provide them to create (requires confirm=true for create)',
    {
      ticketId: z.string().optional().describe('Ticket ID to review or filter by'),
      scores: z.record(z.string(), z.number()).optional().describe('Score per criterion (for create)'),
      notes: z.string().optional().describe('Review notes (for create)'),
      confirm: z.boolean().optional().describe('Must be true to create a review'),
    },
    async ({ ticketId, scores, notes, confirm }) => {
      try {
        if (!scores) {
          const reviews = await getReviews(ticketId ? { ticketId } : undefined);
          return textResult({
            reviewCount: reviews.length,
            reviews: reviews.map((r) => ({
              id: r.id,
              ticketId: r.ticketId,
              reviewType: r.reviewType,
              totalScore: r.totalScore,
              maxPossibleScore: r.maxPossibleScore,
              status: r.status,
              createdAt: r.createdAt,
            })),
          });
        }

        const guard = scopeGuard('qa_review');
        if (guard) return guard;

        if (!ticketId) return errorResult('ticketId is required when creating a review.');

        const scorecards = await getScorecards();
        const activeScorecard = scorecards.find((s) => s.enabled);
        if (!activeScorecard) {
          return errorResult('No active scorecard found. Create and enable a scorecard first.');
        }

        const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
        const maxPossibleScore = activeScorecard.criteria.reduce((sum, c) => sum + c.maxScore, 0);

        const result = withConfirmation(confirm, {
          description: `Create QA review for ticket ${ticketId}`,
          preview: { ticketId, scorecardId: activeScorecard.id, scores, totalScore, maxPossibleScore, notes },
          execute: () => {
            const review = createReview({
              ticketId,
              scorecardId: activeScorecard.id,
              reviewType: 'manual',
              scores, totalScore, maxPossibleScore, notes,
              status: 'completed',
            });
            recordMCPAction({ tool: 'qa_review', action: 'create', params: { ticketId, scores }, timestamp: new Date().toISOString(), result: 'success' });
            return { created: true, review: { id: review.id, ticketId: review.ticketId, totalScore: review.totalScore, maxPossibleScore: review.maxPossibleScore, status: review.status } };
          },
        });

        if (result.needsConfirmation) return result.result;
        return textResult(result.value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to manage QA reviews');
      }
    },
  );

  // ---- qa_dashboard ----
  server.tool(
    'qa_dashboard',
    'Get QA dashboard metrics: average scores, review counts, and per-scorecard breakdown',
    {},
    async () => {
      try {
        return textResult(await getQADashboard());
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to load QA dashboard');
      }
    },
  );

  // ---- autoqa_config ----
  server.tool(
    'autoqa_config',
    'Get or update AutoQA configuration. Omit fields to read, provide them to update.',
    {
      enabled: z.boolean().optional().describe('Enable/disable AutoQA'),
      scorecardId: z.string().optional().describe('Scorecard to use for auto-scoring'),
      sampleRate: z.number().min(0).max(1).optional().describe('Sampling rate 0.0-1.0 (1.0 = score all tickets)'),
      provider: z.enum(['claude', 'openai']).optional().describe('LLM provider'),
      model: z.string().optional().describe('Override model name'),
      customInstructions: z.string().max(2000).optional().describe('Additional scoring instructions'),
      confirm: z.boolean().optional().describe('Must be true to update config'),
    },
    async ({ enabled, scorecardId, sampleRate, provider, model, customInstructions, confirm }) => {
      try {
        const wsId = 'default';
        const hasUpdate = enabled !== undefined || scorecardId !== undefined || sampleRate !== undefined
          || provider !== undefined || model !== undefined || customInstructions !== undefined;
        if (!hasUpdate) {
          const config = await getAutoQAConfig(wsId);
          return textResult({ config: config ?? { enabled: false, workspaceId: wsId } });
        }

        const guard = scopeGuard('autoqa_config');
        if (guard) return guard;

        const updates = {
          ...(enabled !== undefined && { enabled }),
          ...(scorecardId !== undefined && { scorecardId }),
          ...(sampleRate !== undefined && { sampleRate }),
          ...(provider !== undefined && { provider }),
          ...(model !== undefined && { model }),
          ...(customInstructions !== undefined && { customInstructions }),
        };

        const result = withConfirmation(confirm, {
          description: 'Update AutoQA configuration',
          preview: updates,
          execute: () => {
            const config = upsertAutoQAConfig(wsId, updates);
            return { updated: true, config };
          },
        });

        if (result.needsConfirmation) return result.result;
        return textResult(result.value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to manage AutoQA config');
      }
    },
  );

  // ---- autoqa_run ----
  server.tool(
    'autoqa_run',
    'Run AutoQA scoring on a single ticket. Returns scores, flags, and CSAT prediction.',
    {
      ticketId: z.string().describe('Ticket ID to score'),
      confirm: z.boolean().optional().describe('Must be true to run scoring'),
    },
    async ({ ticketId, confirm }) => {
      try {
        const guard = scopeGuard('autoqa_run');
        if (guard) return guard;

        const result = withConfirmation(confirm, {
          description: `Run AutoQA on ticket ${ticketId}`,
          preview: { ticketId },
          execute: async () => {
            const { runAutoQA } = await import('@/lib/ai/autoqa.js');
            const { loadTickets, loadMessages } = await import('@/lib/data.js');

            const tickets = await loadTickets();
            const ticket = tickets.find(t => t.id === ticketId);
            if (!ticket) return { error: 'Ticket not found' };

            const messages = await loadMessages(ticketId);
            const agentReplies = messages.filter(m => m.type === 'reply' && m.author !== ticket.requester);
            const responseText = agentReplies.length > 0 ? agentReplies[agentReplies.length - 1].body : messages[messages.length - 1]?.body ?? '';

            const qaResult = await runAutoQA(ticketId, 'default', { ticket, messages, responseText }, { skipSampling: true });
            if (qaResult.skipped) return { skipped: true, reason: qaResult.skipReason };

            return {
              reviewId: qaResult.review.id,
              score: `${qaResult.review.totalScore}/${qaResult.review.maxPossibleScore}`,
              percentage: qaResult.review.maxPossibleScore > 0 ? Math.round((qaResult.review.totalScore / qaResult.review.maxPossibleScore) * 100) : 0,
              flagsCreated: qaResult.flagsCreated,
              csatPrediction: qaResult.csatPrediction,
              suggestions: qaResult.report.suggestions,
            };
          },
        });

        if (result.needsConfirmation) return result.result;
        return textResult(await result.value);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'AutoQA run failed');
      }
    },
  );

  // ---- qa_flags ----
  server.tool(
    'qa_flags',
    'List or dismiss QA spotlight flags. Filter by severity, ticket, or agent.',
    {
      severity: z.enum(['info', 'warning', 'critical']).optional().describe('Filter by severity'),
      ticketId: z.string().optional().describe('Filter by ticket'),
      dismissId: z.string().optional().describe('Flag ID to dismiss'),
    },
    async ({ severity, ticketId, dismissId }) => {
      try {
        if (dismissId) {
          const guard = scopeGuard('qa_flags');
          if (guard) return guard;
          const result = dismissFlag(dismissId, 'mcp-user');
          if (!result) return errorResult('Flag not found');
          return textResult({ dismissed: true, flag: result });
        }

        const flags = await getFlags({ severity, ticketId, dismissed: false });
        return textResult({
          flagCount: flags.length,
          flags: flags.map(f => ({
            id: f.id, category: f.category, severity: f.severity,
            message: f.message, ticketId: f.ticketId, createdAt: f.createdAt,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to manage QA flags');
      }
    },
  );

  // ---- qa_coaching ----
  server.tool(
    'qa_coaching',
    'List, create, or update coaching assignments.',
    {
      agentId: z.string().optional().describe('Filter by agent or assign to agent'),
      reviewId: z.string().optional().describe('Review to assign for coaching'),
      assignmentId: z.string().optional().describe('Assignment ID to update'),
      status: z.enum(['pending', 'acknowledged', 'completed']).optional().describe('Filter or update status'),
      notes: z.string().optional().describe('Coaching notes'),
      confirm: z.boolean().optional().describe('Must be true to create assignment'),
    },
    async ({ agentId, reviewId, assignmentId, status, notes, confirm }) => {
      try {
        // Update mode
        if (assignmentId) {
          const guard = scopeGuard('qa_coaching');
          if (guard) return guard;

          const updateResult = withConfirmation(confirm, {
            description: `Update coaching assignment ${assignmentId}`,
            preview: { assignmentId, status, notes },
            execute: () => {
              const result = updateCoachingAssignment(assignmentId, {
                status: status as 'acknowledged' | 'completed' | undefined,
                notes,
              });
              if (!result) return { error: 'Assignment not found' };
              return { updated: true, assignment: result };
            },
          });

          if (updateResult.needsConfirmation) return updateResult.result;
          const val = updateResult.value;
          if ('error' in val) return errorResult(val.error as string);
          return textResult(val);
        }

        // Create mode
        if (reviewId && agentId) {
          const guard = scopeGuard('qa_coaching');
          if (guard) return guard;

          const result = withConfirmation(confirm, {
            description: `Assign coaching for review ${reviewId} to agent ${agentId}`,
            preview: { reviewId, agentId, notes },
            execute: () => {
              const assignment = createCoachingAssignment({
                workspaceId: 'default', reviewId, agentId, assignedBy: 'mcp-user', notes,
              });
              return { created: true, assignment };
            },
          });

          if (result.needsConfirmation) return result.result;
          return textResult(result.value);
        }

        // List mode
        const assignments = await getCoachingAssignments({ agentId, status });
        return textResult({ count: assignments.length, assignments });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to manage coaching');
      }
    },
  );

  // ---- csat_predict ----
  server.tool(
    'csat_predict',
    'Predict customer satisfaction for a ticket before survey is sent.',
    {
      ticketId: z.string().describe('Ticket ID to predict CSAT for'),
    },
    async ({ ticketId }) => {
      try {
        const { predictCSAT } = await import('@/lib/predictions/csat-predictor.js');
        const { loadTickets, loadMessages } = await import('@/lib/data.js');

        const tickets = await loadTickets();
        const ticket = tickets.find(t => t.id === ticketId);
        if (!ticket) return errorResult('Ticket not found');

        const messages = await loadMessages(ticketId);
        const result = predictCSAT({ ticket, messages });

        return textResult({
          ticketId,
          prediction: result,
          interpretation: result.riskLevel === 'high'
            ? 'High risk of negative satisfaction — consider proactive outreach'
            : result.riskLevel === 'medium'
              ? 'Moderate satisfaction expected — review before closing'
              : 'Good satisfaction expected',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'CSAT prediction failed');
      }
    },
  );

  // ---- csat_prediction_accuracy ----
  server.tool(
    'csat_prediction_accuracy',
    'Report on CSAT prediction accuracy — compares predicted vs actual scores.',
    {},
    async () => {
      try {
        return textResult(await getAccuracyStats());
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get accuracy stats');
      }
    },
  );

  // ---- customer_health ----
  server.tool(
    'customer_health',
    'Get customer health score. Shows overall score and component breakdown.',
    {
      customerId: z.string().describe('Customer ID'),
    },
    async ({ customerId }) => {
      try {
        const score = await getHealthScore('default', customerId);
        if (!score) return textResult({ customerId, status: 'no_score', message: 'Health score not yet computed. Run health compute first.' });
        return textResult(score);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get health score');
      }
    },
  );

  // ---- customer_at_risk ----
  server.tool(
    'customer_at_risk',
    'List customers with declining or low health scores.',
    {
      limit: z.number().optional().describe('Max results (default 20)'),
    },
    async ({ limit }) => {
      try {
        const atRisk = await getAtRiskCustomers('default', limit ?? 20);
        return textResult({
          atRiskCount: atRisk.length,
          customers: atRisk.map(s => ({
            customerId: s.customerId,
            overallScore: s.overallScore,
            trend: s.trend,
            csatScore: s.csatScore,
            effortScore: s.effortScore,
            computedAt: s.computedAt,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get at-risk customers');
      }
    },
  );

  // ---- qa_agent_performance ----
  server.tool(
    'qa_agent_performance',
    'Per-agent quality metrics: scores, trends, flags, comparisons.',
    {
      agentId: z.string().optional().describe('Specific agent ID (omit for all agents)'),
    },
    async ({ agentId }) => {
      try {
        const reviews = await getReviews({ status: 'completed' });
        const flags = await getFlags({ dismissed: false });

        if (agentId) {
          const agentReviews = reviews.filter(r => r.reviewerId === agentId);
          const agentFlags = flags.filter(f => {
            const review = reviews.find(r => r.id === f.reviewId);
            return review?.reviewerId === agentId;
          });
          const totalScore = agentReviews.reduce((s, r) => s + r.totalScore, 0);
          const totalMax = agentReviews.reduce((s, r) => s + r.maxPossibleScore, 0);

          return textResult({
            agentId,
            reviewCount: agentReviews.length,
            avgPercentage: totalMax > 0 ? Math.round((totalScore / totalMax) * 10000) / 100 : 0,
            flagCount: agentFlags.length,
            criticalFlags: agentFlags.filter(f => f.severity === 'critical').length,
            recentReviews: agentReviews.slice(0, 5).map(r => ({
              id: r.id, ticketId: r.ticketId, totalScore: r.totalScore, maxPossibleScore: r.maxPossibleScore, createdAt: r.createdAt,
            })),
          });
        }

        // All agents summary
        const agentMap = new Map<string, { count: number; total: number; max: number; flags: number }>();
        for (const r of reviews) {
          if (!r.reviewerId || r.reviewerId === 'autoqa' || r.reviewerId === 'auto') continue;
          const a = agentMap.get(r.reviewerId) ?? { count: 0, total: 0, max: 0, flags: 0 };
          a.count++; a.total += r.totalScore; a.max += r.maxPossibleScore;
          agentMap.set(r.reviewerId, a);
        }

        return textResult({
          agents: Array.from(agentMap.entries()).map(([id, a]) => ({
            agentId: id,
            reviewCount: a.count,
            avgPercentage: a.max > 0 ? Math.round((a.total / a.max) * 10000) / 100 : 0,
          })),
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to get agent performance');
      }
    },
  );
}

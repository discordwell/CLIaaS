/**
 * MCP QA tools: qa_review, qa_dashboard.
 * qa_review uses the confirmation pattern for create operations.
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
        // List mode: no scores provided
        if (!scores) {
          const reviews = getReviews(ticketId ? { ticketId } : undefined);
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

        // Create mode
        const guard = scopeGuard('qa_review');
        if (guard) return guard;

        if (!ticketId) return errorResult('ticketId is required when creating a review.');

        const scorecards = getScorecards();
        const activeScorecard = scorecards.find((s) => s.enabled);
        if (!activeScorecard) {
          return errorResult('No active scorecard found. Create and enable a scorecard first.');
        }

        const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
        const maxPossibleScore = activeScorecard.criteria.reduce((sum, c) => sum + c.maxScore, 0);

        const result = withConfirmation(confirm, {
          description: `Create QA review for ticket ${ticketId}`,
          preview: {
            ticketId,
            scorecardId: activeScorecard.id,
            scorecardName: activeScorecard.name,
            scores,
            totalScore,
            maxPossibleScore,
            notes,
          },
          execute: () => {
            const review = createReview({
              ticketId,
              scorecardId: activeScorecard.id,
              reviewType: 'manual',
              scores,
              totalScore,
              maxPossibleScore,
              notes,
              status: 'completed',
            });

            const now = new Date().toISOString();
            recordMCPAction({
              tool: 'qa_review', action: 'create',
              params: { ticketId, scores },
              timestamp: now, result: 'success',
            });

            return {
              created: true,
              review: {
                id: review.id,
                ticketId: review.ticketId,
                totalScore: review.totalScore,
                maxPossibleScore: review.maxPossibleScore,
                status: review.status,
                createdAt: review.createdAt,
              },
            };
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
        const dashboard = getQADashboard();
        return textResult(dashboard);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'Failed to load QA dashboard');
      }
    },
  );
}

/**
 * AutoQA engine — connects the LLM/heuristic QA scorer to scorecards,
 * persists results to qa_reviews + qa_flags, and generates CSAT predictions.
 *
 * This replaces the random-score demo auto-review with real analysis.
 */

import { scoreResponse, type QAReport, type QAInput } from './qa';
import { getAutoQAConfig } from '../qa/autoqa-config-store';
import { getScorecard, getScorecards, createReview, type QAReview, type QAScorecard } from '../qa/qa-store';
import { createFlag } from '../qa/qa-flags-store';
import { createLogger } from '../logger';

const logger = createLogger('ai:autoqa');

export interface AutoQAResult {
  review: QAReview;
  report: QAReport;
  flagsCreated: number;
  csatPrediction?: {
    score: number;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high';
    factors: Record<string, unknown>;
  };
  skipped: boolean;
  skipReason?: string;
}

/**
 * Run AutoQA on a single ticket.
 * Loads config, checks sampling, scores via LLM/heuristic, persists results.
 */
export async function runAutoQA(
  ticketId: string,
  workspaceId: string,
  input: QAInput,
  options?: { forceScorecardId?: string; skipSampling?: boolean },
): Promise<AutoQAResult> {
  const config = getAutoQAConfig(workspaceId);

  // Check if enabled (allow override for manual trigger)
  if (!options?.skipSampling && (!config || !config.enabled)) {
    return {
      review: {} as QAReview,
      report: {} as QAReport,
      flagsCreated: 0,
      skipped: true,
      skipReason: 'AutoQA is disabled for this workspace',
    };
  }

  // Check sample rate
  if (!options?.skipSampling && config && Math.random() > config.sampleRate) {
    return {
      review: {} as QAReview,
      report: {} as QAReport,
      flagsCreated: 0,
      skipped: true,
      skipReason: `Ticket not sampled (rate: ${config.sampleRate * 100}%)`,
    };
  }

  // Resolve scorecard
  const scorecardId = options?.forceScorecardId ?? config?.scorecardId;
  let scorecard: QAScorecard | null = null;

  if (scorecardId) {
    scorecard = getScorecard(scorecardId);
  }
  if (!scorecard) {
    // Fall back to first enabled scorecard
    const all = getScorecards();
    scorecard = all.find(s => s.enabled) ?? null;
  }

  if (!scorecard) {
    return {
      review: {} as QAReview,
      report: {} as QAReport,
      flagsCreated: 0,
      skipped: true,
      skipReason: 'No active scorecard found',
    };
  }

  // Run QA scoring
  const startMs = Date.now();
  const report = await scoreResponse(input);
  const latencyMs = Date.now() - startMs;

  // Map QA report scores to scorecard criteria
  const scores: Record<string, number> = {};
  let totalScore = 0;
  let maxPossibleScore = 0;

  for (const criterion of scorecard.criteria) {
    // Try to match report scores to criterion names
    const mappedScore = matchScoreToCriterion(criterion.name, report.scores as unknown as Record<string, number>);
    const score = Math.min(mappedScore, criterion.maxScore);
    scores[criterion.name] = score;
    totalScore += score;
    maxPossibleScore += criterion.maxScore;
  }

  // Create the review
  const review = createReview({
    workspaceId,
    ticketId,
    scorecardId: scorecard.id,
    reviewerId: 'autoqa',
    reviewType: 'auto',
    scores,
    totalScore,
    maxPossibleScore,
    notes: report.suggestions.length > 0
      ? `Suggestions: ${report.suggestions.join('; ')}`
      : 'Auto-reviewed by AutoQA pipeline.',
    status: 'completed',
  });

  // Create flags
  let flagsCreated = 0;
  for (const flag of report.flags) {
    createFlag({
      workspaceId,
      reviewId: review.id,
      ticketId,
      category: flag.category,
      severity: flag.severity,
      message: flag.message,
    });
    flagsCreated++;
  }

  // Generate CSAT prediction from QA scores
  const csatPrediction = predictCSATFromQA(report, totalScore, maxPossibleScore);

  logger.info({
    ticketId,
    workspaceId,
    reviewId: review.id,
    totalScore,
    maxPossibleScore,
    flagsCreated,
    latencyMs,
    csatPrediction: csatPrediction?.score,
  }, 'AutoQA completed');

  return {
    review,
    report,
    flagsCreated,
    csatPrediction,
    skipped: false,
  };
}

/**
 * Match a QA report score dimension to a scorecard criterion by name similarity.
 */
function matchScoreToCriterion(criterionName: string, scores: Record<string, number>): number {
  const lower = criterionName.toLowerCase();

  // Direct mapping from QA report dimensions
  if (lower.includes('tone') || lower.includes('empathy')) return scores.tone ?? 3;
  if (lower.includes('complete') || lower.includes('thorough')) return scores.completeness ?? 3;
  if (lower.includes('accura') || lower.includes('correct')) return scores.accuracy ?? 3;
  if (lower.includes('brand') || lower.includes('voice')) return scores.brandVoice ?? 3;
  if (lower.includes('resolution') || lower.includes('efficien')) return scores.completeness ?? 3;
  if (lower.includes('overall')) return scores.overall ?? 3;

  // Default to overall
  return scores.overall ?? 3;
}

/**
 * Generate a CSAT prediction from QA scores.
 * Maps QA quality to expected customer satisfaction.
 */
function predictCSATFromQA(
  report: QAReport,
  totalScore: number,
  maxPossibleScore: number,
): { score: number; confidence: number; riskLevel: 'low' | 'medium' | 'high'; factors: Record<string, unknown> } {
  const pct = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0.6;
  const criticalFlags = report.flags.filter(f => f.severity === 'critical').length;
  const warningFlags = report.flags.filter(f => f.severity === 'warning').length;

  // Base predicted CSAT from QA percentage (QA 0-100% → CSAT 1-5)
  let predicted = 1 + pct * 4;

  // Penalties for flags
  predicted -= criticalFlags * 0.8;
  predicted -= warningFlags * 0.3;

  // Clamp
  predicted = Math.max(1, Math.min(5, Math.round(predicted * 10) / 10));

  // Confidence based on how extreme the score is
  const confidence = pct > 0.8 || pct < 0.4 ? 0.75 : 0.55;

  // Risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (predicted <= 2.5 || criticalFlags > 0) riskLevel = 'high';
  else if (predicted <= 3.5 || warningFlags > 1) riskLevel = 'medium';

  return {
    score: predicted,
    confidence,
    riskLevel,
    factors: {
      qaPercentage: Math.round(pct * 100),
      criticalFlags,
      warningFlags,
      toneScore: report.scores.tone,
      completenessScore: report.scores.completeness,
      accuracyScore: report.scores.accuracy,
    },
  };
}

/**
 * Run AutoQA on a batch of tickets.
 * Returns summary statistics.
 */
export async function runAutoQABatch(
  workspaceId: string,
  tickets: Array<{ ticketId: string; input: QAInput }>,
  limit?: number,
): Promise<{
  processed: number;
  skipped: number;
  avgScore: number;
  flagsCreated: number;
  results: AutoQAResult[];
}> {
  const toProcess = limit ? tickets.slice(0, limit) : tickets;
  const results: AutoQAResult[] = [];
  let totalScore = 0;
  let totalMax = 0;
  let totalFlags = 0;
  let skipped = 0;

  for (const { ticketId, input } of toProcess) {
    const result = await runAutoQA(ticketId, workspaceId, input);
    results.push(result);

    if (result.skipped) {
      skipped++;
    } else {
      totalScore += result.review.totalScore;
      totalMax += result.review.maxPossibleScore;
      totalFlags += result.flagsCreated;
    }
  }

  const processed = results.length - skipped;
  return {
    processed,
    skipped,
    avgScore: totalMax > 0 ? Math.round((totalScore / totalMax) * 10000) / 100 : 0,
    flagsCreated: totalFlags,
    results,
  };
}

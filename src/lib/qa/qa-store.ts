/**
 * QA / Conversation Review JSONL store.
 *
 * In-memory arrays backed by JSONL files using the shared jsonl-store helpers.
 * Demo data is seeded on first load when no persisted data exists.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

// ---- Types ----

export interface ScorecardCriterion {
  name: string;
  description: string;
  weight: number;
  maxScore: number;
}

export interface QAScorecard {
  id: string;
  workspaceId?: string;
  name: string;
  criteria: ScorecardCriterion[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QAReview {
  id: string;
  workspaceId?: string;
  ticketId?: string;
  conversationId?: string;
  scorecardId: string;
  reviewerId?: string;
  reviewType: 'manual' | 'auto';
  scores: Record<string, number>;
  totalScore: number;
  maxPossibleScore: number;
  notes?: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
}

// ---- JSONL persistence ----

const SCORECARDS_FILE = 'qa-scorecards.jsonl';
const REVIEWS_FILE = 'qa-reviews.jsonl';

const scorecards: QAScorecard[] = [];
const reviews: QAReview[] = [];

function persistScorecards(): void {
  writeJsonlFile(SCORECARDS_FILE, scorecards);
}

function persistReviews(): void {
  writeJsonlFile(REVIEWS_FILE, reviews);
}

// ---- Demo defaults ----

let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  const savedScorecards = readJsonlFile<QAScorecard>(SCORECARDS_FILE);
  const savedReviews = readJsonlFile<QAReview>(REVIEWS_FILE);

  if (savedScorecards.length > 0) {
    scorecards.push(...savedScorecards);
    reviews.push(...savedReviews);
    return;
  }

  // Seed demo data
  const now = new Date();

  scorecards.push({
    id: 'qsc-1',
    name: 'Standard Support Review',
    criteria: [
      {
        name: 'Accuracy',
        description: 'Was the information provided correct and complete?',
        weight: 1,
        maxScore: 5,
      },
      {
        name: 'Tone & Empathy',
        description: 'Was the agent professional, empathetic, and courteous?',
        weight: 1,
        maxScore: 5,
      },
      {
        name: 'Resolution Efficiency',
        description: 'Was the issue resolved promptly with minimal back-and-forth?',
        weight: 1,
        maxScore: 5,
      },
    ],
    enabled: true,
    createdAt: new Date(now.getTime() - 14 * 86400000).toISOString(),
    updatedAt: new Date(now.getTime() - 14 * 86400000).toISOString(),
  });

  reviews.push(
    {
      id: 'qr-1',
      ticketId: 'demo-tk-1',
      scorecardId: 'qsc-1',
      reviewerId: 'demo-user',
      reviewType: 'manual',
      scores: { Accuracy: 4, 'Tone & Empathy': 5, 'Resolution Efficiency': 3 },
      totalScore: 12,
      maxPossibleScore: 15,
      notes: 'Good overall handling. Could have resolved faster with a KB link.',
      status: 'completed',
      createdAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
    },
    {
      id: 'qr-2',
      ticketId: 'demo-tk-2',
      scorecardId: 'qsc-1',
      reviewerId: 'demo-user',
      reviewType: 'auto',
      scores: { Accuracy: 5, 'Tone & Empathy': 4, 'Resolution Efficiency': 5 },
      totalScore: 14,
      maxPossibleScore: 15,
      notes: 'Excellent resolution. Quick and accurate.',
      status: 'completed',
      createdAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
    },
  );
}

// ---- Scorecard CRUD ----

export function getScorecards(): QAScorecard[] {
  ensureDefaults();
  return [...scorecards];
}

export function getScorecard(id: string): QAScorecard | null {
  ensureDefaults();
  return scorecards.find((s) => s.id === id) ?? null;
}

export function createScorecard(
  input: Omit<QAScorecard, 'id' | 'createdAt' | 'updatedAt'>,
): QAScorecard {
  ensureDefaults();
  const now = new Date().toISOString();
  const scorecard: QAScorecard = {
    ...input,
    id: `qsc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  scorecards.push(scorecard);
  persistScorecards();
  return scorecard;
}

export function updateScorecard(
  id: string,
  input: Partial<Omit<QAScorecard, 'id' | 'createdAt'>>,
): QAScorecard | null {
  ensureDefaults();
  const idx = scorecards.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  scorecards[idx] = {
    ...scorecards[idx],
    ...input,
    updatedAt: new Date().toISOString(),
  };
  persistScorecards();
  return scorecards[idx];
}

// ---- Review CRUD ----

export function getReviews(filters?: {
  ticketId?: string;
  scorecardId?: string;
  status?: string;
  workspaceId?: string;
}): QAReview[] {
  ensureDefaults();
  let result = [...reviews];
  if (filters?.workspaceId) {
    result = result.filter((r) => r.workspaceId === filters.workspaceId);
  }
  if (filters?.ticketId) {
    result = result.filter((r) => r.ticketId === filters.ticketId);
  }
  if (filters?.scorecardId) {
    result = result.filter((r) => r.scorecardId === filters.scorecardId);
  }
  if (filters?.status) {
    result = result.filter((r) => r.status === filters.status);
  }
  return result.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function createReview(
  input: Omit<QAReview, 'id' | 'createdAt'>,
): QAReview {
  ensureDefaults();
  const review: QAReview = {
    ...input,
    id: `qr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  reviews.push(review);
  persistReviews();
  return review;
}

export function updateReviewStatus(
  id: string,
  status: 'pending' | 'in_progress' | 'completed',
): QAReview | null {
  ensureDefaults();
  const idx = reviews.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  reviews[idx] = { ...reviews[idx], status };
  persistReviews();
  return reviews[idx];
}

// ---- Dashboard ----

export interface QADashboardMetrics {
  totalReviews: number;
  completedReviews: number;
  averageScore: number;
  averagePercentage: number;
  scorecardCount: number;
  recentReviews: QAReview[];
  byScorecard: Array<{
    scorecardId: string;
    scorecardName: string;
    reviewCount: number;
    avgScore: number;
    avgPercentage: number;
  }>;
}

export function getQADashboard(): QADashboardMetrics {
  ensureDefaults();

  const completed = reviews.filter((r) => r.status === 'completed');

  let averageScore = 0;
  let averagePercentage = 0;

  if (completed.length > 0) {
    const totalScoreSum = completed.reduce((sum, r) => sum + r.totalScore, 0);
    const maxScoreSum = completed.reduce((sum, r) => sum + r.maxPossibleScore, 0);
    averageScore = Math.round((totalScoreSum / completed.length) * 100) / 100;
    averagePercentage = maxScoreSum > 0
      ? Math.round((totalScoreSum / maxScoreSum) * 10000) / 100
      : 0;
  }

  // Group by scorecard
  const byScorecardMap = new Map<string, QAReview[]>();
  for (const r of completed) {
    const existing = byScorecardMap.get(r.scorecardId) ?? [];
    existing.push(r);
    byScorecardMap.set(r.scorecardId, existing);
  }

  const byScorecard = Array.from(byScorecardMap.entries()).map(([scorecardId, scReviews]) => {
    const sc = scorecards.find((s) => s.id === scorecardId);
    const totalSum = scReviews.reduce((sum, r) => sum + r.totalScore, 0);
    const maxSum = scReviews.reduce((sum, r) => sum + r.maxPossibleScore, 0);
    return {
      scorecardId,
      scorecardName: sc?.name ?? 'Unknown',
      reviewCount: scReviews.length,
      avgScore: Math.round((totalSum / scReviews.length) * 100) / 100,
      avgPercentage: maxSum > 0 ? Math.round((totalSum / maxSum) * 10000) / 100 : 0,
    };
  });

  return {
    totalReviews: reviews.length,
    completedReviews: completed.length,
    averageScore,
    averagePercentage,
    scorecardCount: scorecards.length,
    recentReviews: [...reviews].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ).slice(0, 10),
    byScorecard,
  };
}

/**
 * Routing strategies — each selects the best agent from a scored candidate list.
 */

import type { ScoredAgent, RoutingStrategy } from './types';
import { getRoundRobinIndex, setRoundRobinIndex } from './store';

export interface StrategyContext {
  queueId?: string;
  ticketPriority?: string;
}

type StrategyFn = (candidates: ScoredAgent[], ctx: StrategyContext) => ScoredAgent | null;

function roundRobin(candidates: ScoredAgent[], ctx: StrategyContext): ScoredAgent | null {
  if (candidates.length === 0) return null;
  const key = ctx.queueId ?? '__global';
  const idx = getRoundRobinIndex(key);
  const selected = candidates[idx % candidates.length];
  setRoundRobinIndex(key, (idx + 1) % candidates.length);
  return selected;
}

function loadBalanced(candidates: ScoredAgent[]): ScoredAgent | null {
  if (candidates.length === 0) return null;
  // Pick agent with lowest load as % of capacity
  return candidates.reduce((best, c) => {
    const bestRatio = best.capacity > 0 ? best.load / best.capacity : 1;
    const cRatio = c.capacity > 0 ? c.load / c.capacity : 1;
    return cRatio < bestRatio ? c : best;
  });
}

function skillMatch(candidates: ScoredAgent[]): ScoredAgent | null {
  if (candidates.length === 0) return null;
  // Already sorted by score, pick highest
  return candidates.reduce((best, c) => (c.score > best.score ? c : best));
}

function priorityWeighted(candidates: ScoredAgent[], ctx: StrategyContext): ScoredAgent | null {
  if (candidates.length === 0) return null;
  // Apply priority bonus for urgent/high tickets
  const isHighPriority = ctx.ticketPriority === 'urgent' || ctx.ticketPriority === 'high';
  if (isHighPriority) {
    // Boost agents with higher skill match scores
    const boosted = candidates.map(c => ({
      ...c,
      score: c.score + (c.score > 0.5 ? 0.15 : 0),
    }));
    return boosted.reduce((best, c) => (c.score > best.score ? c : best));
  }
  return skillMatch(candidates);
}

const STRATEGIES: Record<RoutingStrategy, StrategyFn> = {
  round_robin: roundRobin,
  load_balanced: loadBalanced,
  skill_match: skillMatch,
  priority_weighted: priorityWeighted,
};

export function applyStrategy(
  strategy: RoutingStrategy,
  candidates: ScoredAgent[],
  ctx: StrategyContext,
): ScoredAgent | null {
  const fn = STRATEGIES[strategy];
  if (!fn) return candidates[0] ?? null;
  return fn(candidates, ctx);
}

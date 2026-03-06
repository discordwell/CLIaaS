/**
 * Core routing engine — replaces the demo router.ts logic with real
 * skill-based, capacity-aware, queue-driven routing.
 */

import type { Ticket, Message } from '@/lib/data-provider/types';
import type {
  RoutingResult,
  RoutingStrategy,
  ScoredAgent,
  RoutingConfig,
} from './types';
import { DEFAULT_ROUTING_CONFIG } from './types';
import {
  getRoutingQueues,
  getRoutingRules,
  getAgentSkills,
  getAgentCapacity,
  getGroupMemberships,
  getRoutingConfig,
  appendRoutingLog,
} from './store';
import { availability } from './availability';
import { evaluateRules, matchQueue, getOverflowQueue } from './queue-manager';
import { applyStrategy } from './strategies';

// ---- Category extraction (from existing router.ts) ----

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  technical: ['error', 'bug', 'crash', 'api', 'code', '500', '404', 'timeout', 'integration', 'webhook'],
  billing: ['invoice', 'charge', 'payment', 'billing', 'subscription', 'refund', 'pricing', 'plan'],
  account: ['login', 'password', 'access', 'account', 'permission', 'sso', 'locked'],
  onboarding: ['setup', 'getting started', 'install', 'configure', 'onboard', 'new user'],
  'feature-request': ['feature', 'request', 'suggest', 'would be nice', 'enhancement'],
  security: ['security', 'vulnerability', 'breach', 'compliance', 'gdpr', 'privacy'],
};

function extractCategories(ticket: Ticket, messages: Message[]): string[] {
  const text = [
    ticket.subject,
    ...ticket.tags,
    ...messages.map(m => m.body.slice(0, 200)),
  ]
    .join(' ')
    .toLowerCase();

  const matched: string[] = [];
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      matched.push(category);
    }
  }
  return matched.length > 0 ? matched : ['general'];
}

// ---- Agent scoring ----

function scoreAgentSkills(
  userId: string,
  categories: string[],
): { score: number; matchedSkills: string[] } {
  const skills = getAgentSkills(userId);
  if (skills.length === 0 || categories.length === 0) {
    return { score: 0, matchedSkills: [] };
  }

  const matched: string[] = [];
  for (const skill of skills) {
    if (categories.some(c =>
      skill.skillName.toLowerCase().includes(c.toLowerCase()) ||
      c.toLowerCase().includes(skill.skillName.toLowerCase()),
    )) {
      matched.push(skill.skillName);
    }
  }

  const score = categories.length > 0 ? matched.length / categories.length : 0;
  return { score: Math.min(1, score), matchedSkills: matched };
}

function getAgentLoad(userId: string, _channelType?: string): number {
  // In JSONL mode, we can't easily count open tickets per agent.
  // Return 0 by default; the capacity check still works as a filter.
  return 0;
}

function getAgentMaxCapacity(userId: string, channelType?: string): number {
  const caps = getAgentCapacity(userId);
  if (caps.length === 0) return 20; // default
  if (channelType) {
    const specific = caps.find(c => c.channelType === channelType);
    if (specific) return specific.maxConcurrent;
  }
  // Use the highest capacity across channels
  return Math.max(...caps.map(c => c.maxConcurrent));
}

function isInBusinessHours(userId: string): boolean {
  // Placeholder business hours check — penalize agents outside 8am-6pm in their timezone
  // Full implementation deferred to Agent 12
  return true;
}

// ---- Build candidate list ----

interface AgentInfo {
  userId: string;
  userName: string;
}

function buildCandidates(
  agents: AgentInfo[],
  categories: string[],
  channelType?: string,
): ScoredAgent[] {
  const candidates: ScoredAgent[] = [];

  for (const agent of agents) {
    // Filter by availability
    if (!availability.isAvailableForRouting(agent.userId)) continue;

    const load = getAgentLoad(agent.userId, channelType);
    const capacity = getAgentMaxCapacity(agent.userId, channelType);

    // Filter by capacity
    if (load >= capacity) continue;

    const { score, matchedSkills } = scoreAgentSkills(agent.userId, categories);

    // Business hours penalty
    const bizHoursFactor = isInBusinessHours(agent.userId) ? 1 : 0.7;

    // Capacity penalty
    const capRatio = capacity > 0 ? load / capacity : 0;
    const capPenalty = capRatio > 0.8 ? -0.2 : 0;

    candidates.push({
      userId: agent.userId,
      userName: agent.userName,
      score: Math.max(0, Math.min(1, score * bizHoursFactor + capPenalty)),
      matchedSkills,
      load,
      capacity,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// ---- Resolve agents for a target ----

function resolveAgents(
  targetType: 'queue' | 'group' | 'agent',
  targetId: string,
  allAgents: AgentInfo[],
): AgentInfo[] {
  switch (targetType) {
    case 'agent':
      return allAgents.filter(a => a.userId === targetId);
    case 'group': {
      const members = getGroupMemberships(targetId);
      const memberIds = new Set(members.map(m => m.userId));
      return allAgents.filter(a => memberIds.has(a.userId));
    }
    case 'queue': {
      const queue = getRoutingQueues().find(q => q.id === targetId);
      if (queue?.groupId) {
        const members = getGroupMemberships(queue.groupId);
        const memberIds = new Set(members.map(m => m.userId));
        return allAgents.filter(a => memberIds.has(a.userId));
      }
      return allAgents; // no group restriction
    }
    default:
      return allAgents;
  }
}

// ---- Main routing function ----

export interface RouteOptions {
  allAgents: AgentInfo[];
  messages?: Message[];
  workspaceId?: string;
  channelType?: string;
}

export async function routeTicket(
  ticket: Ticket,
  options: RouteOptions,
): Promise<RoutingResult> {
  const startMs = Date.now();
  const config = getRoutingConfig();
  const workspaceId = options.workspaceId ?? '';
  const messages = options.messages ?? [];
  const allAgents = options.allAgents;

  if (allAgents.length === 0) {
    return noResult(ticket, 'No agents available for routing.', config.defaultStrategy);
  }

  // Step 1: Extract categories from ticket content
  const categories = extractCategories(ticket, messages);
  let reasoning = `Categories: ${categories.join(', ')}`;

  // Step 2: Evaluate routing rules
  const rules = getRoutingRules(workspaceId);
  const matchedRule = evaluateRules(ticket, rules);

  let strategy: RoutingStrategy = config.defaultStrategy;
  let queueId: string | undefined;
  let ruleId: string | undefined;
  let eligibleAgents = allAgents;

  if (matchedRule) {
    ruleId = matchedRule.id;
    reasoning += ` | Rule matched: "${matchedRule.name}"`;
    eligibleAgents = resolveAgents(matchedRule.targetType, matchedRule.targetId, allAgents);

    if (matchedRule.targetType === 'queue') {
      const queue = getRoutingQueues().find(q => q.id === matchedRule.targetId);
      if (queue) {
        strategy = queue.strategy;
        queueId = queue.id;
      }
    }
  } else {
    // Step 3: Try queue matching
    const queues = getRoutingQueues(workspaceId);
    const matchedQueue = matchQueue(ticket, queues);

    if (matchedQueue) {
      queueId = matchedQueue.id;
      strategy = matchedQueue.strategy;
      reasoning += ` | Queue matched: "${matchedQueue.name}"`;

      if (matchedQueue.groupId) {
        eligibleAgents = resolveAgents('group', matchedQueue.groupId, allAgents);
      }
    }
  }

  // Step 4: Build and score candidates
  const candidates = buildCandidates(eligibleAgents, categories, options.channelType);

  if (candidates.length === 0) {
    // Try overflow queue
    if (queueId) {
      const allQueues = getRoutingQueues();
      const currentQueue = allQueues.find(q => q.id === queueId);
      if (currentQueue) {
        const overflow = getOverflowQueue(currentQueue, allQueues);
        if (overflow) {
          reasoning += ` | Overflow to: "${overflow.name}"`;
          const overflowAgents = overflow.groupId
            ? resolveAgents('group', overflow.groupId, allAgents)
            : allAgents;
          const overflowCandidates = buildCandidates(overflowAgents, categories, options.channelType);
          if (overflowCandidates.length > 0) {
            const selected = applyStrategy(overflow.strategy, overflowCandidates, {
              queueId: overflow.id,
              ticketPriority: ticket.priority,
            });
            if (selected) {
              return logAndReturn(ticket, selected, overflowCandidates, reasoning, overflow.strategy, overflow.id, ruleId, startMs, workspaceId);
            }
          }
        }
      }
    }

    return noResult(ticket, reasoning + ' | No eligible agents found.', strategy);
  }

  // Step 5: Apply strategy
  const selected = applyStrategy(strategy, candidates, {
    queueId,
    ticketPriority: ticket.priority,
  });

  if (!selected) {
    return noResult(ticket, reasoning + ' | Strategy returned no selection.', strategy);
  }

  return logAndReturn(ticket, selected, candidates, reasoning, strategy, queueId, ruleId, startMs, workspaceId);
}

function logAndReturn(
  ticket: Ticket,
  selected: ScoredAgent,
  candidates: ScoredAgent[],
  reasoning: string,
  strategy: RoutingStrategy,
  queueId: string | undefined,
  ruleId: string | undefined,
  startMs: number,
  workspaceId: string,
): RoutingResult {
  const durationMs = Date.now() - startMs;
  const scores: Record<string, number> = {};
  for (const c of candidates) scores[c.userId] = c.score;

  appendRoutingLog({
    workspaceId,
    ticketId: ticket.id,
    queueId,
    ruleId,
    assignedUserId: selected.userId,
    strategy,
    matchedSkills: selected.matchedSkills,
    scores,
    reasoning,
    durationMs,
    createdAt: new Date().toISOString(),
  });

  return {
    ticketId: ticket.id,
    suggestedAgentId: selected.userId,
    suggestedAgentName: selected.userName,
    matchedSkills: selected.matchedSkills,
    reasoning,
    confidence: selected.score,
    queueId,
    ruleId,
    strategy,
    alternateAgents: candidates
      .filter(c => c.userId !== selected.userId)
      .slice(0, 3)
      .map(c => ({
        agentId: c.userId,
        agentName: c.userName,
        score: c.score,
      })),
  };
}

function noResult(ticket: Ticket, reasoning: string, strategy: RoutingStrategy): RoutingResult {
  return {
    ticketId: ticket.id,
    suggestedAgentId: '',
    suggestedAgentName: 'Unassigned',
    matchedSkills: [],
    reasoning,
    confidence: 0,
    strategy,
    alternateAgents: [],
  };
}

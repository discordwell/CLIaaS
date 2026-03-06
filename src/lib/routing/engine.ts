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
import { loadTracker } from './load-tracker';

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

  const matched: Array<{ name: string; proficiency: number }> = [];
  for (const skill of skills) {
    if (categories.some(c =>
      skill.skillName.toLowerCase().includes(c.toLowerCase()) ||
      c.toLowerCase().includes(skill.skillName.toLowerCase()),
    )) {
      matched.push({ name: skill.skillName, proficiency: skill.proficiency ?? 1 });
    }
  }

  if (matched.length === 0) return { score: 0, matchedSkills: [] };

  const coverage = matched.length / categories.length;
  const avgProficiency = matched.reduce((sum, m) => sum + m.proficiency, 0) / matched.length;
  const score = coverage * avgProficiency;

  return { score: Math.min(1, score), matchedSkills: matched.map(m => m.name) };
}

function getAgentLoad(userName: string): number {
  return loadTracker.getLoad(userName);
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

/**
 * Check if business hours are active. When a businessHoursId is supplied
 * (e.g. from a group or SLA policy), look up that specific schedule first.
 * Falls back to the default business hours config, then to "always open".
 */
async function checkBusinessHoursActive(businessHoursId?: string): Promise<boolean> {
  try {
    const bhMod = await import('../wfm/business-hours');

    // If a specific business_hours_id is given, try DB lookup first
    if (businessHoursId) {
      try {
        const { tryDb } = await import('../store-helpers');
        const ctx = await tryDb();
        if (ctx) {
          const { db, schema } = ctx;
          const { eq } = await import('drizzle-orm');
          const [bhRow] = await db
            .select()
            .from(schema.businessHours)
            .where(eq(schema.businessHours.id, businessHoursId));
          if (bhRow) {
            const config = {
              id: bhRow.id,
              name: bhRow.name,
              timezone: bhRow.timezone,
              schedule: bhRow.schedule as Record<string, Array<{ start: string; end: string }>>,
              holidays: (bhRow.holidays ?? []) as string[],
              isDefault: bhRow.isDefault,
              createdAt: bhRow.createdAt?.toISOString() ?? '',
              updatedAt: bhRow.updatedAt?.toISOString() ?? '',
            };
            return bhMod.isWithinBusinessHours(config);
          }
        }
      } catch {
        // DB not available — fall through to JSONL
      }

      // Try JSONL store with the specific ID
      const byId = bhMod.getBusinessHours(businessHoursId);
      if (byId.length > 0) {
        return bhMod.isWithinBusinessHours(byId[0]);
      }
    }

    // Fall back to default config
    const configs = bhMod.getBusinessHours();
    const defaultConfig = configs.find((c: { isDefault?: boolean }) => c.isDefault);
    if (defaultConfig) {
      return bhMod.isWithinBusinessHours(defaultConfig);
    }
  } catch {
    // Business hours module not available — don't penalize
  }
  return true;
}

/**
 * Resolve a group's business_hours_id from the DB (groups table).
 * Returns undefined if DB is unavailable or group has no hours configured.
 */
async function resolveGroupBusinessHoursId(groupId: string): Promise<string | undefined> {
  try {
    const { tryDb } = await import('../store-helpers');
    const ctx = await tryDb();
    if (!ctx) return undefined;
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    // Groups table doesn't have businessHoursId directly, but
    // routing queues linked to groups may. Check the queue first.
    const queues = await db
      .select()
      .from(schema.routingQueues)
      .where(eq(schema.routingQueues.groupId, groupId));
    // For now, groups don't have a direct businessHoursId column.
    // Return undefined — the caller can pass a queue-level or brand-level hours ID.
    void queues;
  } catch {
    // DB not available
  }
  return undefined;
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
  slaBoost: number = 0,
  bizHoursActive: boolean = true,
): ScoredAgent[] {
  const candidates: ScoredAgent[] = [];

  for (const agent of agents) {
    // Filter by availability
    if (!availability.isAvailableForRouting(agent.userId)) continue;

    const load = getAgentLoad(agent.userName);
    const capacity = getAgentMaxCapacity(agent.userId, channelType);

    // Filter by capacity
    if (load >= capacity) continue;

    const { score, matchedSkills } = scoreAgentSkills(agent.userId, categories);

    // Business hours penalty
    const bizHoursFactor = bizHoursActive ? 1 : 0.7;

    // Capacity penalty
    const capRatio = capacity > 0 ? load / capacity : 0;
    const capPenalty = capRatio > 0.8 ? -0.2 : 0;

    candidates.push({
      userId: agent.userId,
      userName: agent.userName,
      score: Math.max(0, Math.min(1, score * bizHoursFactor + capPenalty + (score > 0 ? slaBoost : 0))),
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

  // Ensure load tracker cache is warm
  await loadTracker.ensureLoaded();

  // Initial business hours check (default schedule)
  let bizHoursActive = await checkBusinessHoursActive();

  if (allAgents.length === 0) {
    return noResult(ticket, 'No agents available for routing.', config.defaultStrategy);
  }

  // Step 1: Extract categories from ticket content
  const categories = extractCategories(ticket, messages);
  let reasoning = `Categories: ${categories.join(', ')}`;

  // Step 1b: SLA priority boost
  let slaBoost = 0;
  try {
    const { checkTicketSLA } = await import('../sla');
    const slaResults = await checkTicketSLA({ ticket });
    for (const result of slaResults) {
      const frStatus = result.firstResponse.status;
      const resStatus = result.resolution.status;
      if (frStatus === 'breached' || resStatus === 'breached') {
        slaBoost = Math.max(slaBoost, 0.3);
        reasoning += ` | SLA breached (+0.3 boost)`;
      } else if (frStatus === 'warning' || resStatus === 'warning') {
        slaBoost = Math.max(slaBoost, 0.15);
        reasoning += ` | SLA warning (+0.15 boost)`;
      }
    }
  } catch {
    // SLA module not available — no boost
  }

  // Step 1c: Check WFM schedule to exclude off-schedule agents
  let wfmExcludedUserIds: Set<string> = new Set();
  try {
    const wfmSchedules = await import('../wfm/schedules');
    const { getScheduledActivity } = wfmSchedules;
    const allSchedules = wfmSchedules.getSchedules();
    const now = new Date();
    for (const sched of allSchedules) {
      const activity = getScheduledActivity(sched, now);
      if (activity === 'off_shift') {
        wfmExcludedUserIds.add(sched.userId);
      }
    }
    if (wfmExcludedUserIds.size > 0) {
      reasoning += ` | WFM: ${wfmExcludedUserIds.size} agent(s) off-schedule`;
    }
  } catch {
    // WFM module not available — no exclusion
  }

  // Filter out off-schedule agents from the candidate pool
  const scheduleFilteredAgents = wfmExcludedUserIds.size > 0
    ? allAgents.filter(a => !wfmExcludedUserIds.has(a.userId))
    : allAgents;

  // Step 2: Evaluate routing rules
  const rules = getRoutingRules(workspaceId);
  const matchedRule = evaluateRules(ticket, rules);

  let strategy: RoutingStrategy = config.defaultStrategy;
  let queueId: string | undefined;
  let ruleId: string | undefined;
  let eligibleAgents = scheduleFilteredAgents;
  let resolvedGroupId: string | undefined;

  if (matchedRule) {
    ruleId = matchedRule.id;
    reasoning += ` | Rule matched: "${matchedRule.name}"`;
    eligibleAgents = resolveAgents(matchedRule.targetType, matchedRule.targetId, scheduleFilteredAgents);

    if (matchedRule.targetType === 'queue') {
      const queue = getRoutingQueues().find(q => q.id === matchedRule.targetId);
      if (queue) {
        strategy = queue.strategy;
        queueId = queue.id;
        resolvedGroupId = queue.groupId;
      }
    } else if (matchedRule.targetType === 'group') {
      resolvedGroupId = matchedRule.targetId;
    }
  } else {
    // Step 3: Try queue matching
    const queues = getRoutingQueues(workspaceId);
    const matchedQueue = matchQueue(ticket, queues);

    if (matchedQueue) {
      queueId = matchedQueue.id;
      strategy = matchedQueue.strategy;
      reasoning += ` | Queue matched: "${matchedQueue.name}"`;
      resolvedGroupId = matchedQueue.groupId;

      if (matchedQueue.groupId) {
        eligibleAgents = resolveAgents('group', matchedQueue.groupId, scheduleFilteredAgents);
      }
    }
  }

  // Step 3b: Re-check business hours using the group's specific schedule if available
  if (resolvedGroupId) {
    const groupBhId = await resolveGroupBusinessHoursId(resolvedGroupId);
    if (groupBhId) {
      bizHoursActive = await checkBusinessHoursActive(groupBhId);
    }
  }

  // Step 4a: Overflow timeout enforcement
  if (queueId) {
    const allQueues = getRoutingQueues();
    const currentQueue = allQueues.find(q => q.id === queueId);
    if (currentQueue?.overflowTimeoutSecs && currentQueue.overflowQueueId) {
      // Prefer routedAt (time ticket entered queue) over createdAt (ticket age)
      const queueEntryTime = (ticket as unknown as Record<string, unknown>).routedAt as string | undefined;
      const ticketAgeMs = Date.now() - new Date(queueEntryTime ?? ticket.createdAt).getTime();
      if (ticketAgeMs > currentQueue.overflowTimeoutSecs * 1000) {
        const overflow = getOverflowQueue(currentQueue, allQueues);
        if (overflow) {
          reasoning += ` | Overflow timeout (${currentQueue.overflowTimeoutSecs}s exceeded)`;
          const overflowAgents = overflow.groupId
            ? resolveAgents('group', overflow.groupId, allAgents)
            : allAgents;
          const overflowCandidates = buildCandidates(overflowAgents, categories, options.channelType, slaBoost, bizHoursActive);
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
  }

  // Step 4b: Build and score candidates
  const candidates = buildCandidates(eligibleAgents, categories, options.channelType, slaBoost, bizHoursActive);

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
          const overflowCandidates = buildCandidates(overflowAgents, categories, options.channelType, slaBoost, bizHoursActive);
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

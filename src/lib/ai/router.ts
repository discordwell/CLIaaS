/**
 * Smart ticket routing: skills-based assignment with round-robin,
 * capacity limits, and priority weighting.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Ticket, Message } from '@/lib/data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSkillProfile {
  agentId: string;
  agentName: string;
  skills: string[]; // e.g. ['billing', 'technical', 'onboarding']
  timezone?: string; // e.g. 'America/New_York'
}

export interface RoutingConfig {
  skills: AgentSkillProfile[];
  roundRobin: boolean;
  capacityLimits: Record<string, number>; // agentId -> max open tickets
  priorityWeight: boolean; // urgent tickets get priority routing
  timezoneAware: boolean;
}

export interface RoutingResult {
  ticketId: string;
  suggestedAgentId: string;
  suggestedAgentName: string;
  matchedSkills: string[];
  reasoning: string;
  confidence: number;
  alternateAgents: Array<{
    agentId: string;
    agentName: string;
    score: number;
  }>;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  skills: [
    {
      agentId: 'agent-1',
      agentName: 'Alice Chen',
      skills: ['technical', 'api', 'integration', 'bug'],
      timezone: 'America/Los_Angeles',
    },
    {
      agentId: 'agent-2',
      agentName: 'Bob Martinez',
      skills: ['billing', 'account', 'subscription', 'refund'],
      timezone: 'America/New_York',
    },
    {
      agentId: 'agent-3',
      agentName: 'Carol Davis',
      skills: ['onboarding', 'setup', 'feature-request', 'general'],
      timezone: 'Europe/London',
    },
    {
      agentId: 'agent-4',
      agentName: 'Dan Kim',
      skills: ['security', 'compliance', 'data', 'privacy'],
      timezone: 'Asia/Tokyo',
    },
  ],
  roundRobin: true,
  capacityLimits: {
    'agent-1': 15,
    'agent-2': 12,
    'agent-3': 18,
    'agent-4': 10,
  },
  priorityWeight: true,
  timezoneAware: false,
};

// ---------------------------------------------------------------------------
// Round-robin state (in-memory)
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __cliaasRRIndex: number | undefined;
}

function nextRoundRobin(agentCount: number): number {
  const idx = (global.__cliaasRRIndex ?? -1) + 1;
  global.__cliaasRRIndex = idx % agentCount;
  return global.__cliaasRRIndex;
}

// ---------------------------------------------------------------------------
// Current open-ticket counts (in-memory simulation)
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAgentLoad: Record<string, number> | undefined;
}

function getAgentLoad(): Record<string, number> {
  if (!global.__cliaasAgentLoad) global.__cliaasAgentLoad = {};
  return global.__cliaasAgentLoad;
}

export function recordAssignment(agentId: string): void {
  const load = getAgentLoad();
  load[agentId] = (load[agentId] ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Ticket category extraction (lightweight, no LLM needed)
// ---------------------------------------------------------------------------

function extractCategories(ticket: Ticket, messages: Message[]): string[] {
  const text = [
    ticket.subject,
    ...ticket.tags,
    ...messages.map((m) => m.body.slice(0, 200)),
  ]
    .join(' ')
    .toLowerCase();

  const categoryKeywords: Record<string, string[]> = {
    technical: ['error', 'bug', 'crash', 'api', 'code', '500', '404', 'timeout', 'integration', 'webhook'],
    billing: ['invoice', 'charge', 'payment', 'billing', 'subscription', 'refund', 'pricing', 'plan'],
    account: ['login', 'password', 'access', 'account', 'permission', 'sso', 'locked'],
    onboarding: ['setup', 'getting started', 'install', 'configure', 'onboard', 'new user'],
    'feature-request': ['feature', 'request', 'suggest', 'would be nice', 'enhancement'],
    security: ['security', 'vulnerability', 'breach', 'compliance', 'gdpr', 'privacy'],
    general: [],
  };

  const matched: string[] = [];
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (category === 'general') continue;
    if (keywords.some((kw) => text.includes(kw))) {
      matched.push(category);
    }
  }

  return matched.length > 0 ? matched : ['general'];
}

// ---------------------------------------------------------------------------
// LLM-enhanced routing (optional, for complex tickets)
// ---------------------------------------------------------------------------

async function llmEnhancedRoute(
  ticket: Ticket,
  messages: Message[],
  config: RoutingConfig,
): Promise<{ categories: string[]; reasoning: string } | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const agentList = config.skills
    .map((a) => `- ${a.agentName} (${a.agentId}): ${a.skills.join(', ')}`)
    .join('\n');

  const thread = messages
    .slice(-5)
    .map((m) => `${m.author}: ${m.body.slice(0, 300)}`)
    .join('\n');

  const prompt = `Categorize this support ticket for routing.

Subject: ${ticket.subject}
Priority: ${ticket.priority}
Tags: ${ticket.tags.join(', ') || 'none'}
Recent messages:
${thread || '(none)'}

Available agents and their skills:
${agentList}

Respond with ONLY a JSON object:
{
  "categories": ["skill1", "skill2"],
  "reasoning": "brief explanation"
}`;

  try {
    let raw = '';
    if (anthropicKey) {
      const client = new Anthropic({ apiKey: anthropicKey });
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = msg.content[0];
      raw = block.type === 'text' ? block.text : '';
    } else if (openaiKey) {
      const client = new OpenAI({ apiKey: openaiKey });
      const res = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = res.choices[0]?.message?.content ?? '';
    } else {
      return null;
    }

    let cleaned = raw.trim();
    const fence = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fence) cleaned = fence[1].trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Score an agent against required categories
// ---------------------------------------------------------------------------

function scoreAgent(
  agent: AgentSkillProfile,
  categories: string[],
  config: RoutingConfig,
  ticket: Ticket,
): number {
  // Skill match score (0-1)
  const matchedSkills = agent.skills.filter((s) =>
    categories.some((c) => s.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(s.toLowerCase())),
  );
  const skillScore = categories.length > 0 ? matchedSkills.length / categories.length : 0;

  // Capacity penalty
  const load = getAgentLoad();
  const current = load[agent.agentId] ?? 0;
  const cap = config.capacityLimits[agent.agentId] ?? 20;
  const capacityRatio = current / cap;
  const capacityPenalty = capacityRatio >= 1 ? -0.5 : capacityRatio > 0.8 ? -0.2 : 0;

  // Priority bonus: urgent/high tickets get a boost for agents with matching skills
  const priorityBonus =
    config.priorityWeight &&
    (ticket.priority === 'urgent' || ticket.priority === 'high') &&
    skillScore > 0.5
      ? 0.15
      : 0;

  return Math.max(0, Math.min(1, skillScore + capacityPenalty + priorityBonus));
}

// ---------------------------------------------------------------------------
// Main routing function
// ---------------------------------------------------------------------------

export async function routeTicket(
  ticket: Ticket,
  messages: Message[],
  config: RoutingConfig = DEFAULT_ROUTING_CONFIG,
  useLLM: boolean = false,
): Promise<RoutingResult> {
  if (config.skills.length === 0) {
    return {
      ticketId: ticket.id,
      suggestedAgentId: '',
      suggestedAgentName: 'Unassigned',
      matchedSkills: [],
      reasoning: 'No agents configured for routing.',
      confidence: 0,
      alternateAgents: [],
    };
  }

  // Step 1: determine ticket categories
  let categories = extractCategories(ticket, messages);
  let reasoning = `Keyword-matched categories: ${categories.join(', ')}`;

  if (useLLM) {
    const llmResult = await llmEnhancedRoute(ticket, messages, config);
    if (llmResult) {
      categories = llmResult.categories;
      reasoning = llmResult.reasoning;
    }
  }

  // Step 2: score all agents
  const scored = config.skills
    .map((agent) => ({
      agent,
      score: scoreAgent(agent, categories, config, ticket),
      matchedSkills: agent.skills.filter((s) =>
        categories.some((c) => s.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(s.toLowerCase())),
      ),
    }))
    .sort((a, b) => b.score - a.score);

  // Step 3: apply round-robin among top-scoring agents if enabled
  let selected = scored[0];
  if (config.roundRobin && scored.length > 1) {
    const topScore = scored[0].score;
    const topTier = scored.filter((s) => s.score >= topScore - 0.1);
    if (topTier.length > 1) {
      const rrIdx = nextRoundRobin(topTier.length);
      selected = topTier[rrIdx];
    }
  }

  // Check capacity hard limit
  const load = getAgentLoad();
  const cap = config.capacityLimits[selected.agent.agentId] ?? 20;
  if ((load[selected.agent.agentId] ?? 0) >= cap) {
    // Find next agent under capacity
    const underCap = scored.find(
      (s) => (load[s.agent.agentId] ?? 0) < (config.capacityLimits[s.agent.agentId] ?? 20),
    );
    if (underCap) selected = underCap;
  }

  return {
    ticketId: ticket.id,
    suggestedAgentId: selected.agent.agentId,
    suggestedAgentName: selected.agent.agentName,
    matchedSkills: selected.matchedSkills,
    reasoning,
    confidence: selected.score,
    alternateAgents: scored
      .filter((s) => s.agent.agentId !== selected.agent.agentId)
      .slice(0, 3)
      .map((s) => ({
        agentId: s.agent.agentId,
        agentName: s.agent.agentName,
        score: s.score,
      })),
  };
}

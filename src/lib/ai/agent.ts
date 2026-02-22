/**
 * AI Agent: autonomous ticket resolution engine.
 *
 * Uses the Anthropic or OpenAI SDK to analyze a ticket's conversation
 * history plus relevant KB articles, then produces a confidence-scored
 * resolution attempt.  If confidence falls below the configured
 * threshold, the ticket is escalated to a human agent.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Ticket, Message, KBArticle } from '@/lib/data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIAgentConfig {
  enabled: boolean;
  confidenceThreshold: number; // 0-1, below this -> escalate to human
  maxTokens: number;
  provider: 'claude' | 'openai' | 'openclaw';
  model?: string;
  excludeTopics?: string[]; // topics that always go to humans
  kbContext: boolean; // include KB articles as context
}

export interface AIAgentResult {
  ticketId: string;
  resolved: boolean;
  confidence: number;
  suggestedReply: string;
  reasoning: string;
  escalated: boolean;
  escalationReason?: string;
  kbArticlesUsed: string[];
}

export interface AIAgentRunOptions {
  ticket: Ticket;
  messages: Message[];
  kbArticles?: KBArticle[];
  config: AIAgentConfig;
  dryRun?: boolean; // suggest but don't auto-reply
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_CONFIG: AIAgentConfig = {
  enabled: false,
  confidenceThreshold: 0.7,
  maxTokens: 1024,
  provider: 'claude',
  model: undefined,
  excludeTopics: ['billing', 'legal', 'security'],
  kbContext: true,
};

// ---------------------------------------------------------------------------
// In-memory stats (singleton across requests via global)
// ---------------------------------------------------------------------------

export interface AIAgentStats {
  totalRuns: number;
  resolved: number;
  escalated: number;
  avgConfidence: number;
  recentResults: AIAgentResult[];
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAIAgentStats: AIAgentStats | undefined;
}

export function getAgentStats(): AIAgentStats {
  return (
    global.__cliaasAIAgentStats ?? {
      totalRuns: 0,
      resolved: 0,
      escalated: 0,
      avgConfidence: 0,
      recentResults: [],
    }
  );
}

function recordResult(result: AIAgentResult): void {
  const stats = getAgentStats();
  stats.totalRuns++;
  if (result.resolved) stats.resolved++;
  if (result.escalated) stats.escalated++;
  stats.avgConfidence =
    (stats.avgConfidence * (stats.totalRuns - 1) + result.confidence) /
    stats.totalRuns;
  stats.recentResults = [result, ...stats.recentResults].slice(0, 50);
  global.__cliaasAIAgentStats = stats;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildAgentPrompt(
  ticket: Ticket,
  messages: Message[],
  kbArticles: KBArticle[],
): string {
  const thread = messages
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .map(
      (m) =>
        `[${m.type.toUpperCase()}] ${m.author} (${m.createdAt}):\n${m.body}`,
    )
    .join('\n\n---\n\n');

  const kbSection =
    kbArticles.length > 0
      ? `\n\n--- KNOWLEDGE BASE ARTICLES ---\n${kbArticles
          .map(
            (a) =>
              `[KB: ${a.id}] ${a.title}\nCategory: ${a.categoryPath.join(' > ') || 'General'}\n${a.body.slice(0, 600)}`,
          )
          .join('\n\n---\n\n')}`
      : '';

  return `You are an AI customer-support agent for CLIaaS. Your job is to resolve
support tickets autonomously when you are confident you can help.

TICKET CONTEXT:
Subject: ${ticket.subject}
Status: ${ticket.status} | Priority: ${ticket.priority}
Requester: ${ticket.requester} | Assignee: ${ticket.assignee ?? 'Unassigned'}
Tags: ${ticket.tags.join(', ') || 'none'}
Created: ${ticket.createdAt}

--- CONVERSATION ---
${thread || '(no messages yet)'}
${kbSection}

INSTRUCTIONS:
1. Analyze the ticket and conversation history.
2. Determine whether you can resolve this ticket with a helpful reply.
3. If the question is outside your ability (billing disputes, legal requests,
   security incidents, account deletion, or anything requiring human judgment),
   mark it for escalation.
4. Cite any KB articles you reference by their ID.

Respond with ONLY a JSON object (no markdown fences, no explanation):
{
  "resolved": true/false,
  "confidence": 0.0-1.0,
  "suggestedReply": "the reply to send to the customer",
  "reasoning": "brief internal reasoning for the confidence score",
  "escalated": true/false,
  "escalationReason": "reason if escalated, omit otherwise",
  "kbArticlesUsed": ["article-id-1"]
}`;
}

// ---------------------------------------------------------------------------
// LLM completion (Anthropic or OpenAI)
// ---------------------------------------------------------------------------

async function completeClaude(
  prompt: string,
  config: AIAgentConfig,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: config.model ?? 'claude-sonnet-4-5-20250929',
    max_tokens: config.maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = message.content[0];
  return block.type === 'text' ? block.text : '';
}

async function completeOpenAI(
  prompt: string,
  config: AIAgentConfig,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: config.model ?? 'gpt-4o',
    max_tokens: config.maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.choices[0]?.message?.content ?? '';
}

async function complete(prompt: string, config: AIAgentConfig): Promise<string> {
  switch (config.provider) {
    case 'claude':
      return completeClaude(prompt, config);
    case 'openai':
    case 'openclaw':
      return completeOpenAI(prompt, config);
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

// ---------------------------------------------------------------------------
// JSON parser (tolerant of markdown fences)
// ---------------------------------------------------------------------------

function parseLLMJson<T>(raw: string): T {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  return JSON.parse(cleaned) as T;
}

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

export async function runAgent(opts: AIAgentRunOptions): Promise<AIAgentResult> {
  const { ticket, messages, kbArticles = [], config } = opts;

  // Pre-flight: check excluded topics
  const excluded = config.excludeTopics ?? [];
  const ticketTopics = [
    ...ticket.tags,
    ...ticket.subject.toLowerCase().split(/\s+/),
  ];
  const matchedExclusion = excluded.find((topic) =>
    ticketTopics.some((t) => t.toLowerCase().includes(topic.toLowerCase())),
  );

  if (matchedExclusion) {
    const result: AIAgentResult = {
      ticketId: ticket.id,
      resolved: false,
      confidence: 0,
      suggestedReply: '',
      reasoning: `Topic "${matchedExclusion}" is in the exclusion list.`,
      escalated: true,
      escalationReason: `Excluded topic: ${matchedExclusion}`,
      kbArticlesUsed: [],
    };
    recordResult(result);
    return result;
  }

  // Build prompt with optional KB context
  const contextArticles = config.kbContext ? kbArticles : [];
  const prompt = buildAgentPrompt(ticket, messages, contextArticles);

  try {
    const raw = await complete(prompt, config);
    const parsed = parseLLMJson<Omit<AIAgentResult, 'ticketId'>>(raw);

    const result: AIAgentResult = {
      ticketId: ticket.id,
      resolved: parsed.confidence >= config.confidenceThreshold && parsed.resolved,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      suggestedReply: parsed.suggestedReply ?? '',
      reasoning: parsed.reasoning ?? '',
      escalated:
        parsed.confidence < config.confidenceThreshold || parsed.escalated,
      escalationReason:
        parsed.confidence < config.confidenceThreshold
          ? `Confidence ${(parsed.confidence * 100).toFixed(0)}% below threshold ${(config.confidenceThreshold * 100).toFixed(0)}%`
          : parsed.escalationReason,
      kbArticlesUsed: parsed.kbArticlesUsed ?? [],
    };

    recordResult(result);
    return result;
  } catch (err) {
    const result: AIAgentResult = {
      ticketId: ticket.id,
      resolved: false,
      confidence: 0,
      suggestedReply: '',
      reasoning: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      escalated: true,
      escalationReason: 'AI agent encountered an error',
      kbArticlesUsed: [],
    };
    recordResult(result);
    return result;
  }
}

/**
 * Autonomous AI resolution pipeline. Subscribes to ticket/message events,
 * classifies intent, generates drafts with confidence gating, and routes
 * to either auto-send, approval queue, or human escalation.
 */

import { runAgent, DEFAULT_AGENT_CONFIG, type AIAgentConfig, type AIAgentResult } from './agent';
import { enqueueApproval, type ApprovalEntry } from './approval-queue';
import { recordResolution } from './roi-tracker';
import type { Ticket, Message, KBArticle } from '@/lib/data';

// ---- Pipeline configuration ----

export interface PipelineConfig extends AIAgentConfig {
  autoSend: boolean;          // true = send immediately above threshold; false = queue for approval
  approvalTimeoutMs: number;  // auto-approve after this many ms (0 = disabled)
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAIPipelineConfig: PipelineConfig | undefined;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  ...DEFAULT_AGENT_CONFIG,
  autoSend: false,
  approvalTimeoutMs: 0,
};

export function getPipelineConfig(): PipelineConfig {
  return global.__cliaasAIPipelineConfig ?? DEFAULT_PIPELINE_CONFIG;
}

export function setPipelineConfig(config: Partial<PipelineConfig>): PipelineConfig {
  const current = getPipelineConfig();
  const updated = { ...current, ...config };
  global.__cliaasAIPipelineConfig = updated;
  return updated;
}

// ---- Pipeline resolution ----

export interface ResolutionOutcome {
  ticketId: string;
  action: 'auto_sent' | 'queued_for_approval' | 'escalated';
  result: AIAgentResult;
  approvalId?: string;
}

export async function resolveTicket(
  ticket: Ticket,
  messages: Message[],
  kbArticles: KBArticle[] = [],
): Promise<ResolutionOutcome> {
  const config = getPipelineConfig();

  if (!config.enabled) {
    return {
      ticketId: ticket.id,
      action: 'escalated',
      result: {
        ticketId: ticket.id,
        resolved: false,
        confidence: 0,
        suggestedReply: '',
        reasoning: 'AI pipeline is disabled',
        escalated: true,
        escalationReason: 'Pipeline disabled',
        kbArticlesUsed: [],
      },
    };
  }

  const result = await runAgent({ ticket, messages, kbArticles, config });

  // Record for ROI tracking
  recordResolution(result);

  // Route based on confidence and config
  if (result.escalated || result.confidence < config.confidenceThreshold) {
    return { ticketId: ticket.id, action: 'escalated', result };
  }

  if (config.autoSend) {
    return { ticketId: ticket.id, action: 'auto_sent', result };
  }

  // Queue for approval
  const entry: ApprovalEntry = {
    id: crypto.randomUUID(),
    ticketId: ticket.id,
    ticketSubject: ticket.subject,
    draftReply: result.suggestedReply,
    confidence: result.confidence,
    reasoning: result.reasoning,
    kbArticlesUsed: result.kbArticlesUsed,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  enqueueApproval(entry);

  return {
    ticketId: ticket.id,
    action: 'queued_for_approval',
    result,
    approvalId: entry.id,
  };
}

// ---- Event handler integration ----

export async function handleTicketEvent(
  event: string,
  data: Record<string, unknown>,
): Promise<ResolutionOutcome | null> {
  const config = getPipelineConfig();
  if (!config.enabled) return null;

  // Only handle ticket.created and message.created
  if (event !== 'ticket.created' && event !== 'message.created') return null;

  // Build minimal Ticket and Message from event data
  const ticket: Ticket = {
    id: String(data.ticketId ?? data.id ?? ''),
    externalId: String(data.externalId ?? data.ticketId ?? data.id ?? ''),
    source: (data.source as Ticket['source']) ?? 'zendesk',
    subject: String(data.subject ?? ''),
    status: String(data.status ?? 'open') as Ticket['status'],
    priority: String(data.priority ?? 'normal') as Ticket['priority'],
    requester: String(data.requester ?? ''),
    assignee: data.assignee != null ? String(data.assignee) : undefined,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    createdAt: String(data.createdAt ?? new Date().toISOString()),
    updatedAt: String(data.updatedAt ?? new Date().toISOString()),
  };

  if (!ticket.id) return null;

  const messages: Message[] = Array.isArray(data.messages)
    ? (data.messages as Message[])
    : [];

  return resolveTicket(ticket, messages);
}

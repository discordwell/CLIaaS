/**
 * Autonomous AI resolution pipeline. Subscribes to ticket/message events,
 * classifies intent, generates drafts with confidence gating, and routes
 * to either auto-send, approval queue, or human escalation.
 */

import { runAgent, DEFAULT_AGENT_CONFIG, type AIAgentConfig, type AIAgentResult } from './agent';
import { recordResolution } from './roi-tracker';
import { saveResolution, type AIAgentConfigRecord } from './store';
import { sendAIReply } from './reply-sender';
import { matchProcedures, formatProcedurePrompt } from './procedure-engine';
import type { Ticket, Message, KBArticle } from '@/lib/data';
import { buildBaseTicketFromEvent } from '@/lib/automation/ticket-from-event';

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
  resolutionId?: string;
}

export interface ResolveTicketOptions {
  configOverride?: AIAgentConfigRecord;
  workspaceId?: string;
}

export async function resolveTicket(
  ticket: Ticket,
  messages: Message[],
  kbArticles: KBArticle[] = [],
  options?: ResolveTicketOptions,
): Promise<ResolutionOutcome> {
  // Build effective config: DB config override > global singleton
  const dbConfig = options?.configOverride;
  const globalConfig = getPipelineConfig();

  const config: PipelineConfig = dbConfig ? {
    enabled: dbConfig.enabled,
    confidenceThreshold: dbConfig.confidenceThreshold,
    maxTokens: dbConfig.maxTokens,
    provider: dbConfig.provider as AIAgentConfig['provider'],
    model: dbConfig.model,
    excludeTopics: dbConfig.excludedTopics,
    kbContext: dbConfig.kbContext,
    autoSend: dbConfig.mode === 'auto',
    approvalTimeoutMs: 0,
  } : globalConfig;

  const workspaceId = options?.workspaceId ?? 'default';

  if (!config.enabled) {
    const result: AIAgentResult = {
      ticketId: ticket.id,
      resolved: false,
      confidence: 0,
      suggestedReply: '',
      reasoning: 'AI pipeline is disabled',
      escalated: true,
      escalationReason: 'Pipeline disabled',
      kbArticlesUsed: [],
    };
    return { ticketId: ticket.id, action: 'escalated', result };
  }

  // Load matching procedures based on ticket topics
  const ticketTopics = [...ticket.tags, ...ticket.subject.toLowerCase().split(/\s+/)];
  const matched = await matchProcedures(workspaceId, ticketTopics);
  const procedurePrompt = formatProcedurePrompt(matched);

  const startTime = Date.now();
  const result = await runAgent({
    ticket,
    messages,
    kbArticles,
    config,
    extraSystemPrompt: procedurePrompt || undefined,
  });
  const latencyMs = Date.now() - startTime;

  // Hallucination guard: if requireKbCitation is enabled, verify the reply
  // references at least one KB article. If not, escalate.
  if (
    dbConfig?.requireKbCitation &&
    !result.escalated &&
    result.resolved &&
    kbArticles.length > 0 &&
    result.kbArticlesUsed.length === 0
  ) {
    result.escalated = true;
    result.resolved = false;
    result.escalationReason = 'No KB citation (hallucination guard)';
  }

  // Record for legacy ROI tracking
  recordResolution(result);

  // Determine action
  const escalated = result.escalated || result.confidence < config.confidenceThreshold;
  const action: ResolutionOutcome['action'] = escalated
    ? 'escalated'
    : config.autoSend ? 'auto_sent' : 'queued_for_approval';

  const status = escalated ? 'escalated' as const
    : config.autoSend ? 'auto_resolved' as const
    : 'pending' as const;

  // Persist resolution to DB/in-memory store
  const resolutionId = crypto.randomUUID();
  const record = await saveResolution({
    id: resolutionId,
    workspaceId,
    ticketId: ticket.id,
    confidence: result.confidence,
    suggestedReply: result.suggestedReply,
    reasoning: result.reasoning,
    kbArticlesUsed: result.kbArticlesUsed,
    status,
    escalationReason: result.escalationReason,
    provider: config.provider,
    model: config.model,
    latencyMs,
    createdAt: new Date().toISOString(),
  });

  // For auto_sent, actually send the reply
  if (action === 'auto_sent' && dbConfig) {
    await sendAIReply(record, dbConfig);
  }

  return { ticketId: ticket.id, action, result, resolutionId };
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

  // Build Ticket from event data using shared builder
  const base = buildBaseTicketFromEvent(data);
  const ticket = {
    ...base,
    status: base.status as Ticket['status'],
    priority: base.priority as Ticket['priority'],
    assignee: base.assignee ?? undefined,
    externalId: String(data.externalId ?? data.ticketId ?? data.id ?? ''),
    source: (data.source as Ticket['source']) ?? 'zendesk',
  } satisfies Ticket;

  if (!ticket.id) return null;

  const messages: Message[] = Array.isArray(data.messages)
    ? (data.messages as Message[])
    : [];

  return resolveTicket(ticket, messages);
}

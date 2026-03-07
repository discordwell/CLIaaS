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
import {
  isChannelAllowed, getChannelPolicy,
  shouldAllowAIRequest, recordAISuccess, recordAIFailure,
  recordAuditEntry, recordUsageSnapshot,
} from './admin-controls';
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

  // Channel policy check
  const ticketChannel = (ticket as unknown as Record<string, unknown>).channel as string | undefined;
  if (ticketChannel && !isChannelAllowed(ticketChannel)) {
    const result: AIAgentResult = {
      ticketId: ticket.id,
      resolved: false,
      confidence: 0,
      suggestedReply: '',
      reasoning: `AI disabled for channel: ${ticketChannel}`,
      escalated: true,
      escalationReason: `Channel policy: ${ticketChannel} disabled`,
      kbArticlesUsed: [],
    };
    return { ticketId: ticket.id, action: 'escalated', result };
  }

  // Apply channel-specific overrides
  if (ticketChannel) {
    const channelPolicy = getChannelPolicy(ticketChannel);
    if (channelPolicy) {
      config.confidenceThreshold = Math.max(config.confidenceThreshold, channelPolicy.confidenceThreshold);
      config.autoSend = channelPolicy.mode === 'auto' ? config.autoSend : false;
    }
  }

  // Circuit breaker check
  if (!shouldAllowAIRequest()) {
    const result: AIAgentResult = {
      ticketId: ticket.id,
      resolved: false,
      confidence: 0,
      suggestedReply: '',
      reasoning: 'AI circuit breaker is open — too many recent failures',
      escalated: true,
      escalationReason: 'Circuit breaker open',
      kbArticlesUsed: [],
    };
    recordAuditEntry({
      workspaceId,
      action: 'resolution_escalated',
      ticketId: ticket.id,
      details: { reason: 'circuit_breaker_open' },
    });
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

  // Record circuit breaker status — only count provider/infra errors, not content escalations
  const isInfraError = result.escalated && (
    result.escalationReason?.startsWith('Provider error') ||
    result.escalationReason?.startsWith('API error') ||
    result.escalationReason?.startsWith('Timeout') ||
    result.confidence === 0
  );
  if (isInfraError) {
    recordAIFailure(result.escalationReason ?? 'unknown');
  } else {
    recordAISuccess();
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

  // Audit trail
  const auditAction = action === 'auto_sent' ? 'resolution_auto_sent' as const
    : action === 'escalated' ? 'resolution_escalated' as const
    : 'resolution_created' as const;
  recordAuditEntry({
    workspaceId,
    action: auditAction,
    ticketId: ticket.id,
    resolutionId,
    details: {
      confidence: result.confidence,
      action,
      provider: config.provider,
      model: config.model,
      latencyMs,
      kbArticlesUsed: result.kbArticlesUsed.length,
    },
  });

  // Usage snapshot (hourly bucket)
  const hourBucket = new Date().toISOString().slice(0, 13) + ':00:00Z';
  recordUsageSnapshot({
    workspaceId,
    period: hourBucket,
    totalRequests: 1,
    autoResolved: action === 'auto_sent' ? 1 : 0,
    escalated: action === 'escalated' ? 1 : 0,
    errors: 0,
    totalTokens: ((result as unknown as Record<string, number>).promptTokens ?? 0)
      + ((result as unknown as Record<string, number>).completionTokens ?? 0),
    promptTokens: (result as unknown as Record<string, number>).promptTokens ?? 0,
    completionTokens: (result as unknown as Record<string, number>).completionTokens ?? 0,
    totalCostCents: 0,
    avgLatencyMs: latencyMs,
    avgConfidence: result.confidence,
  });

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

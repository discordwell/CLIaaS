/**
 * AI resolution approval queue. DB-backed with in-memory fallback.
 * Approval/rejection now persists via the ai_resolutions store.
 */

import {
  getResolution,
  listResolutions,
  updateResolutionStatus,
  type AIResolutionRecord,
} from './store';
import { sendAIReply } from './reply-sender';
import { getAgentConfig } from './store';

// Legacy type kept for backward compat with any existing callers
export interface ApprovalEntry {
  id: string;
  ticketId: string;
  ticketSubject: string;
  draftReply: string;
  confidence: number;
  reasoning: string;
  kbArticlesUsed: string[];
  status: 'pending' | 'approved' | 'rejected' | 'edited';
  editedReply?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

function recordToEntry(r: AIResolutionRecord): ApprovalEntry {
  return {
    id: r.id,
    ticketId: r.ticketId,
    ticketSubject: '',
    draftReply: r.suggestedReply,
    confidence: r.confidence,
    reasoning: r.reasoning ?? '',
    kbArticlesUsed: r.kbArticlesUsed,
    status: r.status === 'auto_resolved' ? 'approved'
      : r.status === 'escalated' || r.status === 'error' ? 'rejected'
      : r.status as ApprovalEntry['status'],
    editedReply: r.finalReply !== r.suggestedReply ? r.finalReply : undefined,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
    createdAt: r.createdAt,
  };
}

export async function getApprovalQueue(): Promise<ApprovalEntry[]> {
  const { records } = await listResolutions({ limit: 200 });
  return records.map(recordToEntry);
}

export async function enqueueApproval(_entry: ApprovalEntry): Promise<void> {
  // No-op: resolutions are now persisted via saveResolution() in the pipeline
}

export async function getApproval(id: string): Promise<ApprovalEntry | undefined> {
  const record = await getResolution(id);
  return record ? recordToEntry(record) : undefined;
}

export async function getPendingApprovals(): Promise<ApprovalEntry[]> {
  const { records } = await listResolutions({ status: 'pending', limit: 200 });
  return records.map(recordToEntry);
}

export async function approveEntry(id: string, reviewedBy: string): Promise<ApprovalEntry | null> {
  const record = await getResolution(id);
  if (!record || record.status !== 'pending') return null;

  const now = new Date().toISOString();

  // Send the reply
  const config = await getAgentConfig(record.workspaceId);
  const sendResult = await sendAIReply(record, config);

  if (sendResult.piiBlocked) {
    return recordToEntry((await getResolution(id))!);
  }

  // Mark as approved regardless of email send success
  const updated = await updateResolutionStatus(id, 'approved', {
    reviewedBy,
    reviewedAt: now,
    finalReply: record.suggestedReply,
  });
  return updated ? recordToEntry(updated) : null;
}

export async function rejectEntry(id: string, reviewedBy: string): Promise<ApprovalEntry | null> {
  const record = await getResolution(id);
  if (!record || record.status !== 'pending') return null;

  const updated = await updateResolutionStatus(id, 'rejected', {
    reviewedBy,
    reviewedAt: new Date().toISOString(),
  });
  return updated ? recordToEntry(updated) : null;
}

export async function editEntry(id: string, editedReply: string, reviewedBy: string): Promise<ApprovalEntry | null> {
  const record = await getResolution(id);
  if (!record || record.status !== 'pending') return null;

  const updated = await updateResolutionStatus(id, 'edited', {
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    finalReply: editedReply,
  });
  return updated ? recordToEntry(updated) : null;
}

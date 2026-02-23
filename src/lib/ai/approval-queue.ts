/**
 * AI resolution approval queue. Stores pending AI-generated responses
 * for human review before sending to customers.
 */

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

declare global {
  // eslint-disable-next-line no-var
  var __cliaasApprovalQueue: ApprovalEntry[] | undefined;
}

export function getApprovalQueue(): ApprovalEntry[] {
  return global.__cliaasApprovalQueue ?? [];
}

export function enqueueApproval(entry: ApprovalEntry): void {
  const queue = global.__cliaasApprovalQueue ?? [];
  queue.unshift(entry);
  // Keep last 200
  if (queue.length > 200) queue.length = 200;
  global.__cliaasApprovalQueue = queue;
}

export function getApproval(id: string): ApprovalEntry | undefined {
  return getApprovalQueue().find(e => e.id === id);
}

export function getPendingApprovals(): ApprovalEntry[] {
  return getApprovalQueue().filter(e => e.status === 'pending');
}

export function approveEntry(id: string, reviewedBy: string): ApprovalEntry | null {
  const entry = getApproval(id);
  if (!entry || entry.status !== 'pending') return null;
  entry.status = 'approved';
  entry.reviewedBy = reviewedBy;
  entry.reviewedAt = new Date().toISOString();
  return entry;
}

export function rejectEntry(id: string, reviewedBy: string): ApprovalEntry | null {
  const entry = getApproval(id);
  if (!entry || entry.status !== 'pending') return null;
  entry.status = 'rejected';
  entry.reviewedBy = reviewedBy;
  entry.reviewedAt = new Date().toISOString();
  return entry;
}

export function editEntry(id: string, editedReply: string, reviewedBy: string): ApprovalEntry | null {
  const entry = getApproval(id);
  if (!entry || entry.status !== 'pending') return null;
  entry.status = 'edited';
  entry.editedReply = editedReply;
  entry.reviewedBy = reviewedBy;
  entry.reviewedAt = new Date().toISOString();
  return entry;
}

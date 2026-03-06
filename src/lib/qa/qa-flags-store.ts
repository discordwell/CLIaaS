/**
 * QA Flags (spotlight) JSONL store.
 * Flags are AI-generated issues found during auto-review.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

export interface QAFlagRecord {
  id: string;
  workspaceId: string;
  reviewId: string;
  ticketId?: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  dismissed: boolean;
  dismissedBy?: string;
  dismissedAt?: string;
  createdAt: string;
}

const FILE = 'qa-flags.jsonl';
const flags: QAFlagRecord[] = [];
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const saved = readJsonlFile<QAFlagRecord>(FILE);
  if (saved.length > 0) flags.push(...saved);
}

function persist(): void {
  writeJsonlFile(FILE, flags);
}

export function createFlag(input: Omit<QAFlagRecord, 'id' | 'createdAt' | 'dismissed'>): QAFlagRecord {
  ensureLoaded();
  const flag: QAFlagRecord = {
    ...input,
    id: `qf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dismissed: false,
    createdAt: new Date().toISOString(),
  };
  flags.push(flag);
  persist();
  return flag;
}

export function getFlags(filters?: {
  workspaceId?: string;
  severity?: string;
  dismissed?: boolean;
  ticketId?: string;
  reviewId?: string;
}): QAFlagRecord[] {
  ensureLoaded();
  let result = [...flags];
  if (filters?.workspaceId) result = result.filter(f => f.workspaceId === filters.workspaceId);
  if (filters?.severity) result = result.filter(f => f.severity === filters.severity);
  if (filters?.dismissed !== undefined) result = result.filter(f => f.dismissed === filters.dismissed);
  if (filters?.ticketId) result = result.filter(f => f.ticketId === filters.ticketId);
  if (filters?.reviewId) result = result.filter(f => f.reviewId === filters.reviewId);
  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function dismissFlag(id: string, userId: string, workspaceId?: string): QAFlagRecord | null {
  ensureLoaded();
  const idx = flags.findIndex(f => f.id === id && (!workspaceId || f.workspaceId === workspaceId));
  if (idx === -1) return null;
  flags[idx] = {
    ...flags[idx],
    dismissed: true,
    dismissedBy: userId,
    dismissedAt: new Date().toISOString(),
  };
  persist();
  return flags[idx];
}

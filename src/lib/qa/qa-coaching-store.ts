/**
 * QA Coaching assignments JSONL store.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

export interface QACoachingAssignment {
  id: string;
  workspaceId: string;
  reviewId: string;
  agentId: string;
  assignedBy: string;
  status: 'pending' | 'acknowledged' | 'completed';
  notes?: string;
  agentResponse?: string;
  assignedAt: string;
  acknowledgedAt?: string;
  completedAt?: string;
}

const FILE = 'qa-coaching.jsonl';
const assignments: QACoachingAssignment[] = [];
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const saved = readJsonlFile<QACoachingAssignment>(FILE);
  if (saved.length > 0) assignments.push(...saved);
}

function persist(): void {
  writeJsonlFile(FILE, assignments);
}

export function createCoachingAssignment(
  input: Omit<QACoachingAssignment, 'id' | 'assignedAt' | 'status'>,
): QACoachingAssignment {
  ensureLoaded();
  const assignment: QACoachingAssignment = {
    ...input,
    id: `qca-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'pending',
    assignedAt: new Date().toISOString(),
  };
  assignments.push(assignment);
  persist();
  return assignment;
}

export async function getCoachingAssignments(filters?: {
  workspaceId?: string;
  agentId?: string;
  status?: string;
}): Promise<QACoachingAssignment[]> {
  if (filters?.workspaceId) {
    const dbResult = await withRls(filters.workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.qaCoachingAssignments);
      return rows.map(r => ({
        id: r.id,
        workspaceId: r.workspaceId,
        reviewId: r.reviewId,
        agentId: r.agentId,
        assignedBy: r.assignedBy,
        status: r.status as 'pending' | 'acknowledged' | 'completed',
        notes: r.notes ?? undefined,
        agentResponse: r.agentResponse ?? undefined,
        assignedAt: r.assignedAt.toISOString(),
        acknowledgedAt: r.acknowledgedAt?.toISOString(),
        completedAt: r.completedAt?.toISOString(),
      }));
    });
    if (dbResult !== null) {
      let filtered = dbResult;
      if (filters.agentId) filtered = filtered.filter(a => a.agentId === filters.agentId);
      if (filters.status) filtered = filtered.filter(a => a.status === filters.status);
      return filtered.sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime());
    }
  }
  ensureLoaded();
  let result = [...assignments];
  if (filters?.workspaceId) result = result.filter(a => a.workspaceId === filters.workspaceId);
  if (filters?.agentId) result = result.filter(a => a.agentId === filters.agentId);
  if (filters?.status) result = result.filter(a => a.status === filters.status);
  return result.sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime());
}

export function updateCoachingAssignment(
  id: string,
  update: { status?: 'acknowledged' | 'completed'; agentResponse?: string; notes?: string },
  workspaceId?: string,
): QACoachingAssignment | null {
  ensureLoaded();
  const idx = assignments.findIndex(a => a.id === id && (!workspaceId || a.workspaceId === workspaceId));
  if (idx === -1) return null;
  const now = new Date().toISOString();
  if (update.status === 'acknowledged') {
    assignments[idx] = { ...assignments[idx], ...update, acknowledgedAt: now };
  } else if (update.status === 'completed') {
    assignments[idx] = { ...assignments[idx], ...update, completedAt: now };
  } else {
    assignments[idx] = { ...assignments[idx], ...update };
  }
  persist();
  return assignments[idx];
}

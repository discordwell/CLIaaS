/**
 * AI Procedures store — dual-mode (DB primary, JSONL fallback).
 *
 * Procedures are step-by-step instructions the AI agent follows when a ticket
 * matches one of the procedure's trigger topics.
 */

import { withRls } from '@/lib/store-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIProcedure {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  steps: unknown[];          // JSONB — opaque array of step objects
  triggerTopics: string[];   // text[] — topics that activate this procedure
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProcedureInput {
  name: string;
  description?: string | null;
  steps: unknown[];
  triggerTopics: string[];
  enabled?: boolean;
}

export interface UpdateProcedureInput {
  name?: string;
  description?: string | null;
  steps?: unknown[];
  triggerTopics?: string[];
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __cliaasAIProcedures: AIProcedure[] | undefined;
}

function getInMemory(): AIProcedure[] {
  return global.__cliaasAIProcedures ?? [];
}

function setInMemory(records: AIProcedure[]): void {
  global.__cliaasAIProcedures = records;
}

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

async function tryDb() {
  try {
    const { getDb } = await import('@/db');
    const db = getDb();
    if (!db) return null;
    const schema = await import('@/db/schema');
    if (!schema.aiProcedures) return null;
    return { db, schema };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbRowToRecord(row: any): AIProcedure {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description ?? null,
    steps: (row.steps as unknown[]) ?? [],
    triggerTopics: (row.triggerTopics as string[]) ?? [],
    enabled: row.enabled,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listProcedures(workspaceId: string): Promise<AIProcedure[]> {
  const conn = await tryDb();
  if (conn) {
    try {
      const { eq, desc } = await import('drizzle-orm');
      const rows = await conn.db
        .select()
        .from(conn.schema.aiProcedures)
        .where(eq(conn.schema.aiProcedures.workspaceId, workspaceId))
        .orderBy(desc(conn.schema.aiProcedures.createdAt));
      return rows.map(dbRowToRecord);
    } catch {
      // Fall through to in-memory
    }
  }

  return getInMemory().filter((p) => p.workspaceId === workspaceId);
}

export async function getProcedure(id: string, _workspaceId?: string): Promise<AIProcedure | null> {
  const conn = await tryDb();
  if (conn) {
    try {
      const { eq } = await import('drizzle-orm');
      const [row] = await conn.db
        .select()
        .from(conn.schema.aiProcedures)
        .where(eq(conn.schema.aiProcedures.id, id))
        .limit(1);
      return row ? dbRowToRecord(row) : null;
    } catch {
      // Fall through
    }
  }

  return getInMemory().find((p) => p.id === id) ?? null;
}

export async function createProcedure(workspaceId: string, input: CreateProcedureInput): Promise<AIProcedure> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const conn = await tryDb();
  if (conn) {
    try {
      const [row] = await conn.db
        .insert(conn.schema.aiProcedures)
        .values({
          id,
          workspaceId,
          name: input.name,
          description: input.description ?? null,
          steps: input.steps,
          triggerTopics: input.triggerTopics,
          enabled: input.enabled ?? true,
        })
        .returning();
      return dbRowToRecord(row);
    } catch {
      // Fall through
    }
  }

  // In-memory fallback
  const record: AIProcedure = {
    id,
    workspaceId,
    name: input.name,
    description: input.description ?? null,
    steps: input.steps,
    triggerTopics: input.triggerTopics,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
  const records = getInMemory();
  records.unshift(record);
  setInMemory(records);
  return record;
}

export async function updateProcedure(
  id: string,
  input: UpdateProcedureInput,
  workspaceId?: string,
): Promise<AIProcedure | null> {
  const conn = await tryDb();
  if (conn) {
    try {
      const { eq, and } = await import('drizzle-orm');
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) set.name = input.name;
      if (input.description !== undefined) set.description = input.description;
      if (input.steps !== undefined) set.steps = input.steps;
      if (input.triggerTopics !== undefined) set.triggerTopics = input.triggerTopics;
      if (input.enabled !== undefined) set.enabled = input.enabled;

      const whereClause = workspaceId
        ? and(eq(conn.schema.aiProcedures.id, id), eq(conn.schema.aiProcedures.workspaceId, workspaceId))
        : eq(conn.schema.aiProcedures.id, id);

      const [row] = await conn.db
        .update(conn.schema.aiProcedures)
        .set(set)
        .where(whereClause)
        .returning();
      return row ? dbRowToRecord(row) : null;
    } catch {
      // Fall through
    }
  }

  // In-memory fallback
  const records = getInMemory();
  const record = records.find((p) => p.id === id);
  if (!record) return null;
  if (input.name !== undefined) record.name = input.name;
  if (input.description !== undefined) record.description = input.description;
  if (input.steps !== undefined) record.steps = input.steps;
  if (input.triggerTopics !== undefined) record.triggerTopics = input.triggerTopics;
  if (input.enabled !== undefined) record.enabled = input.enabled;
  record.updatedAt = new Date().toISOString();
  return record;
}

export async function deleteProcedure(id: string, workspaceId?: string): Promise<boolean> {
  const conn = await tryDb();
  if (conn) {
    try {
      const { eq, and } = await import('drizzle-orm');
      const whereClause = workspaceId
        ? and(eq(conn.schema.aiProcedures.id, id), eq(conn.schema.aiProcedures.workspaceId, workspaceId))
        : eq(conn.schema.aiProcedures.id, id);
      const result = await conn.db
        .delete(conn.schema.aiProcedures)
        .where(whereClause)
        .returning();
      if (result.length > 0) return true;
    } catch {
      // Fall through
    }
  }

  // In-memory fallback
  const records = getInMemory();
  const idx = records.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  records.splice(idx, 1);
  setInMemory(records);
  return true;
}

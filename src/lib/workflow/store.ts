/**
 * Workflow storage: CRUD operations with DB + JSONL fallback.
 * Same dual-path pattern used by chatbot store.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb, getDefaultWorkspaceId } from '../store-helpers';
import type { Workflow, WorkflowNode, WorkflowTransition } from './types';

const WORKFLOWS_FILE = 'workflows.jsonl';

// ---- JSONL helpers ----

function readAll(): Workflow[] {
  return readJsonlFile<Workflow>(WORKFLOWS_FILE);
}

function writeAll(workflows: Workflow[]): void {
  writeJsonlFile(WORKFLOWS_FILE, workflows);
}

// ---- Public API ----

export async function getWorkflows(workspaceId?: string): Promise<Workflow[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    if (workspaceId) {
      const { eq } = await import('drizzle-orm');
      const rows = await db
        .select()
        .from(schema.workflows)
        .where(eq(schema.workflows.workspaceId, workspaceId))
        .orderBy(schema.workflows.createdAt);
      return rows.map(rowToWorkflow);
    }
    const rows = await db.select().from(schema.workflows).orderBy(schema.workflows.createdAt);
    return rows.map(rowToWorkflow);
  }
  return readAll();
}

export async function getWorkflow(id: string, workspaceId?: string): Promise<Workflow | null> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');
    const conditions = workspaceId
      ? and(eq(schema.workflows.id, id), eq(schema.workflows.workspaceId, workspaceId))
      : eq(schema.workflows.id, id);
    const [row] = await db.select().from(schema.workflows).where(conditions);
    return row ? rowToWorkflow(row) : null;
  }
  return readAll().find((w) => w.id === id) ?? null;
}

export async function getActiveWorkflows(workspaceId?: string): Promise<Workflow[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');
    const conditions = workspaceId
      ? and(eq(schema.workflows.enabled, true), eq(schema.workflows.workspaceId, workspaceId))
      : eq(schema.workflows.enabled, true);
    const rows = await db
      .select()
      .from(schema.workflows)
      .where(conditions);
    return rows.map(rowToWorkflow);
  }
  return readAll().filter((w) => w.enabled);
}

export async function upsertWorkflow(workflow: Workflow, workspaceId?: string): Promise<Workflow> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');

    // When updating, scope by workspace to prevent cross-workspace overwrites
    const findCondition = workspaceId
      ? and(eq(schema.workflows.id, workflow.id), eq(schema.workflows.workspaceId, workspaceId))
      : eq(schema.workflows.id, workflow.id);

    const [existing] = await db
      .select({ id: schema.workflows.id })
      .from(schema.workflows)
      .where(findCondition);

    const values = {
      name: workflow.name,
      description: workflow.description ?? null,
      flow: {
        nodes: workflow.nodes,
        transitions: workflow.transitions,
        entryNodeId: workflow.entryNodeId,
      },
      enabled: workflow.enabled,
      version: workflow.version,
      updatedAt: new Date(),
    };

    if (existing) {
      const updateCondition = workspaceId
        ? and(eq(schema.workflows.id, workflow.id), eq(schema.workflows.workspaceId, workspaceId))
        : eq(schema.workflows.id, workflow.id);
      await db.update(schema.workflows).set(values).where(updateCondition);
    } else {
      const wsId = workspaceId ?? await getDefaultWorkspaceId(db, schema);
      await db.insert(schema.workflows).values({
        id: workflow.id,
        workspaceId: wsId,
        ...values,
      });
    }

    return workflow;
  }

  // JSONL path
  const all = readAll();
  const idx = all.findIndex((w) => w.id === workflow.id);
  if (idx >= 0) {
    all[idx] = workflow;
  } else {
    all.push(workflow);
  }
  writeAll(all);
  return workflow;
}

export async function deleteWorkflow(id: string, workspaceId?: string): Promise<boolean> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');
    // Scope delete by workspace to prevent cross-workspace deletion
    const condition = workspaceId
      ? and(eq(schema.workflows.id, id), eq(schema.workflows.workspaceId, workspaceId))
      : eq(schema.workflows.id, id);
    const result = await db.delete(schema.workflows).where(condition);
    return (result.rowCount ?? 0) > 0;
  }

  const all = readAll();
  const filtered = all.filter((w) => w.id !== id);
  if (filtered.length === all.length) return false;
  writeAll(filtered);
  return true;
}

// ---- Helpers ----

function rowToWorkflow(row: {
  id: string;
  name: string;
  description: string | null;
  flow: unknown;
  enabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): Workflow {
  const flowData = row.flow as {
    nodes: Record<string, WorkflowNode>;
    transitions: WorkflowTransition[];
    entryNodeId: string;
  };
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    nodes: flowData.nodes,
    transitions: flowData.transitions,
    entryNodeId: flowData.entryNodeId,
    enabled: row.enabled,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}


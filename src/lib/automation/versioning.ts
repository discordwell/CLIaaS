/**
 * Rule versioning: create snapshots, list history, and restore previous versions.
 * Uses DB (rule_versions table) with JSONL fallback.
 */

import { randomUUID } from 'crypto';
import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { tryDb, withRls } from '../store-helpers';
import { invalidateRuleCache } from './bootstrap';

export interface RuleVersion {
  id: string;
  ruleId: string;
  workspaceId: string;
  versionNumber: number;
  name: string;
  conditions: Record<string, unknown>;
  actions: unknown[];
  description: string | null;
  createdBy: string | null;
  createdAt: string;
}

const VERSIONS_FILE = 'rule-versions.jsonl';

// ---- JSONL helpers ----

function readAllVersions(): RuleVersion[] {
  return readJsonlFile<RuleVersion>(VERSIONS_FILE);
}

function writeAllVersions(items: RuleVersion[]): void {
  writeJsonlFile(VERSIONS_FILE, items);
}

// ---- Public API ----

/**
 * Snapshot the current state of a rule into the version history.
 * Reads the current rule, increments the version number, and persists.
 */
export async function createVersion(
  ruleId: string,
  workspaceId: string,
  userId?: string,
): Promise<RuleVersion> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and, desc } = await import('drizzle-orm');

    // Read the current rule
    const [rule] = await db
      .select()
      .from(schema.rules)
      .where(and(eq(schema.rules.id, ruleId), eq(schema.rules.workspaceId, workspaceId)));

    if (!rule) throw new Error(`Rule ${ruleId} not found`);

    // Find the highest existing version number
    const [latest] = await db
      .select({ versionNumber: schema.ruleVersions.versionNumber })
      .from(schema.ruleVersions)
      .where(eq(schema.ruleVersions.ruleId, ruleId))
      .orderBy(desc(schema.ruleVersions.versionNumber))
      .limit(1);

    const nextVersion = (latest?.versionNumber ?? 0) + 1;

    const [row] = await db
      .insert(schema.ruleVersions)
      .values({
        ruleId,
        workspaceId,
        versionNumber: nextVersion,
        name: rule.name,
        conditions: (rule.conditions ?? {}) as Record<string, unknown>,
        actions: (rule.actions ?? []) as unknown[],
        description: rule.description,
        createdBy: userId ?? null,
      })
      .returning();

    return rowToVersion(row);
  }

  // JSONL path: read rule from in-memory automation rules
  const { getAutomationRules } = await import('./executor');
  const rules = getAutomationRules(workspaceId);
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);

  const allVersions = readAllVersions().filter(v => v.ruleId === ruleId);
  const maxVersion = allVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0);

  const version: RuleVersion = {
    id: randomUUID(),
    ruleId,
    workspaceId,
    versionNumber: maxVersion + 1,
    name: rule.name,
    conditions: (rule.conditions ?? {}) as Record<string, unknown>,
    actions: (rule.actions ?? []) as unknown[],
    description: null,
    createdBy: userId ?? null,
    createdAt: new Date().toISOString(),
  };

  const all = readAllVersions();
  all.push(version);
  writeAllVersions(all);
  return version;
}

/**
 * List all versions for a rule, ordered by version number descending.
 */
export async function listVersions(
  ruleId: string,
  workspaceId: string,
): Promise<RuleVersion[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and, desc } = await import('drizzle-orm');

    const rows = await db
      .select()
      .from(schema.ruleVersions)
      .where(and(
        eq(schema.ruleVersions.ruleId, ruleId),
        eq(schema.ruleVersions.workspaceId, workspaceId),
      ))
      .orderBy(desc(schema.ruleVersions.versionNumber));

    return rows.map(rowToVersion);
  }

  // JSONL path
  return readAllVersions()
    .filter(v => v.ruleId === ruleId && v.workspaceId === workspaceId)
    .sort((a, b) => b.versionNumber - a.versionNumber);
}

/**
 * Restore a rule to a previous version. Overwrites the current rule's
 * conditions, actions, name, and description with the version's snapshot.
 * Creates a new version snapshot first (so the current state is preserved).
 */
export async function restoreVersion(
  ruleId: string,
  versionId: string,
  workspaceId: string,
  userId?: string,
): Promise<RuleVersion> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');

    // Find the version to restore
    const [version] = await db
      .select()
      .from(schema.ruleVersions)
      .where(and(
        eq(schema.ruleVersions.id, versionId),
        eq(schema.ruleVersions.workspaceId, workspaceId),
      ));

    if (!version) throw new Error(`Version ${versionId} not found`);
    if (version.ruleId !== ruleId) throw new Error('Version does not belong to this rule');

    // Snapshot current state before restoring
    await createVersion(ruleId, workspaceId, userId);

    // Restore the rule to the version's state
    await db
      .update(schema.rules)
      .set({
        name: version.name,
        conditions: version.conditions,
        actions: version.actions,
        description: version.description,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.rules.id, ruleId), eq(schema.rules.workspaceId, workspaceId)));

    invalidateRuleCache();

    // Return the restored version info
    return rowToVersion(version);
  }

  // JSONL path
  const allVersions = readAllVersions();
  const version = allVersions.find(v => v.id === versionId && v.workspaceId === workspaceId);
  if (!version) throw new Error(`Version ${versionId} not found`);
  if (version.ruleId !== ruleId) throw new Error('Version does not belong to this rule');

  // Snapshot current state before restoring
  await createVersion(ruleId, workspaceId, userId);

  // Restore in-memory rule
  const { updateAutomationRule } = await import('./executor');
  updateAutomationRule(ruleId, {
    name: version.name,
    conditions: version.conditions as import('./conditions').RuleConditions,
    actions: version.actions as import('./actions').RuleAction[],
  }, workspaceId);

  invalidateRuleCache();
  return version;
}

// ---- Helpers ----

function rowToVersion(row: {
  id: string;
  ruleId: string;
  workspaceId: string;
  versionNumber: number;
  name: string;
  conditions: unknown;
  actions: unknown;
  description: string | null;
  createdBy: string | null;
  createdAt: Date | string;
}): RuleVersion {
  return {
    id: row.id,
    ruleId: row.ruleId,
    workspaceId: row.workspaceId,
    versionNumber: row.versionNumber,
    name: row.name,
    conditions: (row.conditions ?? {}) as Record<string, unknown>,
    actions: (row.actions ?? []) as unknown[],
    description: row.description,
    createdBy: row.createdBy,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

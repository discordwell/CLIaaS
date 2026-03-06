/**
 * PII sensitivity rules CRUD — workspace-level PII detection configuration.
 */

import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import type { PiiType, PiiSensitivityRule, MaskingStyle } from './pii-detector';
import { getDefaultRules } from './pii-detector';

export interface PiiSensitivityRuleRecord {
  id: string;
  workspaceId: string;
  piiType: PiiType;
  enabled: boolean;
  autoRedact: boolean;
  customPattern: string | null;
  maskingStyle: MaskingStyle;
  createdAt: string;
  updatedAt: string;
}

/** Get all sensitivity rules for a workspace. Falls back to defaults if none configured. */
export async function getSensitivityRules(workspaceId: string): Promise<PiiSensitivityRule[]> {
  const db = getDb();
  if (!db) return getDefaultRules();

  try {
    const rows = await db
      .select()
      .from(schema.piiSensitivityRules)
      .where(eq(schema.piiSensitivityRules.workspaceId, workspaceId));

    if (rows.length === 0) return getDefaultRules();

    return rows.map(row => ({
      piiType: row.piiType as PiiType,
      enabled: row.enabled,
      autoRedact: row.autoRedact,
      customPattern: row.customPattern ?? undefined,
      maskingStyle: (row.maskingStyle as MaskingStyle) || 'full',
    }));
  } catch {
    return getDefaultRules();
  }
}

/** Upsert sensitivity rules for a workspace (batch). */
export async function upsertSensitivityRules(
  workspaceId: string,
  rules: PiiSensitivityRule[],
): Promise<PiiSensitivityRuleRecord[]> {
  const db = getDb();
  if (!db) throw new Error('Database not available');

  const results: PiiSensitivityRuleRecord[] = [];

  for (const rule of rules) {
    const existing = await db
      .select()
      .from(schema.piiSensitivityRules)
      .where(
        and(
          eq(schema.piiSensitivityRules.workspaceId, workspaceId),
          eq(schema.piiSensitivityRules.piiType, rule.piiType),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(schema.piiSensitivityRules)
        .set({
          enabled: rule.enabled,
          autoRedact: rule.autoRedact,
          customPattern: rule.customPattern ?? null,
          maskingStyle: rule.maskingStyle,
          updatedAt: new Date(),
        })
        .where(eq(schema.piiSensitivityRules.id, existing[0].id))
        .returning();

      results.push(toRecord(updated));
    } else {
      const [inserted] = await db
        .insert(schema.piiSensitivityRules)
        .values({
          workspaceId,
          piiType: rule.piiType,
          enabled: rule.enabled,
          autoRedact: rule.autoRedact,
          customPattern: rule.customPattern ?? null,
          maskingStyle: rule.maskingStyle,
        })
        .returning();

      results.push(toRecord(inserted));
    }
  }

  return results;
}

function toRecord(row: typeof schema.piiSensitivityRules.$inferSelect): PiiSensitivityRuleRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    piiType: row.piiType as PiiType,
    enabled: row.enabled,
    autoRedact: row.autoRedact,
    customPattern: row.customPattern,
    maskingStyle: (row.maskingStyle as MaskingStyle) || 'full',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

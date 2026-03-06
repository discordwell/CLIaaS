/**
 * PII masking service — orchestrates detection, storage, and redaction.
 */

import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { detectPii, maskText, type PiiMatch, type MaskingStyle } from './pii-detector';
import { getSensitivityRules } from './pii-rules';
import { encryptPii, decryptPii, hashPii } from './pii-encryption';
import { createLogger } from '@/lib/logger';

const logger = createLogger('compliance:pii-masking');

export interface PiiDetectionRecord {
  id: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  piiType: string;
  charOffset: number;
  charLength: number;
  maskedValue: string;
  confidence: number;
  detectionMethod: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  redactedAt: string | null;
  createdAt: string;
}

/** Scan a single entity for PII. Returns detections found. */
export async function scanEntity(
  entityType: string,
  entityId: string,
  workspaceId: string,
): Promise<PiiDetectionRecord[]> {
  const db = getDb();
  const rules = await getSensitivityRules(workspaceId);
  const detections: PiiDetectionRecord[] = [];

  // Get the text fields to scan based on entity type
  const fields = await getEntityFields(entityType, entityId, workspaceId);
  if (!fields) return detections;

  for (const [fieldName, text] of Object.entries(fields)) {
    if (!text) continue;
    const matches = await detectPii(text, rules);
    if (matches.length === 0) continue;

    // Determine masking style from rules
    const ruleMap = new Map(rules.map(r => [r.piiType, r]));

    for (const match of matches) {
      const rule = ruleMap.get(match.piiType);
      const style: MaskingStyle = rule?.maskingStyle || 'full';
      const maskedValue = maskText(text.slice(match.start, match.end), [{ ...match, start: 0, end: match.end - match.start }], style);
      const autoRedact = rule?.autoRedact ?? false;

      const encrypted = encryptPii(match.text);

      if (db) {
        try {
          const [row] = await db
            .insert(schema.piiDetections)
            .values({
              workspaceId,
              entityType,
              entityId,
              fieldName,
              piiType: match.piiType,
              charOffset: match.start,
              charLength: match.end - match.start,
              originalEncrypted: encrypted,
              maskedValue,
              confidence: match.confidence,
              detectionMethod: match.method,
              status: autoRedact ? 'auto_redacted' : 'pending',
              redactedAt: autoRedact ? new Date() : null,
            })
            .returning();

          detections.push(toDetectionRecord(row));

          // If auto-redact, apply immediately
          if (autoRedact) {
            await applyRedaction(entityType, entityId, fieldName, text, [match], style, workspaceId);
          }
        } catch (err) {
          logger.error({ entityType, entityId, fieldName, error: err instanceof Error ? err.message : 'Unknown' }, 'Failed to persist PII detection');
        }
      } else {
        // In-memory mode: return detections without persisting
        detections.push({
          id: crypto.randomUUID(),
          workspaceId,
          entityType,
          entityId,
          fieldName,
          piiType: match.piiType,
          charOffset: match.start,
          charLength: match.end - match.start,
          maskedValue,
          confidence: match.confidence,
          detectionMethod: match.method,
          status: autoRedact ? 'auto_redacted' : 'pending',
          reviewedBy: null,
          reviewedAt: null,
          redactedAt: autoRedact ? new Date().toISOString() : null,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Update entity has_pii flag
    if (matches.length > 0 && db) {
      await markEntityHasPii(entityType, entityId, workspaceId, db);
    }
  }

  return detections;
}

/** Redact a single confirmed detection. */
export async function redactDetection(
  detectionId: string,
  redactedBy: string,
  workspaceId: string,
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not available');

  const [detection] = await db
    .select()
    .from(schema.piiDetections)
    .where(
      and(
        eq(schema.piiDetections.id, detectionId),
        eq(schema.piiDetections.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!detection) throw new Error('Detection not found');
  if (detection.status === 'redacted' || detection.status === 'auto_redacted') {
    throw new Error('Detection already redacted');
  }

  // Get the current text
  const fields = await getEntityFields(detection.entityType, detection.entityId, workspaceId);
  const fieldText = fields?.[detection.fieldName];
  if (!fieldText) throw new Error('Entity field not found');

  // Re-detect the PII in the current text to handle offset drift from prior redactions
  const expectedText = fieldText.slice(detection.charOffset, detection.charOffset + detection.charLength);
  let matchStart = detection.charOffset;
  let matchEnd = detection.charOffset + detection.charLength;
  let matchText = expectedText;

  // If the stored offsets no longer point to the expected text, try to find it
  if (detection.originalEncrypted) {
    const original = decryptPii(detection.originalEncrypted);
    if (original && original !== expectedText) {
      const idx = fieldText.indexOf(original);
      if (idx === -1) throw new Error('Original PII text no longer found in field — text may have been modified');
      matchStart = idx;
      matchEnd = idx + original.length;
      matchText = original;
    }
  }

  const match: PiiMatch = {
    piiType: detection.piiType as PiiMatch['piiType'],
    text: matchText,
    start: matchStart,
    end: matchEnd,
    confidence: detection.confidence,
    method: detection.detectionMethod as 'regex' | 'ai' | 'manual',
  };

  const rules = await getSensitivityRules(workspaceId);
  const ruleMap = new Map(rules.map(r => [r.piiType, r]));
  const style: MaskingStyle = ruleMap.get(detection.piiType as any)?.maskingStyle || 'full';

  // Apply redaction to the entity
  await applyRedaction(detection.entityType, detection.entityId, detection.fieldName, fieldText, [match], style, workspaceId);

  // Update detection status
  await db
    .update(schema.piiDetections)
    .set({ status: 'redacted', redactedAt: new Date() })
    .where(eq(schema.piiDetections.id, detectionId));

  // Write to redaction log
  await db.insert(schema.piiRedactionLog).values({
    workspaceId,
    detectionId,
    entityType: detection.entityType,
    entityId: detection.entityId,
    fieldName: detection.fieldName,
    originalHash: hashPii(match.text),
    maskedValue: detection.maskedValue,
    redactedBy,
    reason: 'manual',
  });
}

/** Redact all confirmed detections for a workspace. */
export async function redactAllConfirmed(
  workspaceId: string,
  redactedBy: string,
): Promise<number> {
  const db = getDb();
  if (!db) throw new Error('Database not available');

  const confirmed = await db
    .select()
    .from(schema.piiDetections)
    .where(
      and(
        eq(schema.piiDetections.workspaceId, workspaceId),
        eq(schema.piiDetections.status, 'confirmed'),
      ),
    );

  let count = 0;
  for (const detection of confirmed) {
    try {
      await redactDetection(detection.id, redactedBy, workspaceId);
      count++;
    } catch (err) {
      logger.error({ detectionId: detection.id, error: err instanceof Error ? err.message : 'Unknown' }, 'Failed to redact detection');
    }
  }

  return count;
}

/** Review (confirm/dismiss) a PII detection. */
export async function reviewDetection(
  detectionId: string,
  action: 'confirm' | 'dismiss',
  reviewedBy: string,
  workspaceId: string,
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not available');

  const newStatus = action === 'confirm' ? 'confirmed' : 'dismissed';

  const result = await db
    .update(schema.piiDetections)
    .set({
      status: newStatus,
      reviewedBy,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(schema.piiDetections.id, detectionId),
        eq(schema.piiDetections.workspaceId, workspaceId),
      ),
    )
    .returning();

  if (result.length === 0) throw new Error('Detection not found');
}

/** Get entity fields to scan based on entity type, scoped to workspace. */
async function getEntityFields(
  entityType: string,
  entityId: string,
  workspaceId: string,
): Promise<Record<string, string> | null> {
  const db = getDb();
  if (!db) return null;

  try {
    switch (entityType) {
      case 'message': {
        const [msg] = await db.select().from(schema.messages).where(and(eq(schema.messages.id, entityId), eq(schema.messages.workspaceId, workspaceId))).limit(1);
        if (!msg) return null;
        return { body: msg.body, ...(msg.bodyHtml ? { bodyHtml: msg.bodyHtml } : {}) };
      }
      case 'ticket': {
        const [ticket] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.id, entityId), eq(schema.tickets.workspaceId, workspaceId))).limit(1);
        if (!ticket) return null;
        const fields: Record<string, string> = {};
        if (ticket.subject) fields.subject = ticket.subject;
        if (ticket.description) fields.description = ticket.description;
        if (ticket.customerEmail) fields.customerEmail = ticket.customerEmail;
        return fields;
      }
      case 'customer': {
        const [customer] = await db.select().from(schema.customers).where(and(eq(schema.customers.id, entityId), eq(schema.customers.workspaceId, workspaceId))).limit(1);
        if (!customer) return null;
        const fields: Record<string, string> = {};
        if (customer.name) fields.name = customer.name;
        if (customer.email) fields.email = customer.email;
        if (customer.phone) fields.phone = customer.phone;
        return fields;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Apply redaction to the actual entity field in the database. */
async function applyRedaction(
  entityType: string,
  entityId: string,
  fieldName: string,
  originalText: string,
  matches: PiiMatch[],
  style: MaskingStyle,
  workspaceId: string,
): Promise<void> {
  const db = getDb();
  if (!db) return;

  const masked = maskText(originalText, matches, style);

  try {
    switch (entityType) {
      case 'message': {
        if (fieldName === 'body') {
          await db
            .update(schema.messages)
            .set({ bodyRedacted: masked, hasPii: true, piiScannedAt: new Date() })
            .where(and(eq(schema.messages.id, entityId), eq(schema.messages.workspaceId, workspaceId)));
        }
        break;
      }
      case 'ticket': {
        await db
          .update(schema.tickets)
          .set({ hasPii: true, piiScannedAt: new Date() })
          .where(and(eq(schema.tickets.id, entityId), eq(schema.tickets.workspaceId, workspaceId)));
        break;
      }
    }
  } catch (err) {
    logger.error({ entityType, entityId, fieldName, error: err instanceof Error ? err.message : 'Unknown' }, 'Failed to apply redaction');
  }
}

/** Mark entity as containing PII. */
async function markEntityHasPii(
  entityType: string,
  entityId: string,
  workspaceId: string,
  db: NonNullable<ReturnType<typeof getDb>>,
): Promise<void> {
  try {
    switch (entityType) {
      case 'message':
        await db.update(schema.messages).set({ hasPii: true, piiScannedAt: new Date() }).where(and(eq(schema.messages.id, entityId), eq(schema.messages.workspaceId, workspaceId)));
        break;
      case 'ticket':
        await db.update(schema.tickets).set({ hasPii: true, piiScannedAt: new Date() }).where(and(eq(schema.tickets.id, entityId), eq(schema.tickets.workspaceId, workspaceId)));
        break;
    }
  } catch {
    // Best-effort
  }
}

/** Log PII access (unmasked view). */
export async function logPiiAccess(
  workspaceId: string,
  userId: string,
  entityType: string,
  entityId: string,
  fieldName: string,
  piiType: string,
  accessType: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(schema.piiAccessLog).values({
      workspaceId,
      userId,
      entityType,
      entityId,
      fieldName,
      piiType,
      accessType,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    });
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : 'Unknown' }, 'Failed to log PII access');
  }
}

/** Get PII detection statistics for a workspace. */
export async function getPiiStats(workspaceId: string): Promise<{
  total: number;
  pending: number;
  confirmed: number;
  redacted: number;
  dismissed: number;
  autoRedacted: number;
  byType: Record<string, number>;
}> {
  const db = getDb();
  if (!db) return { total: 0, pending: 0, confirmed: 0, redacted: 0, dismissed: 0, autoRedacted: 0, byType: {} };

  try {
    // Use SQL aggregation instead of fetching all rows
    const statusRows = await db
      .select({
        status: schema.piiDetections.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.piiDetections)
      .where(eq(schema.piiDetections.workspaceId, workspaceId))
      .groupBy(schema.piiDetections.status);

    const typeRows = await db
      .select({
        piiType: schema.piiDetections.piiType,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.piiDetections)
      .where(eq(schema.piiDetections.workspaceId, workspaceId))
      .groupBy(schema.piiDetections.piiType);

    let total = 0, pending = 0, confirmed = 0, redacted = 0, dismissed = 0, autoRedacted = 0;
    for (const row of statusRows) {
      total += row.count;
      switch (row.status) {
        case 'pending': pending = row.count; break;
        case 'confirmed': confirmed = row.count; break;
        case 'redacted': redacted = row.count; break;
        case 'dismissed': dismissed = row.count; break;
        case 'auto_redacted': autoRedacted = row.count; break;
      }
    }

    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.piiType] = row.count;
    }

    return { total, pending, confirmed, redacted, dismissed, autoRedacted, byType };
  } catch {
    return { total: 0, pending: 0, confirmed: 0, redacted: 0, dismissed: 0, autoRedacted: 0, byType: {} };
  }
}

function toDetectionRecord(row: typeof schema.piiDetections.$inferSelect): PiiDetectionRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    entityType: row.entityType,
    entityId: row.entityId,
    fieldName: row.fieldName,
    piiType: row.piiType,
    charOffset: row.charOffset,
    charLength: row.charLength,
    maskedValue: row.maskedValue,
    confidence: row.confidence,
    detectionMethod: row.detectionMethod,
    status: row.status,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    redactedAt: row.redactedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

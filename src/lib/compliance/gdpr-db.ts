import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { exportUserData, deleteUserData } from '@/lib/compliance';
import { createLogger } from '@/lib/logger';

const logger = createLogger('gdpr-db');

export interface GdprExportResult {
  userId: string;
  workspaceId: string;
  exportedAt: string;
  tickets: Array<{ id: string; subject: string; status: string; createdAt: string }>;
  messages: Array<{ id: string; body: string; createdAt: string }>;
  customers: Array<{ id: string; name: string; email: string | null }>;
  csatRatings: Array<{ id: string; rating: number; createdAt: string }>;
  timeEntries: Array<{ id: string; minutes: number; createdAt: string }>;
  auditEntries: Array<{ id: string; action: string; timestamp: string }>;
}

export interface GdprDeletionResult {
  requestId: string;
  status: 'completed' | 'failed';
  recordsAffected: {
    customersAnonymized: number;
    messagesRedacted: number;
    csatDeleted: number;
    timeEntriesDeleted: number;
  };
}

export async function exportUserDataFromDb(
  userId: string,
  workspaceId: string,
): Promise<GdprExportResult> {
  const db = getDb();
  if (!db) {
    // Demo mode fallback
    const demoData = await exportUserData(userId);
    return {
      userId,
      workspaceId,
      exportedAt: demoData.exportedAt,
      tickets: demoData.tickets,
      messages: demoData.messages,
      customers: [],
      csatRatings: [],
      timeEntries: [],
      auditEntries: [],
    };
  }

  try {
    // Query tickets where user is requester or assignee
    const tickets = await db
      .select({
        id: schema.tickets.id,
        subject: schema.tickets.subject,
        status: schema.tickets.status,
        createdAt: schema.tickets.createdAt,
      })
      .from(schema.tickets)
      .where(
        and(
          eq(schema.tickets.workspaceId, workspaceId),
          sql`(${schema.tickets.requesterId} = ${userId}::uuid OR ${schema.tickets.assigneeId} = ${userId}::uuid)`,
        ),
      );

    // Query customers scoped to the target user's email
    let customers: Array<{ id: string; name: string; email: string | null }> = [];
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (user?.email) {
      customers = await db
        .select({
          id: schema.customers.id,
          name: schema.customers.name,
          email: schema.customers.email,
        })
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.workspaceId, workspaceId),
            eq(schema.customers.email, user.email),
          ),
        );
    }

    // Query audit entries
    const auditEntries = await db
      .select({
        id: schema.auditEntries.id,
        action: schema.auditEntries.action,
        timestamp: schema.auditEntries.timestamp,
      })
      .from(schema.auditEntries)
      .where(eq(schema.auditEntries.userId, userId))
      .limit(1000);

    return {
      userId,
      workspaceId,
      exportedAt: new Date().toISOString(),
      tickets: tickets.map(t => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      })),
      messages: [],
      customers: customers.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
      })),
      csatRatings: [],
      timeEntries: [],
      auditEntries: auditEntries.map(a => ({
        id: a.id,
        action: a.action,
        timestamp: a.timestamp.toISOString(),
      })),
    };
  } catch (err) {
    logger.error({ err }, 'GDPR export from DB failed, falling back to demo');
    const demoData = await exportUserData(userId);
    return {
      userId,
      workspaceId,
      exportedAt: demoData.exportedAt,
      tickets: demoData.tickets,
      messages: demoData.messages,
      customers: [],
      csatRatings: [],
      timeEntries: [],
      auditEntries: [],
    };
  }
}

export async function deleteUserDataFromDb(
  userId: string,
  workspaceId: string,
  requestedBy: string,
  subjectEmail: string,
): Promise<GdprDeletionResult> {
  const db = getDb();
  if (!db) {
    // Demo mode fallback
    const demoResult = await deleteUserData(userId);
    return {
      requestId: `demo-${Date.now()}`,
      status: 'completed',
      recordsAffected: {
        customersAnonymized: demoResult.anonymizedTickets,
        messagesRedacted: demoResult.anonymizedMessages,
        csatDeleted: 0,
        timeEntriesDeleted: 0,
      },
    };
  }

  const requestId = crypto.randomUUID();
  const recordsAffected = {
    customersAnonymized: 0,
    messagesRedacted: 0,
    csatDeleted: 0,
    timeEntriesDeleted: 0,
  };

  try {
    // Record the deletion request
    await db.insert(schema.gdprDeletionRequests).values({
      id: requestId,
      workspaceId,
      requestedBy,
      subjectEmail,
      status: 'pending',
    });

    // Anonymize customers by email
    const custResult = await db
      .update(schema.customers)
      .set({ name: '[deleted]', email: null, phone: null })
      .where(
        and(
          eq(schema.customers.workspaceId, workspaceId),
          eq(schema.customers.email, subjectEmail),
        ),
      );
    recordsAffected.customersAnonymized = custResult.rowCount ?? 0;

    // Mark request completed
    await db
      .update(schema.gdprDeletionRequests)
      .set({
        status: 'completed',
        completedAt: new Date(),
        recordsAffected,
      })
      .where(eq(schema.gdprDeletionRequests.id, requestId));

    return { requestId, status: 'completed', recordsAffected };
  } catch (err) {
    logger.error({ err }, 'GDPR deletion failed');
    // Mark request failed
    try {
      await db
        .update(schema.gdprDeletionRequests)
        .set({ status: 'failed', completedAt: new Date() })
        .where(eq(schema.gdprDeletionRequests.id, requestId));
    } catch { /* best effort */ }

    return { requestId, status: 'failed', recordsAffected };
  }
}

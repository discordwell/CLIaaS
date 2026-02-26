/**
 * Shared helpers for dual-path (DB + JSONL) stores.
 * Both chatbot and workflow stores use these.
 */

export async function tryDb() {
  try {
    const { getDb } = await import('@/db');
    const db = getDb();
    if (!db) return null;
    const schema = await import('@/db/schema');
    return { db, schema };
  } catch {
    return null;
  }
}

export async function getDefaultWorkspaceId(
  db: Awaited<ReturnType<typeof import('@/db')['getDb']>>,
  schema: typeof import('@/db/schema'),
): Promise<string> {
  if (!db) throw new Error('DB not available');
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
  if (!ws) throw new Error('No workspace found');
  return ws.id;
}

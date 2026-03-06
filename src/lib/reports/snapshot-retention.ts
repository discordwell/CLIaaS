/**
 * Delete metric_snapshots older than 30 days.
 * Called daily from automation worker.
 */
export async function cleanExpiredSnapshots(): Promise<number> {
  try {
    const { db } = await import('@/db');
    const { metricSnapshots } = await import('@/db/schema');
    const { lt } = await import('drizzle-orm');

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const deleted = await db
      .delete(metricSnapshots)
      .where(lt(metricSnapshots.createdAt, cutoff))
      .returning({ id: metricSnapshots.id });

    return deleted.length;
  } catch {
    // No DB connection (BYOC / JSONL mode) — nothing to clean
    return 0;
  }
}

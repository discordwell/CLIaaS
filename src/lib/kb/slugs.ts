/**
 * KB article slug generation and uniqueness utilities.
 */

/**
 * Generate a URL-friendly slug from an article title.
 * - lowercase
 * - replace non-alphanumeric characters with hyphens
 * - collapse multiple hyphens
 * - trim leading/trailing hyphens
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Ensure a slug is unique within a workspace by appending -2, -3, etc.
 * Queries the DB for existing slugs; if no DB is available, returns the slug as-is.
 */
export async function ensureUniqueSlug(
  slug: string,
  workspaceId: string,
): Promise<string> {
  try {
    const { getDb } = await import('@/db');
    const db = getDb();
    if (!db) return slug;

    const schema = await import('@/db/schema');
    const { eq, and, like } = await import('drizzle-orm');

    // Escape LIKE wildcards to prevent injection
    const escapedSlug = slug.replace(/%/g, '\\%').replace(/_/g, '\\_');

    // Fetch all slugs that start with the base slug in this workspace
    const rows = await db
      .select({ slug: schema.kbArticles.slug })
      .from(schema.kbArticles)
      .where(
        and(
          eq(schema.kbArticles.workspaceId, workspaceId),
          like(schema.kbArticles.slug, `${escapedSlug}%`),
        ),
      );

    const existing = new Set(rows.map((r) => r.slug));
    if (!existing.has(slug)) return slug;

    let counter = 2;
    while (existing.has(`${slug}-${counter}`)) {
      counter++;
    }
    return `${slug}-${counter}`;
  } catch {
    return slug;
  }
}

/**
 * Mention parsing and resolution for internal notes.
 * Supports @name.surname and @email patterns.
 */

/**
 * Extract mention strings from text.
 * Matches @first.last, @first, and @user@domain.com patterns.
 */
export function extractMentions(text: string): string[] {
  const mentionRegex = /@([\w.+-]+@[\w.-]+\.\w+|[\w]+(?:\.[\w]+)*)/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return [...new Set(matches)];
}

/**
 * Resolve mention strings to user IDs by matching against name or email.
 */
export async function resolveMentions(
  mentions: string[],
  workspaceId: string,
): Promise<Array<{ id: string; name: string; email: string | null }>> {
  if (mentions.length === 0) return [];

  try {
    const { db } = await import('@/db');
    const schema = await import('@/db/schema');
    const { eq, or, ilike } = await import('drizzle-orm');

    const conditions = mentions.flatMap((m) => {
      // If it looks like an email, match on email
      if (m.includes('@')) {
        return [ilike(schema.users.email, m)];
      }
      // Otherwise match name (dot → space) or email prefix
      const nameLike = m.replace(/\./g, ' ');
      return [
        ilike(schema.users.name, `%${nameLike}%`),
        ilike(schema.users.email, `${m}%`),
      ];
    });

    if (conditions.length === 0) return [];

    const rows = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(
        conditions.length === 1
          ? conditions[0]
          : or(...conditions) ?? conditions[0],
      )
      .limit(50);

    // Filter to workspace (users table has workspaceId)
    const wsFiltered = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(
        eq(schema.users.workspaceId, workspaceId),
      )
      .limit(500);

    const wsUserIds = new Set(wsFiltered.map((u: { id: string }) => u.id));
    return rows
      .filter((r: { id: string }) => wsUserIds.has(r.id))
      .map((r: { id: string; name: string; email: string | null }) => ({
        id: r.id,
        name: r.name,
        email: r.email,
      }));
  } catch {
    return [];
  }
}

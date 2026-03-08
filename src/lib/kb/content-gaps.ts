/**
 * KB Content Gap analysis — detects topics with recurring support tickets
 * but no corresponding KB articles.
 *
 * Uses the existing detectKBGaps logic from src/lib/ai/proactive.ts
 * and writes results to the kb_content_gaps table.
 */

import type { Ticket, Message, KBArticle } from '@/lib/data';
import { loadTickets, loadMessages, loadKBArticles } from '@/lib/data';

// Re-use the KBGap type from proactive.ts
interface KBGap {
  topic: string;
  ticketCount: number;
  sampleQuestions: string[];
  suggestedTitle: string;
  suggestedOutline: string;
}

/**
 * Detect KB gaps using the same keyword-overlap algorithm as proactive.ts.
 * This is a local copy to avoid circular dependency issues.
 */
export function detectKBGapsLocal(
  tickets: Ticket[],
  _messages: Message[],
  kbArticles: KBArticle[],
): KBGap[] {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recent = tickets.filter((t) => new Date(t.createdAt).getTime() >= cutoff);
  if (recent.length === 0) return [];

  // Build a set of topics already covered by KB
  const kbTopics = new Set<string>();
  for (const article of kbArticles) {
    for (const word of article.title.toLowerCase().split(/\W+/)) {
      if (word.length > 3) kbTopics.add(word);
    }
    for (const cat of article.categoryPath) {
      kbTopics.add(cat.toLowerCase());
    }
  }

  // Group tickets by primary uncovered topic
  const topicGroups: Record<string, { tickets: Ticket[]; questions: string[] }> = {};

  for (const ticket of recent) {
    const topics = [
      ...ticket.tags,
      ...ticket.subject.toLowerCase().split(/\W+/).filter((w) => w.length > 4),
    ];

    const novelTopic = topics.find((t) => !kbTopics.has(t.toLowerCase()));
    if (novelTopic) {
      const key = novelTopic.toLowerCase();
      if (!topicGroups[key]) topicGroups[key] = { tickets: [], questions: [] };
      topicGroups[key].tickets.push(ticket);
      topicGroups[key].questions.push(ticket.subject);
    }
  }

  const gaps: KBGap[] = [];
  for (const [topic, group] of Object.entries(topicGroups)) {
    if (group.tickets.length < 2) continue;
    gaps.push({
      topic,
      ticketCount: group.tickets.length,
      sampleQuestions: group.questions.slice(0, 5),
      suggestedTitle: `How to: ${topic.charAt(0).toUpperCase() + topic.slice(1)}`,
      suggestedOutline: `Guide covering the most common questions about "${topic}" based on ${group.tickets.length} recent support tickets.`,
    });
  }

  return gaps.sort((a, b) => b.ticketCount - a.ticketCount).slice(0, 10);
}

/**
 * Analyze content gaps for a workspace and persist results to the database.
 * Returns the detected gaps.
 */
export async function analyzeContentGaps(workspaceId: string): Promise<KBGap[]> {
  const tickets = await loadTickets();
  const messages = await loadMessages();
  const articles = await loadKBArticles();

  const gaps = detectKBGapsLocal(tickets, messages, articles);

  // Persist to DB if available
  if (process.env.DATABASE_URL && gaps.length > 0) {
    try {
      const { db } = await import('@/db');
      const schema = await import('@/db/schema');
      const { eq, and } = await import('drizzle-orm');

      // Mark existing open gaps as stale before inserting new ones
      await db
        .update(schema.kbContentGaps)
        .set({ status: 'stale', updatedAt: new Date() })
        .where(
          and(
            eq(schema.kbContentGaps.workspaceId, workspaceId),
            eq(schema.kbContentGaps.status, 'open'),
          ),
        );

      // Insert new gaps
      for (const gap of gaps) {
        // Check if a gap with the same topic already exists (accepted/dismissed)
        const existing = await db
          .select({ id: schema.kbContentGaps.id, status: schema.kbContentGaps.status })
          .from(schema.kbContentGaps)
          .where(
            and(
              eq(schema.kbContentGaps.workspaceId, workspaceId),
              eq(schema.kbContentGaps.topic, gap.topic),
            ),
          )
          .limit(1);

        if (existing.length > 0 && (existing[0].status === 'accepted' || existing[0].status === 'dismissed')) {
          // Don't re-create accepted or dismissed gaps
          continue;
        }

        if (existing.length > 0) {
          // Update existing stale gap
          await db
            .update(schema.kbContentGaps)
            .set({
              ticketCount: gap.ticketCount,
              sampleTicketIds: gap.sampleQuestions,
              suggestedTitle: gap.suggestedTitle,
              suggestedOutline: gap.suggestedOutline,
              status: 'open',
              updatedAt: new Date(),
            })
            .where(eq(schema.kbContentGaps.id, existing[0].id));
        } else {
          // Insert new gap
          await db.insert(schema.kbContentGaps).values({
            workspaceId,
            topic: gap.topic,
            ticketCount: gap.ticketCount,
            sampleTicketIds: gap.sampleQuestions,
            suggestedTitle: gap.suggestedTitle,
            suggestedOutline: gap.suggestedOutline,
            status: 'open',
          });
        }
      }
    } catch {
      // DB unavailable — return in-memory results
    }
  }

  return gaps;
}

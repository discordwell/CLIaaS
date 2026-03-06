import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeGetProvider, safeLoadTickets, safeLoadKBArticles, findTicket } from '../util.js';

export function registerKBTools(server: McpServer): void {
  server.tool(
    'kb_search',
    'Search knowledge base articles by text matching',
    {
      query: z.string().describe('Search query'),
      limit: z.number().default(10).describe('Max results'),
      locale: z.string().optional().describe('Filter by locale (e.g. en, es, fr)'),
      brandId: z.string().optional().describe('Filter by brand ID'),
      visibility: z.enum(['public', 'internal', 'draft']).optional().describe('Filter by visibility'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ query, limit, locale, brandId, visibility, dir }) => {
      let articles = await safeLoadKBArticles(dir);
      if (articles.length === 0) return errorResult('No KB articles found.');

      // Apply optional filters
      if (locale) {
        articles = articles.filter(a => !a.locale || a.locale === locale);
      }
      if (brandId) {
        articles = articles.filter(a => a.brandId === brandId);
      }
      if (visibility) {
        articles = articles.filter(a => !a.visibility || a.visibility === visibility);
      }

      const lower = query.toLowerCase();
      const matches = articles
        .map(a => {
          const titleMatch = a.title.toLowerCase().includes(lower) ? 2 : 0;
          const bodyMatch = a.body.toLowerCase().includes(lower) ? 1 : 0;
          const catMatch = a.categoryPath.some(c => c.toLowerCase().includes(lower)) ? 1 : 0;
          return { article: a, score: titleMatch + bodyMatch + catMatch };
        })
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return textResult({
        total: matches.length,
        results: matches.map(m => ({
          id: m.article.id,
          externalId: m.article.externalId,
          title: m.article.title,
          categoryPath: m.article.categoryPath,
          locale: m.article.locale ?? 'en',
          visibility: m.article.visibility ?? 'public',
          score: m.score,
          snippet: m.article.body.slice(0, 300),
        })),
      });
    },
  );

  server.tool(
    'kb_suggest',
    'Suggest relevant KB articles for a ticket using LLM, optionally with RAG',
    {
      ticketId: z.string().describe('Ticket ID or external ID'),
      top: z.number().default(3).describe('Number of suggestions'),
      useRag: z.boolean().default(false).describe('Use RAG for semantic matching'),
      locale: z.string().optional().describe('Filter suggestions by locale'),
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, top, useRag, locale, dir }) => {
      const provResult = safeGetProvider();
      if ('error' in provResult) return errorResult(provResult.error);

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket not found: ${ticketId}`);

      if (useRag) {
        try {
          const { retrieve } = await import('../../rag/retriever.js');
          const results = await retrieve({
            query: ticket.subject,
            topK: top,
            sourceType: 'kb_article',
          });
          let suggestions = results.map(r => ({
            sourceId: r.chunk.sourceId,
            title: r.chunk.sourceTitle,
            score: r.combinedScore,
            snippet: r.chunk.content.slice(0, 300),
          }));
          // locale filtering not available in RAG chunks, return as-is
          return textResult({
            ticketId: ticket.id,
            source: 'rag',
            suggestions,
          });
        } catch (err) {
          return errorResult(`RAG search failed: ${err instanceof Error ? err.message : err}. Try with useRag=false.`);
        }
      }

      let articles = await safeLoadKBArticles(dir);
      if (locale) {
        articles = articles.filter(a => !a.locale || a.locale === locale);
      }
      if (articles.length === 0) return errorResult('No KB articles found.');

      try {
        const suggestions = await provResult.provider.suggestKB(ticket, articles);
        return textResult({
          ticketId: ticket.id,
          source: 'llm',
          suggestions: suggestions.slice(0, top),
        });
      } catch (err) {
        return errorResult(`KB suggest failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  // ---- kb_translate ----
  server.tool(
    'kb_translate',
    'Create a translation for a KB article',
    {
      articleId: z.string().describe('Parent article ID'),
      locale: z.string().describe('Target locale (e.g. es, fr, de)'),
      title: z.string().describe('Translated title'),
      body: z.string().describe('Translated body'),
      slug: z.string().optional().describe('URL slug for the translation'),
    },
    async ({ articleId, locale, title, body, slug }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (!conn) return errorResult('Database not available. Translations require a database.');

        const { eq, and } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        // Verify parent exists
        const [parent] = await conn.db
          .select({ id: conn.schema.kbArticles.id })
          .from(conn.schema.kbArticles)
          .where(and(
            eq(conn.schema.kbArticles.id, articleId),
            eq(conn.schema.kbArticles.workspaceId, wsId),
          ))
          .limit(1);

        if (!parent) return errorResult(`Article not found: ${articleId}`);

        const [row] = await conn.db
          .insert(conn.schema.kbArticles)
          .values({
            workspaceId: wsId,
            parentArticleId: articleId,
            locale,
            title: title.trim(),
            body: body.trim(),
            slug: slug ?? undefined,
            status: 'published',
            visibility: 'public',
            categoryPath: [],
          })
          .returning({ id: conn.schema.kbArticles.id });

        return textResult({
          created: true,
          translationId: row.id,
          parentArticleId: articleId,
          locale,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('kb_articles_translation_unique_idx')) {
          return errorResult(`A translation for locale '${locale}' already exists for this article.`);
        }
        return errorResult(`Failed to create translation: ${msg}`);
      }
    },
  );

  // ---- kb_translations ----
  server.tool(
    'kb_translations',
    'List translations for a KB article',
    {
      articleId: z.string().describe('Parent article ID'),
    },
    async ({ articleId }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (!conn) {
          // JSONL fallback
          const articles = await safeLoadKBArticles();
          const translations = articles.filter(a => a.parentArticleId === articleId);
          return textResult({
            articleId,
            total: translations.length,
            translations: translations.map(t => ({
              id: t.id,
              locale: t.locale ?? 'en',
              title: t.title,
              status: t.status ?? 'published',
            })),
          });
        }

        const { eq, and } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        const rows = await conn.db
          .select({
            id: conn.schema.kbArticles.id,
            title: conn.schema.kbArticles.title,
            locale: conn.schema.kbArticles.locale,
            status: conn.schema.kbArticles.status,
            updatedAt: conn.schema.kbArticles.updatedAt,
          })
          .from(conn.schema.kbArticles)
          .where(and(
            eq(conn.schema.kbArticles.parentArticleId, articleId),
            eq(conn.schema.kbArticles.workspaceId, wsId),
          ));

        return textResult({
          articleId,
          total: rows.length,
          translations: rows.map(r => ({
            id: r.id,
            locale: r.locale ?? 'en',
            title: r.title,
            status: r.status,
            updatedAt: r.updatedAt?.toISOString(),
          })),
        });
      } catch (err) {
        return errorResult(`Failed to list translations: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  // ---- kb_feedback_summary ----
  server.tool(
    'kb_feedback_summary',
    'Get feedback summary for a KB article (helpful/not helpful counts)',
    {
      articleId: z.string().describe('Article ID'),
    },
    async ({ articleId }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (!conn) {
          // JSONL fallback — minimal data
          const articles = await safeLoadKBArticles();
          const article = articles.find(a => a.id === articleId);
          if (!article) return errorResult(`Article not found: ${articleId}`);
          return textResult({
            articleId,
            title: article.title,
            helpfulCount: article.helpfulCount ?? 0,
            notHelpfulCount: article.notHelpfulCount ?? 0,
            viewCount: article.viewCount ?? 0,
            satisfactionRate: 0,
            recentFeedback: [],
          });
        }

        const { eq, and, desc } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        // Get article counts
        const [article] = await conn.db
          .select({
            title: conn.schema.kbArticles.title,
            helpfulCount: conn.schema.kbArticles.helpfulCount,
            notHelpfulCount: conn.schema.kbArticles.notHelpfulCount,
            viewCount: conn.schema.kbArticles.viewCount,
          })
          .from(conn.schema.kbArticles)
          .where(and(
            eq(conn.schema.kbArticles.id, articleId),
            eq(conn.schema.kbArticles.workspaceId, wsId),
          ))
          .limit(1);

        if (!article) return errorResult(`Article not found: ${articleId}`);

        const helpful = article.helpfulCount ?? 0;
        const notHelpful = article.notHelpfulCount ?? 0;
        const total = helpful + notHelpful;
        const satisfactionRate = total > 0 ? Math.round((helpful / total) * 100) : 0;

        // Get recent feedback entries
        const feedback = await conn.db
          .select({
            id: conn.schema.kbArticleFeedback.id,
            helpful: conn.schema.kbArticleFeedback.helpful,
            comment: conn.schema.kbArticleFeedback.comment,
            createdAt: conn.schema.kbArticleFeedback.createdAt,
          })
          .from(conn.schema.kbArticleFeedback)
          .where(and(
            eq(conn.schema.kbArticleFeedback.articleId, articleId),
            eq(conn.schema.kbArticleFeedback.workspaceId, wsId),
          ))
          .orderBy(desc(conn.schema.kbArticleFeedback.createdAt))
          .limit(10);

        return textResult({
          articleId,
          title: article.title,
          helpfulCount: helpful,
          notHelpfulCount: notHelpful,
          viewCount: article.viewCount ?? 0,
          satisfactionRate,
          recentFeedback: feedback.map(f => ({
            id: f.id,
            helpful: f.helpful,
            comment: f.comment,
            createdAt: f.createdAt?.toISOString(),
          })),
        });
      } catch (err) {
        return errorResult(`Failed to get feedback: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  // ---- kb_content_gaps ----
  server.tool(
    'kb_content_gaps',
    'List content gaps — topics with ticket volume but no KB coverage',
    {
      status: z.enum(['open', 'in-progress', 'resolved', 'dismissed']).optional()
        .describe('Filter by status (default: all)'),
      limit: z.number().default(20).describe('Max results'),
    },
    async ({ status, limit }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (!conn) {
          return textResult({ total: 0, gaps: [], note: 'Content gap detection requires a database.' });
        }

        const { eq, and, desc } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);

        const conditions = [eq(conn.schema.kbContentGaps.workspaceId, wsId)];
        if (status) {
          conditions.push(eq(conn.schema.kbContentGaps.status, status));
        }

        const rows = await conn.db
          .select()
          .from(conn.schema.kbContentGaps)
          .where(and(...conditions))
          .orderBy(desc(conn.schema.kbContentGaps.ticketCount))
          .limit(limit);

        return textResult({
          total: rows.length,
          gaps: rows.map(r => ({
            id: r.id,
            topic: r.topic,
            ticketCount: r.ticketCount,
            status: r.status,
            suggestedTitle: r.suggestedTitle,
            suggestedOutline: r.suggestedOutline,
            locale: r.locale ?? 'en',
            createdAt: r.createdAt?.toISOString(),
          })),
        });
      } catch (err) {
        return errorResult(`Failed to list content gaps: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  // ---- kb_deflection_stats ----
  server.tool(
    'kb_deflection_stats',
    'Get KB deflection statistics — how often articles prevent tickets',
    {
      days: z.number().default(30).describe('Look-back period in days'),
      articleId: z.string().optional().describe('Filter by specific article ID'),
    },
    async ({ days, articleId }) => {
      try {
        const { tryDb, getDefaultWorkspaceId } = await import('@/lib/store-helpers.js');
        const conn = await tryDb();

        if (!conn) {
          return textResult({
            totalViews: 0,
            totalDeflections: 0,
            deflectionRate: 0,
            note: 'Deflection tracking requires a database.',
          });
        }

        const { eq, and, gte, sql } = await import('drizzle-orm');
        const wsId = await getDefaultWorkspaceId(conn.db, conn.schema);
        const since = new Date(Date.now() - days * 86_400_000);

        const conditions = [
          eq(conn.schema.kbDeflections.workspaceId, wsId),
          gte(conn.schema.kbDeflections.createdAt, since),
        ];
        if (articleId) {
          conditions.push(eq(conn.schema.kbDeflections.articleId, articleId));
        }

        const rows = await conn.db
          .select({
            total: sql<number>`count(*)::int`,
            deflected: sql<number>`count(*) filter (where ${conn.schema.kbDeflections.deflected} = true)::int`,
          })
          .from(conn.schema.kbDeflections)
          .where(and(...conditions));

        const stats = rows[0] ?? { total: 0, deflected: 0 };
        const rate = stats.total > 0
          ? Math.round((stats.deflected / stats.total) * 100)
          : 0;

        // Top deflecting articles
        const topArticles = await conn.db
          .select({
            articleId: conn.schema.kbDeflections.articleId,
            count: sql<number>`count(*)::int`,
            deflectedCount: sql<number>`count(*) filter (where ${conn.schema.kbDeflections.deflected} = true)::int`,
          })
          .from(conn.schema.kbDeflections)
          .where(and(...conditions))
          .groupBy(conn.schema.kbDeflections.articleId)
          .orderBy(sql`count(*) desc`)
          .limit(10);

        return textResult({
          period: `${days} days`,
          totalSearches: stats.total,
          totalDeflections: stats.deflected,
          deflectionRate: rate,
          topArticles: topArticles.map(a => ({
            articleId: a.articleId,
            searches: a.count,
            deflections: a.deflectedCount,
            rate: a.count > 0 ? Math.round((a.deflectedCount / a.count) * 100) : 0,
          })),
        });
      } catch (err) {
        return errorResult(`Failed to get deflection stats: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

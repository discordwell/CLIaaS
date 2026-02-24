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
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ query, limit, dir }) => {
      const articles = await safeLoadKBArticles(dir);
      if (articles.length === 0) return errorResult('No KB articles found.');

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
      dir: z.string().optional().describe('Export directory override'),
    },
    async ({ ticketId, top, useRag, dir }) => {
      const provResult = safeGetProvider();
      if ('error' in provResult) return errorResult(provResult.error);

      const tickets = await safeLoadTickets(dir);
      const ticket = findTicket(tickets, ticketId);
      if (!ticket) return errorResult(`Ticket not found: ${ticketId}`);

      if (useRag) {
        try {
          const { retrieve, formatRetrievedContext } = await import('../../rag/retriever.js');
          const results = await retrieve({
            query: ticket.subject,
            topK: top,
            sourceType: 'kb_article',
          });
          return textResult({
            ticketId: ticket.id,
            source: 'rag',
            suggestions: results.map(r => ({
              sourceId: r.chunk.sourceId,
              title: r.chunk.sourceTitle,
              score: r.combinedScore,
              snippet: r.chunk.content.slice(0, 300),
            })),
          });
        } catch (err) {
          return errorResult(`RAG search failed: ${err instanceof Error ? err.message : err}. Try with useRag=false.`);
        }
      }

      const articles = await safeLoadKBArticles(dir);
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
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, errorResult, safeGetProvider } from '../util.js';
import { buildRagAskPrompt } from '../../providers/base.js';

export function registerRagTools(server: McpServer): void {
  server.tool(
    'rag_search',
    'Semantic search over the RAG vector store (requires pgvector database)',
    {
      query: z.string().describe('Search query'),
      topK: z.number().default(5).describe('Number of results'),
      sourceType: z.string().optional().describe('Filter by source type: kb_article, ticket_thread, external_file'),
    },
    async ({ query, topK, sourceType }) => {
      try {
        const { retrieve } = await import('../../rag/retriever.js');
        const results = await retrieve({ query, topK, sourceType });

        if (results.length === 0) return textResult({ results: [], message: 'No results found.' });

        return textResult({
          results: results.map(r => ({
            sourceTitle: r.chunk.sourceTitle,
            sourceType: r.chunk.sourceType,
            sourceId: r.chunk.sourceId,
            content: r.chunk.content,
            scores: {
              combined: r.combinedScore,
              vector: r.vectorScore,
              text: r.textScore,
            },
          })),
        });
      } catch (err) {
        return errorResult(`RAG search failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'rag_ask',
    'Ask a question and get an answer using RAG-retrieved context',
    {
      question: z.string().describe('Your question'),
      topK: z.number().default(5).describe('Number of context chunks to retrieve'),
    },
    async ({ question, topK }) => {
      const provResult = safeGetProvider();
      if ('error' in provResult) return errorResult(provResult.error);

      try {
        const { retrieve, formatRetrievedContext } = await import('../../rag/retriever.js');
        const results = await retrieve({ query: question, topK });

        if (results.length === 0) {
          return textResult({ answer: 'No relevant context found in the RAG store.', sources: [] });
        }

        const context = formatRetrievedContext(results);
        const prompt = buildRagAskPrompt(question, context);
        const answer = await provResult.provider.complete(prompt);

        return textResult({
          answer,
          sources: results.map(r => ({
            title: r.chunk.sourceTitle,
            type: r.chunk.sourceType,
            score: r.combinedScore,
          })),
        });
      } catch (err) {
        return errorResult(`RAG ask failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  server.tool(
    'rag_status',
    'Show RAG vector store statistics — chunk counts by source type',
    {},
    async () => {
      try {
        const { getRagPool } = await import('../../rag/db.js');
        const pool = getRagPool();
        if (!pool) {
          return errorResult('No RAG database configured. Set RAG_DATABASE_URL or DATABASE_URL.');
        }

        const tableCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'rag_chunks'
          ) AS exists
        `);

        if (!tableCheck.rows[0].exists) {
          return textResult({ initialized: false, message: 'RAG not initialized. Run: cliaas rag init' });
        }

        const counts = await pool.query(`
          SELECT source_type, COUNT(*) AS total,
                 COUNT(embedding) AS with_embedding
          FROM rag_chunks
          GROUP BY source_type
          ORDER BY source_type
        `);

        const totalResult = await pool.query('SELECT COUNT(*) AS total FROM rag_chunks');

        const lastJob = await pool.query(`
          SELECT source_type, status, finished_at
          FROM rag_import_jobs
          ORDER BY started_at DESC
          LIMIT 1
        `);

        return textResult({
          initialized: true,
          totalChunks: parseInt(totalResult.rows[0].total),
          bySourceType: counts.rows.map((row: Record<string, unknown>) => ({
            sourceType: row.source_type,
            total: parseInt(String(row.total)),
            withEmbedding: parseInt(String(row.with_embedding)),
          })),
          lastImport: lastJob.rows[0] ? {
            sourceType: lastJob.rows[0].source_type,
            status: lastJob.rows[0].status,
            finishedAt: lastJob.rows[0].finished_at,
          } : null,
        });
      } catch (err) {
        return errorResult(`RAG status check failed: ${err instanceof Error ? err.message : err}`);
      }
    },
  );
}

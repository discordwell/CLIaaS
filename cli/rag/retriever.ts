import { requireRagPool, getDefaultWorkspaceId } from './db.js';
import { getEmbeddingProvider, getRagConfig } from './config.js';
import type { RagChunk, RagSearchResult } from './types.js';

interface RetrieveOpts {
  query: string;
  topK?: number;
  hybridWeight?: number;
  workspaceId?: string;
  sourceType?: string;
  locale?: string;
}

/**
 * Hybrid retrieval: vector search + full-text search merged with Reciprocal Rank Fusion.
 */
export async function retrieve(opts: RetrieveOpts): Promise<RagSearchResult[]> {
  const pool = requireRagPool();
  const ragConfig = getRagConfig();
  const topK = opts.topK ?? ragConfig.topK;
  const w = opts.hybridWeight ?? ragConfig.hybridWeight;
  const k = 60; // RRF constant
  const workspaceId = opts.workspaceId ?? await getDefaultWorkspaceId();
  const fetchLimit = topK * 3; // fetch more than needed for RRF merging

  // Generate query embedding
  const provider = getEmbeddingProvider();
  const [queryEmbedding] = await provider.embed([opts.query]);
  const vecStr = `[${queryEmbedding.join(',')}]`;

  // Build parameterized queries with source type and locale filters
  const vecParams: (string | number)[] = [vecStr, workspaceId];
  let vecFilterSql = '';
  if (opts.sourceType) { vecParams.push(opts.sourceType); vecFilterSql += ` AND source_type = $${vecParams.length}`; }
  if (opts.locale) { vecParams.push(opts.locale); vecFilterSql += ` AND locale = $${vecParams.length}`; }
  vecParams.push(fetchLimit);
  const vecLimitParam = `$${vecParams.length}`;

  const textParams: (string | number)[] = [opts.query, workspaceId];
  let textFilterSql = '';
  if (opts.sourceType) { textParams.push(opts.sourceType); textFilterSql += ` AND source_type = $${textParams.length}`; }
  if (opts.locale) { textParams.push(opts.locale); textFilterSql += ` AND locale = $${textParams.length}`; }
  textParams.push(fetchLimit);
  const textLimitParam = `$${textParams.length}`;

  const vecSourceFilter = vecFilterSql;
  const textSourceFilter = textFilterSql;

  // Run vector search and full-text search in parallel
  const [vectorResults, textResults] = await Promise.all([
    pool.query(
      `SELECT id, workspace_id, source_type, source_id, source_title,
              chunk_index, content, token_count, content_hash, metadata,
              created_at, updated_at,
              1 - (embedding <=> $1::vector) AS vector_score
       FROM rag_chunks
       WHERE workspace_id = $2 AND embedding IS NOT NULL ${vecSourceFilter}
       ORDER BY embedding <=> $1::vector
       LIMIT ${vecLimitParam}`,
      vecParams,
    ),
    pool.query(
      `SELECT id, workspace_id, source_type, source_id, source_title,
              chunk_index, content, token_count, content_hash, metadata,
              created_at, updated_at,
              ts_rank_cd(search_vector, plainto_tsquery('english', $1)) AS text_score
       FROM rag_chunks
       WHERE workspace_id = $2 AND search_vector @@ plainto_tsquery('english', $1)
             ${textSourceFilter}
       ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', $1)) DESC
       LIMIT ${textLimitParam}`,
      textParams,
    ),
  ]);

  // Build rank maps
  const vectorRanks = new Map<string, { rank: number; score: number; row: RagChunk }>();
  vectorResults.rows.forEach((row: Record<string, unknown>, i: number) => {
    const chunk = rowToChunk(row);
    vectorRanks.set(chunk.id, { rank: i + 1, score: row.vector_score as number, row: chunk });
  });

  const textRanks = new Map<string, { rank: number; score: number }>();
  textResults.rows.forEach((row: Record<string, unknown>, i: number) => {
    textRanks.set(row.id as string, { rank: i + 1, score: row.text_score as number });
  });

  // Merge all unique chunk IDs
  const allIds = new Set([...vectorRanks.keys(), ...textRanks.keys()]);
  const scored: RagSearchResult[] = [];

  for (const id of allIds) {
    const vr = vectorRanks.get(id);
    const tr = textRanks.get(id);

    const vRank = vr ? vr.rank : fetchLimit + 1;
    const tRank = tr ? tr.rank : fetchLimit + 1;

    const combinedScore = w * (1 / (k + vRank)) + (1 - w) * (1 / (k + tRank));

    // If we only have text results for this id, we need to fetch the chunk
    let chunk: RagChunk;
    if (vr) {
      chunk = vr.row;
    } else {
      // Fetch from text results
      const textRow = textResults.rows.find((r: Record<string, unknown>) => r.id === id);
      chunk = rowToChunk(textRow!);
    }

    scored.push({
      chunk,
      vectorScore: vr?.score ?? 0,
      textScore: tr?.score ?? 0,
      combinedScore,
    });
  }

  // Sort by combined score descending
  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  // Deduplicate: keep highest scorer per source document
  const seenSources = new Map<string, RagSearchResult>();
  const deduped: RagSearchResult[] = [];

  for (const result of scored) {
    const key = `${result.chunk.sourceType}:${result.chunk.sourceId}`;
    if (!seenSources.has(key)) {
      seenSources.set(key, result);
      deduped.push(result);
    }
    if (deduped.length >= topK) break;
  }

  return deduped;
}

/**
 * Format retrieved results as labeled markdown sections for LLM prompts.
 */
export function formatRetrievedContext(results: RagSearchResult[]): string {
  if (results.length === 0) return '';

  const sections = results.map((r, i) => {
    const score = (r.combinedScore * 1000).toFixed(1);
    return `### Source ${i + 1}: ${r.chunk.sourceTitle} [score: ${score}]
Type: ${r.chunk.sourceType}

${r.chunk.content}`;
  });

  return `## Retrieved Context

${sections.join('\n\n---\n\n')}`;
}

function rowToChunk(row: Record<string, unknown>): RagChunk {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    sourceType: row.source_type as RagChunk['sourceType'],
    sourceId: row.source_id as string,
    sourceTitle: row.source_title as string,
    chunkIndex: row.chunk_index as number,
    content: row.content as string,
    tokenCount: row.token_count as number,
    contentHash: row.content_hash as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

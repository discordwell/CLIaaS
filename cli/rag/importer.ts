import { createHash } from 'crypto';
import { readFileSync, statSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { getPool } from '../../src/db/index.js';
import { loadKBArticles, loadTickets, loadMessages, getTicketMessages } from '../data.js';
import { chunkKBArticle, chunkTicketThread, chunkMarkdownFile } from './chunker.js';
import { getEmbeddingProvider, getRagConfig } from './config.js';
import type { RagImportStats, TextChunk, ChunkSourceType } from './types.js';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function requirePool() {
  const pool = getPool();
  if (!pool) throw new Error('DATABASE_URL is not set. RAG requires a PostgreSQL database.');
  return pool;
}

async function getDefaultWorkspaceId(): Promise<string> {
  const pool = requirePool();
  const result = await pool.query('SELECT id FROM workspaces LIMIT 1');
  if (result.rows.length === 0) {
    throw new Error('No workspace found. Run "cliaas db seed" or create a workspace first.');
  }
  return result.rows[0].id;
}

interface UpsertChunkInput {
  workspaceId: string;
  sourceType: ChunkSourceType;
  sourceId: string;
  sourceTitle: string;
  chunk: TextChunk;
}

/**
 * Upsert chunks: skip if contentHash matches, insert/update otherwise.
 * Returns { newChunks, skippedChunks, textsToEmbed, chunkIdsToEmbed }
 */
async function upsertChunks(inputs: UpsertChunkInput[]) {
  const pool = requirePool();
  let newChunks = 0;
  let skippedChunks = 0;
  const textsToEmbed: string[] = [];
  const chunkIdsToEmbed: string[] = [];

  for (const input of inputs) {
    const hash = sha256(input.chunk.content);

    // Check for existing chunk with same dedup key
    const existing = await pool.query(
      `SELECT id, content_hash FROM rag_chunks
       WHERE workspace_id = $1 AND source_id = $2 AND chunk_index = $3`,
      [input.workspaceId, input.sourceId, input.chunk.chunkIndex],
    );

    if (existing.rows.length > 0 && existing.rows[0].content_hash === hash) {
      // Content unchanged, skip re-embedding
      skippedChunks++;
      continue;
    }

    let chunkId: string;
    if (existing.rows.length > 0) {
      // Update existing chunk
      chunkId = existing.rows[0].id;
      await pool.query(
        `UPDATE rag_chunks SET content = $1, token_count = $2, content_hash = $3,
         source_title = $4, metadata = $5, embedding = NULL, updated_at = NOW()
         WHERE id = $6`,
        [input.chunk.content, input.chunk.tokenCount, hash, input.sourceTitle, '{}', chunkId],
      );
    } else {
      // Insert new chunk
      const result = await pool.query(
        `INSERT INTO rag_chunks (workspace_id, source_type, source_id, source_title,
         chunk_index, content, token_count, content_hash, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          input.workspaceId,
          input.sourceType,
          input.sourceId,
          input.sourceTitle,
          input.chunk.chunkIndex,
          input.chunk.content,
          input.chunk.tokenCount,
          hash,
          '{}',
        ],
      );
      chunkId = result.rows[0].id;
    }

    newChunks++;
    textsToEmbed.push(input.chunk.content);
    chunkIdsToEmbed.push(chunkId);
  }

  return { newChunks, skippedChunks, textsToEmbed, chunkIdsToEmbed };
}

/**
 * Batch-embed texts and store embeddings.
 */
async function embedAndStore(texts: string[], chunkIds: string[]): Promise<number> {
  if (texts.length === 0) return 0;

  const pool = requirePool();
  const provider = getEmbeddingProvider();
  const embeddings = await provider.embed(texts);

  for (let i = 0; i < chunkIds.length; i++) {
    const vecStr = `[${embeddings[i].join(',')}]`;
    await pool.query(
      'UPDATE rag_chunks SET embedding = $1::vector WHERE id = $2',
      [vecStr, chunkIds[i]],
    );
  }

  return embeddings.length;
}

async function recordJob(
  workspaceId: string,
  sourceType: ChunkSourceType,
  stats: RagImportStats,
  error?: string,
) {
  const pool = requirePool();
  await pool.query(
    `INSERT INTO rag_import_jobs (workspace_id, source_type, status, total_sources,
     total_chunks, new_chunks, skipped_chunks, error, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      workspaceId,
      sourceType,
      error ? 'error' : 'success',
      stats.totalSources,
      stats.totalChunks,
      stats.newChunks,
      stats.skippedChunks,
      error ?? null,
    ],
  );
}

/**
 * Import all KB articles into the vector store.
 */
export async function importKBArticles(dir?: string): Promise<RagImportStats> {
  const start = Date.now();
  const articles = loadKBArticles(dir);
  const workspaceId = await getDefaultWorkspaceId();
  const ragConfig = getRagConfig();

  const allInputs: UpsertChunkInput[] = [];
  for (const article of articles) {
    const chunks = chunkKBArticle(article.title, article.body, {
      chunkSize: ragConfig.chunkSize,
      chunkOverlap: ragConfig.chunkOverlap,
    });
    for (const chunk of chunks) {
      allInputs.push({
        workspaceId,
        sourceType: 'kb_article',
        sourceId: article.id,
        sourceTitle: article.title,
        chunk,
      });
    }
  }

  const { newChunks, skippedChunks, textsToEmbed, chunkIdsToEmbed } =
    await upsertChunks(allInputs);

  const embeddingsGenerated = await embedAndStore(textsToEmbed, chunkIdsToEmbed);

  const stats: RagImportStats = {
    sourceType: 'kb_article',
    totalSources: articles.length,
    totalChunks: allInputs.length,
    newChunks,
    skippedChunks,
    embeddingsGenerated,
    durationMs: Date.now() - start,
  };

  await recordJob(workspaceId, 'kb_article', stats);
  return stats;
}

/**
 * Import ticket threads into the vector store.
 */
export async function importTickets(
  dir?: string,
  statusFilter?: string,
): Promise<RagImportStats> {
  const start = Date.now();
  let tickets = loadTickets(dir);
  const allMessages = loadMessages(dir);
  const workspaceId = await getDefaultWorkspaceId();
  const ragConfig = getRagConfig();

  if (statusFilter) {
    tickets = tickets.filter(t => t.status === statusFilter);
  }

  const allInputs: UpsertChunkInput[] = [];
  for (const ticket of tickets) {
    const msgs = getTicketMessages(ticket.id, allMessages);
    if (msgs.length === 0) continue;

    const chunks = chunkTicketThread(ticket.subject, msgs, {
      chunkSize: ragConfig.chunkSize,
      chunkOverlap: ragConfig.chunkOverlap,
    });
    for (const chunk of chunks) {
      allInputs.push({
        workspaceId,
        sourceType: 'ticket_thread',
        sourceId: ticket.id,
        sourceTitle: ticket.subject,
        chunk,
      });
    }
  }

  const { newChunks, skippedChunks, textsToEmbed, chunkIdsToEmbed } =
    await upsertChunks(allInputs);

  const embeddingsGenerated = await embedAndStore(textsToEmbed, chunkIdsToEmbed);

  const stats: RagImportStats = {
    sourceType: 'ticket_thread',
    totalSources: tickets.length,
    totalChunks: allInputs.length,
    newChunks,
    skippedChunks,
    embeddingsGenerated,
    durationMs: Date.now() - start,
  };

  await recordJob(workspaceId, 'ticket_thread', stats);
  return stats;
}

/**
 * Import a markdown/text file or directory into the vector store.
 */
export async function importFile(filePath: string): Promise<RagImportStats> {
  const start = Date.now();
  const workspaceId = await getDefaultWorkspaceId();
  const ragConfig = getRagConfig();

  const files = collectFiles(filePath);
  const allInputs: UpsertChunkInput[] = [];

  for (const fp of files) {
    const content = readFileSync(fp, 'utf-8');
    const chunks = chunkMarkdownFile(content, fp, {
      chunkSize: ragConfig.chunkSize,
      chunkOverlap: ragConfig.chunkOverlap,
    });
    for (const chunk of chunks) {
      allInputs.push({
        workspaceId,
        sourceType: 'external_file',
        sourceId: fp,
        sourceTitle: fp,
        chunk,
      });
    }
  }

  const { newChunks, skippedChunks, textsToEmbed, chunkIdsToEmbed } =
    await upsertChunks(allInputs);

  const embeddingsGenerated = await embedAndStore(textsToEmbed, chunkIdsToEmbed);

  const stats: RagImportStats = {
    sourceType: 'external_file',
    totalSources: files.length,
    totalChunks: allInputs.length,
    newChunks,
    skippedChunks,
    embeddingsGenerated,
    durationMs: Date.now() - start,
  };

  await recordJob(workspaceId, 'external_file', stats);
  return stats;
}

/** Recursively collect .md and .txt files from a path */
function collectFiles(filePath: string): string[] {
  const stat = statSync(filePath);
  if (stat.isFile()) {
    const ext = extname(filePath).toLowerCase();
    if (ext === '.md' || ext === '.txt') return [filePath];
    throw new Error(`Unsupported file type: ${ext}. Only .md and .txt files are supported.`);
  }
  if (stat.isDirectory()) {
    const files: string[] = [];
    for (const entry of readdirSync(filePath, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(filePath, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectFiles(fullPath));
      } else {
        const ext = extname(entry.name).toLowerCase();
        if (ext === '.md' || ext === '.txt') files.push(fullPath);
      }
    }
    return files;
  }
  return [];
}

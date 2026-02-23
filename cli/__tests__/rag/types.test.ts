import { describe, it, expect } from 'vitest';
import type {
  ChunkSourceType,
  TextChunk,
  RagChunk,
  RagSearchResult,
  RagImportStats,
  EmbeddingProvider,
  RagConfig,
} from '../../rag/types.js';

// ── Type validation tests ────────────────────────────────────────────────────
// These tests verify runtime behavior of objects conforming to the type contracts.
// TypeScript types are erased at runtime, so we test the shapes we expect.

describe('RAG type contracts', () => {
  describe('ChunkSourceType', () => {
    it('accepts valid source types', () => {
      const types: ChunkSourceType[] = ['kb_article', 'ticket_thread', 'external_file'];
      expect(types).toHaveLength(3);
      expect(types).toContain('kb_article');
      expect(types).toContain('ticket_thread');
      expect(types).toContain('external_file');
    });
  });

  describe('TextChunk', () => {
    it('has required fields', () => {
      const chunk: TextChunk = {
        content: 'Test content',
        tokenCount: 3,
        chunkIndex: 0,
      };
      expect(chunk.content).toBe('Test content');
      expect(chunk.tokenCount).toBe(3);
      expect(chunk.chunkIndex).toBe(0);
    });
  });

  describe('RagChunk', () => {
    it('has all required fields', () => {
      const chunk: RagChunk = {
        id: 'chunk-uuid',
        workspaceId: 'ws-uuid',
        sourceType: 'kb_article',
        sourceId: 'article-uuid',
        sourceTitle: 'My Article',
        chunkIndex: 0,
        content: 'Some content',
        tokenCount: 10,
        contentHash: 'a'.repeat(64),
        metadata: {},
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(chunk.id).toBeTruthy();
      expect(chunk.workspaceId).toBeTruthy();
      expect(chunk.sourceType).toBe('kb_article');
      expect(chunk.contentHash).toHaveLength(64);
    });

    it('embedding field is optional', () => {
      const withEmbedding: RagChunk = {
        id: 'c1',
        workspaceId: 'ws',
        sourceType: 'kb_article',
        sourceId: 's1',
        sourceTitle: 'Title',
        chunkIndex: 0,
        content: 'text',
        tokenCount: 1,
        contentHash: 'x'.repeat(64),
        metadata: {},
        embedding: [0.1, 0.2, 0.3],
        createdAt: '',
        updatedAt: '',
      };

      const withoutEmbedding: RagChunk = {
        id: 'c2',
        workspaceId: 'ws',
        sourceType: 'ticket_thread',
        sourceId: 's2',
        sourceTitle: 'Title',
        chunkIndex: 0,
        content: 'text',
        tokenCount: 1,
        contentHash: 'y'.repeat(64),
        metadata: {},
        createdAt: '',
        updatedAt: '',
      };

      expect(withEmbedding.embedding).toHaveLength(3);
      expect(withoutEmbedding.embedding).toBeUndefined();
    });
  });

  describe('RagSearchResult', () => {
    it('contains chunk and all score fields', () => {
      const result: RagSearchResult = {
        chunk: {
          id: 'c1',
          workspaceId: 'ws',
          sourceType: 'kb_article',
          sourceId: 's1',
          sourceTitle: 'Title',
          chunkIndex: 0,
          content: 'text',
          tokenCount: 1,
          contentHash: 'z'.repeat(64),
          metadata: {},
          createdAt: '',
          updatedAt: '',
        },
        vectorScore: 0.85,
        textScore: 0.72,
        combinedScore: 0.0115,
      };

      expect(result.vectorScore).toBeGreaterThan(0);
      expect(result.textScore).toBeGreaterThan(0);
      expect(result.combinedScore).toBeGreaterThan(0);
      expect(result.chunk).toBeDefined();
    });
  });

  describe('RagImportStats', () => {
    it('has all tracking fields', () => {
      const stats: RagImportStats = {
        sourceType: 'kb_article',
        totalSources: 50,
        totalChunks: 200,
        newChunks: 150,
        skippedChunks: 50,
        embeddingsGenerated: 150,
        durationMs: 3500,
      };

      expect(stats.totalChunks).toBe(stats.newChunks + stats.skippedChunks);
      expect(stats.embeddingsGenerated).toBe(stats.newChunks);
      expect(stats.durationMs).toBeGreaterThan(0);
    });
  });

  describe('EmbeddingProvider interface', () => {
    it('can be implemented', () => {
      const provider: EmbeddingProvider = {
        embed: async (texts: string[]) => texts.map(() => [0.1, 0.2]),
        dimensions: 1536,
        model: 'text-embedding-3-small',
      };

      expect(provider.dimensions).toBe(1536);
      expect(provider.model).toBe('text-embedding-3-small');
    });

    it('mock provider returns correct dimensions', async () => {
      const provider: EmbeddingProvider = {
        embed: async (texts: string[]) =>
          texts.map(() => Array.from({ length: 1536 }, () => Math.random())),
        dimensions: 1536,
        model: 'mock',
      };

      const results = await provider.embed(['test']);
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(1536);
    });
  });

  describe('RagConfig', () => {
    it('has all configuration fields', () => {
      const config: RagConfig = {
        chunkSize: 400,
        chunkOverlap: 60,
        topK: 5,
        hybridWeight: 0.7,
        embeddingModel: 'text-embedding-3-small',
      };

      expect(config.chunkSize).toBeGreaterThan(0);
      expect(config.chunkOverlap).toBeGreaterThanOrEqual(0);
      expect(config.chunkOverlap).toBeLessThan(config.chunkSize);
      expect(config.topK).toBeGreaterThan(0);
      expect(config.hybridWeight).toBeGreaterThanOrEqual(0);
      expect(config.hybridWeight).toBeLessThanOrEqual(1);
    });
  });
});

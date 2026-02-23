import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateTokenCount, OpenAIEmbeddingProvider } from '../../rag/embedding.js';

// ── estimateTokenCount ───────────────────────────────────────────────────────

describe('estimateTokenCount', () => {
  it('returns 0 for empty string', () => {
    // Math.ceil(0/4) = 0
    expect(estimateTokenCount('')).toBe(0);
  });

  it('returns 1 for very short strings', () => {
    expect(estimateTokenCount('Hi')).toBe(1); // ceil(2/4) = 1
  });

  it('returns approximately 1 token per 4 characters', () => {
    expect(estimateTokenCount('1234')).toBe(1);
    expect(estimateTokenCount('12345')).toBe(2);
    expect(estimateTokenCount('12345678')).toBe(2);
    expect(estimateTokenCount('123456789')).toBe(3);
  });

  it('handles 100-char string correctly', () => {
    const text = 'A'.repeat(100);
    expect(estimateTokenCount(text)).toBe(25);
  });

  it('handles 1000-char string correctly', () => {
    const text = 'B'.repeat(1000);
    expect(estimateTokenCount(text)).toBe(250);
  });

  it('handles unicode characters (counts by char, not byte)', () => {
    // Unicode chars are still counted as individual characters in JS strings
    const text = '日本語'; // 3 characters
    expect(estimateTokenCount(text)).toBe(1); // ceil(3/4) = 1
  });

  it('handles emoji correctly', () => {
    // Emoji can be 1-2 chars in JS string representation
    const text = '🎉🚀🎯'; // 6 chars (each emoji is 2 char codes)
    expect(estimateTokenCount(text)).toBe(2); // ceil(6/4) = 2
  });
});

// ── OpenAIEmbeddingProvider ──────────────────────────────────────────────────

describe('OpenAIEmbeddingProvider', () => {
  let provider: OpenAIEmbeddingProvider;

  beforeEach(() => {
    provider = new OpenAIEmbeddingProvider('test-api-key');
  });

  it('has correct default dimensions', () => {
    expect(provider.dimensions).toBe(1536);
  });

  it('has correct default model', () => {
    expect(provider.model).toBe('text-embedding-3-small');
  });

  it('accepts custom model', () => {
    const custom = new OpenAIEmbeddingProvider('key', 'text-embedding-3-large');
    expect(custom.model).toBe('text-embedding-3-large');
  });

  it('returns empty array for empty input', async () => {
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it('calls OpenAI API with correct parameters', async () => {
    const mockEmbedding = Array.from({ length: 1536 }, () => Math.random());
    const mockCreate = vi.fn().mockResolvedValue({
      data: [{ index: 0, embedding: mockEmbedding }],
    });

    // Access private client to mock
    (provider as unknown as { client: { embeddings: { create: typeof mockCreate } } }).client = {
      embeddings: { create: mockCreate },
    } as unknown as typeof provider['client' & keyof typeof provider];

    const result = await provider.embed(['test text']);

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['test text'],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockEmbedding);
  });

  it('handles multiple texts in a single batch', async () => {
    const mockEmbeddings = Array.from({ length: 3 }, () =>
      Array.from({ length: 1536 }, () => Math.random()),
    );
    const mockCreate = vi.fn().mockResolvedValue({
      data: mockEmbeddings.map((embedding, index) => ({ index, embedding })),
    });

    (provider as unknown as { client: { embeddings: { create: typeof mockCreate } } }).client = {
      embeddings: { create: mockCreate },
    } as unknown as typeof provider['client' & keyof typeof provider];

    const result = await provider.embed(['text 1', 'text 2', 'text 3']);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(3);
  });

  it('correctly maps embeddings by index (handles out-of-order responses)', async () => {
    const emb0 = Array.from({ length: 1536 }, () => 0.1);
    const emb1 = Array.from({ length: 1536 }, () => 0.2);
    const emb2 = Array.from({ length: 1536 }, () => 0.3);

    // Return indices in reversed order to test index mapping
    const mockCreate = vi.fn().mockResolvedValue({
      data: [
        { index: 2, embedding: emb2 },
        { index: 0, embedding: emb0 },
        { index: 1, embedding: emb1 },
      ],
    });

    (provider as unknown as { client: { embeddings: { create: typeof mockCreate } } }).client = {
      embeddings: { create: mockCreate },
    } as unknown as typeof provider['client' & keyof typeof provider];

    const result = await provider.embed(['a', 'b', 'c']);

    expect(result[0]).toBe(emb0);
    expect(result[1]).toBe(emb1);
    expect(result[2]).toBe(emb2);
  });

  it('batches requests when exceeding 100 texts', async () => {
    const texts = Array.from({ length: 150 }, (_, i) => `text ${i}`);
    const mockEmb = Array.from({ length: 1536 }, () => 0.5);

    const mockCreate = vi.fn().mockImplementation(({ input }: { input: string[] }) => ({
      data: input.map((_: string, index: number) => ({ index, embedding: mockEmb })),
    }));

    (provider as unknown as { client: { embeddings: { create: typeof mockCreate } } }).client = {
      embeddings: { create: mockCreate },
    } as unknown as typeof provider['client' & keyof typeof provider];

    const result = await provider.embed(texts);

    // Should call API twice: batch of 100 + batch of 50
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0].input).toHaveLength(100);
    expect(mockCreate.mock.calls[1][0].input).toHaveLength(50);
    expect(result).toHaveLength(150);
  });

  it('propagates API errors', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('API rate limit exceeded'));

    (provider as unknown as { client: { embeddings: { create: typeof mockCreate } } }).client = {
      embeddings: { create: mockCreate },
    } as unknown as typeof provider['client' & keyof typeof provider];

    await expect(provider.embed(['test'])).rejects.toThrow('API rate limit exceeded');
  });
});

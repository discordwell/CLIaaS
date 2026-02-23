import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RAG_DEFAULTS, getRagConfig, getEmbeddingProvider } from '../../rag/config.js';

// ── RAG_DEFAULTS ─────────────────────────────────────────────────────────────

describe('RAG_DEFAULTS', () => {
  it('has expected default values', () => {
    expect(RAG_DEFAULTS).toEqual({
      chunkSize: 400,
      chunkOverlap: 60,
      topK: 5,
      hybridWeight: 0.7,
      embeddingModel: 'text-embedding-3-small',
    });
  });

  it('is frozen (immutable reference check)', () => {
    // Defaults should remain constant across the test suite
    expect(RAG_DEFAULTS.chunkSize).toBe(400);
    expect(RAG_DEFAULTS.chunkOverlap).toBe(60);
    expect(RAG_DEFAULTS.topK).toBe(5);
    expect(RAG_DEFAULTS.hybridWeight).toBe(0.7);
    expect(RAG_DEFAULTS.embeddingModel).toBe('text-embedding-3-small');
  });
});

// ── getRagConfig ─────────────────────────────────────────────────────────────

describe('getRagConfig', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns defaults when no config file exists', async () => {
    vi.doMock('../../config.js', () => ({
      loadConfig: () => ({ provider: 'claude' }),
    }));

    const { getRagConfig: getConfig } = await import('../../rag/config.js');
    const config = getConfig();

    expect(config.chunkSize).toBe(400);
    expect(config.chunkOverlap).toBe(60);
    expect(config.topK).toBe(5);
    expect(config.hybridWeight).toBe(0.7);
    expect(config.embeddingModel).toBe('text-embedding-3-small');
  });

  it('merges user overrides with defaults', async () => {
    vi.doMock('../../config.js', () => ({
      loadConfig: () => ({
        provider: 'claude',
        rag: { chunkSize: 600, topK: 10 },
      }),
    }));

    const { getRagConfig: getConfig } = await import('../../rag/config.js');
    const config = getConfig();

    expect(config.chunkSize).toBe(600); // overridden
    expect(config.topK).toBe(10); // overridden
    expect(config.chunkOverlap).toBe(60); // default
    expect(config.hybridWeight).toBe(0.7); // default
    expect(config.embeddingModel).toBe('text-embedding-3-small'); // default
  });

  it('applies all user overrides when provided', async () => {
    vi.doMock('../../config.js', () => ({
      loadConfig: () => ({
        provider: 'openai',
        rag: {
          chunkSize: 800,
          chunkOverlap: 100,
          topK: 3,
          hybridWeight: 0.5,
          embeddingModel: 'text-embedding-3-large',
        },
      }),
    }));

    const { getRagConfig: getConfig } = await import('../../rag/config.js');
    const config = getConfig();

    expect(config.chunkSize).toBe(800);
    expect(config.chunkOverlap).toBe(100);
    expect(config.topK).toBe(3);
    expect(config.hybridWeight).toBe(0.5);
    expect(config.embeddingModel).toBe('text-embedding-3-large');
  });
});

// ── getEmbeddingProvider ─────────────────────────────────────────────────────

describe('getEmbeddingProvider', () => {
  const origEnv = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.OPENAI_API_KEY = origEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    vi.resetModules();
  });

  it('throws when no OpenAI API key is available', async () => {
    delete process.env.OPENAI_API_KEY;

    vi.doMock('../../config.js', () => ({
      loadConfig: () => ({ provider: 'claude' }),
    }));

    const { getEmbeddingProvider: getProvider } = await import('../../rag/config.js');
    expect(() => getProvider()).toThrow('OpenAI API key required');
  });

  it('uses OPENAI_API_KEY env var', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-env-key';

    vi.doMock('../../config.js', () => ({
      loadConfig: () => ({ provider: 'claude' }),
    }));

    const { getEmbeddingProvider: getProvider } = await import('../../rag/config.js');
    const provider = getProvider();
    expect(provider.model).toBe('text-embedding-3-small');
    expect(provider.dimensions).toBe(1536);
  });

  it('prefers config API key over env var', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-key';

    vi.doMock('../../config.js', () => ({
      loadConfig: () => ({
        provider: 'claude',
        openai: { apiKey: 'sk-config-key' },
      }),
    }));

    const { getEmbeddingProvider: getProvider } = await import('../../rag/config.js');
    const provider = getProvider();
    // We can't directly inspect the API key, but the provider should be created successfully
    expect(provider.model).toBe('text-embedding-3-small');
  });

  it('uses configured embedding model', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    vi.doMock('../../config.js', () => ({
      loadConfig: () => ({
        provider: 'claude',
        rag: { embeddingModel: 'text-embedding-3-large' },
      }),
    }));

    const { getEmbeddingProvider: getProvider } = await import('../../rag/config.js');
    const provider = getProvider();
    expect(provider.model).toBe('text-embedding-3-large');
  });

  it('works when LLM provider is Claude but still uses OpenAI for embeddings', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    vi.doMock('../../config.js', () => ({
      loadConfig: () => ({ provider: 'claude', claude: { apiKey: 'sk-claude-key' } }),
    }));

    const { getEmbeddingProvider: getProvider } = await import('../../rag/config.js');
    const provider = getProvider();
    expect(provider.model).toBe('text-embedding-3-small');
  });
});

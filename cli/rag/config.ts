import { loadConfig } from '../config.js';
import type { RagConfig, EmbeddingProvider } from './types.js';
import { OpenAIEmbeddingProvider } from './embedding.js';

export const RAG_DEFAULTS: RagConfig = {
  chunkSize: 400,
  chunkOverlap: 60,
  topK: 5,
  hybridWeight: 0.7,
  embeddingModel: 'text-embedding-3-small',
};

export function getRagConfig(): RagConfig {
  const config = loadConfig();
  const rag = config.rag;
  return {
    chunkSize: rag?.chunkSize ?? RAG_DEFAULTS.chunkSize,
    chunkOverlap: rag?.chunkOverlap ?? RAG_DEFAULTS.chunkOverlap,
    topK: rag?.topK ?? RAG_DEFAULTS.topK,
    hybridWeight: rag?.hybridWeight ?? RAG_DEFAULTS.hybridWeight,
    embeddingModel: rag?.embeddingModel ?? RAG_DEFAULTS.embeddingModel,
  };
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const config = loadConfig();
  const ragConfig = getRagConfig();

  // Always use OpenAI for embeddings regardless of LLM provider setting
  const apiKey = config.openai?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OpenAI API key required for embeddings. Set OPENAI_API_KEY or run: cliaas config set-key openai <key>',
    );
  }

  return new OpenAIEmbeddingProvider(apiKey, ragConfig.embeddingModel);
}

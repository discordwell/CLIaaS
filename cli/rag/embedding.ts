import OpenAI from 'openai';
import type { EmbeddingProvider } from './types.js';

const BATCH_SIZE = 100;
const RATE_LIMIT_DELAY_MS = 200;

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  readonly dimensions = 1536;
  readonly model: string;

  constructor(apiKey: string, model = 'text-embedding-3-small') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = new Array(texts.length);
    const batches = Math.ceil(texts.length / BATCH_SIZE);

    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, texts.length);
      const batch = texts.slice(start, end);

      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
      });

      for (const item of response.data) {
        results[start + item.index] = item.embedding;
      }

      // Rate limiting between batches
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    return results;
  }
}

/** Heuristic token count: ~4 chars per token */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

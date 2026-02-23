export type ChunkSourceType = 'kb_article' | 'ticket_thread' | 'external_file';

export interface TextChunk {
  content: string;
  tokenCount: number;
  chunkIndex: number;
}

export interface RagChunk {
  id: string;
  workspaceId: string;
  sourceType: ChunkSourceType;
  sourceId: string;
  sourceTitle: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  contentHash: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface RagSearchResult {
  chunk: RagChunk;
  vectorScore: number;
  textScore: number;
  combinedScore: number;
}

export interface RagImportStats {
  sourceType: ChunkSourceType;
  totalSources: number;
  totalChunks: number;
  newChunks: number;
  skippedChunks: number;
  embeddingsGenerated: number;
  durationMs: number;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
  model: string;
}

export interface RagConfig {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  hybridWeight: number;
  embeddingModel: string;
}

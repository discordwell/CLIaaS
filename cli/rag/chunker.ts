import type { TextChunk } from './types.js';
import { estimateTokenCount } from './embedding.js';
import { RAG_DEFAULTS } from './config.js';

/**
 * Split text into chunks of ~chunkSize tokens with overlap.
 * Splits on paragraph boundaries first, then sentences if needed.
 */
export function chunkText(
  text: string,
  opts?: { chunkSize?: number; chunkOverlap?: number },
): TextChunk[] {
  const chunkSize = opts?.chunkSize ?? RAG_DEFAULTS.chunkSize;
  const chunkOverlap = opts?.chunkOverlap ?? RAG_DEFAULTS.chunkOverlap;

  if (!text.trim()) return [];

  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  const chunks: TextChunk[] = [];
  let buffer = '';
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    const combined = buffer ? `${buffer}\n\n${trimmed}` : trimmed;

    if (estimateTokenCount(combined) > chunkSize && buffer) {
      // Emit current buffer as a chunk
      chunks.push({
        content: buffer.trim(),
        tokenCount: estimateTokenCount(buffer.trim()),
        chunkIndex: chunkIndex++,
      });

      // Start new buffer with overlap from end of previous
      const overlapText = getOverlapText(buffer, chunkOverlap);
      buffer = overlapText ? `${overlapText}\n\n${trimmed}` : trimmed;
    } else {
      buffer = combined;
    }
  }

  // Emit remaining buffer
  if (buffer.trim()) {
    chunks.push({
      content: buffer.trim(),
      tokenCount: estimateTokenCount(buffer.trim()),
      chunkIndex: chunkIndex++,
    });
  }

  return chunks;
}

/**
 * Chunk a KB article, prepending the title as context prefix to each chunk.
 */
export function chunkKBArticle(
  title: string,
  body: string,
  opts?: { chunkSize?: number; chunkOverlap?: number },
): TextChunk[] {
  const prefix = `[KB Article: ${title}]\n\n`;
  const prefixTokens = estimateTokenCount(prefix);
  const effectiveChunkSize = (opts?.chunkSize ?? RAG_DEFAULTS.chunkSize) - prefixTokens;

  const rawChunks = chunkText(body, {
    chunkSize: Math.max(effectiveChunkSize, 100),
    chunkOverlap: opts?.chunkOverlap,
  });

  return rawChunks.map(c => ({
    content: `${prefix}${c.content}`,
    tokenCount: c.tokenCount + prefixTokens,
    chunkIndex: c.chunkIndex,
  }));
}

/**
 * Chunk a ticket thread by grouping Q+A pairs (customer message + agent reply).
 */
export function chunkTicketThread(
  subject: string,
  messages: Array<{ author: string; body: string; type: string }>,
  opts?: { chunkSize?: number; chunkOverlap?: number },
): TextChunk[] {
  const prefix = `[Ticket: ${subject}]\n\n`;
  const prefixTokens = estimateTokenCount(prefix);
  const chunkSize = (opts?.chunkSize ?? RAG_DEFAULTS.chunkSize) - prefixTokens;
  const chunks: TextChunk[] = [];
  let buffer = '';
  let chunkIndex = 0;

  for (const msg of messages) {
    const line = `[${msg.type.toUpperCase()}] ${msg.author}:\n${msg.body}`;
    const combined = buffer ? `${buffer}\n\n---\n\n${line}` : line;

    if (estimateTokenCount(combined) > chunkSize && buffer) {
      chunks.push({
        content: `${prefix}${buffer.trim()}`,
        tokenCount: estimateTokenCount(buffer.trim()) + prefixTokens,
        chunkIndex: chunkIndex++,
      });
      buffer = line;
    } else {
      buffer = combined;
    }
  }

  if (buffer.trim()) {
    chunks.push({
      content: `${prefix}${buffer.trim()}`,
      tokenCount: estimateTokenCount(buffer.trim()) + prefixTokens,
      chunkIndex: chunkIndex++,
    });
  }

  return chunks;
}

/**
 * Chunk a markdown file by splitting on ## headers.
 */
export function chunkMarkdownFile(
  content: string,
  filePath: string,
  opts?: { chunkSize?: number; chunkOverlap?: number },
): TextChunk[] {
  const prefix = `[File: ${filePath}]\n\n`;
  const prefixTokens = estimateTokenCount(prefix);
  const effectiveChunkSize = (opts?.chunkSize ?? RAG_DEFAULTS.chunkSize) - prefixTokens;

  // Split on ## headers, keeping the header with its content
  const sections = content.split(/(?=^##\s)/m).filter(s => s.trim());

  if (sections.length <= 1) {
    // No headers found, fall back to paragraph chunking
    const rawChunks = chunkText(content, {
      chunkSize: Math.max(effectiveChunkSize, 100),
      chunkOverlap: opts?.chunkOverlap,
    });
    return rawChunks.map(c => ({
      content: `${prefix}${c.content}`,
      tokenCount: c.tokenCount + prefixTokens,
      chunkIndex: c.chunkIndex,
    }));
  }

  const chunks: TextChunk[] = [];
  let buffer = '';
  let chunkIndex = 0;

  for (const section of sections) {
    const combined = buffer ? `${buffer}\n\n${section.trim()}` : section.trim();

    if (estimateTokenCount(combined) > effectiveChunkSize && buffer) {
      chunks.push({
        content: `${prefix}${buffer.trim()}`,
        tokenCount: estimateTokenCount(buffer.trim()) + prefixTokens,
        chunkIndex: chunkIndex++,
      });
      buffer = section.trim();
    } else {
      buffer = combined;
    }
  }

  if (buffer.trim()) {
    chunks.push({
      content: `${prefix}${buffer.trim()}`,
      tokenCount: estimateTokenCount(buffer.trim()) + prefixTokens,
      chunkIndex: chunkIndex++,
    });
  }

  return chunks;
}

/** Extract the last ~overlapTokens worth of text for chunk overlap */
function getOverlapText(text: string, overlapTokens: number): string {
  const chars = overlapTokens * 4; // heuristic: 4 chars per token
  if (text.length <= chars) return text;
  return text.slice(-chars);
}

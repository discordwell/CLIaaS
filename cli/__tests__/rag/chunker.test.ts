import { describe, it, expect } from 'vitest';
import {
  chunkText,
  chunkKBArticle,
  chunkTicketThread,
  chunkMarkdownFile,
} from '../../rag/chunker.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Generate a paragraph of roughly N tokens (~4 chars per token). */
function makeParagraph(tokens: number, label = 'x'): string {
  // 4 chars per token, minus space overhead
  return (label.repeat(4) + ' ').repeat(tokens).trim();
}

/** Build multi-paragraph text with N paragraphs of a given token size. */
function makeParagraphs(count: number, tokensEach: number): string {
  return Array.from({ length: count }, (_, i) =>
    makeParagraph(tokensEach, String.fromCharCode(65 + (i % 26))),
  ).join('\n\n');
}

// ── chunkText ────────────────────────────────────────────────────────────────

describe('chunkText', () => {
  it('returns empty array for empty string', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(chunkText('   \n\n   ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const chunks = chunkText('Hello world.', { chunkSize: 400 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Hello world.');
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it('splits into multiple chunks when text exceeds chunkSize', () => {
    // 5 paragraphs × 100 tokens each = ~500 tokens total
    // With chunkSize 200, should split into multiple chunks
    const text = makeParagraphs(5, 100);
    const chunks = chunkText(text, { chunkSize: 200, chunkOverlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should have sequential indices
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('maintains sequential chunk indices', () => {
    const text = makeParagraphs(10, 100);
    const chunks = chunkText(text, { chunkSize: 150, chunkOverlap: 20 });

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i);
    }
  });

  it('uses defaults from RAG_DEFAULTS when no opts given', () => {
    // Short text should still produce one chunk with defaults
    const chunks = chunkText('Short text.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Short text.');
  });

  it('respects custom chunkSize', () => {
    // Create text that fits in 800 tokens but not 100
    const text = makeParagraphs(4, 50);
    const largeChunks = chunkText(text, { chunkSize: 800 });
    const smallChunks = chunkText(text, { chunkSize: 100 });

    expect(smallChunks.length).toBeGreaterThan(largeChunks.length);
  });

  it('produces overlap between consecutive chunks', () => {
    const text = makeParagraphs(6, 100);
    const chunks = chunkText(text, { chunkSize: 200, chunkOverlap: 50 });

    // With overlap, later chunks should contain some text from the end of the previous chunk
    if (chunks.length >= 2) {
      const prevEnd = chunks[0].content.slice(-50);
      // The overlap text from the previous chunk should appear at the start of the next
      expect(chunks[1].content).toContain(prevEnd.slice(-20));
    }
  });

  it('handles single very long paragraph', () => {
    // One paragraph that's 600 tokens — fits in default 400-token chunkSize as single para
    // But the buffer logic won't split mid-paragraph, so it emits as one chunk
    const text = makeParagraph(600);
    const chunks = chunkText(text, { chunkSize: 400 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
  });

  it('tokenCount reflects actual content length heuristic', () => {
    const text = 'A'.repeat(400); // 400 chars ≈ 100 tokens
    const chunks = chunkText(text);
    expect(chunks[0].tokenCount).toBe(100);
  });

  it('trims leading and trailing whitespace from chunks', () => {
    const text = '  paragraph one  \n\n  paragraph two  ';
    const chunks = chunkText(text, { chunkSize: 400 });
    expect(chunks[0].content).not.toMatch(/^\s/);
    expect(chunks[0].content).not.toMatch(/\s$/);
  });

  it('handles unicode content correctly', () => {
    const text = '日本語テキスト。\n\n中文内容。\n\nEmoji: 🎉🚀';
    const chunks = chunkText(text, { chunkSize: 400 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('日本語');
    expect(chunks[0].content).toContain('🎉');
  });
});

// ── chunkKBArticle ───────────────────────────────────────────────────────────

describe('chunkKBArticle', () => {
  it('prepends title prefix to every chunk', () => {
    const body = makeParagraphs(5, 100);
    const chunks = chunkKBArticle('Password Reset Guide', body, {
      chunkSize: 200,
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^\[KB Article: Password Reset Guide\]\n\n/);
    }
  });

  it('accounts for prefix in token budget', () => {
    const body = makeParagraphs(3, 100);
    const withTitle = chunkKBArticle('My Article', body, { chunkSize: 200 });
    const withoutTitle = chunkText(body, { chunkSize: 200 });

    // Title prefix consumes tokens, so article chunking may produce more chunks
    expect(withTitle.length).toBeGreaterThanOrEqual(withoutTitle.length);
  });

  it('returns empty for empty body', () => {
    const chunks = chunkKBArticle('Title', '');
    expect(chunks).toEqual([]);
  });

  it('includes prefix tokens in tokenCount', () => {
    const chunks = chunkKBArticle('Test', 'Short body.');
    expect(chunks).toHaveLength(1);
    // tokenCount should be larger than just the body's tokens
    const bodyOnlyTokens = Math.ceil('Short body.'.length / 4);
    expect(chunks[0].tokenCount).toBeGreaterThan(bodyOnlyTokens);
  });

  it('preserves sequential chunk indices', () => {
    const body = makeParagraphs(8, 100);
    const chunks = chunkKBArticle('Big Article', body, { chunkSize: 200 });
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('enforces minimum effective chunk size of 100', () => {
    // Very long title eating into chunk budget shouldn't crash
    const longTitle = 'A'.repeat(1600); // ~400 tokens title
    const body = 'Some body text for the article.';
    const chunks = chunkKBArticle(longTitle, body, { chunkSize: 200 });
    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ── chunkTicketThread ────────────────────────────────────────────────────────

describe('chunkTicketThread', () => {
  const sampleMessages = [
    { author: 'customer@test.com', body: 'I cannot log in to my account.', type: 'reply' },
    { author: 'agent@support.com', body: 'Can you try resetting your password?', type: 'reply' },
    { author: 'customer@test.com', body: 'That worked, thank you!', type: 'reply' },
  ];

  it('prepends ticket subject prefix to every chunk', () => {
    const chunks = chunkTicketThread('Login Issue', sampleMessages);
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^\[Ticket: Login Issue\]\n\n/);
    }
  });

  it('formats messages with type and author', () => {
    const chunks = chunkTicketThread('Test', sampleMessages, { chunkSize: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('[REPLY] customer@test.com:');
    expect(chunks[0].content).toContain('[REPLY] agent@support.com:');
  });

  it('separates messages with --- divider', () => {
    const chunks = chunkTicketThread('Test', sampleMessages, { chunkSize: 1000 });
    expect(chunks[0].content).toContain('---');
  });

  it('splits when thread exceeds chunk size', () => {
    const longMessages = Array.from({ length: 20 }, (_, i) => ({
      author: i % 2 === 0 ? 'customer@test.com' : 'agent@support.com',
      body: makeParagraph(80, String.fromCharCode(65 + (i % 26))),
      type: 'reply',
    }));

    const chunks = chunkTicketThread('Long Thread', longMessages, {
      chunkSize: 200,
    });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('handles empty messages array', () => {
    const chunks = chunkTicketThread('Empty Ticket', []);
    expect(chunks).toEqual([]);
  });

  it('handles single message', () => {
    const chunks = chunkTicketThread('Single', [
      { author: 'user', body: 'One message.', type: 'reply' },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('One message.');
  });

  it('uppercases message type in output', () => {
    const chunks = chunkTicketThread('Test', [
      { author: 'user', body: 'Hello', type: 'note' },
    ]);
    expect(chunks[0].content).toContain('[NOTE]');
  });
});

// ── chunkMarkdownFile ────────────────────────────────────────────────────────

describe('chunkMarkdownFile', () => {
  it('prepends file path prefix to every chunk', () => {
    const md = '## Section 1\nContent one.\n\n## Section 2\nContent two.';
    const chunks = chunkMarkdownFile(md, 'docs/guide.md');
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^\[File: docs\/guide\.md\]\n\n/);
    }
  });

  it('splits on ## headers', () => {
    const sections = Array.from({ length: 5 }, (_, i) =>
      `## Section ${i + 1}\n\n${makeParagraph(100)}`,
    ).join('\n\n');

    const chunks = chunkMarkdownFile(sections, 'test.md', { chunkSize: 200 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('falls back to paragraph chunking when no headers found', () => {
    const text = makeParagraphs(5, 100);
    const chunks = chunkMarkdownFile(text, 'no-headers.txt', { chunkSize: 200 });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^\[File: no-headers\.txt\]/);
    }
  });

  it('handles empty content', () => {
    const chunks = chunkMarkdownFile('', 'empty.md');
    expect(chunks).toEqual([]);
  });

  it('keeps header with its content in the same chunk', () => {
    const md = '## Getting Started\n\nFollow these steps to begin.';
    const chunks = chunkMarkdownFile(md, 'readme.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('## Getting Started');
    expect(chunks[0].content).toContain('Follow these steps');
  });

  it('preserves sequential chunk indices', () => {
    const sections = Array.from({ length: 10 }, (_, i) =>
      `## Section ${i}\n\n${makeParagraph(100)}`,
    ).join('\n\n');

    const chunks = chunkMarkdownFile(sections, 'big.md', { chunkSize: 150 });
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('handles markdown with only one section', () => {
    const md = '## Only Section\n\nSome content here.';
    const chunks = chunkMarkdownFile(md, 'single.md');
    expect(chunks).toHaveLength(1);
  });

  it('handles ### subheaders without splitting on them', () => {
    const md = '## Main Section\n\n### Sub 1\nContent.\n\n### Sub 2\nMore content.';
    const chunks = chunkMarkdownFile(md, 'sub.md', { chunkSize: 1000 });
    // ### does not trigger a split, only ## does
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('### Sub 1');
    expect(chunks[0].content).toContain('### Sub 2');
  });
});

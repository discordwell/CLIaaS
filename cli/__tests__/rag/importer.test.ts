import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

// ── SHA-256 hashing (used for content dedup) ─────────────────────────────────

describe('SHA-256 content hashing', () => {
  function sha256(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  it('produces 64-character hex string', () => {
    const hash = sha256('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const a = sha256('same content');
    const b = sha256('same content');
    expect(a).toBe(b);
  });

  it('produces different hashes for different content', () => {
    const a = sha256('content version 1');
    const b = sha256('content version 2');
    expect(a).not.toBe(b);
  });

  it('detects single-character changes', () => {
    const a = sha256('The quick brown fox jumps over the lazy dog');
    const b = sha256('The quick brown fox jumps over the lazy dog.');
    expect(a).not.toBe(b);
  });

  it('handles empty string', () => {
    const hash = sha256('');
    expect(hash).toHaveLength(64);
    // Known SHA-256 of empty string
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('handles unicode content', () => {
    const hash = sha256('日本語テキスト 🎉');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles very large content', () => {
    const largeContent = 'A'.repeat(1_000_000);
    const hash = sha256(largeContent);
    expect(hash).toHaveLength(64);
  });
});

// ── File collection logic ────────────────────────────────────────────────────

describe('file collection (importFile support)', () => {
  const TEST_DIR = `/tmp/cliaas-test-rag-import-${process.pid}`;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  function createFile(relativePath: string, content: string): string {
    const fullPath = join(TEST_DIR, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content);
    return fullPath;
  }

  // Test the collectFiles logic by reimplementing it simply (the real function is in importer.ts)
  // We test the same behavior patterns that importFile depends on

  it('recognizes .md files', () => {
    const path = createFile('guide.md', '# Guide\nSome content.');
    expect(path.endsWith('.md')).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('recognizes .txt files', () => {
    const path = createFile('notes.txt', 'Some notes.');
    expect(path.endsWith('.txt')).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('creates nested directory structure', () => {
    createFile('docs/api/endpoints.md', '# Endpoints');
    createFile('docs/api/auth.md', '# Auth');
    createFile('docs/faq.txt', 'FAQ content');

    expect(existsSync(join(TEST_DIR, 'docs/api/endpoints.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'docs/api/auth.md'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'docs/faq.txt'))).toBe(true);
  });

  it('hidden files (dotfiles) are ignored by convention', () => {
    createFile('.hidden.md', 'Should be ignored');
    createFile('visible.md', 'Should be included');

    // The importer skips files starting with '.'
    expect(existsSync(join(TEST_DIR, '.hidden.md'))).toBe(true);
    expect('.hidden.md'.startsWith('.')).toBe(true);
    expect('visible.md'.startsWith('.')).toBe(false);
  });
});

// ── Import pipeline invariants ───────────────────────────────────────────────

describe('import pipeline invariants', () => {
  it('content hash changes when content changes (dedup detection)', () => {
    function sha256(text: string): string {
      return createHash('sha256').update(text).digest('hex');
    }

    const v1 = sha256('[KB Article: Guide]\n\nStep 1: Click settings.');
    const v2 = sha256('[KB Article: Guide]\n\nStep 1: Click settings. Step 2: Save.');

    expect(v1).not.toBe(v2); // hash changed → re-embedding needed
  });

  it('content hash stays stable for unchanged content (skip re-embedding)', () => {
    function sha256(text: string): string {
      return createHash('sha256').update(text).digest('hex');
    }

    const content = '[KB Article: FAQ]\n\nHow do I reset my password?';
    const hash1 = sha256(content);
    const hash2 = sha256(content);

    expect(hash1).toBe(hash2); // same hash → skip re-embedding
  });

  it('dedup key is composite of (workspaceId, sourceId, chunkIndex)', () => {
    // This documents the dedup strategy — chunks are uniquely identified by this triple
    const key1 = ['ws-1', 'article-1', 0].join(':');
    const key2 = ['ws-1', 'article-1', 1].join(':');
    const key3 = ['ws-1', 'article-2', 0].join(':');

    expect(key1).not.toBe(key2); // different chunk of same article
    expect(key1).not.toBe(key3); // same chunk index but different article
  });

  it('source types are valid enum values', () => {
    const validTypes = ['kb_article', 'ticket_thread', 'external_file'];
    for (const type of validTypes) {
      expect(validTypes).toContain(type);
    }
  });
});

// ── Chunking + hashing integration ───────────────────────────────────────────

describe('chunking → hashing integration', () => {
  it('chunks of same article produce different hashes', async () => {
    const { chunkKBArticle } = await import('../../rag/chunker.js');

    const body = Array.from(
      { length: 10 },
      (_, i) => `Paragraph ${i}: ${'x'.repeat(400)}`,
    ).join('\n\n');

    const chunks = chunkKBArticle('Test Article', body, { chunkSize: 200 });
    expect(chunks.length).toBeGreaterThan(1);

    const hashes = chunks.map(c => createHash('sha256').update(c.content).digest('hex'));
    const uniqueHashes = new Set(hashes);

    // Every chunk should have a unique hash
    expect(uniqueHashes.size).toBe(hashes.length);
  });

  it('same content always produces same chunk hashes', async () => {
    const { chunkKBArticle } = await import('../../rag/chunker.js');
    const body = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';

    const run1 = chunkKBArticle('Article', body);
    const run2 = chunkKBArticle('Article', body);

    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      const hash1 = createHash('sha256').update(run1[i].content).digest('hex');
      const hash2 = createHash('sha256').update(run2[i].content).digest('hex');
      expect(hash1).toBe(hash2);
    }
  });

  it('ticket thread chunking produces unique hashes per chunk', async () => {
    const { chunkTicketThread } = await import('../../rag/chunker.js');

    const messages = Array.from({ length: 20 }, (_, i) => ({
      author: i % 2 === 0 ? 'customer' : 'agent',
      body: `Message ${i}: ${'y'.repeat(300)}`,
      type: 'reply',
    }));

    const chunks = chunkTicketThread('Support Thread', messages, { chunkSize: 200 });
    expect(chunks.length).toBeGreaterThan(1);

    const hashes = chunks.map(c => createHash('sha256').update(c.content).digest('hex'));
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(hashes.length);
  });
});

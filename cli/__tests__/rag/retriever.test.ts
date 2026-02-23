import { describe, it, expect } from 'vitest';
import { formatRetrievedContext } from '../../rag/retriever.js';
import type { RagSearchResult } from '../../rag/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<RagSearchResult> & { title?: string; source?: string } = {}): RagSearchResult {
  return {
    chunk: {
      id: 'chunk-1',
      workspaceId: 'ws-1',
      sourceType: 'kb_article',
      sourceId: 'article-1',
      sourceTitle: overrides.title ?? 'Test Article',
      chunkIndex: 0,
      content: overrides.source ?? 'This is the chunk content about password resets.',
      tokenCount: 50,
      contentHash: 'abc123',
      metadata: {},
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      ...overrides.chunk,
    },
    vectorScore: overrides.vectorScore ?? 0.85,
    textScore: overrides.textScore ?? 0.72,
    combinedScore: overrides.combinedScore ?? 0.0115,
  };
}

// ── formatRetrievedContext ────────────────────────────────────────────────────

describe('formatRetrievedContext', () => {
  it('returns empty string for empty results', () => {
    expect(formatRetrievedContext([])).toBe('');
  });

  it('formats a single result with header and content', () => {
    const results = [makeResult({ title: 'Password Reset Guide' })];
    const output = formatRetrievedContext(results);

    expect(output).toContain('## Retrieved Context');
    expect(output).toContain('### Source 1: Password Reset Guide');
    expect(output).toContain('Type: kb_article');
    expect(output).toContain('This is the chunk content');
  });

  it('includes score in header', () => {
    const results = [makeResult({ combinedScore: 0.0115 })];
    const output = formatRetrievedContext(results);

    expect(output).toContain('[score: 11.5]');
  });

  it('formats multiple results with sequential numbering', () => {
    const results = [
      makeResult({ title: 'Article One', combinedScore: 0.02 }),
      makeResult({
        title: 'Article Two',
        combinedScore: 0.01,
        chunk: {
          id: 'chunk-2',
          workspaceId: 'ws-1',
          sourceType: 'ticket_thread',
          sourceId: 'ticket-1',
          sourceTitle: 'Article Two',
          chunkIndex: 0,
          content: 'Ticket content here.',
          tokenCount: 30,
          contentHash: 'def456',
          metadata: {},
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      }),
    ];

    const output = formatRetrievedContext(results);

    expect(output).toContain('### Source 1: Article One');
    expect(output).toContain('### Source 2: Article Two');
    expect(output).toContain('Type: kb_article');
    expect(output).toContain('Type: ticket_thread');
  });

  it('separates results with horizontal rules', () => {
    const results = [
      makeResult({ title: 'First' }),
      makeResult({ title: 'Second', chunk: { ...makeResult().chunk, id: 'chunk-2', sourceTitle: 'Second' } }),
    ];

    const output = formatRetrievedContext(results);
    expect(output).toContain('---');
  });

  it('handles very small scores without formatting errors', () => {
    const results = [makeResult({ combinedScore: 0.00001 })];
    const output = formatRetrievedContext(results);

    // 0.00001 * 1000 = 0.01 → "0.0"
    expect(output).toContain('[score: 0.0]');
  });

  it('handles high scores correctly', () => {
    const results = [makeResult({ combinedScore: 1.0 })];
    const output = formatRetrievedContext(results);

    expect(output).toContain('[score: 1000.0]');
  });

  it('preserves chunk content verbatim', () => {
    const content = 'Special chars: <html>&amp; "quotes" \'apostrophes\' `backticks`';
    const results = [makeResult({ source: content })];
    const output = formatRetrievedContext(results);

    expect(output).toContain(content);
  });

  it('includes all source types correctly', () => {
    const types: Array<'kb_article' | 'ticket_thread' | 'external_file'> = [
      'kb_article',
      'ticket_thread',
      'external_file',
    ];

    for (const sourceType of types) {
      const results = [
        makeResult({
          chunk: { ...makeResult().chunk, sourceType, id: `chunk-${sourceType}` },
        }),
      ];
      const output = formatRetrievedContext(results);
      expect(output).toContain(`Type: ${sourceType}`);
    }
  });
});

// ── RRF scoring logic (mathematical verification) ────────────────────────────

describe('Reciprocal Rank Fusion scoring', () => {
  // Test the formula: score = w * 1/(k+vRank) + (1-w) * 1/(k+tRank)
  const k = 60;

  function rrf(vRank: number, tRank: number, w = 0.7): number {
    return w * (1 / (k + vRank)) + (1 - w) * (1 / (k + tRank));
  }

  it('scores higher when vector rank is #1 vs #10', () => {
    const scoreRank1 = rrf(1, 10);
    const scoreRank10 = rrf(10, 10);
    expect(scoreRank1).toBeGreaterThan(scoreRank10);
  });

  it('scores higher when text rank is #1 vs #10', () => {
    const scoreRank1 = rrf(10, 1);
    const scoreRank10 = rrf(10, 10);
    expect(scoreRank1).toBeGreaterThan(scoreRank10);
  });

  it('vector score has higher weight (w=0.7) than text score', () => {
    // Same rank but different sources should show vector is weighted more
    const vectorWins = rrf(1, 100); // great vector, bad text
    const textWins = rrf(100, 1); // bad vector, great text

    expect(vectorWins).toBeGreaterThan(textWins);
  });

  it('result present in both searches scores higher than single-source', () => {
    const bothRank5 = rrf(5, 5);
    const vectorOnly = rrf(5, 100);
    const textOnly = rrf(100, 5);

    expect(bothRank5).toBeGreaterThan(vectorOnly);
    expect(bothRank5).toBeGreaterThan(textOnly);
  });

  it('produces values in expected range', () => {
    // Best case: rank 1 in both
    const best = rrf(1, 1);
    expect(best).toBeGreaterThan(0);
    expect(best).toBeLessThan(1);

    // Worst case: very high ranks
    const worst = rrf(1000, 1000);
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(best);
  });

  it('equal weight (w=0.5) treats vector and text equally', () => {
    const a = rrf(1, 10, 0.5);
    const b = rrf(10, 1, 0.5);
    expect(a).toBeCloseTo(b, 10);
  });

  it('k=60 dampens rank differences at high ranks', () => {
    // Difference between rank 1 and 2 should be larger than rank 100 and 101
    const diff_1_2 = rrf(1, 50) - rrf(2, 50);
    const diff_100_101 = rrf(100, 50) - rrf(101, 50);
    expect(diff_1_2).toBeGreaterThan(diff_100_101);
  });
});

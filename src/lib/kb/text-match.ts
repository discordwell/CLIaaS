/**
 * Simple text-matching utility for KB article search.
 * Used by portal suggest and chat suggest endpoints.
 * No RAG dependency — pure keyword/phrase matching with TF-IDF-like scoring.
 */

import { loadKBArticles } from '@/lib/data';

export interface SuggestedArticle {
  id: string;
  title: string;
  snippet: string;
  score: number;
  categoryPath: string[];
}

/**
 * Tokenize and normalize a query string into searchable terms.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Score an article against a query using term-frequency matching.
 * Returns a 0-1 score.
 */
function scoreArticle(
  queryTokens: string[],
  title: string,
  body: string,
): number {
  if (queryTokens.length === 0) return 0;

  const titleLower = title.toLowerCase();
  const bodyLower = body.toLowerCase();

  let titleHits = 0;
  let bodyHits = 0;

  for (const token of queryTokens) {
    if (titleLower.includes(token)) titleHits++;
    if (bodyLower.includes(token)) bodyHits++;
  }

  // Title matches are worth 3x body matches
  const score = (titleHits * 3 + bodyHits) / (queryTokens.length * 4);
  return Math.min(1, score);
}

/**
 * Extract a relevant snippet from the article body around the first matching term.
 */
function extractSnippet(body: string, queryTokens: string[], maxLen = 200): string {
  const bodyLower = body.toLowerCase();

  for (const token of queryTokens) {
    const idx = bodyLower.indexOf(token);
    if (idx >= 0) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(body.length, idx + maxLen - 60);
      const snippet = body.slice(start, end).trim();
      return (start > 0 ? '...' : '') + snippet + (end < body.length ? '...' : '');
    }
  }

  // No match found — return start of body
  return body.slice(0, maxLen) + (body.length > maxLen ? '...' : '');
}

/**
 * Search KB articles and return the top matches for a query.
 */
export async function suggestArticles(opts: {
  query: string;
  brandId?: string;
  locale?: string;
  limit?: number;
}): Promise<SuggestedArticle[]> {
  const { query, brandId, locale, limit = 5 } = opts;

  if (!query.trim()) return [];

  let articles = await loadKBArticles();

  // Portal-only: public articles
  articles = articles.filter((a) => !a.visibility || a.visibility === 'public');

  if (locale) {
    articles = articles.filter((a) => !a.locale || a.locale === locale);
  }

  if (brandId) {
    articles = articles.filter((a) => a.brandId === brandId);
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored: SuggestedArticle[] = [];

  for (const article of articles) {
    const score = scoreArticle(queryTokens, article.title, article.body);
    if (score > 0.05) {
      scored.push({
        id: article.id,
        title: article.title,
        snippet: extractSnippet(article.body, queryTokens),
        score: Math.round(score * 100) / 100,
        categoryPath: article.categoryPath,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

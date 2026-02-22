/**
 * Proactive intelligence: analyze ticket history for patterns,
 * anomalies, topic spikes, sentiment trends, and suggest KB articles
 * for recurring novel questions.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Ticket, Message, KBArticle } from '@/lib/data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopicSpike {
  topic: string;
  currentCount: number;
  baselineCount: number;
  percentIncrease: number;
  sampleTicketIds: string[];
}

export interface SentimentTrend {
  period: string;
  averageSentiment: number; // -1 to 1
  ticketsAnalyzed: number;
  direction: 'improving' | 'declining' | 'stable';
}

export interface Anomaly {
  type: 'topic_spike' | 'sentiment_drop' | 'volume_surge' | 'resolution_slowdown';
  severity: 'low' | 'medium' | 'high';
  description: string;
  detectedAt: string;
  relatedTicketIds: string[];
}

export interface KBGap {
  topic: string;
  ticketCount: number;
  sampleQuestions: string[];
  suggestedTitle: string;
  suggestedOutline: string;
}

export interface ProactiveInsights {
  generatedAt: string;
  topicSpikes: TopicSpike[];
  sentimentTrend: SentimentTrend;
  anomalies: Anomaly[];
  kbGaps: KBGap[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Helpers: time bucketing
// ---------------------------------------------------------------------------

function daysAgo(date: string, days: number): boolean {
  const d = new Date(date).getTime();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return d >= cutoff;
}

function partitionByRecency(
  tickets: Ticket[],
  recentDays: number = 7,
  baselineDays: number = 30,
): { recent: Ticket[]; baseline: Ticket[] } {
  const recent = tickets.filter((t) => daysAgo(t.createdAt, recentDays));
  const baseline = tickets.filter(
    (t) => daysAgo(t.createdAt, baselineDays) && !daysAgo(t.createdAt, recentDays),
  );
  return { recent, baseline };
}

// ---------------------------------------------------------------------------
// Topic analysis (keyword-based, no LLM required)
// ---------------------------------------------------------------------------

function countTopics(tickets: Ticket[]): Record<string, string[]> {
  const topicMap: Record<string, string[]> = {};

  for (const ticket of tickets) {
    const words = [
      ...ticket.tags,
      ...ticket.subject.toLowerCase().split(/\W+/).filter((w) => w.length > 3),
    ];

    const seen = new Set<string>();
    for (const word of words) {
      if (seen.has(word)) continue;
      seen.add(word);
      if (!topicMap[word]) topicMap[word] = [];
      topicMap[word].push(ticket.id);
    }
  }

  return topicMap;
}

function detectTopicSpikes(tickets: Ticket[]): TopicSpike[] {
  const { recent, baseline } = partitionByRecency(tickets);
  if (recent.length === 0) return [];

  const recentTopics = countTopics(recent);
  const baselineTopics = countTopics(baseline);

  const spikes: TopicSpike[] = [];
  const baselineDays = 23; // 30-7
  const recentDays = 7;

  for (const [topic, recentIds] of Object.entries(recentTopics)) {
    if (recentIds.length < 3) continue; // ignore rare topics

    const baselineIds = baselineTopics[topic] ?? [];
    const recentRate = recentIds.length / recentDays;
    const baselineRate = baselineIds.length / Math.max(baselineDays, 1);

    if (baselineRate === 0 && recentIds.length >= 3) {
      spikes.push({
        topic,
        currentCount: recentIds.length,
        baselineCount: 0,
        percentIncrease: 100,
        sampleTicketIds: recentIds.slice(0, 5),
      });
    } else if (baselineRate > 0 && recentRate > baselineRate * 1.5) {
      const increase = ((recentRate - baselineRate) / baselineRate) * 100;
      spikes.push({
        topic,
        currentCount: recentIds.length,
        baselineCount: baselineIds.length,
        percentIncrease: Math.round(increase),
        sampleTicketIds: recentIds.slice(0, 5),
      });
    }
  }

  return spikes.sort((a, b) => b.percentIncrease - a.percentIncrease).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Sentiment analysis (heuristic, upgraded with LLM when available)
// ---------------------------------------------------------------------------

const NEGATIVE_WORDS = [
  'angry', 'frustrated', 'terrible', 'horrible', 'worst', 'unacceptable',
  'broken', 'fails', 'disappointed', 'outage', 'down', 'urgent', 'asap',
  'furious', 'ridiculous', 'unusable',
];

const POSITIVE_WORDS = [
  'thanks', 'great', 'excellent', 'love', 'awesome', 'helpful', 'perfect',
  'appreciate', 'resolved', 'satisfied', 'wonderful', 'amazing',
];

function heuristicSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  let matches = 0;

  for (const word of NEGATIVE_WORDS) {
    if (lower.includes(word)) {
      score -= 0.3;
      matches++;
    }
  }
  for (const word of POSITIVE_WORDS) {
    if (lower.includes(word)) {
      score += 0.3;
      matches++;
    }
  }

  if (matches === 0) return 0;
  return Math.max(-1, Math.min(1, score / matches));
}

function analyzeSentiment(
  tickets: Ticket[],
  messages: Message[],
): SentimentTrend {
  const recent = tickets.filter((t) => daysAgo(t.createdAt, 7));
  const older = tickets.filter(
    (t) => daysAgo(t.createdAt, 30) && !daysAgo(t.createdAt, 7),
  );

  const messagesByTicket = new Map<string, Message[]>();
  for (const m of messages) {
    const existing = messagesByTicket.get(m.ticketId) ?? [];
    existing.push(m);
    messagesByTicket.set(m.ticketId, existing);
  }

  function avgSentimentForTickets(ts: Ticket[]): number {
    if (ts.length === 0) return 0;
    let total = 0;
    for (const ticket of ts) {
      const msgs = messagesByTicket.get(ticket.id) ?? [];
      const text = [ticket.subject, ...msgs.map((m) => m.body)].join(' ');
      total += heuristicSentiment(text);
    }
    return total / ts.length;
  }

  const recentSentiment = avgSentimentForTickets(recent);
  const olderSentiment = avgSentimentForTickets(older);

  const diff = recentSentiment - olderSentiment;
  let direction: SentimentTrend['direction'] = 'stable';
  if (diff > 0.1) direction = 'improving';
  if (diff < -0.1) direction = 'declining';

  return {
    period: 'last 7 days',
    averageSentiment: Math.round(recentSentiment * 100) / 100,
    ticketsAnalyzed: recent.length,
    direction,
  };
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

function detectAnomalies(
  tickets: Ticket[],
  messages: Message[],
  topicSpikes: TopicSpike[],
  sentimentTrend: SentimentTrend,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const now = new Date().toISOString();

  // Topic spikes > 100%
  for (const spike of topicSpikes) {
    if (spike.percentIncrease >= 100) {
      anomalies.push({
        type: 'topic_spike',
        severity: spike.percentIncrease >= 200 ? 'high' : 'medium',
        description: `"${spike.topic}" increased ${spike.percentIncrease}% (${spike.currentCount} tickets in past 7 days vs ${spike.baselineCount} in prior 23 days)`,
        detectedAt: now,
        relatedTicketIds: spike.sampleTicketIds,
      });
    }
  }

  // Sentiment drop
  if (sentimentTrend.direction === 'declining' && sentimentTrend.averageSentiment < -0.2) {
    anomalies.push({
      type: 'sentiment_drop',
      severity: sentimentTrend.averageSentiment < -0.5 ? 'high' : 'medium',
      description: `Customer sentiment is declining. Average: ${sentimentTrend.averageSentiment.toFixed(2)} over ${sentimentTrend.ticketsAnalyzed} tickets`,
      detectedAt: now,
      relatedTicketIds: [],
    });
  }

  // Volume surge
  const { recent, baseline } = partitionByRecency(tickets);
  const recentRate = recent.length / 7;
  const baselineRate = baseline.length / 23;
  if (baselineRate > 0 && recentRate > baselineRate * 2) {
    anomalies.push({
      type: 'volume_surge',
      severity: recentRate > baselineRate * 3 ? 'high' : 'medium',
      description: `Ticket volume surged: ${recent.length} in past 7 days (${(recentRate / baselineRate * 100 - 100).toFixed(0)}% increase)`,
      detectedAt: now,
      relatedTicketIds: recent.slice(0, 5).map((t) => t.id),
    });
  }

  // Resolution slowdown: open tickets accumulating
  const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'pending');
  const openRatio = tickets.length > 0 ? openTickets.length / tickets.length : 0;
  if (openRatio > 0.6 && openTickets.length > 10) {
    anomalies.push({
      type: 'resolution_slowdown',
      severity: openRatio > 0.8 ? 'high' : 'medium',
      description: `${(openRatio * 100).toFixed(0)}% of tickets are open/pending (${openTickets.length}/${tickets.length})`,
      detectedAt: now,
      relatedTicketIds: openTickets.slice(0, 5).map((t) => t.id),
    });
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// KB gap detection
// ---------------------------------------------------------------------------

function detectKBGaps(
  tickets: Ticket[],
  messages: Message[],
  kbArticles: KBArticle[],
): KBGap[] {
  const recent = tickets.filter((t) => daysAgo(t.createdAt, 14));
  if (recent.length === 0) return [];

  // Build a set of topics already covered by KB
  const kbTopics = new Set<string>();
  for (const article of kbArticles) {
    for (const word of article.title.toLowerCase().split(/\W+/)) {
      if (word.length > 3) kbTopics.add(word);
    }
    for (const cat of article.categoryPath) {
      kbTopics.add(cat.toLowerCase());
    }
  }

  // Group tickets by primary topic (first significant tag or keyword)
  const topicGroups: Record<string, { tickets: Ticket[]; questions: string[] }> = {};

  for (const ticket of recent) {
    const topics = [
      ...ticket.tags,
      ...ticket.subject.toLowerCase().split(/\W+/).filter((w) => w.length > 4),
    ];

    const novelTopic = topics.find((t) => !kbTopics.has(t.toLowerCase()));
    if (novelTopic) {
      const key = novelTopic.toLowerCase();
      if (!topicGroups[key]) topicGroups[key] = { tickets: [], questions: [] };
      topicGroups[key].tickets.push(ticket);
      topicGroups[key].questions.push(ticket.subject);
    }
  }

  const gaps: KBGap[] = [];
  for (const [topic, group] of Object.entries(topicGroups)) {
    if (group.tickets.length < 2) continue; // need at least 2 tickets
    gaps.push({
      topic,
      ticketCount: group.tickets.length,
      sampleQuestions: group.questions.slice(0, 5),
      suggestedTitle: `How to: ${topic.charAt(0).toUpperCase() + topic.slice(1)}`,
      suggestedOutline: `Guide covering the most common questions about "${topic}" based on ${group.tickets.length} recent support tickets.`,
    });
  }

  return gaps.sort((a, b) => b.ticketCount - a.ticketCount).slice(0, 5);
}

// ---------------------------------------------------------------------------
// LLM-enhanced summary (optional)
// ---------------------------------------------------------------------------

async function generateSummary(insights: Omit<ProactiveInsights, 'summary'>): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const dataBlob = JSON.stringify(
    {
      topicSpikes: insights.topicSpikes.slice(0, 5),
      sentiment: insights.sentimentTrend,
      anomalies: insights.anomalies,
      kbGaps: insights.kbGaps.slice(0, 3),
    },
    null,
    2,
  );

  const prompt = `You are a support operations analyst. Summarize these insights into 3-5 actionable bullet points for a shift manager.

${dataBlob}

Be concise and specific. Focus on what actions should be taken.`;

  try {
    if (anthropicKey) {
      const client = new Anthropic({ apiKey: anthropicKey });
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = msg.content[0];
      return block.type === 'text' ? block.text : '';
    } else if (openaiKey) {
      const client = new OpenAI({ apiKey: openaiKey });
      const res = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.choices[0]?.message?.content ?? '';
    }
  } catch {
    // Fall through to heuristic summary
  }

  // Heuristic summary when no LLM is available
  const lines: string[] = [];
  if (insights.anomalies.length > 0) {
    const high = insights.anomalies.filter((a) => a.severity === 'high');
    lines.push(
      `${insights.anomalies.length} anomalies detected${high.length > 0 ? ` (${high.length} high severity)` : ''}.`,
    );
  }
  if (insights.topicSpikes.length > 0) {
    const top = insights.topicSpikes[0];
    lines.push(
      `Top topic spike: "${top.topic}" up ${top.percentIncrease}% with ${top.currentCount} tickets.`,
    );
  }
  if (insights.sentimentTrend.direction !== 'stable') {
    lines.push(
      `Sentiment is ${insights.sentimentTrend.direction} (avg: ${insights.sentimentTrend.averageSentiment.toFixed(2)}).`,
    );
  }
  if (insights.kbGaps.length > 0) {
    lines.push(
      `${insights.kbGaps.length} KB gap(s) identified. Consider creating articles for: ${insights.kbGaps.map((g) => g.topic).join(', ')}.`,
    );
  }
  if (lines.length === 0) {
    lines.push('No significant patterns or anomalies detected. Operations normal.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateInsights(
  tickets: Ticket[],
  messages: Message[],
  kbArticles: KBArticle[],
  useLLM: boolean = true,
): Promise<ProactiveInsights> {
  const topicSpikes = detectTopicSpikes(tickets);
  const sentimentTrend = analyzeSentiment(tickets, messages);
  const anomalies = detectAnomalies(tickets, messages, topicSpikes, sentimentTrend);
  const kbGaps = detectKBGaps(tickets, messages, kbArticles);

  const partial = {
    generatedAt: new Date().toISOString(),
    topicSpikes,
    sentimentTrend,
    anomalies,
    kbGaps,
  };

  const summary = useLLM
    ? await generateSummary(partial)
    : [
        topicSpikes.length > 0 ? `${topicSpikes.length} topic spike(s)` : null,
        anomalies.length > 0 ? `${anomalies.length} anomaly(ies)` : null,
        `Sentiment: ${sentimentTrend.direction}`,
        kbGaps.length > 0 ? `${kbGaps.length} KB gap(s)` : null,
      ]
        .filter(Boolean)
        .join('. ') + '.';

  return { ...partial, summary };
}

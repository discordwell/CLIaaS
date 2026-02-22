/**
 * Agent quality scoring: evaluate a support response on tone,
 * completeness, accuracy, and brand voice.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Ticket, Message } from '@/lib/data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QAScores {
  tone: number; // 1-5
  completeness: number; // 1-5
  accuracy: number; // 1-5
  brandVoice: number; // 1-5
  overall: number; // weighted average
}

export interface QAFlag {
  category: 'tone' | 'completeness' | 'accuracy' | 'brand_voice' | 'policy';
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface QAReport {
  ticketId: string;
  messageId?: string;
  scores: QAScores;
  flags: QAFlag[];
  suggestions: string[];
  evaluatedAt: string;
}

export interface QAInput {
  ticket: Ticket;
  messages: Message[];
  responseText: string;
  messageId?: string;
}

// ---------------------------------------------------------------------------
// Heuristic scoring (fallback when no LLM available)
// ---------------------------------------------------------------------------

function heuristicQA(input: QAInput): QAReport {
  const { ticket, messages, responseText, messageId } = input;
  const lower = responseText.toLowerCase();
  const flags: QAFlag[] = [];
  const suggestions: string[] = [];

  // --- Tone ---
  let toneScore = 3;
  const hasGreeting = /^(hi|hello|hey|dear|good\s+(morning|afternoon|evening))/i.test(
    responseText.trim(),
  );
  const hasClosing = /(thanks|thank you|regards|best|cheers|sincerely)/i.test(responseText);
  const hasApology = /(sorry|apologize|apologies)/i.test(responseText);
  const hasRude = /(obviously|clearly you|you should have|that's wrong)/i.test(responseText);

  if (hasGreeting) toneScore += 0.5;
  if (hasClosing) toneScore += 0.5;
  if (hasApology && (ticket.priority === 'urgent' || ticket.priority === 'high')) toneScore += 0.5;
  if (hasRude) {
    toneScore -= 1.5;
    flags.push({
      category: 'tone',
      severity: 'warning',
      message: 'Response contains potentially dismissive language.',
    });
  }

  toneScore = Math.max(1, Math.min(5, Math.round(toneScore)));

  // --- Completeness ---
  let completenessScore = 3;
  const wordCount = responseText.split(/\s+/).length;

  if (wordCount < 15) {
    completenessScore = 2;
    flags.push({
      category: 'completeness',
      severity: 'warning',
      message: `Response is very short (${wordCount} words). May not fully address the issue.`,
    });
    suggestions.push('Consider providing more detail or next steps.');
  } else if (wordCount > 50) {
    completenessScore = 4;
  }

  // Check if response references the customer's issue
  const subjectWords = ticket.subject
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);
  const referencesIssue = subjectWords.some((w) => lower.includes(w));
  if (referencesIssue) completenessScore = Math.min(5, completenessScore + 1);
  else {
    suggestions.push('Consider referencing the specific issue the customer raised.');
  }

  // Check for action items or next steps
  const hasNextSteps = /(next step|please try|you can|here's how|to resolve|follow these)/i.test(
    responseText,
  );
  if (hasNextSteps) completenessScore = Math.min(5, completenessScore + 0.5);

  completenessScore = Math.max(1, Math.min(5, Math.round(completenessScore)));

  // --- Accuracy ---
  // Heuristic: can only check for red flags, not real accuracy
  let accuracyScore = 3;
  const hasHedging = /(i think|maybe|not sure|might be|possibly)/i.test(responseText);
  const hasConfidence = /(the solution is|here are the steps|this will|you need to)/i.test(
    responseText,
  );

  if (hasHedging) {
    accuracyScore = 2;
    flags.push({
      category: 'accuracy',
      severity: 'info',
      message: 'Response contains hedging language that may reduce customer confidence.',
    });
  }
  if (hasConfidence) accuracyScore = Math.min(5, accuracyScore + 1);

  // Check conversation context: are we repeating what was already tried?
  const previousBodies = messages
    .filter((m) => m.type === 'reply')
    .map((m) => m.body.toLowerCase());
  const isRepeat = previousBodies.some(
    (prev) => prev.length > 50 && lower.includes(prev.slice(0, 50)),
  );
  if (isRepeat) {
    accuracyScore = Math.max(1, accuracyScore - 1);
    flags.push({
      category: 'accuracy',
      severity: 'warning',
      message: 'Response appears to repeat a previous reply.',
    });
  }

  accuracyScore = Math.max(1, Math.min(5, Math.round(accuracyScore)));

  // --- Brand Voice ---
  let brandScore = 3;
  const isProfessional = /\b(we|our team|happy to help|glad to assist)\b/i.test(responseText);
  const hasCasualSlang = /\b(gonna|wanna|nah|lol|haha|bruh|dude)\b/i.test(responseText);
  const hasAllCaps = /[A-Z]{4,}/.test(responseText.replace(/\b(SLA|API|URL|KB|FAQ|ID)\b/g, ''));

  if (isProfessional) brandScore += 1;
  if (hasCasualSlang) {
    brandScore -= 1;
    flags.push({
      category: 'brand_voice',
      severity: 'info',
      message: 'Response uses informal language that may not match brand standards.',
    });
  }
  if (hasAllCaps) {
    brandScore -= 0.5;
    flags.push({
      category: 'brand_voice',
      severity: 'info',
      message: 'Response contains excessive capitalization.',
    });
  }

  brandScore = Math.max(1, Math.min(5, Math.round(brandScore)));

  // --- Overall ---
  const rawOverall =
    toneScore * 0.25 + completenessScore * 0.3 + accuracyScore * 0.3 + brandScore * 0.15;
  const overall = Math.round(rawOverall * 10) / 10;

  return {
    ticketId: ticket.id,
    messageId,
    scores: {
      tone: toneScore,
      completeness: completenessScore,
      accuracy: accuracyScore,
      brandVoice: brandScore,
      overall: Math.max(1, Math.min(5, overall)),
    },
    flags,
    suggestions,
    evaluatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// LLM-enhanced QA
// ---------------------------------------------------------------------------

async function llmQA(input: QAInput): Promise<QAReport | null> {
  const { ticket, messages, responseText, messageId } = input;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!anthropicKey && !openaiKey) return null;

  const thread = messages
    .slice(-5)
    .map((m) => `[${m.type}] ${m.author}: ${m.body.slice(0, 300)}`)
    .join('\n');

  const prompt = `You are a QA analyst scoring a support agent's response.

TICKET:
Subject: ${ticket.subject}
Priority: ${ticket.priority}
Tags: ${ticket.tags.join(', ') || 'none'}

CONVERSATION (last 5 messages):
${thread || '(none)'}

RESPONSE BEING EVALUATED:
${responseText}

Score on these dimensions (1-5, where 5 is excellent):
- tone: professional, empathetic, appropriate for the situation
- completeness: addresses all parts of the customer's question
- accuracy: technically correct, no misinformation
- brandVoice: consistent with professional SaaS brand standards

Also flag any issues and provide improvement suggestions.

Respond with ONLY a JSON object:
{
  "scores": { "tone": N, "completeness": N, "accuracy": N, "brandVoice": N, "overall": N },
  "flags": [{ "category": "tone|completeness|accuracy|brand_voice|policy", "severity": "info|warning|critical", "message": "..." }],
  "suggestions": ["..."]
}`;

  try {
    let raw = '';
    if (anthropicKey) {
      const client = new Anthropic({ apiKey: anthropicKey });
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = msg.content[0];
      raw = block.type === 'text' ? block.text : '';
    } else if (openaiKey) {
      const client = new OpenAI({ apiKey: openaiKey });
      const res = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });
      raw = res.choices[0]?.message?.content ?? '';
    }

    let cleaned = raw.trim();
    const fence = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fence) cleaned = fence[1].trim();

    const parsed = JSON.parse(cleaned) as {
      scores: QAScores;
      flags: QAFlag[];
      suggestions: string[];
    };

    // Clamp scores
    for (const key of ['tone', 'completeness', 'accuracy', 'brandVoice', 'overall'] as const) {
      parsed.scores[key] = Math.max(1, Math.min(5, Math.round(parsed.scores[key] ?? 3)));
    }

    return {
      ticketId: ticket.id,
      messageId,
      scores: parsed.scores,
      flags: parsed.flags ?? [],
      suggestions: parsed.suggestions ?? [],
      evaluatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function scoreResponse(input: QAInput): Promise<QAReport> {
  // Try LLM first, fall back to heuristic
  const llmReport = await llmQA(input);
  if (llmReport) return llmReport;
  return heuristicQA(input);
}

// ---------------------------------------------------------------------------
// Batch scoring (for dashboard stats)
// ---------------------------------------------------------------------------

export interface QAOverview {
  totalScored: number;
  avgTone: number;
  avgCompleteness: number;
  avgAccuracy: number;
  avgBrandVoice: number;
  avgOverall: number;
  flagCount: number;
  criticalFlags: number;
  recentReports: QAReport[];
}

declare global {
  // eslint-disable-next-line no-var
  var __cliaasQAReports: QAReport[] | undefined;
}

export function getQAReports(): QAReport[] {
  return global.__cliaasQAReports ?? [];
}

export function recordQAReport(report: QAReport): void {
  const reports = getQAReports();
  global.__cliaasQAReports = [report, ...reports].slice(0, 100);
}

export function getQAOverview(): QAOverview {
  const reports = getQAReports();
  if (reports.length === 0) {
    return {
      totalScored: 0,
      avgTone: 0,
      avgCompleteness: 0,
      avgAccuracy: 0,
      avgBrandVoice: 0,
      avgOverall: 0,
      flagCount: 0,
      criticalFlags: 0,
      recentReports: [],
    };
  }

  const avg = (fn: (r: QAReport) => number) =>
    Math.round((reports.reduce((s, r) => s + fn(r), 0) / reports.length) * 10) / 10;

  return {
    totalScored: reports.length,
    avgTone: avg((r) => r.scores.tone),
    avgCompleteness: avg((r) => r.scores.completeness),
    avgAccuracy: avg((r) => r.scores.accuracy),
    avgBrandVoice: avg((r) => r.scores.brandVoice),
    avgOverall: avg((r) => r.scores.overall),
    flagCount: reports.reduce((s, r) => s + r.flags.length, 0),
    criticalFlags: reports.reduce(
      (s, r) => s + r.flags.filter((f) => f.severity === 'critical').length,
      0,
    ),
    recentReports: reports.slice(0, 10),
  };
}

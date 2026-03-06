/**
 * CSAT Prediction Engine.
 * Heuristic model that predicts customer satisfaction before survey is sent.
 * No LLM required — uses ticket metadata and conversation signals.
 */

import type { Ticket, Message } from '@/lib/data';
import { createLogger } from '../logger';

const logger = createLogger('predictions:csat');

export interface CSATPredictionInput {
  ticket: Ticket;
  messages: Message[];
  agentAvgQAScore?: number; // 0-100, agent's recent QA average
  isFirstContactResolution?: boolean;
}

export interface CSATPredictionResult {
  score: number;           // 1.0 - 5.0
  confidence: number;      // 0.00 - 1.00
  riskLevel: 'low' | 'medium' | 'high';
  factors: Record<string, unknown>;
}

/**
 * Predict CSAT using heuristic signals.
 * Works without LLM — uses resolution speed, message count, sentiment signals, etc.
 */
export function predictCSAT(input: CSATPredictionInput): CSATPredictionResult {
  const { ticket, messages, agentAvgQAScore, isFirstContactResolution } = input;

  let score = 3.5; // neutral baseline
  const factors: Record<string, unknown> = {};

  // 1. Resolution speed factor
  const createdAt = new Date(ticket.createdAt).getTime();
  const updatedAt = new Date(ticket.updatedAt).getTime();
  const resolutionHours = (updatedAt - createdAt) / (1000 * 60 * 60);
  factors.resolutionHours = Math.round(resolutionHours * 10) / 10;

  if (resolutionHours < 1) { score += 0.5; factors.resolutionSpeed = 'very_fast'; }
  else if (resolutionHours < 4) { score += 0.3; factors.resolutionSpeed = 'fast'; }
  else if (resolutionHours < 24) { score += 0.1; factors.resolutionSpeed = 'normal'; }
  else if (resolutionHours > 72) { score -= 0.5; factors.resolutionSpeed = 'slow'; }
  else if (resolutionHours > 24) { score -= 0.2; factors.resolutionSpeed = 'delayed'; }

  // 2. First contact resolution
  const agentReplies = messages.filter(m => m.type === 'reply' && m.author !== ticket.requester);
  factors.agentReplyCount = agentReplies.length;

  if (isFirstContactResolution || agentReplies.length === 1) {
    score += 0.5;
    factors.firstContactResolution = true;
  } else if (agentReplies.length > 5) {
    score -= 0.4;
    factors.firstContactResolution = false;
    factors.excessiveBackAndForth = true;
  }

  // 3. Sentiment signals from last customer message
  const customerMessages = messages.filter(m => m.author === ticket.requester);
  if (customerMessages.length > 0) {
    const lastCustomerMsg = customerMessages[customerMessages.length - 1].body.toLowerCase();
    const posSignals = /(thank|thanks|great|awesome|perfect|appreciate|helpful|solved|worked)/i;
    const negSignals = /(frustrated|angry|terrible|worst|unacceptable|ridiculous|still not|doesn't work)/i;

    if (posSignals.test(lastCustomerMsg)) {
      score += 0.6;
      factors.lastMessageSentiment = 'positive';
    } else if (negSignals.test(lastCustomerMsg)) {
      score -= 0.7;
      factors.lastMessageSentiment = 'negative';
    } else {
      factors.lastMessageSentiment = 'neutral';
    }
  }

  // 4. Priority alignment
  if (ticket.priority === 'urgent' && resolutionHours > 4) {
    score -= 0.4;
    factors.urgentButSlow = true;
  } else if (ticket.priority === 'urgent' && resolutionHours < 1) {
    score += 0.3;
    factors.urgentAndFast = true;
  }

  // 5. Ticket status at prediction time
  if (ticket.status === 'solved' || ticket.status === 'closed') {
    factors.resolved = true;
  } else {
    score -= 0.3;
    factors.resolved = false;
  }

  // 6. Agent quality factor
  if (agentAvgQAScore !== undefined) {
    factors.agentQAScore = agentAvgQAScore;
    if (agentAvgQAScore >= 85) score += 0.3;
    else if (agentAvgQAScore < 60) score -= 0.3;
  }

  // 7. Reopens (multiple solved→open transitions hint at bad resolution)
  // Heuristic: if there are messages after a "solved" system message, likely reopened
  const solvedIdx = messages.findIndex(m => m.type === 'system' && /solved|resolved/i.test(m.body));
  if (solvedIdx >= 0 && messages.slice(solvedIdx + 1).some(m => m.type === 'reply')) {
    score -= 0.5;
    factors.reopened = true;
  }

  // Clamp score
  score = Math.max(1, Math.min(5, Math.round(score * 10) / 10));

  // Confidence: higher when signals are strong and consistent
  let confidence = 0.5;
  if (Math.abs(score - 3) > 1) confidence += 0.15;      // extreme score = more confident
  if (customerMessages.length > 2) confidence += 0.1;     // more data
  if (agentAvgQAScore !== undefined) confidence += 0.05;   // QA data available
  if (isFirstContactResolution !== undefined) confidence += 0.05;
  confidence = Math.min(0.95, Math.round(confidence * 100) / 100);

  // Risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (score <= 2.5) riskLevel = 'high';
  else if (score <= 3.5) riskLevel = 'medium';

  logger.debug({ ticketId: ticket.id, score, confidence, riskLevel }, 'CSAT prediction generated');

  return { score, confidence, riskLevel, factors };
}

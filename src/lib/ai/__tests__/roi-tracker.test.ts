import { describe, it, expect, beforeEach } from 'vitest';
import { recordResolution, getROIMetrics, resetROIMetrics } from '../roi-tracker';
import type { AIAgentResult } from '../agent';

const resolved: AIAgentResult = {
  ticketId: 't-1',
  resolved: true,
  confidence: 0.9,
  suggestedReply: 'Fixed it',
  reasoning: 'Clear answer',
  escalated: false,
  kbArticlesUsed: ['kb-1'],
};

const escalated: AIAgentResult = {
  ticketId: 't-2',
  resolved: false,
  confidence: 0.3,
  suggestedReply: '',
  reasoning: 'Unclear',
  escalated: true,
  escalationReason: 'Low confidence',
  kbArticlesUsed: [],
};

beforeEach(() => {
  resetROIMetrics();
});

describe('ROI tracker', () => {
  it('starts with zero metrics', () => {
    const m = getROIMetrics();
    expect(m.totalResolutions).toBe(0);
    expect(m.aiResolved).toBe(0);
  });

  it('records resolved tickets', () => {
    recordResolution(resolved);
    const m = getROIMetrics();
    expect(m.totalResolutions).toBe(1);
    expect(m.aiResolved).toBe(1);
    expect(m.resolutionRate).toBe(100);
    expect(m.estimatedTimeSavedMinutes).toBe(8);
  });

  it('records escalated tickets', () => {
    recordResolution(escalated);
    const m = getROIMetrics();
    expect(m.totalResolutions).toBe(1);
    expect(m.escalated).toBe(1);
    expect(m.aiResolved).toBe(0);
    expect(m.resolutionRate).toBe(0);
  });

  it('calculates mixed metrics', () => {
    recordResolution(resolved);
    recordResolution(resolved);
    recordResolution(escalated);
    const m = getROIMetrics();
    expect(m.totalResolutions).toBe(3);
    expect(m.aiResolved).toBe(2);
    expect(m.escalated).toBe(1);
    expect(m.resolutionRate).toBe(67);
    expect(m.avgConfidence).toBeCloseTo(0.7, 1);
  });
});

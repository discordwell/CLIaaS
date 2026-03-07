import { describe, it, expect } from 'vitest';
import { optimizeSchedules, classifyAgentQA } from '../optimizer';
import type { OptimizerInput, OptimizerConstraints } from '../optimizer';
import { generateWeeklySchedules, createTemplate } from '../schedules';
import type { AutoScheduleInput } from '../schedules';
import type { ForecastPoint, ShiftBlock } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build forecast points for a single week (Mon-Sun) with configurable peak hours. */
function buildWeekForecast(options?: {
  peakHours?: number[];
  peakVolume?: number;
  offPeakVolume?: number;
}): Array<{ hour: string; predictedVolume: number; dayOfWeek: number }> {
  const peakHrs = new Set(options?.peakHours ?? [9, 10, 11, 14, 15, 16]);
  const peakVol = options?.peakVolume ?? 20;
  const offPeakVol = options?.offPeakVolume ?? 5;
  const points: Array<{ hour: string; predictedVolume: number; dayOfWeek: number }> = [];

  // Generate Mon (1) through Fri (5)
  const weekStart = '2026-03-09'; // Monday
  for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + dayOffset);
    const dow = d.getUTCDay();
    for (let h = 8; h < 18; h++) {
      const hourStr = d.toISOString().slice(0, 11) + String(h).padStart(2, '0') + ':00:00.000Z';
      points.push({
        hour: hourStr,
        predictedVolume: peakHrs.has(h) ? peakVol : offPeakVol,
        dayOfWeek: dow,
      });
    }
  }
  return points;
}

function makeForecastPoints(forecast: Array<{ hour: string; predictedVolume: number; dayOfWeek: number }>): ForecastPoint[] {
  return forecast.map(f => ({
    hour: f.hour,
    predictedVolume: f.predictedVolume,
    dayOfWeek: f.dayOfWeek,
    confidence: { low: f.predictedVolume * 0.8, high: f.predictedVolume * 1.2 },
  }));
}

const DEFAULT_CONSTRAINTS: OptimizerConstraints = {
  maxHoursPerWeek: 40,
  minRestBetweenShifts: 8,
  maxConsecutiveDays: 6,
  respectTimeOff: true,
  preferredShiftLength: 8,
};

// ---------------------------------------------------------------------------
// B11: QA-weighted scheduling
// ---------------------------------------------------------------------------

describe('classifyAgentQA', () => {
  const thresholds = { coachingBelow: 60, peakAbove: 85 };

  it('classifies agents below coaching threshold as low', () => {
    expect(classifyAgentQA('a1', { a1: 45 }, thresholds)).toBe('low');
    expect(classifyAgentQA('a1', { a1: 59 }, thresholds)).toBe('low');
  });

  it('classifies agents at or above peak threshold as high', () => {
    expect(classifyAgentQA('a1', { a1: 85 }, thresholds)).toBe('high');
    expect(classifyAgentQA('a1', { a1: 100 }, thresholds)).toBe('high');
  });

  it('classifies agents in the mid range', () => {
    expect(classifyAgentQA('a1', { a1: 60 }, thresholds)).toBe('mid');
    expect(classifyAgentQA('a1', { a1: 84 }, thresholds)).toBe('mid');
  });

  it('defaults to mid when agent not in scores map', () => {
    expect(classifyAgentQA('a1', { a2: 50 }, thresholds)).toBe('mid');
  });

  it('defaults to mid when no scores provided', () => {
    expect(classifyAgentQA('a1', undefined, thresholds)).toBe('mid');
  });
});

describe('QA-weighted optimizer: low QA agents get coaching blocks', () => {
  it('assigns coaching blocks to agents with QA score below threshold', () => {
    const forecast = buildWeekForecast();
    const agents = [
      { id: 'low-qa', name: 'Low QA Agent', skills: ['support'] },
      { id: 'high-qa', name: 'High QA Agent', skills: ['support'] },
      { id: 'mid-qa', name: 'Mid QA Agent', skills: ['support'] },
    ];

    const qaScores: Record<string, number> = {
      'low-qa': 40,
      'high-qa': 90,
      'mid-qa': 70,
    };

    const result = optimizeSchedules({
      agents,
      forecast,
      constraints: DEFAULT_CONSTRAINTS,
      qaScores,
    });

    // Low-QA agent should have coaching blocks
    const lowQaCoaching = result.coachingBlocks?.get('low-qa');
    expect(lowQaCoaching).toBeDefined();
    expect(lowQaCoaching!.length).toBeGreaterThanOrEqual(1);
    expect(lowQaCoaching!.length).toBeLessThanOrEqual(2);

    // Each coaching block should be labeled
    for (const block of lowQaCoaching!) {
      expect(block.activity).toBe('training');
      expect(block.label).toBe('QA Coaching');
    }

    // High-QA and mid-QA should NOT have coaching blocks
    expect(result.coachingBlocks?.get('high-qa')).toBeUndefined();
    expect(result.coachingBlocks?.get('mid-qa')).toBeUndefined();
  });

  it('assigns 2 coaching blocks when agent works 4+ days', () => {
    const forecast = buildWeekForecast();
    const agents = [
      { id: 'low-qa', name: 'Low QA Agent', skills: ['support'], maxHours: 40 },
      { id: 'filler-1', name: 'Filler 1', skills: ['support'] },
      { id: 'filler-2', name: 'Filler 2', skills: ['support'] },
    ];

    const result = optimizeSchedules({
      agents,
      forecast,
      constraints: DEFAULT_CONSTRAINTS,
      qaScores: { 'low-qa': 30 },
    });

    const coaching = result.coachingBlocks?.get('low-qa');
    expect(coaching).toBeDefined();

    // The low-QA agent should work 4+ days (5 weekdays available)
    const lowQaSched = result.schedules.find(s => s.userId === 'low-qa');
    const workDays = new Set(lowQaSched?.shifts.filter(s => s.activity === 'work').map(s => s.dayOfWeek) ?? []);

    if (workDays.size >= 4) {
      expect(coaching!.length).toBe(2);
    } else {
      expect(coaching!.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('places coaching blocks during off-peak hours (not peak)', () => {
    // Peak hours: 10, 11, 14, 15
    const forecast = buildWeekForecast({
      peakHours: [10, 11, 14, 15],
      peakVolume: 30,
      offPeakVolume: 5,
    });

    const agents = [
      { id: 'low-qa', name: 'Low QA Agent', skills: ['support'] },
      { id: 'filler', name: 'Filler', skills: ['support'] },
    ];

    const result = optimizeSchedules({
      agents,
      forecast,
      constraints: DEFAULT_CONSTRAINTS,
      qaScores: { 'low-qa': 40 },
    });

    const coaching = result.coachingBlocks?.get('low-qa');
    expect(coaching).toBeDefined();

    const peakSet = new Set([10, 11, 14, 15]);
    for (const block of coaching!) {
      const startHour = parseInt(block.startTime.split(':')[0], 10);
      // Coaching should NOT be during peak hours
      expect(peakSet.has(startHour)).toBe(false);
    }
  });
});

describe('QA-weighted optimizer: high QA agents assigned to peak hours', () => {
  it('prefers high-QA agents for peak hour assignment', () => {
    // Use a minimal forecast where we only have 1 agent slot needed
    // and both a high-QA and low-QA agent compete for it
    const forecast: Array<{ hour: string; predictedVolume: number; dayOfWeek: number }> = [];

    // Only Monday, peak at 10am (high volume), off-peak at 8am (low volume)
    const monday = '2026-03-09';
    forecast.push(
      { hour: `${monday}T10:00:00.000Z`, predictedVolume: 15, dayOfWeek: 1 }, // peak
      { hour: `${monday}T08:00:00.000Z`, predictedVolume: 3, dayOfWeek: 1 },  // off-peak
    );

    const agents = [
      { id: 'low-qa', name: 'Low QA Agent', skills: ['support'] },
      { id: 'high-qa', name: 'High QA Agent', skills: ['support'] },
    ];

    const result = optimizeSchedules({
      agents,
      forecast,
      constraints: DEFAULT_CONSTRAINTS,
      qaScores: { 'low-qa': 40, 'high-qa': 95 },
    });

    // Check that the high-QA agent is assigned to the peak hour (10am)
    const highQaSched = result.schedules.find(s => s.userId === 'high-qa');
    expect(highQaSched).toBeDefined();

    const highQaWorkSlots = highQaSched!.shifts.filter(s => s.activity === 'work');
    const hasPeakSlot = highQaWorkSlots.some(s => {
      const startH = parseInt(s.startTime.split(':')[0], 10);
      const endH = parseInt(s.endTime.split(':')[0], 10);
      return startH <= 10 && endH > 10;
    });
    expect(hasPeakSlot).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B12: Auto-schedule generation
// ---------------------------------------------------------------------------

describe('generateWeeklySchedules', () => {
  it('generates a valid weekly schedule from forecast', () => {
    const forecast = makeForecastPoints(buildWeekForecast());
    const agents = [
      { id: 'a1', name: 'Agent 1', skills: ['support'] },
      { id: 'a2', name: 'Agent 2', skills: ['support'] },
      { id: 'a3', name: 'Agent 3', skills: ['support'] },
    ];

    const result = generateWeeklySchedules({
      weekStart: '2026-03-09',
      agents,
      forecast,
    });

    // Should produce schedules
    expect(result.schedules.length).toBeGreaterThan(0);
    // All schedules should have shifts
    for (const sched of result.schedules) {
      expect(sched.shifts.length).toBeGreaterThan(0);
    }
    // Should be flagged for review
    expect(result.needsReview).toBe(true);
    // Coverage array should be populated
    expect(result.coverage.length).toBe(forecast.length);
  });

  it('uses template shifts as base when templateId provided', () => {
    const forecast = makeForecastPoints(buildWeekForecast());

    // Create a template first
    const templateShifts: ShiftBlock[] = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' },
      { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', activity: 'work' },
      { dayOfWeek: 3, startTime: '09:00', endTime: '17:00', activity: 'work' },
      { dayOfWeek: 4, startTime: '09:00', endTime: '17:00', activity: 'work' },
      { dayOfWeek: 5, startTime: '09:00', endTime: '17:00', activity: 'work' },
    ];
    const template = createTemplate({ name: 'Test Template', shifts: templateShifts });

    const agents = [
      { id: 'a1', name: 'Agent 1', skills: ['support'] },
    ];

    const result = generateWeeklySchedules({
      weekStart: '2026-03-09',
      templateId: template.id,
      agents,
      forecast,
    });

    // Template-based schedule should reference the templateId
    const templatedSchedule = result.schedules.find(s => s.templateId === template.id);
    expect(templatedSchedule).toBeDefined();

    // Template-based schedule should have the template shifts as base
    const workShifts = templatedSchedule!.shifts.filter(s => s.activity === 'work');
    expect(workShifts.length).toBeGreaterThanOrEqual(5);

    // Should have shifts on all 5 weekdays (from template)
    const workDays = new Set(workShifts.map(s => s.dayOfWeek));
    expect(workDays.has(1)).toBe(true);
    expect(workDays.has(2)).toBe(true);
    expect(workDays.has(3)).toBe(true);
    expect(workDays.has(4)).toBe(true);
    expect(workDays.has(5)).toBe(true);
  });

  it('reports coverage warnings for understaffed hours', () => {
    // High-volume forecast but only 1 agent
    const forecast = makeForecastPoints(buildWeekForecast({ peakVolume: 50, offPeakVolume: 20 }));
    const agents = [
      { id: 'a1', name: 'Solo Agent', skills: ['support'], maxHours: 20 },
    ];

    const result = generateWeeklySchedules({
      weekStart: '2026-03-09',
      agents,
      forecast,
    });

    // With high volume and limited agent hours, there should be coverage gaps
    expect(result.warnings.length).toBeGreaterThan(0);
    const coverageWarnings = result.warnings.filter(w => w.includes('Coverage gap'));
    expect(coverageWarnings.length).toBeGreaterThan(0);
  });

  it('warns when template is not found', () => {
    const forecast = makeForecastPoints(buildWeekForecast());
    const agents = [{ id: 'a1', name: 'Agent 1', skills: ['support'] }];

    const result = generateWeeklySchedules({
      weekStart: '2026-03-09',
      templateId: 'nonexistent-template-id',
      agents,
      forecast,
    });

    expect(result.warnings.some(w => w.includes('not found'))).toBe(true);
  });

  it('integrates QA scores into auto-schedule generation', () => {
    const forecast = makeForecastPoints(buildWeekForecast());
    const agents = [
      { id: 'low', name: 'Low QA', skills: ['support'] },
      { id: 'high', name: 'High QA', skills: ['support'] },
      { id: 'mid', name: 'Mid QA', skills: ['support'] },
    ];

    const result = generateWeeklySchedules({
      weekStart: '2026-03-09',
      agents,
      forecast,
      qaScores: { low: 30, high: 95, mid: 70 },
    });

    // Low-QA agent should have coaching (training) blocks
    const lowSched = result.schedules.find(s => s.userId === 'low');
    expect(lowSched).toBeDefined();
    const coachingBlocks = lowSched!.shifts.filter(
      s => s.activity === 'training' && s.label === 'QA Coaching',
    );
    expect(coachingBlocks.length).toBeGreaterThanOrEqual(1);

    // High-QA and mid-QA should NOT have coaching blocks
    const highSched = result.schedules.find(s => s.userId === 'high');
    if (highSched) {
      const highCoaching = highSched.shifts.filter(s => s.activity === 'training' && s.label === 'QA Coaching');
      expect(highCoaching.length).toBe(0);
    }
  });

  it('always marks result as needsReview', () => {
    const forecast = makeForecastPoints(buildWeekForecast());
    const result = generateWeeklySchedules({
      weekStart: '2026-03-09',
      agents: [{ id: 'a1', name: 'Agent 1', skills: ['support'] }],
      forecast,
    });
    expect(result.needsReview).toBe(true);
  });
});

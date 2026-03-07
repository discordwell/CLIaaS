import { describe, it, expect } from 'vitest';
import { optimizeSchedules } from '../optimizer';
import type { OptimizerConstraints, OptimizerInput } from '../optimizer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 7-day forecast with predictable volume (business hours = 12, off = 0). */
function makeWeekForecast(
  baseDate = '2026-03-02', // Monday
  businessHourVolume = 12,
  offHourVolume = 0,
): OptimizerInput['forecast'] {
  const points: OptimizerInput['forecast'] = [];
  const base = new Date(baseDate + 'T00:00:00Z');
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const dt = new Date(base.getTime() + d * 86400000 + h * 3600000);
      const bh = h >= 9 && h < 17;
      points.push({
        hour: dt.toISOString().slice(0, 14) + '00:00.000Z',
        predictedVolume: bh ? businessHourVolume : offHourVolume,
      });
    }
  }
  return points;
}

function makeAgents(count: number, skills: string[] = ['support']): OptimizerInput['agents'] {
  return Array.from({ length: count }, (_, i) => ({
    id: `agent-${i + 1}`,
    name: `Agent ${i + 1}`,
    skills,
  }));
}

function defaultConstraints(overrides?: Partial<OptimizerConstraints>): OptimizerConstraints {
  return {
    maxHoursPerWeek: 40,
    minRestBetweenShifts: 8,
    maxConsecutiveDays: 6,
    respectTimeOff: true,
    preferredShiftLength: 8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('optimizeSchedules', () => {
  // ---- Basic schedule generation ----

  it('generates schedules for 5 agents covering 7 days of forecast', () => {
    const input: OptimizerInput = {
      agents: makeAgents(5),
      forecast: makeWeekForecast(),
      constraints: defaultConstraints(),
    };

    const result = optimizeSchedules(input);

    // Should produce at least one schedule
    expect(result.schedules.length).toBeGreaterThan(0);
    expect(result.schedules.length).toBeLessThanOrEqual(5);

    // Every schedule should have shifts
    for (const sched of result.schedules) {
      expect(sched.shifts.length).toBeGreaterThan(0);
      expect(sched.userId).toBeTruthy();
      expect(sched.userName).toBeTruthy();
    }

    // Coverage array matches forecast length
    expect(result.coverage.length).toBe(input.forecast.length);

    // Score is between 0 and 100
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  // ---- Max hours per week constraint ----

  it('respects max hours per week constraint', () => {
    const maxHours = 20;
    const input: OptimizerInput = {
      agents: makeAgents(5),
      // Heavy volume all week — tries to assign a lot of hours
      forecast: makeWeekForecast('2026-03-02', 20, 5),
      constraints: defaultConstraints({ maxHoursPerWeek: maxHours }),
    };

    const result = optimizeSchedules(input);

    // Check that no agent is assigned more than maxHours
    for (const sched of result.schedules) {
      let totalHours = 0;
      for (const shift of sched.shifts) {
        const startH = parseInt(shift.startTime.split(':')[0], 10);
        const endH = parseInt(shift.endTime.split(':')[0], 10);
        totalHours += endH - startH;
      }
      expect(totalHours).toBeLessThanOrEqual(maxHours);
    }

    // No max_hours_exceeded violations
    const hoursViolations = result.violations.filter(v => v.type === 'max_hours_exceeded');
    expect(hoursViolations).toHaveLength(0);
  });

  // ---- Min rest between shifts ----

  it('respects min rest between non-contiguous shifts', () => {
    // Create a forecast that has demand early morning and late night to
    // tempt the optimizer into back-to-back shifts.
    const forecast: OptimizerInput['forecast'] = [];
    const base = new Date('2026-03-02T00:00:00Z');
    for (let d = 0; d < 2; d++) {
      for (let h = 0; h < 24; h++) {
        const dt = new Date(base.getTime() + d * 86400000 + h * 3600000);
        // Demand at 06-08 and 22-24 (only 6h gap if assigned both blocks)
        const demand = (h >= 6 && h < 8) || (h >= 22 && h < 24) ? 10 : 0;
        forecast.push({
          hour: dt.toISOString().slice(0, 14) + '00:00.000Z',
          predictedVolume: demand,
        });
      }
    }

    const input: OptimizerInput = {
      agents: makeAgents(3),
      forecast,
      constraints: defaultConstraints({ minRestBetweenShifts: 10 }),
    };

    const result = optimizeSchedules(input);

    // Should have zero min_rest violations
    const restViolations = result.violations.filter(v => v.type === 'min_rest_violated');
    expect(restViolations).toHaveLength(0);
  });

  // ---- Time-off periods are excluded ----

  it('excludes agents on time-off from assignments', () => {
    const input: OptimizerInput = {
      agents: makeAgents(2),
      forecast: makeWeekForecast('2026-03-02', 8, 0),
      constraints: defaultConstraints({ respectTimeOff: true }),
      timeOff: [
        // Agent 1 has the entire week off
        { agentId: 'agent-1', startDate: '2026-03-02', endDate: '2026-03-08' },
      ],
    };

    const result = optimizeSchedules(input);

    // Agent 1 should have no schedule
    const agent1Schedule = result.schedules.find(s => s.userId === 'agent-1');
    expect(agent1Schedule).toBeUndefined();

    // Agent 2 should have assignments
    const agent2Schedule = result.schedules.find(s => s.userId === 'agent-2');
    expect(agent2Schedule).toBeDefined();
    expect(agent2Schedule!.shifts.length).toBeGreaterThan(0);
  });

  // ---- Skill matching ----

  it('does not assign agents without required skills', () => {
    const agents: OptimizerInput['agents'] = [
      { id: 'agent-1', name: 'Skilled', skills: ['billing', 'support'] },
      { id: 'agent-2', name: 'Unskilled', skills: ['support'] },
      { id: 'agent-3', name: 'Also Skilled', skills: ['billing', 'tier2'] },
    ];

    const input: OptimizerInput = {
      agents,
      forecast: makeWeekForecast('2026-03-02', 8, 0),
      constraints: defaultConstraints({ requiredSkills: ['billing'] }),
    };

    const result = optimizeSchedules(input);

    // Agent 2 should NOT appear (lacks 'billing')
    const agent2Schedule = result.schedules.find(s => s.userId === 'agent-2');
    expect(agent2Schedule).toBeUndefined();

    // Only agents with billing skill get schedules
    for (const sched of result.schedules) {
      const agent = agents.find(a => a.id === sched.userId);
      expect(agent).toBeDefined();
      expect(agent!.skills).toContain('billing');
    }
  });

  // ---- Coverage score reflects gaps ----

  it('coverage score reflects gaps accurately', () => {
    // Lots of demand, very few agents — expect low score
    const input: OptimizerInput = {
      agents: makeAgents(1),
      forecast: makeWeekForecast('2026-03-02', 30, 10), // needs ~7 agents per biz hour
      constraints: defaultConstraints(),
    };

    const result = optimizeSchedules(input);

    // With only 1 agent and high demand, score should be well below 100
    expect(result.score).toBeLessThan(50);

    // Coverage gaps should exist
    const gapsAboveZero = result.coverage.filter(c => c.gap > 0);
    expect(gapsAboveZero.length).toBeGreaterThan(0);
  });

  it('perfect coverage yields score near 100', () => {
    // Low demand, many agents — should approach 100
    const input: OptimizerInput = {
      agents: makeAgents(10),
      forecast: makeWeekForecast('2026-03-02', 2, 0), // ~1 agent per biz hour
      constraints: defaultConstraints(),
    };

    const result = optimizeSchedules(input);

    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  // ---- Empty forecast ----

  it('empty forecast produces empty schedules', () => {
    const input: OptimizerInput = {
      agents: makeAgents(3),
      forecast: [],
      constraints: defaultConstraints(),
    };

    const result = optimizeSchedules(input);

    expect(result.schedules).toHaveLength(0);
    expect(result.coverage).toHaveLength(0);
    expect(result.violations).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  // ---- Zero-volume forecast produces empty schedules ----

  it('zero-volume forecast produces no assignments', () => {
    const input: OptimizerInput = {
      agents: makeAgents(3),
      forecast: makeWeekForecast('2026-03-02', 0, 0),
      constraints: defaultConstraints(),
    };

    const result = optimizeSchedules(input);

    expect(result.schedules).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  // ---- Consecutive days limit ----

  it('respects max consecutive days constraint', () => {
    // 7-day forecast but maxConsecutiveDays = 3
    const input: OptimizerInput = {
      agents: makeAgents(1),
      forecast: makeWeekForecast('2026-03-02', 4, 0), // needs exactly 1 agent per biz hour
      constraints: defaultConstraints({ maxConsecutiveDays: 3 }),
    };

    const result = optimizeSchedules(input);

    // The single agent should not work more than 3 consecutive days
    for (const sched of result.schedules) {
      const dates = new Set<string>();
      for (const slot of input.forecast) {
        // Check which dates this agent actually got assigned via coverage
        // We'll infer from shifts + effectiveFrom/To
      }
      // Instead, verify via the shifts: extract unique dayOfWeek values
      // and check the effective date range
      const workDates = new Set<string>();
      for (const shift of sched.shifts) {
        // Reconstruct dates from effectiveFrom + dayOfWeek
        const from = new Date(sched.effectiveFrom + 'T00:00:00Z');
        const to = new Date((sched.effectiveTo ?? sched.effectiveFrom) + 'T00:00:00Z');
        for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) {
          if (d.getUTCDay() === shift.dayOfWeek) {
            workDates.add(d.toISOString().slice(0, 10));
          }
        }
      }

      // Check consecutive runs
      const sorted = [...workDates].sort();
      let run = 1;
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1] + 'T00:00:00Z');
        const curr = new Date(sorted[i] + 'T00:00:00Z');
        const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        if (diff === 1) {
          run++;
          expect(run).toBeLessThanOrEqual(3);
        } else {
          run = 1;
        }
      }
    }

    // No consecutive_days violations
    const dayViolations = result.violations.filter(
      v => v.type === 'consecutive_days_exceeded',
    );
    expect(dayViolations).toHaveLength(0);
  });

  // ---- Preferences influence assignment ----

  it('prefers agents with matching day preferences', () => {
    const agents: OptimizerInput['agents'] = [
      {
        id: 'agent-1',
        name: 'Weekday Pref',
        skills: ['support'],
        preferences: { preferredDays: [1, 2, 3, 4, 5] }, // Mon-Fri
      },
      {
        id: 'agent-2',
        name: 'Weekend Pref',
        skills: ['support'],
        preferences: { preferredDays: [0, 6] }, // Sat, Sun
      },
    ];

    // Forecast: only Saturday (day 5 in the week = index offset)
    // Base is Monday 2026-03-02 => Saturday is 2026-03-07 (DOW=6)
    const forecast: OptimizerInput['forecast'] = [];
    const saturday = new Date('2026-03-07T00:00:00Z');
    for (let h = 9; h < 17; h++) {
      const dt = new Date(saturday.getTime() + h * 3600000);
      forecast.push({
        hour: dt.toISOString().slice(0, 14) + '00:00.000Z',
        predictedVolume: 4, // needs 1 agent
      });
    }

    const input: OptimizerInput = {
      agents,
      forecast,
      constraints: defaultConstraints(),
    };

    const result = optimizeSchedules(input);

    // Agent 2 (weekend preference) should be assigned (or at least preferred)
    const agent2Sched = result.schedules.find(s => s.userId === 'agent-2');
    expect(agent2Sched).toBeDefined();
  });

  // ---- Existing schedules count toward limits ----

  it('existing schedules count toward max hours', () => {
    const input: OptimizerInput = {
      agents: makeAgents(1, ['support']),
      forecast: makeWeekForecast('2026-03-02', 4, 0), // needs 1 agent per biz hour
      constraints: defaultConstraints({ maxHoursPerWeek: 10 }),
      existingSchedules: [
        {
          id: 'existing-1',
          userId: 'agent-1',
          userName: 'Agent 1',
          effectiveFrom: '2026-03-02',
          timezone: 'UTC',
          shifts: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }, // 8h already used
          ],
          createdAt: '',
          updatedAt: '',
        },
      ],
    };

    const result = optimizeSchedules(input);

    // Agent only has 2 hours left out of 10 (8 from existing)
    // So total new assignment should be <= 2 hours
    const sched = result.schedules.find(s => s.userId === 'agent-1');
    if (sched) {
      let newHours = 0;
      for (const shift of sched.shifts) {
        const startH = parseInt(shift.startTime.split(':')[0], 10);
        const endH = parseInt(shift.endTime.split(':')[0], 10);
        newHours += endH - startH;
      }
      expect(newHours).toBeLessThanOrEqual(2);
    }
  });

  // ---- Result structure integrity ----

  it('result has correct structure with all required fields', () => {
    const input: OptimizerInput = {
      agents: makeAgents(3),
      forecast: makeWeekForecast('2026-03-02', 8, 0),
      constraints: defaultConstraints(),
    };

    const result = optimizeSchedules(input);

    // Schedules have required fields
    for (const sched of result.schedules) {
      expect(sched).toHaveProperty('id');
      expect(sched).toHaveProperty('userId');
      expect(sched).toHaveProperty('userName');
      expect(sched).toHaveProperty('effectiveFrom');
      expect(sched).toHaveProperty('timezone');
      expect(sched).toHaveProperty('shifts');
      expect(sched).toHaveProperty('createdAt');
      expect(sched).toHaveProperty('updatedAt');

      for (const shift of sched.shifts) {
        expect(shift).toHaveProperty('dayOfWeek');
        expect(shift).toHaveProperty('startTime');
        expect(shift).toHaveProperty('endTime');
        expect(shift.dayOfWeek).toBeGreaterThanOrEqual(0);
        expect(shift.dayOfWeek).toBeLessThanOrEqual(6);
      }
    }

    // Coverage entries have required fields
    for (const c of result.coverage) {
      expect(c).toHaveProperty('hour');
      expect(c).toHaveProperty('required');
      expect(c).toHaveProperty('assigned');
      expect(c).toHaveProperty('gap');
      expect(c.gap).toBe(c.required - c.assigned);
    }

    // Violations have required fields
    for (const v of result.violations) {
      expect(v).toHaveProperty('agentId');
      expect(v).toHaveProperty('type');
      expect(v).toHaveProperty('detail');
    }
  });
});

/**
 * WFM Schedule Optimizer — greedy heuristic with constraint satisfaction.
 *
 * Given a set of agents, a volume forecast, and constraints (max hours, min rest,
 * consecutive-day limits, skill matching, time-off), the optimizer produces shift
 * assignments that minimise coverage gaps while respecting all hard constraints.
 */

import type { AgentSchedule, ShiftBlock } from './types';
import { genId } from './store';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface OptimizerConstraints {
  maxHoursPerWeek: number;       // default 40
  minRestBetweenShifts: number;  // hours, default 8
  maxConsecutiveDays: number;    // default 6
  requiredSkills?: string[];     // only assign agents with these skills
  respectTimeOff: boolean;       // default true
  preferredShiftLength: number;  // hours, default 8
}

export interface OptimizerInput {
  agents: Array<{
    id: string;
    name: string;
    skills: string[];
    maxHours?: number;
    preferences?: { preferredDays?: number[]; preferredStartHour?: number };
  }>;
  forecast: Array<{ hour: string; predictedVolume: number; dayOfWeek?: number }>;
  constraints: OptimizerConstraints;
  existingSchedules?: AgentSchedule[];
  timeOff?: Array<{ agentId: string; startDate: string; endDate: string }>;
  qaScores?: Record<string, number>; // agentId → score 0-100
  qaThresholds?: { coachingBelow: number; peakAbove: number }; // default 60, 85
}

export interface OptimizerResult {
  schedules: AgentSchedule[];
  coverage: Array<{ hour: string; required: number; assigned: number; gap: number }>;
  violations: Array<{ agentId: string; type: string; detail: string }>;
  score: number; // 0-100, higher is better
  coachingBlocks?: Map<string, ShiftBlock[]>; // agentId → coaching shifts (low-QA agents)
}

export type QATier = 'low' | 'mid' | 'high';

const DEFAULT_QA_THRESHOLDS = { coachingBelow: 60, peakAbove: 85 };

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONSTRAINTS: OptimizerConstraints = {
  maxHoursPerWeek: 40,
  minRestBetweenShifts: 8,
  maxConsecutiveDays: 6,
  respectTimeOff: true,
  preferredShiftLength: 8,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse an ISO hour string into a Date. */
function parseHour(hourStr: string): Date {
  return new Date(hourStr);
}

/** Calculate required agents for a single hour using the same logic as calculateStaffing. */
function requiredAgentsForHour(
  predictedVolume: number,
  avgHandleMinutes = 15,
  targetOccupancy = 0.75,
): number {
  if (predictedVolume <= 0) return 0;
  return Math.ceil((predictedVolume * avgHandleMinutes) / (60 * targetOccupancy));
}

/** Get the YYYY-MM-DD date string for a Date. */
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Tracks per-agent assignment state during optimisation.
 */
interface AgentTracker {
  agentId: string;
  agentName: string;
  skills: string[];
  maxHours: number;
  assignedHours: number;
  /** Set of ISO hour strings this agent is assigned to. */
  assignedSlots: Set<string>;
  /** Sorted list of assigned Date timestamps (ms) for rest-gap checks. */
  assignedTimestamps: number[];
  /** Set of YYYY-MM-DD date strings the agent works on. */
  workDates: Set<string>;
  preferences?: { preferredDays?: number[]; preferredStartHour?: number };
  qaTier: QATier;
}

/** Check whether a date falls within a time-off range (inclusive). */
function isOnTimeOff(
  date: Date,
  agentId: string,
  timeOff: Array<{ agentId: string; startDate: string; endDate: string }>,
): boolean {
  const ds = dateStr(date);
  for (const to of timeOff) {
    if (to.agentId === agentId && ds >= to.startDate && ds <= to.endDate) return true;
  }
  return false;
}

/**
 * Check whether assigning `hourTs` (epoch ms) violates the minimum rest
 * constraint relative to the agent's other assignments.
 */
function violatesMinRest(
  tracker: AgentTracker,
  hourTs: number,
  minRestMs: number,
): boolean {
  for (const ts of tracker.assignedTimestamps) {
    const diff = Math.abs(hourTs - ts);
    // Slots within the same contiguous shift are fine (diff <= 3600000 means
    // consecutive hours — no rest gap required).  Only non-contiguous blocks
    // need the rest check.
    if (diff > 3_600_000 && diff < minRestMs) return true;
  }
  return false;
}

/**
 * Check whether assigning the agent on `date` would exceed the max
 * consecutive working days.
 */
function violatesConsecutiveDays(
  tracker: AgentTracker,
  date: Date,
  maxConsecutive: number,
): boolean {
  // Temporarily add the candidate date
  const ds = dateStr(date);
  if (tracker.workDates.has(ds)) return false; // already working that day

  const allDates = [...tracker.workDates, ds].sort();
  // Check the longest consecutive run
  let run = 1;
  for (let i = 1; i < allDates.length; i++) {
    const prev = new Date(allDates[i - 1] + 'T00:00:00Z');
    const curr = new Date(allDates[i] + 'T00:00:00Z');
    const diffDays = Math.round(
      (curr.getTime() - prev.getTime()) / 86_400_000,
    );
    if (diffDays === 1) {
      run++;
      if (run > maxConsecutive) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/**
 * Identify whether the agent has the required skills.
 */
function hasRequiredSkills(
  agentSkills: string[],
  required: string[] | undefined,
): boolean {
  if (!required || required.length === 0) return true;
  return required.every(s => agentSkills.includes(s));
}

/**
 * Score an agent for a slot — lower is better (used for sorting).
 * Prefers agents with fewer assigned hours, matching preferences,
 * and factors in QA tier for peak-hour preference.
 */
function agentPriority(
  tracker: AgentTracker,
  hourDate: Date,
  isPeakHour: boolean,
): number {
  let score = tracker.assignedHours; // lower hours = preferred

  // QA-weighted: high-QA agents preferred for peak hours
  if (isPeakHour) {
    if (tracker.qaTier === 'high') score -= 10;
    else if (tracker.qaTier === 'low') score += 10;
  }

  // Preference bonus — subtract from score (making it lower = more preferred)
  if (tracker.preferences) {
    const dow = hourDate.getUTCDay();
    if (
      tracker.preferences.preferredDays &&
      tracker.preferences.preferredDays.includes(dow)
    ) {
      score -= 2;
    }
    if (
      tracker.preferences.preferredStartHour !== undefined &&
      hourDate.getUTCHours() === tracker.preferences.preferredStartHour
    ) {
      score -= 1;
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// QA-weighted scheduling helpers
// ---------------------------------------------------------------------------

/** Classify an agent into a QA tier based on their score. */
export function classifyAgentQA(
  agentId: string,
  qaScores: Record<string, number> | undefined,
  thresholds: { coachingBelow: number; peakAbove: number },
): QATier {
  if (!qaScores || !(agentId in qaScores)) return 'mid';
  const score = qaScores[agentId];
  if (score < thresholds.coachingBelow) return 'low';
  if (score >= thresholds.peakAbove) return 'high';
  return 'mid';
}

/** Identify peak hours for a given day of week from the forecast. */
function identifyPeakHours(
  forecast: Array<{ hour: string; predictedVolume: number; dayOfWeek?: number }>,
  dayOfWeek: number,
): Set<number> {
  const dayPoints = forecast.filter(fp => {
    const dow = fp.dayOfWeek ?? new Date(fp.hour).getUTCDay();
    return dow === dayOfWeek;
  });
  if (dayPoints.length === 0) return new Set();

  const volumes = dayPoints.map(fp => fp.predictedVolume);
  const maxVol = Math.max(...volumes);
  if (maxVol === 0) return new Set();

  // Peak = hours with volume >= 70% of max
  const threshold = maxVol * 0.7;
  const peaks = new Set<number>();
  for (const fp of dayPoints) {
    if (fp.predictedVolume >= threshold) {
      peaks.add(new Date(fp.hour).getUTCHours());
    }
  }
  return peaks;
}

/** Identify off-peak business hours suitable for coaching blocks. */
function identifyOffPeakHours(
  forecast: Array<{ hour: string; predictedVolume: number; dayOfWeek?: number }>,
  dayOfWeek: number,
): number[] {
  const peaks = identifyPeakHours(forecast, dayOfWeek);
  const dayPoints = forecast.filter(fp => {
    const dow = fp.dayOfWeek ?? new Date(fp.hour).getUTCDay();
    return dow === dayOfWeek;
  });
  return dayPoints
    .filter(fp => fp.predictedVolume > 0)
    .map(fp => new Date(fp.hour).getUTCHours())
    .filter(h => !peaks.has(h))
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Group consecutive assigned hours into ShiftBlocks per (agent, dayOfWeek).
// ---------------------------------------------------------------------------

function buildShiftBlocks(
  assignedSlots: Set<string>,
): ShiftBlock[] {
  if (assignedSlots.size === 0) return [];

  // Group by YYYY-MM-DD
  const byDate = new Map<string, number[]>();
  for (const slot of assignedSlots) {
    const d = parseHour(slot);
    const ds = dateStr(d);
    let hours = byDate.get(ds);
    if (!hours) {
      hours = [];
      byDate.set(ds, hours);
    }
    hours.push(d.getUTCHours());
  }

  const shifts: ShiftBlock[] = [];

  for (const [ds, hours] of byDate) {
    hours.sort((a, b) => a - b);
    const dow = new Date(ds + 'T00:00:00Z').getUTCDay();

    let blockStart = hours[0];
    let blockEnd = hours[0] + 1;

    for (let i = 1; i < hours.length; i++) {
      if (hours[i] === blockEnd) {
        blockEnd = hours[i] + 1;
      } else {
        shifts.push({
          dayOfWeek: dow,
          startTime: String(blockStart).padStart(2, '0') + ':00',
          endTime: String(blockEnd).padStart(2, '0') + ':00',
          activity: 'work',
        });
        blockStart = hours[i];
        blockEnd = hours[i] + 1;
      }
    }
    // push last block
    shifts.push({
      dayOfWeek: dow,
      startTime: String(blockStart).padStart(2, '0') + ':00',
      endTime: String(blockEnd).padStart(2, '0') + ':00',
      activity: 'work',
    });
  }

  return shifts;
}

// ---------------------------------------------------------------------------
// Main optimiser
// ---------------------------------------------------------------------------

export function optimizeSchedules(input: OptimizerInput): OptimizerResult {
  const constraints = { ...DEFAULT_CONSTRAINTS, ...input.constraints };
  const timeOff = input.timeOff ?? [];
  const minRestMs = constraints.minRestBetweenShifts * 3_600_000;

  // ---- 1. Calculate required agents per forecast hour ----
  const hourlyRequirements: Array<{
    hourStr: string;
    hourDate: Date;
    required: number;
    assigned: number;
  }> = [];

  for (const fp of input.forecast) {
    const required = requiredAgentsForHour(fp.predictedVolume);
    hourlyRequirements.push({
      hourStr: fp.hour,
      hourDate: parseHour(fp.hour),
      required,
      assigned: 0,
    });
  }

  // ---- 2. Initialise agent trackers (with QA tier classification) ----
  const qaThresholds = input.qaThresholds ?? DEFAULT_QA_THRESHOLDS;
  const trackers = new Map<string, AgentTracker>();
  for (const agent of input.agents) {
    // Skip agents that lack required skills
    if (!hasRequiredSkills(agent.skills, constraints.requiredSkills)) continue;

    trackers.set(agent.id, {
      agentId: agent.id,
      agentName: agent.name,
      skills: agent.skills,
      maxHours: agent.maxHours ?? constraints.maxHoursPerWeek,
      assignedHours: 0,
      assignedSlots: new Set(),
      assignedTimestamps: [],
      workDates: new Set(),
      preferences: agent.preferences,
      qaTier: classifyAgentQA(agent.id, input.qaScores, qaThresholds),
    });
  }

  // Pre-compute peak hours per day-of-week for QA-weighted assignment
  const peakHoursByDay = new Map<number, Set<number>>();
  for (let dow = 0; dow < 7; dow++) {
    peakHoursByDay.set(dow, identifyPeakHours(input.forecast, dow));
  }

  // Pre-populate from existing schedules
  if (input.existingSchedules) {
    for (const sched of input.existingSchedules) {
      const tracker = trackers.get(sched.userId);
      if (!tracker) continue;
      for (const shift of sched.shifts) {
        const startH = parseInt(shift.startTime.split(':')[0], 10);
        const endH = parseInt(shift.endTime.split(':')[0], 10);
        const hoursInShift = endH - startH;
        if (hoursInShift > 0) {
          tracker.assignedHours += hoursInShift;
        }
      }
    }
  }

  // ---- 3. Sort hours by staffing gap (descending) and greedily assign ----
  // Sort by required descending so biggest gaps get filled first
  const sortedHours = [...hourlyRequirements].sort(
    (a, b) => b.required - a.required,
  );

  const violations: OptimizerResult['violations'] = [];

  for (const slot of sortedHours) {
    if (slot.required <= 0) continue;

    // Collect eligible agents, sorted by priority
    const eligible: AgentTracker[] = [];
    for (const tracker of trackers.values()) {
      // Already assigned this slot?
      if (tracker.assignedSlots.has(slot.hourStr)) {
        slot.assigned++;
        continue;
      }

      // Max hours reached?
      if (tracker.assignedHours >= tracker.maxHours) continue;

      // Time-off?
      if (constraints.respectTimeOff && isOnTimeOff(slot.hourDate, tracker.agentId, timeOff)) {
        continue;
      }

      // Min rest between non-contiguous shifts?
      if (violatesMinRest(tracker, slot.hourDate.getTime(), minRestMs)) continue;

      // Consecutive day limit?
      if (violatesConsecutiveDays(tracker, slot.hourDate, constraints.maxConsecutiveDays)) continue;

      eligible.push(tracker);
    }

    // Sort by priority (fewer hours first, QA-weighted for peak hours)
    const slotDow = slot.hourDate.getUTCDay();
    const slotHour = slot.hourDate.getUTCHours();
    const isPeak = peakHoursByDay.get(slotDow)?.has(slotHour) ?? false;
    eligible.sort((a, b) => agentPriority(a, slot.hourDate, isPeak) - agentPriority(b, slot.hourDate, isPeak));

    // Assign agents until required count met or no more eligible
    const stillNeeded = slot.required - slot.assigned;
    const toAssign = eligible.slice(0, Math.max(0, stillNeeded));

    for (const tracker of toAssign) {
      tracker.assignedSlots.add(slot.hourStr);
      tracker.assignedHours++;
      tracker.assignedTimestamps.push(slot.hourDate.getTime());
      tracker.workDates.add(dateStr(slot.hourDate));
      slot.assigned++;
    }
  }

  // ---- 4. Build AgentSchedule objects from assignments ----
  const schedules: AgentSchedule[] = [];
  const now = new Date().toISOString();

  for (const tracker of trackers.values()) {
    if (tracker.assignedSlots.size === 0) continue;

    const shifts = buildShiftBlocks(tracker.assignedSlots);
    if (shifts.length === 0) continue;

    // Derive effectiveFrom / effectiveTo from assigned slots
    const sortedSlots = [...tracker.assignedSlots].sort();
    const effectiveFrom = sortedSlots[0].slice(0, 10);
    const effectiveTo = sortedSlots[sortedSlots.length - 1].slice(0, 10);

    schedules.push({
      id: genId('opt-sched'),
      userId: tracker.agentId,
      userName: tracker.agentName,
      effectiveFrom,
      effectiveTo,
      timezone: 'UTC',
      shifts,
      createdAt: now,
      updatedAt: now,
    });
  }

  // ---- 5. Build coverage report ----
  const coverage: OptimizerResult['coverage'] = hourlyRequirements.map(h => ({
    hour: h.hourStr,
    required: h.required,
    assigned: h.assigned,
    gap: h.required - h.assigned,
  }));

  // ---- 6. Detect constraint violations (post-hoc audit) ----
  for (const tracker of trackers.values()) {
    if (tracker.assignedHours > tracker.maxHours) {
      violations.push({
        agentId: tracker.agentId,
        type: 'max_hours_exceeded',
        detail: `Assigned ${tracker.assignedHours}h, max ${tracker.maxHours}h`,
      });
    }

    // Check consecutive days
    const sortedDates = [...tracker.workDates].sort();
    let run = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1] + 'T00:00:00Z');
      const curr = new Date(sortedDates[i] + 'T00:00:00Z');
      const diff = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);
      if (diff === 1) {
        run++;
        if (run > constraints.maxConsecutiveDays) {
          violations.push({
            agentId: tracker.agentId,
            type: 'consecutive_days_exceeded',
            detail: `${run} consecutive days, max ${constraints.maxConsecutiveDays}`,
          });
          break;
        }
      } else {
        run = 1;
      }
    }

    // Check min rest between non-contiguous shift blocks
    const ts = [...tracker.assignedTimestamps].sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i] - ts[i - 1];
      if (gap > 3_600_000 && gap < minRestMs) {
        violations.push({
          agentId: tracker.agentId,
          type: 'min_rest_violated',
          detail: `Only ${(gap / 3_600_000).toFixed(1)}h rest, min ${constraints.minRestBetweenShifts}h`,
        });
        break; // one violation per agent is enough
      }
    }
  }

  // ---- 7. Assign coaching blocks for low-QA agents ----
  const coachingBlocks = new Map<string, ShiftBlock[]>();
  if (input.qaScores) {
    for (const tracker of trackers.values()) {
      if (tracker.qaTier !== 'low') continue;
      if (tracker.workDates.size === 0) continue;

      const agentCoaching: ShiftBlock[] = [];
      const targetCoachingCount = tracker.workDates.size >= 4 ? 2 : 1;
      let coachingCount = 0;

      const sortedWorkDates = [...tracker.workDates].sort();
      for (const ds of sortedWorkDates) {
        if (coachingCount >= targetCoachingCount) break;

        const dow = new Date(ds + 'T00:00:00Z').getUTCDay();
        const offPeak = identifyOffPeakHours(input.forecast, dow);
        const dayPeaks = peakHoursByDay.get(dow) ?? new Set<number>();

        // Find agent's work hours for this date
        const agentWorkHours = [...tracker.assignedSlots]
          .filter(s => dateStr(parseHour(s)) === ds)
          .map(s => parseHour(s).getUTCHours())
          .sort((a, b) => a - b);

        let placed = false;

        // Strategy 1: Find off-peak hours already in agent's work shift
        for (const offHour of offPeak) {
          if (agentWorkHours.includes(offHour)) {
            agentCoaching.push({
              dayOfWeek: dow,
              startTime: String(offHour).padStart(2, '0') + ':00',
              endTime: String(offHour + 1).padStart(2, '0') + ':00',
              activity: 'training',
              label: 'QA Coaching',
            });
            placed = true;
            break;
          }
        }

        // Strategy 2: Add an adjacent off-peak hour for coaching (extend shift)
        if (!placed && agentWorkHours.length > 0) {
          const earliest = agentWorkHours[0];
          const latest = agentWorkHours[agentWorkHours.length - 1];

          // Try 1 hour before the shift (if off-peak and within business hours)
          if (earliest > 0 && !dayPeaks.has(earliest - 1)) {
            const h = earliest - 1;
            agentCoaching.push({
              dayOfWeek: dow,
              startTime: String(h).padStart(2, '0') + ':00',
              endTime: String(h + 1).padStart(2, '0') + ':00',
              activity: 'training',
              label: 'QA Coaching',
            });
            placed = true;
          }

          // Try 1 hour after the shift (if off-peak and within business hours)
          if (!placed && latest < 23 && !dayPeaks.has(latest + 1)) {
            const h = latest + 1;
            agentCoaching.push({
              dayOfWeek: dow,
              startTime: String(h).padStart(2, '0') + ':00',
              endTime: String(h + 1).padStart(2, '0') + ':00',
              activity: 'training',
              label: 'QA Coaching',
            });
            placed = true;
          }
        }

        // Strategy 3: Last resort — use any off-peak hour for this day
        if (!placed && offPeak.length > 0) {
          const h = offPeak[0];
          agentCoaching.push({
            dayOfWeek: dow,
            startTime: String(h).padStart(2, '0') + ':00',
            endTime: String(h + 1).padStart(2, '0') + ':00',
            activity: 'training',
            label: 'QA Coaching',
          });
          placed = true;
        }

        if (placed) coachingCount++;
      }

      if (agentCoaching.length > 0) {
        coachingBlocks.set(tracker.agentId, agentCoaching);
        // Also inject coaching blocks into the agent's schedule
        const sched = schedules.find(s => s.userId === tracker.agentId);
        if (sched) {
          sched.shifts.push(...agentCoaching);
        }
      }

      if (coachingCount === 0) {
        violations.push({
          agentId: tracker.agentId,
          type: 'coaching_not_scheduled',
          detail: `QA score below ${qaThresholds.coachingBelow} but no coaching slot found`,
        });
      }
    }
  }

  // ---- 8. Compute overall score (0-100) ----
  const totalRequired = coverage.reduce((s, c) => s + c.required, 0);
  const totalAssigned = coverage.reduce((s, c) => s + Math.min(c.assigned, c.required), 0);
  const coverageRatio = totalRequired > 0 ? totalAssigned / totalRequired : 1;
  const violationPenalty = Math.min(violations.length * 5, 30); // cap at 30
  const score = Math.max(0, Math.min(100, Math.round(coverageRatio * 100 - violationPenalty)));

  return { schedules, coverage, violations, score, coachingBlocks };
}

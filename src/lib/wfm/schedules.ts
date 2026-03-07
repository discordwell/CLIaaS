/**
 * Schedule and template CRUD + helpers for the WFM domain.
 * Includes auto-schedule generation (B12) using the optimizer.
 */

import type { AgentSchedule, ForecastPoint, ScheduleTemplate, ScheduledActivity, ShiftBlock } from './types';
import {
  getSchedulesStore, addSchedule, updateScheduleStore, removeSchedule,
  getTemplatesStore, addTemplate, updateTemplateStore, removeTemplate,
  getTimeOffStore, genId,
} from './store';
import { optimizeSchedules } from './optimizer';
import type { OptimizerConstraints } from './optimizer';

export function getTemplates(id?: string): ScheduleTemplate[] {
  const all = getTemplatesStore();
  return id ? all.filter(t => t.id === id) : all;
}

export function createTemplate(input: { name: string; shifts: ShiftBlock[] }): ScheduleTemplate {
  const now = new Date().toISOString();
  const t: ScheduleTemplate = { id: genId('tmpl'), name: input.name, shifts: input.shifts, createdAt: now, updatedAt: now };
  addTemplate(t);
  return t;
}

export function updateTemplate(id: string, updates: Partial<Pick<ScheduleTemplate, 'name' | 'shifts'>>): ScheduleTemplate | null {
  return updateTemplateStore(id, updates);
}

export function deleteTemplate(id: string): boolean { return removeTemplate(id); }

export function getSchedules(userId?: string): AgentSchedule[] { return getSchedulesStore(userId); }

export function createSchedule(input: {
  userId: string; userName: string; templateId?: string; effectiveFrom: string;
  effectiveTo?: string; timezone: string; shifts: ShiftBlock[];
}): AgentSchedule {
  const now = new Date().toISOString();
  const s: AgentSchedule = { id: genId('sched'), ...input, createdAt: now, updatedAt: now };
  addSchedule(s);
  return s;
}

export function updateSchedule(id: string, updates: Partial<Pick<AgentSchedule, 'templateId' | 'effectiveFrom' | 'effectiveTo' | 'timezone' | 'shifts'>>): AgentSchedule | null {
  return updateScheduleStore(id, updates);
}

export function deleteSchedule(id: string): boolean { return removeSchedule(id); }

export function applyTemplate(scheduleId: string, templateId: string): AgentSchedule | null {
  const tmpls = getTemplatesStore();
  const tmpl = tmpls.find(t => t.id === templateId);
  if (!tmpl) return null;
  return updateScheduleStore(scheduleId, { templateId, shifts: [...tmpl.shifts] });
}

export function detectConflicts(userId: string, newShifts: ShiftBlock[], effectiveFrom: string, effectiveTo?: string): Array<{ type: string; detail: string }> {
  const conflicts: Array<{ type: string; detail: string }> = [];

  // Check overlapping shifts in existing schedules
  const existing = getSchedulesStore(userId);
  for (const sched of existing) {
    const schedEnd = sched.effectiveTo ?? '9999-12-31';
    const newEnd = effectiveTo ?? '9999-12-31';
    if (effectiveFrom <= schedEnd && newEnd >= sched.effectiveFrom) {
      for (const ns of newShifts) for (const es of sched.shifts) {
        if (ns.dayOfWeek === es.dayOfWeek && ns.startTime < es.endTime && ns.endTime > es.startTime) {
          conflicts.push({ type: 'shift_overlap', detail: `Day ${ns.dayOfWeek}: ${ns.startTime}-${ns.endTime} overlaps ${es.startTime}-${es.endTime} in ${sched.id}` });
        }
      }
    }
  }

  // Check approved time-off within the effective date range
  const timeOff = getTimeOffStore(userId, 'approved');
  const newEnd = effectiveTo ?? '9999-12-31';
  for (const pto of timeOff) {
    if (pto.startDate <= newEnd && pto.endDate >= effectiveFrom) {
      conflicts.push({ type: 'time_off_overlap', detail: `Approved time off ${pto.startDate} to ${pto.endDate} (${pto.reason ?? 'no reason'})` });
    }
  }

  return conflicts;
}

export function getScheduledActivity(schedule: AgentSchedule, at?: Date): ScheduledActivity {
  const now = at ?? new Date();
  const dow = now.getUTCDay();
  const curMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const dayShifts = schedule.shifts.filter(s => s.dayOfWeek === dow)
    .sort((a, b) => (a.activity === 'work' ? 0 : 1) - (b.activity === 'work' ? 0 : 1));
  let result: ScheduledActivity = 'off_shift';
  for (const shift of dayShifts) {
    const [sh, sm] = shift.startTime.split(':').map(Number);
    const [eh, em] = shift.endTime.split(':').map(Number);
    if (curMin >= sh*60+sm && curMin < eh*60+em) result = shift.activity as ScheduledActivity;
  }
  return result;
}

export function countScheduledAgents(schedules: AgentSchedule[], hourStr: string): number {
  const d = new Date(hourStr); d.setUTCMinutes(30);
  let count = 0;
  for (const s of schedules) if (getScheduledActivity(s, d) === 'work') count++;
  return count;
}

// ---------------------------------------------------------------------------
// B12: Auto-schedule generation
// ---------------------------------------------------------------------------

export interface AutoScheduleInput {
  weekStart: string; // ISO date (Monday)
  templateId?: string;
  agents: Array<{ id: string; name: string; skills: string[]; maxHours?: number }>;
  forecast: ForecastPoint[];
  constraints?: Partial<OptimizerConstraints>;
  qaScores?: Record<string, number>;
}

export interface AutoScheduleResult {
  schedules: AgentSchedule[];
  coverage: Array<{ hour: string; assigned: number; required: number }>;
  warnings: string[];
  needsReview: boolean;
}

/**
 * Generate a full weekly schedule for the given agents using forecast data
 * and (optionally) a template as the baseline. Results are flagged for
 * admin review before they take effect.
 */
export function generateWeeklySchedules(input: AutoScheduleInput): AutoScheduleResult {
  const warnings: string[] = [];

  // 1. If templateId provided, load template shifts as base
  let templateShifts: ShiftBlock[] | undefined;
  if (input.templateId) {
    const templates = getTemplatesStore();
    const tmpl = templates.find(t => t.id === input.templateId);
    if (tmpl) {
      templateShifts = tmpl.shifts;
    } else {
      warnings.push(`Template ${input.templateId} not found; generating schedule from forecast only.`);
    }
  }

  // 2. Build optimizer input
  const optimizerConstraints: OptimizerConstraints = {
    maxHoursPerWeek: 40,
    minRestBetweenShifts: 8,
    maxConsecutiveDays: 6,
    respectTimeOff: true,
    preferredShiftLength: 8,
    ...input.constraints,
  };

  // Map forecast to optimizer format — include dayOfWeek for QA peak detection
  const forecast = input.forecast.map(fp => ({
    hour: fp.hour,
    predictedVolume: fp.predictedVolume,
    dayOfWeek: fp.dayOfWeek,
  }));

  // Map agents
  const agents = input.agents.map(a => ({
    id: a.id,
    name: a.name,
    skills: a.skills,
    maxHours: a.maxHours,
  }));

  // If we have a template, we need a different strategy:
  // Assign template shifts directly then let optimizer fill gaps
  let existingSchedules: AgentSchedule[] | undefined;
  if (templateShifts && templateShifts.length > 0) {
    const now = new Date().toISOString();
    // Calculate week end (Sunday)
    const weekEndDate = new Date(input.weekStart + 'T00:00:00Z');
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
    const weekEnd = weekEndDate.toISOString().slice(0, 10);

    existingSchedules = agents.map(a => ({
      id: genId('auto-sched'),
      userId: a.id,
      userName: a.name,
      templateId: input.templateId,
      effectiveFrom: input.weekStart,
      effectiveTo: weekEnd,
      timezone: 'UTC',
      shifts: templateShifts!.map(s => ({ ...s })),
      createdAt: now,
      updatedAt: now,
    }));
  }

  // 3. Run optimizer
  const result = optimizeSchedules({
    agents,
    forecast,
    constraints: optimizerConstraints,
    existingSchedules,
    qaScores: input.qaScores,
  });

  // 4. Merge: if we had template-based existing schedules, use those as the base
  // and only append any additional optimizer-generated shifts
  let finalSchedules: AgentSchedule[];
  if (existingSchedules) {
    // Template schedules are the base; optimizer may have assigned additional agents
    const templateAgentIds = new Set(existingSchedules.map(s => s.userId));
    const additionalFromOptimizer = result.schedules.filter(s => !templateAgentIds.has(s.userId));
    finalSchedules = [...existingSchedules, ...additionalFromOptimizer];

    // Inject coaching blocks from optimizer into template schedules
    if (result.coachingBlocks) {
      for (const [agentId, blocks] of result.coachingBlocks) {
        const sched = finalSchedules.find(s => s.userId === agentId);
        if (sched) {
          sched.shifts.push(...blocks);
        }
      }
    }
  } else {
    finalSchedules = result.schedules;
  }

  // 5. Build coverage report
  const coverage = result.coverage.map(c => ({
    hour: c.hour,
    assigned: c.assigned,
    required: c.required,
  }));

  // 6. Add warnings for coverage gaps
  for (const c of result.coverage) {
    if (c.gap > 0) {
      warnings.push(`Coverage gap at ${c.hour}: ${c.required} needed, ${c.assigned} assigned (${c.gap} short)`);
    }
  }

  // Add violation warnings
  for (const v of result.violations) {
    warnings.push(`Constraint violation for agent ${v.agentId}: ${v.type} — ${v.detail}`);
  }

  // 7. Return with needsReview: true
  return {
    schedules: finalSchedules,
    coverage,
    warnings,
    needsReview: true,
  };
}

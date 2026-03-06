/**
 * Schedule and template CRUD + helpers for the WFM domain.
 */

import type { AgentSchedule, ScheduleTemplate, ScheduledActivity, ShiftBlock } from './types';
import {
  getSchedulesStore, addSchedule, updateScheduleStore, removeSchedule,
  getTemplatesStore, addTemplate, updateTemplateStore, removeTemplate,
  getTimeOffStore, genId,
} from './store';

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

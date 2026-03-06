/**
 * Schedule and template CRUD + helpers for the WFM domain.
 * Determines what activity an agent is scheduled for at a given moment.
 * Provides CRUD operations for schedules and templates with JSONL persistence.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import type {
  AgentSchedule,
  ScheduleTemplate,
  ShiftBlock,
  ScheduledActivity,
} from './types';
import { genId } from './store';

// ---- JSONL persistence ----

const SCHEDULES_FILE = 'wfm-schedules.jsonl';
const TEMPLATES_FILE = 'wfm-templates.jsonl';

let scheduleCache: AgentSchedule[] | null = null;
let templateCache: ScheduleTemplate[] | null = null;

function ensureSchedulesLoaded(): AgentSchedule[] {
  if (scheduleCache === null) {
    scheduleCache = readJsonlFile<AgentSchedule>(SCHEDULES_FILE);
  }
  return scheduleCache;
}

function persistSchedules(): void {
  writeJsonlFile(SCHEDULES_FILE, ensureSchedulesLoaded());
}

function ensureTemplatesLoaded(): ScheduleTemplate[] {
  if (templateCache === null) {
    templateCache = readJsonlFile<ScheduleTemplate>(TEMPLATES_FILE);
  }
  return templateCache;
}

function persistTemplates(): void {
  writeJsonlFile(TEMPLATES_FILE, ensureTemplatesLoaded());
}

// ---- Schedule CRUD ----

/** Get schedules, optionally filtered by userId. */
export function getSchedules(userId?: string): AgentSchedule[] {
  const all = ensureSchedulesLoaded();
  if (userId) return all.filter((s) => s.userId === userId);
  return [...all];
}

/** Create a new schedule. */
export function createSchedule(input: {
  userId: string;
  userName: string;
  templateId?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  timezone: string;
  shifts: ShiftBlock[];
}): AgentSchedule {
  const now = new Date().toISOString();
  const schedule: AgentSchedule = {
    id: genId('sched'),
    userId: input.userId,
    userName: input.userName,
    timezone: input.timezone,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    templateId: input.templateId,
    shifts: input.shifts,
    createdAt: now,
    updatedAt: now,
  };

  ensureSchedulesLoaded().push(schedule);
  persistSchedules();
  return schedule;
}

/** Update a schedule by id. Returns updated schedule or null. */
export function updateSchedule(
  id: string,
  updates: Partial<Omit<AgentSchedule, 'id' | 'createdAt'>>
): AgentSchedule | null {
  const all = ensureSchedulesLoaded();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() };
  persistSchedules();
  return all[idx];
}

/** Delete a schedule by id. Returns true if found and removed. */
export function deleteSchedule(id: string): boolean {
  const all = ensureSchedulesLoaded();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return false;

  all.splice(idx, 1);
  persistSchedules();
  return true;
}

// ---- Template CRUD ----

/** Get all templates. */
export function getTemplates(): ScheduleTemplate[] {
  return [...ensureTemplatesLoaded()];
}

/** Create a template. */
export function createTemplate(input: {
  name: string;
  shifts: ShiftBlock[];
}): ScheduleTemplate {
  const now = new Date().toISOString();
  const template: ScheduleTemplate = {
    id: genId('tmpl'),
    name: input.name,
    shifts: input.shifts,
    createdAt: now,
    updatedAt: now,
  };

  ensureTemplatesLoaded().push(template);
  persistTemplates();
  return template;
}

/** Update a template by id. Returns updated template or null. */
export function updateTemplate(
  id: string,
  updates: Partial<Omit<ScheduleTemplate, 'id' | 'createdAt'>>
): ScheduleTemplate | null {
  const all = ensureTemplatesLoaded();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return null;

  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() };
  persistTemplates();
  return all[idx];
}

/** Delete a template by id. Returns true if found and removed. */
export function deleteTemplate(id: string): boolean {
  const all = ensureTemplatesLoaded();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return false;

  all.splice(idx, 1);
  persistTemplates();
  return true;
}

/** Apply a template's shifts to a schedule. */
export function applyTemplate(scheduleId: string, templateId: string): AgentSchedule | null {
  const templates = ensureTemplatesLoaded();
  const template = templates.find((t) => t.id === templateId);
  if (!template) return null;

  return updateSchedule(scheduleId, {
    templateId,
    shifts: [...template.shifts],
  });
}

// ---- Schedule activity helpers ----

/** Parse "HH:MM" into total minutes from midnight. */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Get the scheduled activity for an agent at the current moment (or a given date).
 * Returns 'off_shift' if no matching shift block is found.
 */
export function getScheduledActivity(
  schedule: AgentSchedule,
  at?: Date
): ScheduledActivity {
  const now = at ?? new Date();
  const dayOfWeek = now.getUTCDay();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  for (const shift of schedule.shifts) {
    if (shift.dayOfWeek !== dayOfWeek) continue;

    const shiftStart = parseTimeToMinutes(shift.startTime);
    const shiftEnd = parseTimeToMinutes(shift.endTime);

    if (currentMinutes >= shiftStart && currentMinutes < shiftEnd) {
      return (shift.activity ?? 'work') as ScheduledActivity;
    }
  }

  return 'off_shift';
}

/**
 * Count how many agents are scheduled for 'work' during a given hour.
 */
export function countScheduledAgents(
  schedules: AgentSchedule[],
  hourKey: string
): number {
  const date = new Date(hourKey);
  // Check at mid-hour (e.g. XX:30) for a representative sample
  date.setUTCMinutes(30);

  let count = 0;
  for (const schedule of schedules) {
    const activity = getScheduledActivity(schedule, date);
    if (activity === 'work') count++;
  }
  return count;
}

/**
 * Get total scheduled work minutes for an agent within a date range.
 */
export function getScheduledWorkMinutes(
  schedule: AgentSchedule,
  from: Date,
  to: Date
): number {
  let totalMinutes = 0;
  const cursor = new Date(from);

  while (cursor < to) {
    const dayOfWeek = cursor.getUTCDay();
    for (const shift of schedule.shifts) {
      if (shift.dayOfWeek !== dayOfWeek) continue;
      if ((shift.activity ?? 'work') !== 'work') continue;

      const shiftStart = parseTimeToMinutes(shift.startTime);
      const shiftEnd = parseTimeToMinutes(shift.endTime);

      // Clamp shift to the from/to range within this day
      const dayStart = new Date(cursor);
      dayStart.setUTCHours(0, 0, 0, 0);

      const absStart = new Date(dayStart.getTime() + shiftStart * 60_000);
      const absEnd = new Date(dayStart.getTime() + shiftEnd * 60_000);

      const effectiveStart = absStart < from ? from : absStart;
      const effectiveEnd = absEnd > to ? to : absEnd;

      if (effectiveStart < effectiveEnd) {
        totalMinutes += (effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000;
      }
    }

    // Advance to next day
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }

  return totalMinutes;
}

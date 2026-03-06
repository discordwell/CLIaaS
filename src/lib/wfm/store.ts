/**
 * JSONL persistence for all WFM collections.
 * Follows the pattern from src/lib/time-tracking.ts.
 */

import { readJsonlFile, writeJsonlFile } from '@/lib/jsonl-store';
import type {
  ScheduleTemplate,
  AgentSchedule,
  AgentStatusEntry,
  StatusLogEntry,
  TimeOffRequest,
  VolumeSnapshot,
  BusinessHoursConfig,
} from './types';

const TEMPLATES_FILE = 'wfm-templates.jsonl';
const SCHEDULES_FILE = 'wfm-schedules.jsonl';
const STATUS_FILE = 'wfm-agent-status.jsonl';
const TIMEOFF_FILE = 'wfm-time-off.jsonl';
const VOLUME_FILE = 'wfm-volume-snapshots.jsonl';
const BH_FILE = 'wfm-business-hours.jsonl';

export function genId(prefix = 'wfm'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Defaults flags ----

let templatesLoaded = false;
let schedulesLoaded = false;
let statusLoaded = false;
let timeoffLoaded = false;
let volumeLoaded = false;
let bhLoaded = false;

// ---- Templates ----

const templates: ScheduleTemplate[] = [];

function ensureTemplates(): void {
  if (templatesLoaded) return;
  templatesLoaded = true;
  const saved = readJsonlFile<ScheduleTemplate>(TEMPLATES_FILE);
  if (saved.length > 0) { templates.push(...saved); return; }

  const now = new Date().toISOString();
  const defaultTemplate: ScheduleTemplate = {
    id: 'tmpl-default-9to5',
    name: 'Standard 9-5',
    shifts: [
      ...[1, 2, 3, 4, 5].map(d => ({ dayOfWeek: d, startTime: '09:00', endTime: '17:00', activity: 'work' })),
      ...[1, 2, 3, 4, 5].map(d => ({ dayOfWeek: d, startTime: '12:00', endTime: '13:00', activity: 'break' })),
    ],
    createdAt: now,
    updatedAt: now,
  };
  templates.push(defaultTemplate);
  writeJsonlFile(TEMPLATES_FILE, templates);
}

export function getTemplatesStore(): ScheduleTemplate[] { ensureTemplates(); return [...templates]; }
export function addTemplate(t: ScheduleTemplate): void { ensureTemplates(); templates.push(t); writeJsonlFile(TEMPLATES_FILE, templates); }
export function updateTemplateStore(id: string, updates: Partial<ScheduleTemplate>): ScheduleTemplate | null {
  ensureTemplates();
  const idx = templates.findIndex(t => t.id === id);
  if (idx < 0) return null;
  templates[idx] = { ...templates[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJsonlFile(TEMPLATES_FILE, templates);
  return templates[idx];
}
export function removeTemplate(id: string): boolean {
  ensureTemplates();
  const idx = templates.findIndex(t => t.id === id);
  if (idx < 0) return false;
  templates.splice(idx, 1);
  writeJsonlFile(TEMPLATES_FILE, templates);
  return true;
}

// ---- Schedules ----

const schedules: AgentSchedule[] = [];

function ensureSchedules(): void {
  if (schedulesLoaded) return;
  schedulesLoaded = true;
  const saved = readJsonlFile<AgentSchedule>(SCHEDULES_FILE);
  if (saved.length > 0) { schedules.push(...saved); return; }

  ensureTemplates();
  const tmpl = templates[0];
  const now = new Date().toISOString();
  const demoSchedules: AgentSchedule[] = [
    { id: 'sched-1', userId: 'user-1', userName: 'Alice Chen', templateId: tmpl?.id, effectiveFrom: '2026-01-01', timezone: 'America/New_York', shifts: tmpl?.shifts ?? [], createdAt: now, updatedAt: now },
    { id: 'sched-2', userId: 'user-2', userName: 'Bob Martinez', templateId: tmpl?.id, effectiveFrom: '2026-01-01', timezone: 'America/New_York', shifts: tmpl?.shifts ?? [], createdAt: now, updatedAt: now },
  ];
  schedules.push(...demoSchedules);
  writeJsonlFile(SCHEDULES_FILE, schedules);
}

export function getSchedulesStore(userId?: string): AgentSchedule[] {
  ensureSchedules();
  if (userId) return schedules.filter(s => s.userId === userId);
  return [...schedules];
}
export function addSchedule(s: AgentSchedule): void { ensureSchedules(); schedules.push(s); writeJsonlFile(SCHEDULES_FILE, schedules); }
export function updateScheduleStore(id: string, updates: Partial<AgentSchedule>): AgentSchedule | null {
  ensureSchedules();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx < 0) return null;
  schedules[idx] = { ...schedules[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJsonlFile(SCHEDULES_FILE, schedules);
  return schedules[idx];
}
export function removeSchedule(id: string): boolean {
  ensureSchedules();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx < 0) return false;
  schedules.splice(idx, 1);
  writeJsonlFile(SCHEDULES_FILE, schedules);
  return true;
}

// ---- Agent Status Log ----

const statusEntries: AgentStatusEntry[] = [];

function ensureStatus(): void {
  if (statusLoaded) return;
  statusLoaded = true;
  const saved = readJsonlFile<AgentStatusEntry>(STATUS_FILE);
  if (saved.length > 0) { statusEntries.push(...saved); return; }

  const now = new Date().toISOString();
  statusEntries.push(
    { id: 'ast-1', userId: 'user-1', userName: 'Alice Chen', status: 'online', changedAt: now },
    { id: 'ast-2', userId: 'user-2', userName: 'Bob Martinez', status: 'online', changedAt: now },
    { id: 'ast-3', userId: 'user-3', userName: 'Charlie Park', status: 'away', reason: 'Lunch break', changedAt: now },
    { id: 'ast-4', userId: 'user-4', userName: 'Diana Lee', status: 'offline', changedAt: now },
  );
  writeJsonlFile(STATUS_FILE, statusEntries);
}

/** Get raw status entries (aliased as getAgentStatusEntries for agent-status.ts). */
export function getAgentStatusEntries(userId?: string): AgentStatusEntry[] {
  ensureStatus();
  if (userId) return statusEntries.filter(e => e.userId === userId);
  return [...statusEntries];
}

/** Append an agent status entry (aliased as addAgentStatusEntry for agent-status.ts). */
export function addAgentStatusEntry(e: AgentStatusEntry): void {
  ensureStatus();
  statusEntries.push(e);
  writeJsonlFile(STATUS_FILE, statusEntries);
}

/**
 * Get status log as duration-based entries for utilization calculations.
 * Converts the change log into StatusLogEntry[] with startedAt/endedAt.
 */
export function getStatusLog(): StatusLogEntry[] {
  ensureStatus();
  if (statusEntries.length === 0) return [];

  const byUser = new Map<string, AgentStatusEntry[]>();
  for (const entry of statusEntries) {
    const arr = byUser.get(entry.userId) ?? [];
    arr.push(entry);
    byUser.set(entry.userId, arr);
  }

  const log: StatusLogEntry[] = [];

  for (const [, entries] of byUser) {
    const sorted = entries.sort((a, b) => a.changedAt.localeCompare(b.changedAt));
    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];

      const mappedStatus = curr.status === 'busy' ? 'online' : curr.status;
      if (mappedStatus !== 'online' && mappedStatus !== 'away' && mappedStatus !== 'offline' && mappedStatus !== 'on_break') continue;

      log.push({
        userId: curr.userId,
        status: mappedStatus as StatusLogEntry['status'],
        startedAt: curr.changedAt,
        endedAt: next ? next.changedAt : null,
      });
    }
  }

  return log;
}

// ---- Time Off ----

const timeOffRequests: TimeOffRequest[] = [];

function ensureTimeOff(): void {
  if (timeoffLoaded) return;
  timeoffLoaded = true;
  const saved = readJsonlFile<TimeOffRequest>(TIMEOFF_FILE);
  if (saved.length > 0) { timeOffRequests.push(...saved); return; }

  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 86400000);
  const nextWeekEnd = new Date(nextWeek.getTime() + 2 * 86400000);
  timeOffRequests.push({
    id: 'pto-1',
    userId: 'user-2',
    userName: 'Bob Martinez',
    startDate: nextWeek.toISOString().slice(0, 10),
    endDate: nextWeekEnd.toISOString().slice(0, 10),
    reason: 'Family vacation',
    status: 'pending',
    createdAt: now.toISOString(),
  });
  writeJsonlFile(TIMEOFF_FILE, timeOffRequests);
}

export function getTimeOffStore(userId?: string, status?: string): TimeOffRequest[] {
  ensureTimeOff();
  let results = [...timeOffRequests];
  if (userId) results = results.filter(r => r.userId === userId);
  if (status) results = results.filter(r => r.status === status);
  return results;
}
export function addTimeOff(r: TimeOffRequest): void { ensureTimeOff(); timeOffRequests.push(r); writeJsonlFile(TIMEOFF_FILE, timeOffRequests); }
export function updateTimeOff(id: string, updates: Partial<TimeOffRequest>): TimeOffRequest | null {
  ensureTimeOff();
  const idx = timeOffRequests.findIndex(r => r.id === id);
  if (idx < 0) return null;
  timeOffRequests[idx] = { ...timeOffRequests[idx], ...updates };
  writeJsonlFile(TIMEOFF_FILE, timeOffRequests);
  return timeOffRequests[idx];
}

// ---- Volume Snapshots ----

const volumeSnapshots: VolumeSnapshot[] = [];

function ensureVolume(): void {
  if (volumeLoaded) return;
  volumeLoaded = true;
  const saved = readJsonlFile<VolumeSnapshot>(VOLUME_FILE);
  if (saved.length > 0) { volumeSnapshots.push(...saved); return; }

  const now = Date.now();
  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    for (let hour = 0; hour < 24; hour++) {
      const ts = now - dayOffset * 86400000 + hour * 3600000;
      const d = new Date(ts);
      const hourKey = d.toISOString().slice(0, 11) + String(d.getUTCHours()).padStart(2, '0') + ':00:00.000Z';
      const isBusinessHour = hour >= 9 && hour < 17;
      const base = isBusinessHour ? 12 : 2;
      const ticketsCreated = base + Math.floor(Math.random() * 8);
      const ticketsResolved = Math.max(0, ticketsCreated - Math.floor(Math.random() * 4));
      volumeSnapshots.push({ hourKey, channel: 'all', ticketsCreated, ticketsResolved, recordedAt: new Date(ts).toISOString() });
    }
  }
  writeJsonlFile(VOLUME_FILE, volumeSnapshots);
}

export function getVolumeSnapshots(): VolumeSnapshot[] { ensureVolume(); return [...volumeSnapshots]; }
export function addVolumeSnapshot(s: VolumeSnapshot): void { ensureVolume(); volumeSnapshots.push(s); writeJsonlFile(VOLUME_FILE, volumeSnapshots); }

// ---- Business Hours ----

const bhConfigs: BusinessHoursConfig[] = [];

function ensureBH(): void {
  if (bhLoaded) return;
  bhLoaded = true;
  const saved = readJsonlFile<BusinessHoursConfig>(BH_FILE);
  if (saved.length > 0) { bhConfigs.push(...saved); return; }

  const now = new Date().toISOString();
  bhConfigs.push({
    id: 'bh-default',
    name: 'Default Hours',
    timezone: 'America/New_York',
    schedule: [
      { day: 'monday', startTime: '09:00', endTime: '17:00' },
      { day: 'tuesday', startTime: '09:00', endTime: '17:00' },
      { day: 'wednesday', startTime: '09:00', endTime: '17:00' },
      { day: 'thursday', startTime: '09:00', endTime: '17:00' },
      { day: 'friday', startTime: '09:00', endTime: '17:00' },
    ],
    holidays: [],
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
  writeJsonlFile(BH_FILE, bhConfigs);
}

export function getBHConfigs(id?: string): BusinessHoursConfig[] {
  ensureBH();
  if (id) return bhConfigs.filter(c => c.id === id);
  return [...bhConfigs];
}
export function addBHConfig(c: BusinessHoursConfig): void { ensureBH(); bhConfigs.push(c); writeJsonlFile(BH_FILE, bhConfigs); }
export function updateBHConfig(id: string, updates: Partial<BusinessHoursConfig>): BusinessHoursConfig | null {
  ensureBH();
  const idx = bhConfigs.findIndex(c => c.id === id);
  if (idx < 0) return null;
  bhConfigs[idx] = { ...bhConfigs[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJsonlFile(BH_FILE, bhConfigs);
  return bhConfigs[idx];
}
export function removeBHConfig(id: string): boolean {
  ensureBH();
  const idx = bhConfigs.findIndex(c => c.id === id);
  if (idx < 0) return false;
  bhConfigs.splice(idx, 1);
  writeJsonlFile(BH_FILE, bhConfigs);
  return true;
}

// ---- Compatibility aliases ----
// Re-export under names expected by consumers (CLI, API routes, business-hours.ts, time-off.ts, schedules.ts)

export { getTimeOffStore as getTimeOffRequests };
export { addTimeOff as addTimeOffRequest };
export { updateTimeOff as updateTimeOffRequest };
export { getBHConfigs as getBusinessHoursConfigs };
export { addBHConfig as addBusinessHoursConfig };
export { updateBHConfig as updateBusinessHoursConfig };
export { removeBHConfig as removeBusinessHoursConfig };
export { getSchedulesStore as getSchedules };
export { updateScheduleStore as updateSchedule };
export { getTemplatesStore as getTemplates };
export { updateTemplateStore as updateTemplate };

/** Remove a time-off request. Returns true if found and removed. */
export function removeTimeOffRequest(id: string): boolean {
  ensureTimeOff();
  const idx = timeOffRequests.findIndex(r => r.id === id);
  if (idx < 0) return false;
  timeOffRequests.splice(idx, 1);
  writeJsonlFile(TIMEOFF_FILE, timeOffRequests);
  return true;
}

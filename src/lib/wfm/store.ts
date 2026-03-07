/**
 * Dual-mode WFM store: DB primary, JSONL fallback.
 * Uses tryDb() from store-helpers to prefer Postgres when available.
 */

import { readJsonlFile, writeJsonlFile } from '@/lib/jsonl-store';
import { tryDb, withRls } from '@/lib/store-helpers';
import type {
  ScheduleTemplate, AgentSchedule, AgentStatusEntry,
  TimeOffRequest, VolumeSnapshot, BusinessHoursConfig,
  HolidayCalendar, HolidayCalendarEntry, ShiftBlock,
} from './types';

const TEMPLATES_FILE = 'wfm-templates.jsonl';
const SCHEDULES_FILE = 'wfm-schedules.jsonl';
const STATUS_FILE = 'wfm-agent-status.jsonl';
const TIMEOFF_FILE = 'wfm-time-off.jsonl';
const VOLUME_FILE = 'wfm-volume-snapshots.jsonl';
const BH_FILE = 'wfm-business-hours.jsonl';
const HC_FILE = 'wfm-holiday-calendars.jsonl';

export function genId(prefix = 'wfm'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

let tL = false, sL = false, stL = false, toL = false, vL = false, bL = false, hcL = false;
const templates: ScheduleTemplate[] = [];
const schedules: AgentSchedule[] = [];
const statusEntries: AgentStatusEntry[] = [];
const timeOffReqs: TimeOffRequest[] = [];
const volSnaps: VolumeSnapshot[] = [];
const bhConfigs: BusinessHoursConfig[] = [];
const hcConfigs: HolidayCalendar[] = [];

function ensT(): void {
  if (tL) return; tL = true;
  const s = readJsonlFile<ScheduleTemplate>(TEMPLATES_FILE);
  if (s.length > 0) { templates.push(...s); return; }
  const now = new Date().toISOString();
  templates.push({
    id: 'tmpl-default-9to5', name: 'Standard 9-5',
    shifts: [
      ...[1,2,3,4,5].map(d => ({ dayOfWeek: d, startTime: '09:00', endTime: '17:00', activity: 'work' })),
      ...[1,2,3,4,5].map(d => ({ dayOfWeek: d, startTime: '12:00', endTime: '13:00', activity: 'break' })),
    ],
    createdAt: now, updatedAt: now,
  });
  writeJsonlFile(TEMPLATES_FILE, templates);
}

function ensS(): void {
  if (sL) return; sL = true;
  const s = readJsonlFile<AgentSchedule>(SCHEDULES_FILE);
  if (s.length > 0) { schedules.push(...s); return; }
  ensT();
  const t = templates[0]; const now = new Date().toISOString();
  schedules.push(
    { id: 'sched-1', userId: 'user-1', userName: 'Alice Chen', templateId: t?.id, effectiveFrom: '2026-01-01', timezone: 'America/New_York', shifts: t?.shifts ?? [], createdAt: now, updatedAt: now },
    { id: 'sched-2', userId: 'user-2', userName: 'Bob Martinez', templateId: t?.id, effectiveFrom: '2026-01-01', timezone: 'America/New_York', shifts: t?.shifts ?? [], createdAt: now, updatedAt: now },
  );
  writeJsonlFile(SCHEDULES_FILE, schedules);
}

function ensSt(): void {
  if (stL) return; stL = true;
  const s = readJsonlFile<AgentStatusEntry>(STATUS_FILE);
  if (s.length > 0) { statusEntries.push(...s); return; }
  const now = new Date().toISOString();
  statusEntries.push(
    { id: 'ast-1', userId: 'user-1', userName: 'Alice Chen', status: 'online', startedAt: now },
    { id: 'ast-2', userId: 'user-2', userName: 'Bob Martinez', status: 'online', startedAt: now },
    { id: 'ast-3', userId: 'user-3', userName: 'Charlie Park', status: 'away', reason: 'Lunch break', startedAt: now },
    { id: 'ast-4', userId: 'user-4', userName: 'Diana Lee', status: 'offline', startedAt: now },
  );
  writeJsonlFile(STATUS_FILE, statusEntries);
}

function ensTo(): void {
  if (toL) return; toL = true;
  const s = readJsonlFile<TimeOffRequest>(TIMEOFF_FILE);
  if (s.length > 0) { timeOffReqs.push(...s); return; }
  const now = new Date(); const nw = new Date(now.getTime() + 7*86400000); const nwe = new Date(nw.getTime() + 2*86400000);
  timeOffReqs.push({ id: 'pto-1', userId: 'user-2', userName: 'Bob Martinez', startDate: nw.toISOString().slice(0,10), endDate: nwe.toISOString().slice(0,10), reason: 'Family vacation', status: 'pending', createdAt: now.toISOString() });
  writeJsonlFile(TIMEOFF_FILE, timeOffReqs);
}

function ensV(): void {
  if (vL) return; vL = true;
  const s = readJsonlFile<VolumeSnapshot>(VOLUME_FILE);
  if (s.length > 0) { volSnaps.push(...s); return; }
  const now = Date.now();
  for (let d = 6; d >= 0; d--) for (let h = 0; h < 24; h++) {
    const ts = now - d*86400000 + h*3600000; const dt = new Date(ts);
    const sh = dt.toISOString().slice(0,11) + String(dt.getUTCHours()).padStart(2,'0') + ':00:00.000Z';
    const bh = h >= 9 && h < 17; const base = bh ? 12 : 2;
    const tc = base + Math.floor(Math.random()*8); const tr = Math.max(0, tc - Math.floor(Math.random()*4));
    volSnaps.push({ id: genId('vs'), snapshotHour: sh, channel: 'all', ticketsCreated: tc, ticketsResolved: tr });
  }
  writeJsonlFile(VOLUME_FILE, volSnaps);
}

function ensB(): void {
  if (bL) return; bL = true;
  const s = readJsonlFile<BusinessHoursConfig>(BH_FILE);
  if (s.length > 0) { bhConfigs.push(...s); return; }
  const now = new Date().toISOString();
  bhConfigs.push({
    id: 'bh-default', name: 'Default Hours', timezone: 'America/New_York',
    schedule: { '1': [{start:'09:00',end:'17:00'}], '2': [{start:'09:00',end:'17:00'}], '3': [{start:'09:00',end:'17:00'}], '4': [{start:'09:00',end:'17:00'}], '5': [{start:'09:00',end:'17:00'}] },
    holidays: [], isDefault: true, createdAt: now, updatedAt: now,
  });
  writeJsonlFile(BH_FILE, bhConfigs);
}

// Templates
export function getTemplatesStore(): ScheduleTemplate[] { ensT(); return [...templates]; }
export function addTemplate(t: ScheduleTemplate): void { ensT(); templates.push(t); writeJsonlFile(TEMPLATES_FILE, templates); }
export function updateTemplateStore(id: string, u: Partial<ScheduleTemplate>): ScheduleTemplate|null { ensT(); const i = templates.findIndex(t=>t.id===id); if(i<0) return null; templates[i]={...templates[i],...u,updatedAt:new Date().toISOString()}; writeJsonlFile(TEMPLATES_FILE,templates); return templates[i]; }
export function removeTemplate(id: string): boolean { ensT(); const i=templates.findIndex(t=>t.id===id); if(i<0) return false; templates.splice(i,1); writeJsonlFile(TEMPLATES_FILE,templates); return true; }

// Schedules
export function getSchedulesStore(userId?: string): AgentSchedule[] { ensS(); return userId ? schedules.filter(s=>s.userId===userId) : [...schedules]; }
export function addSchedule(s: AgentSchedule): void { ensS(); schedules.push(s); writeJsonlFile(SCHEDULES_FILE, schedules); }
export function updateScheduleStore(id: string, u: Partial<AgentSchedule>): AgentSchedule|null { ensS(); const i=schedules.findIndex(s=>s.id===id); if(i<0) return null; schedules[i]={...schedules[i],...u,updatedAt:new Date().toISOString()}; writeJsonlFile(SCHEDULES_FILE,schedules); return schedules[i]; }
export function removeSchedule(id: string): boolean { ensS(); const i=schedules.findIndex(s=>s.id===id); if(i<0) return false; schedules.splice(i,1); writeJsonlFile(SCHEDULES_FILE,schedules); return true; }

// Status
export function getStatusLog(): AgentStatusEntry[] { ensSt(); return [...statusEntries]; }
export function addStatusEntry(e: AgentStatusEntry): void { ensSt(); statusEntries.push(e); writeJsonlFile(STATUS_FILE, statusEntries); }

// Time Off
export function getTimeOffStore(userId?: string, status?: string): TimeOffRequest[] { ensTo(); let r=[...timeOffReqs]; if(userId) r=r.filter(x=>x.userId===userId); if(status) r=r.filter(x=>x.status===status); return r; }
export function addTimeOff(r: TimeOffRequest): void { ensTo(); timeOffReqs.push(r); writeJsonlFile(TIMEOFF_FILE, timeOffReqs); }
export function updateTimeOff(id: string, u: Partial<TimeOffRequest>): TimeOffRequest|null { ensTo(); const i=timeOffReqs.findIndex(r=>r.id===id); if(i<0) return null; timeOffReqs[i]={...timeOffReqs[i],...u}; writeJsonlFile(TIMEOFF_FILE,timeOffReqs); return timeOffReqs[i]; }

// Volume
export function getVolumeSnapshots(): VolumeSnapshot[] { ensV(); return [...volSnaps]; }
export function addVolumeSnapshot(s: VolumeSnapshot): void { ensV(); volSnaps.push(s); writeJsonlFile(VOLUME_FILE, volSnaps); }

// Business Hours
export function getBHConfigs(id?: string): BusinessHoursConfig[] { ensB(); return id ? bhConfigs.filter(c=>c.id===id) : [...bhConfigs]; }
export function addBHConfig(c: BusinessHoursConfig): void { ensB(); bhConfigs.push(c); writeJsonlFile(BH_FILE, bhConfigs); }
export function updateBHConfig(id: string, u: Partial<BusinessHoursConfig>): BusinessHoursConfig|null { ensB(); const i=bhConfigs.findIndex(c=>c.id===id); if(i<0) return null; bhConfigs[i]={...bhConfigs[i],...u,updatedAt:new Date().toISOString()}; writeJsonlFile(BH_FILE,bhConfigs); return bhConfigs[i]; }
export function removeBHConfig(id: string): boolean { ensB(); const i=bhConfigs.findIndex(c=>c.id===id); if(i<0) return false; bhConfigs.splice(i,1); writeJsonlFile(BH_FILE,bhConfigs); return true; }

// Holiday Calendars
function ensHC(): void {
  if (hcL) return; hcL = true;
  const s = readJsonlFile<HolidayCalendar>(HC_FILE);
  if (s.length > 0) { hcConfigs.push(...s); }
}
export function getHolidayCalendars(id?: string): HolidayCalendar[] { ensHC(); return id ? hcConfigs.filter(c=>c.id===id) : [...hcConfigs]; }
export function addHolidayCalendar(c: HolidayCalendar): void { ensHC(); hcConfigs.push(c); writeJsonlFile(HC_FILE, hcConfigs); }
export function updateHolidayCalendar(id: string, u: Partial<HolidayCalendar>): HolidayCalendar|null { ensHC(); const i=hcConfigs.findIndex(c=>c.id===id); if(i<0) return null; hcConfigs[i]={...hcConfigs[i],...u,updatedAt:new Date().toISOString()}; writeJsonlFile(HC_FILE,hcConfigs); return hcConfigs[i]; }
export function removeHolidayCalendar(id: string): boolean { ensHC(); const i=hcConfigs.findIndex(c=>c.id===id); if(i<0) return false; hcConfigs.splice(i,1); writeJsonlFile(HC_FILE,hcConfigs); return true; }

// ---- Async dual-mode accessors (DB primary, JSONL fallback) ----

export async function getTemplatesAsync(workspaceId?: string): Promise<ScheduleTemplate[]> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const rows = await db.select().from(schema.scheduleTemplates);
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        shifts: (r.shifts ?? []) as ShiftBlock[],
        createdAt: r.createdAt?.toISOString() ?? '',
        updatedAt: r.updatedAt?.toISOString() ?? '',
      }));
    });
    if (result !== null) return result;
  }
  // Unscoped DB path (fallback)
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const rows = workspaceId
      ? await db.select().from(schema.scheduleTemplates).where(eq(schema.scheduleTemplates.workspaceId, workspaceId))
      : await db.select().from(schema.scheduleTemplates);
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      shifts: (r.shifts ?? []) as ShiftBlock[],
      createdAt: r.createdAt?.toISOString() ?? '',
      updatedAt: r.updatedAt?.toISOString() ?? '',
    }));
  }
  return getTemplatesStore();
}

export async function getTemplateAsync(id: string, workspaceId?: string): Promise<ScheduleTemplate | null> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [r] = await db.select().from(schema.scheduleTemplates).where(eq(schema.scheduleTemplates.id, id));
      if (!r) return null;
      return {
        id: r.id,
        name: r.name,
        shifts: (r.shifts ?? []) as ShiftBlock[],
        createdAt: r.createdAt?.toISOString() ?? '',
        updatedAt: r.updatedAt?.toISOString() ?? '',
      };
    });
    if (result !== null) return result;
  }
  // Unscoped tryDb path
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const [r] = await db.select().from(schema.scheduleTemplates).where(eq(schema.scheduleTemplates.id, id));
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      shifts: (r.shifts ?? []) as ShiftBlock[],
      createdAt: r.createdAt?.toISOString() ?? '',
      updatedAt: r.updatedAt?.toISOString() ?? '',
    };
  }
  // JSONL fallback
  ensT();
  return templates.find(t => t.id === id) ?? null;
}

export async function getSchedulesAsync(userId?: string, workspaceId?: string): Promise<AgentSchedule[]> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const baseRows = userId
        ? await db.select().from(schema.agentSchedules).where(eq(schema.agentSchedules.userId, userId))
        : await db.select().from(schema.agentSchedules);
      const scheduleResult: AgentSchedule[] = [];
      for (const r of baseRows) {
        const shiftRows = await db.select().from(schema.scheduleShifts).where(eq(schema.scheduleShifts.scheduleId, r.id));
        let userName = '';
        try {
          const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.userId));
          userName = user?.name ?? '';
        } catch { /* user table may not match */ }
        scheduleResult.push({
          id: r.id, userId: r.userId, userName,
          templateId: r.templateId ?? undefined,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo ?? undefined,
          timezone: r.timezone,
          shifts: shiftRows.map(s => ({
            dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
            activity: s.activity ?? 'work', label: s.label ?? undefined,
          })),
          createdAt: r.createdAt?.toISOString() ?? '',
          updatedAt: r.updatedAt?.toISOString() ?? '',
        });
      }
      return scheduleResult;
    });
    if (result !== null) return result;
  }
  // Unscoped DB path (fallback)
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const baseRows = userId
      ? await db.select().from(schema.agentSchedules).where(eq(schema.agentSchedules.userId, userId))
      : await db.select().from(schema.agentSchedules);

    // Load shifts for each schedule
    const result: AgentSchedule[] = [];
    for (const r of baseRows) {
      const shiftRows = await db.select().from(schema.scheduleShifts).where(eq(schema.scheduleShifts.scheduleId, r.id));
      // Look up userName from users table
      let userName = '';
      try {
        const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.userId));
        userName = user?.name ?? '';
      } catch { /* user table may not match */ }

      result.push({
        id: r.id,
        userId: r.userId,
        userName,
        templateId: r.templateId ?? undefined,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo ?? undefined,
        timezone: r.timezone,
        shifts: shiftRows.map(s => ({
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          activity: s.activity ?? 'work',
          label: s.label ?? undefined,
        })),
        createdAt: r.createdAt?.toISOString() ?? '',
        updatedAt: r.updatedAt?.toISOString() ?? '',
      });
    }
    return result;
  }
  return getSchedulesStore(userId);
}

export async function getScheduleAsync(id: string, workspaceId?: string): Promise<AgentSchedule | null> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const [r] = await db.select().from(schema.agentSchedules).where(eq(schema.agentSchedules.id, id));
      if (!r) return null;
      const shiftRows = await db.select().from(schema.scheduleShifts).where(eq(schema.scheduleShifts.scheduleId, r.id));
      let userName = '';
      try {
        const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.userId));
        userName = user?.name ?? '';
      } catch { /* user table may not match */ }
      return {
        id: r.id, userId: r.userId, userName,
        templateId: r.templateId ?? undefined,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo ?? undefined,
        timezone: r.timezone,
        shifts: shiftRows.map(s => ({
          dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
          activity: s.activity ?? 'work', label: s.label ?? undefined,
        })),
        createdAt: r.createdAt?.toISOString() ?? '',
        updatedAt: r.updatedAt?.toISOString() ?? '',
      };
    });
    if (result !== null) return result;
  }
  // Unscoped tryDb path
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const [r] = await db.select().from(schema.agentSchedules).where(eq(schema.agentSchedules.id, id));
    if (!r) return null;
    const shiftRows = await db.select().from(schema.scheduleShifts).where(eq(schema.scheduleShifts.scheduleId, r.id));
    let userName = '';
    try {
      const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.userId));
      userName = user?.name ?? '';
    } catch { /* user table may not match */ }
    return {
      id: r.id, userId: r.userId, userName,
      templateId: r.templateId ?? undefined,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo ?? undefined,
      timezone: r.timezone,
      shifts: shiftRows.map(s => ({
        dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
        activity: s.activity ?? 'work', label: s.label ?? undefined,
      })),
      createdAt: r.createdAt?.toISOString() ?? '',
      updatedAt: r.updatedAt?.toISOString() ?? '',
    };
  }
  // JSONL fallback
  ensS();
  return schedules.find(s => s.id === id) ?? null;
}

export async function getShiftsAsync(scheduleId: string, workspaceId?: string): Promise<ShiftBlock[]> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq } = await import('drizzle-orm');
      const rows = await db.select().from(schema.scheduleShifts).where(eq(schema.scheduleShifts.scheduleId, scheduleId));
      return rows.map(s => ({
        dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
        activity: s.activity ?? 'work', label: s.label ?? undefined,
      }));
    });
    if (result !== null) return result;
  }
  // Unscoped tryDb path
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(schema.scheduleShifts).where(eq(schema.scheduleShifts.scheduleId, scheduleId));
    return rows.map(s => ({
      dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
      activity: s.activity ?? 'work', label: s.label ?? undefined,
    }));
  }
  // JSONL fallback — shifts are embedded in schedule
  ensS();
  const sched = schedules.find(s => s.id === scheduleId);
  return sched?.shifts ?? [];
}

export async function getStatusLogAsync(workspaceId?: string): Promise<AgentStatusEntry[]> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq, desc } = await import('drizzle-orm');
      const rows = await db.select().from(schema.agentStatusLog).orderBy(desc(schema.agentStatusLog.startedAt));
      const statusResult: AgentStatusEntry[] = [];
      const userNameCache: Record<string, string> = {};
      for (const r of rows) {
        if (!userNameCache[r.userId]) {
          try {
            const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.userId));
            userNameCache[r.userId] = user?.name ?? '';
          } catch { userNameCache[r.userId] = ''; }
        }
        statusResult.push({
          id: r.id, userId: r.userId, userName: userNameCache[r.userId],
          status: r.status as AgentStatusEntry['status'],
          reason: r.reason ?? undefined,
          startedAt: r.startedAt?.toISOString() ?? '',
        });
      }
      return statusResult;
    });
    if (result !== null) return result;
  }
  // Unscoped DB path (fallback)
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, desc } = await import('drizzle-orm');
    const query = workspaceId
      ? db.select().from(schema.agentStatusLog).where(eq(schema.agentStatusLog.workspaceId, workspaceId)).orderBy(desc(schema.agentStatusLog.startedAt))
      : db.select().from(schema.agentStatusLog).orderBy(desc(schema.agentStatusLog.startedAt));
    const rows = await query;

    // Resolve user names
    const result: AgentStatusEntry[] = [];
    const userNameCache: Record<string, string> = {};
    for (const r of rows) {
      if (!userNameCache[r.userId]) {
        try {
          const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.userId));
          userNameCache[r.userId] = user?.name ?? '';
        } catch {
          userNameCache[r.userId] = '';
        }
      }
      result.push({
        id: r.id,
        userId: r.userId,
        userName: userNameCache[r.userId],
        status: r.status as AgentStatusEntry['status'],
        reason: r.reason ?? undefined,
        startedAt: r.startedAt?.toISOString() ?? '',
      });
    }
    return result;
  }
  return getStatusLog();
}

export async function addStatusEntryAsync(entry: AgentStatusEntry, workspaceId?: string): Promise<void> {
  const ctx = await tryDb();
  if (ctx && workspaceId) {
    const { db, schema } = ctx;
    await db.insert(schema.agentStatusLog).values({
      workspaceId,
      userId: entry.userId,
      status: entry.status,
      reason: entry.reason,
      startedAt: new Date(entry.startedAt),
    });
    return;
  }
  addStatusEntry(entry);
}

export async function getTimeOffAsync(userId?: string, status?: string, workspaceId?: string): Promise<TimeOffRequest[]> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { eq, and } = await import('drizzle-orm');
      const conditions = [];
      if (userId) conditions.push(eq(schema.timeOffRequests.userId, userId));
      if (status) conditions.push(eq(schema.timeOffRequests.status, status as 'pending' | 'approved' | 'denied'));
      const rows = conditions.length > 0
        ? await db.select().from(schema.timeOffRequests).where(and(...conditions))
        : await db.select().from(schema.timeOffRequests);
      const userNameCache: Record<string, string> = {};
      const timeOffResult: TimeOffRequest[] = [];
      for (const r of rows) {
        if (!userNameCache[r.userId]) {
          try {
            const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.userId));
            userNameCache[r.userId] = user?.name ?? '';
          } catch { userNameCache[r.userId] = ''; }
        }
        timeOffResult.push({
          id: r.id, userId: r.userId, userName: userNameCache[r.userId],
          startDate: r.startDate, endDate: r.endDate,
          reason: r.reason ?? undefined, status: r.status,
          approvedBy: r.approvedBy ?? undefined,
          decidedAt: r.decidedAt?.toISOString() ?? undefined,
          createdAt: r.createdAt?.toISOString() ?? '',
        });
      }
      return timeOffResult;
    });
    if (result !== null) return result;
  }
  // Unscoped DB path (fallback)
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, and } = await import('drizzle-orm');
    const conditions = [];
    if (workspaceId) conditions.push(eq(schema.timeOffRequests.workspaceId, workspaceId));
    if (userId) conditions.push(eq(schema.timeOffRequests.userId, userId));
    if (status) conditions.push(eq(schema.timeOffRequests.status, status as 'pending' | 'approved' | 'denied'));

    const rows = conditions.length > 0
      ? await db.select().from(schema.timeOffRequests).where(and(...conditions))
      : await db.select().from(schema.timeOffRequests);

    // Resolve user names
    const userNameCache: Record<string, string> = {};
    const result: TimeOffRequest[] = [];
    for (const r of rows) {
      if (!userNameCache[r.userId]) {
        try {
          const [user] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.userId));
          userNameCache[r.userId] = user?.name ?? '';
        } catch {
          userNameCache[r.userId] = '';
        }
      }
      result.push({
        id: r.id,
        userId: r.userId,
        userName: userNameCache[r.userId],
        startDate: r.startDate,
        endDate: r.endDate,
        reason: r.reason ?? undefined,
        status: r.status,
        approvedBy: r.approvedBy ?? undefined,
        decidedAt: r.decidedAt?.toISOString() ?? undefined,
        createdAt: r.createdAt?.toISOString() ?? '',
      });
    }
    return result;
  }
  return getTimeOffStore(userId, status);
}

export async function getVolumeSnapshotsAsync(workspaceId?: string): Promise<VolumeSnapshot[]> {
  // RLS-scoped path
  if (workspaceId) {
    const result = await withRls(workspaceId, async ({ db, schema }) => {
      const { desc } = await import('drizzle-orm');
      const rows = await db.select().from(schema.volumeSnapshots).orderBy(desc(schema.volumeSnapshots.snapshotHour));
      return rows.map(r => ({
        id: r.id,
        snapshotHour: r.snapshotHour?.toISOString() ?? '',
        channel: r.channel ?? undefined,
        ticketsCreated: r.ticketsCreated,
        ticketsResolved: r.ticketsResolved,
      }));
    });
    if (result !== null) return result;
  }
  // Unscoped DB path (fallback)
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq, desc } = await import('drizzle-orm');
    const rows = workspaceId
      ? await db.select().from(schema.volumeSnapshots).where(eq(schema.volumeSnapshots.workspaceId, workspaceId)).orderBy(desc(schema.volumeSnapshots.snapshotHour))
      : await db.select().from(schema.volumeSnapshots).orderBy(desc(schema.volumeSnapshots.snapshotHour));
    return rows.map(r => ({
      id: r.id,
      snapshotHour: r.snapshotHour?.toISOString() ?? '',
      channel: r.channel ?? undefined,
      ticketsCreated: r.ticketsCreated,
      ticketsResolved: r.ticketsResolved,
    }));
  }
  return getVolumeSnapshots();
}

export async function addVolumeSnapshotAsync(snapshot: VolumeSnapshot, workspaceId?: string): Promise<void> {
  const ctx = await tryDb();
  if (ctx && workspaceId) {
    const { db, schema } = ctx;
    await db.insert(schema.volumeSnapshots).values({
      workspaceId,
      snapshotHour: new Date(snapshot.snapshotHour),
      channel: snapshot.channel ?? 'all',
      ticketsCreated: snapshot.ticketsCreated,
      ticketsResolved: snapshot.ticketsResolved,
    }).onConflictDoNothing();
    return;
  }
  addVolumeSnapshot(snapshot);
}

export async function getBHConfigsAsync(id?: string, workspaceId?: string): Promise<BusinessHoursConfig[]> {
  const ctx = await tryDb();
  if (ctx) {
    const { db, schema } = ctx;
    const { eq } = await import('drizzle-orm');
    const rows = id
      ? await db.select().from(schema.businessHours).where(eq(schema.businessHours.id, id))
      : workspaceId
        ? await db.select().from(schema.businessHours).where(eq(schema.businessHours.workspaceId, workspaceId))
        : await db.select().from(schema.businessHours);
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      timezone: r.timezone,
      schedule: (r.schedule ?? {}) as BusinessHoursConfig['schedule'],
      holidays: (r.holidays ?? []) as BusinessHoursConfig['holidays'],
      isDefault: r.isDefault,
      createdAt: r.createdAt?.toISOString() ?? '',
      updatedAt: r.updatedAt?.toISOString() ?? '',
    }));
  }
  return getBHConfigs(id);
}

// ---- Compatibility aliases ----
// Re-export under names expected by agent-status.ts, business-hours.ts, time-off.ts, etc.

export { getStatusLog as getAgentStatusEntries };
export { addStatusEntry as addAgentStatusEntry };
export { getTimeOffStore as getTimeOffRequests };
export { addTimeOff as addTimeOffRequest };
export { updateTimeOff as updateTimeOffRequest };
export function removeTimeOffRequest(id: string): boolean {
  ensTo();
  const i = timeOffReqs.findIndex(r => r.id === id);
  if (i < 0) return false;
  timeOffReqs.splice(i, 1);
  writeJsonlFile(TIMEOFF_FILE, timeOffReqs);
  return true;
}
export { getBHConfigs as getBusinessHoursConfigs };
export { addBHConfig as addBusinessHoursConfig };
export { updateBHConfig as updateBusinessHoursConfig };
export { removeBHConfig as removeBusinessHoursConfig };
export { getSchedulesStore as getSchedules };
export { updateScheduleStore as updateSchedule };
export { getTemplatesStore as getTemplates };
export { updateTemplateStore as updateTemplate };

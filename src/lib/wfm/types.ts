/**
 * Shared types for the workforce management domain.
 */

// ---- Schedules & Templates ----

export interface ShiftBlock {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  activity: string;
  label?: string;
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  shifts: ShiftBlock[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentSchedule {
  id: string;
  userId: string;
  userName: string;
  templateId?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  timezone: string;
  shifts: ShiftBlock[];
  createdAt: string;
  updatedAt: string;
}

export type ScheduledActivity = 'work' | 'break' | 'training' | 'meeting' | 'off_shift';

// ---- Agent Status ----

export type AgentAvailability = 'online' | 'away' | 'offline' | 'on_break';

export interface AgentStatusEntry {
  id: string;
  userId: string;
  userName: string;
  status: AgentAvailability;
  reason?: string;
  startedAt: string;
}

export interface AgentCurrentStatus {
  userId: string;
  userName: string;
  status: AgentAvailability;
  reason?: string;
  since: string;
}

// ---- Time Off ----

export interface TimeOffRequest {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  reason?: string;
  status: 'pending' | 'approved' | 'denied';
  approvedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

// ---- Volume & Forecast ----

export interface VolumeSnapshot {
  id: string;
  snapshotHour: string;
  channel?: string;
  ticketsCreated: number;
  ticketsResolved: number;
}

export interface ForecastPoint {
  hour: string;
  predictedVolume: number;
  confidence: { low: number; high: number };
  dayOfWeek: number;
}

export interface StaffingRecommendation {
  hour: string;
  requiredAgents: number;
  scheduledAgents: number;
  gap: number;
}

// ---- Business Hours ----

export interface BusinessHoursConfig {
  id: string;
  name: string;
  timezone: string;
  schedule: Record<string, Array<{ start: string; end: string }>>;
  holidays: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Adherence & Utilization ----

export interface AdherenceRecord {
  userId: string;
  userName: string;
  scheduledActivity: string;
  actualStatus: string;
  adherent: boolean;
  since: string;
}

export interface UtilizationRecord {
  userId: string;
  userName: string;
  handleMinutes: number;
  availableMinutes: number;
  occupancy: number;
}

export interface WfmDashboardData {
  agentStatuses: AgentCurrentStatus[];
  adherence: AdherenceRecord[];
  utilization: UtilizationRecord[];
  forecast: ForecastPoint[];
  staffing: StaffingRecommendation[];
  pendingTimeOff: TimeOffRequest[];
}

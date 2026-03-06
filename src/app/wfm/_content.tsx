"use client";

import { useEffect, useState, useCallback } from "react";

type Tab = "dashboard" | "schedules" | "adherence" | "forecast" | "time-off";

interface AgentStatus {
  userId: string;
  userName: string;
  status: "online" | "away" | "offline" | "on_break";
  reason?: string;
  since: string;
}

interface AdherenceRecord {
  userId: string;
  userName: string;
  scheduledActivity: string;
  actualStatus: string;
  adherent: boolean;
  since: string;
}

interface UtilizationRecord {
  userId: string;
  userName: string;
  handleMinutes: number;
  availableMinutes: number;
  occupancy: number;
}

interface ForecastPoint {
  hour: string;
  predictedVolume: number;
  confidence: { low: number; high: number };
  dayOfWeek: number;
}

interface StaffingRecommendation {
  hour: string;
  requiredAgents: number;
  scheduledAgents: number;
  gap: number;
}

interface TimeOffRequest {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  reason?: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
}

interface Schedule {
  id: string;
  userId: string;
  userName: string;
  effectiveFrom: string;
  effectiveTo?: string;
  timezone: string;
  shifts: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    activity: string;
    label?: string;
  }>;
}

interface DashboardData {
  agentStatuses: AgentStatus[];
  adherence: AdherenceRecord[];
  utilization: UtilizationRecord[];
  forecast: ForecastPoint[];
  staffing: StaffingRecommendation[];
  pendingTimeOff: TimeOffRequest[];
}

const statusColors: Record<string, string> = {
  online: "bg-emerald-500 text-white",
  away: "bg-amber-400 text-black",
  on_break: "bg-blue-500 text-white",
  offline: "bg-zinc-400 text-white",
};

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

export default function WfmPageContent() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/dashboard");
      const data = await res.json();
      setDashboard(data);
    } catch {
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSchedules = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/schedules");
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch {
      setSchedules([]);
    }
  }, []);

  const loadTimeOff = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/time-off");
      const data = await res.json();
      setTimeOffRequests(data.requests || []);
    } catch {
      setTimeOffRequests([]);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    loadSchedules();
    loadTimeOff();
  }, [loadDashboard, loadSchedules, loadTimeOff]);

  // Auto-refresh adherence
  useEffect(() => {
    if (activeTab !== "adherence" && activeTab !== "dashboard") return;
    const interval = setInterval(loadDashboard, 30_000);
    return () => clearInterval(interval);
  }, [activeTab, loadDashboard]);

  async function handleTimeOffDecision(id: string, decision: "approved" | "denied") {
    await fetch(`/api/wfm/time-off/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    loadTimeOff();
    loadDashboard();
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "schedules", label: "Schedules" },
    { key: "adherence", label: "Adherence" },
    { key: "forecast", label: "Forecast" },
    { key: "time-off", label: "Time Off" },
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Workforce Management
        </p>
        <h1 className="mt-2 text-3xl font-bold">WFM Dashboard</h1>
      </header>

      {/* TABS */}
      <nav className="mt-4 flex border-2 border-zinc-950 bg-white">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-4 py-3 font-mono text-xs font-bold uppercase transition-colors ${
              activeTab === tab.key
                ? "bg-zinc-950 text-white"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <section className="mt-4 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading WFM data...</p>
        </section>
      ) : (
        <>
          {activeTab === "dashboard" && dashboard && <DashboardTab data={dashboard} />}
          {activeTab === "schedules" && <SchedulesTab schedules={schedules} />}
          {activeTab === "adherence" && dashboard && <AdherenceTab adherence={dashboard.adherence} />}
          {activeTab === "forecast" && dashboard && <ForecastTab forecast={dashboard.forecast} staffing={dashboard.staffing} />}
          {activeTab === "time-off" && <TimeOffTab requests={timeOffRequests} onDecide={handleTimeOffDecision} />}
        </>
      )}
    </main>
  );
}

function DashboardTab({ data }: { data: DashboardData }) {
  const onlineCount = data.agentStatuses.filter((s) => s.status === "online").length;
  const awayCount = data.agentStatuses.filter((s) => s.status === "away").length;
  const adherentCount = data.adherence.filter((a) => a.adherent).length;
  const adherenceRate = data.adherence.length > 0 ? Math.round((adherentCount / data.adherence.length) * 100) : 0;
  const avgOccupancy = data.utilization.length > 0
    ? Math.round(data.utilization.reduce((sum, u) => sum + u.occupancy, 0) / data.utilization.length)
    : 0;
  const staffingGaps = data.staffing.filter((s) => s.gap > 0);

  return (
    <div className="mt-4 space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">Agents Online</p>
          <p className="mt-2 text-3xl font-bold text-emerald-600">{onlineCount}</p>
          <p className="mt-1 font-mono text-xs text-zinc-400">{awayCount} away, {data.agentStatuses.length} total</p>
        </div>
        <div className="border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">Adherence</p>
          <p className={`mt-2 text-3xl font-bold ${adherenceRate >= 80 ? "text-emerald-600" : adherenceRate >= 60 ? "text-amber-500" : "text-red-500"}`}>
            {adherenceRate}%
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-400">{adherentCount}/{data.adherence.length} on-shift agents</p>
        </div>
        <div className="border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">Avg Occupancy</p>
          <p className="mt-2 text-3xl font-bold">{avgOccupancy}%</p>
          <p className="mt-1 font-mono text-xs text-zinc-400">{data.utilization.length} agents tracked</p>
        </div>
        <div className="border-2 border-zinc-950 bg-white p-6">
          <p className="font-mono text-xs font-bold uppercase text-zinc-500">Staffing Gaps</p>
          <p className={`mt-2 text-3xl font-bold ${staffingGaps.length > 0 ? "text-red-500" : "text-emerald-600"}`}>
            {staffingGaps.length}
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-400">upcoming understaffed hours</p>
        </div>
      </div>

      {/* Agent Status Grid */}
      <section className="border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-950 p-4">
          <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">Agent Statuses</h2>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.agentStatuses.map((s) => (
            <div key={s.userId} className="flex items-center gap-3 border border-zinc-200 p-3">
              <span className={`inline-block h-3 w-3 rounded-full ${
                s.status === "online" ? "bg-emerald-500" :
                s.status === "away" ? "bg-amber-400" :
                s.status === "on_break" ? "bg-blue-500" : "bg-zinc-400"
              }`} />
              <div>
                <p className="text-sm font-medium">{s.userName}</p>
                <p className="font-mono text-xs text-zinc-500">{s.status.replace("_", " ")}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pending Time Off */}
      {data.pendingTimeOff.length > 0 && (
        <section className="border-2 border-amber-400 bg-amber-50 p-4">
          <h2 className="font-mono text-xs font-bold uppercase text-amber-700">
            {data.pendingTimeOff.length} Pending Time-Off Request{data.pendingTimeOff.length !== 1 ? "s" : ""}
          </h2>
          <div className="mt-2 space-y-1">
            {data.pendingTimeOff.map((r) => (
              <p key={r.id} className="font-mono text-xs text-amber-800">
                {r.userName}: {r.startDate} to {r.endDate} {r.reason ? `— ${r.reason}` : ""}
              </p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SchedulesTab({ schedules }: { schedules: Schedule[] }) {
  return (
    <div className="mt-4 space-y-4">
      {schedules.length === 0 ? (
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="text-lg font-bold">No schedules configured</p>
          <p className="mt-2 text-sm text-zinc-600">Create agent schedules via the CLI or API.</p>
        </section>
      ) : (
        <>
          {/* Schedule Table */}
          <section className="border-2 border-zinc-950 bg-white">
            <div className="border-b-2 border-zinc-950 p-4">
              <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">Agent Schedules</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Agent</th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">From</th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">To</th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Timezone</th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Shifts</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={s.id} className="border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                      <td className="px-4 py-3 font-medium">{s.userName}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.effectiveFrom}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.effectiveTo ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.timezone}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {s.shifts.map((shift, i) => (
                            <span key={i} className="inline-block bg-zinc-100 px-2 py-0.5 font-mono text-xs">
                              {dayNames[shift.dayOfWeek]} {shift.startTime}–{shift.endTime}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Weekly Grid */}
          <section className="border-2 border-zinc-950 bg-white">
            <div className="border-b-2 border-zinc-950 p-4">
              <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">Weekly Overview</h2>
            </div>
            <div className="overflow-x-auto p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left font-mono text-xs font-bold uppercase text-zinc-500">Agent</th>
                    {dayNames.map((d) => (
                      <th key={d} className="px-2 py-1 text-center font-mono text-xs font-bold uppercase text-zinc-500">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={s.id} className="border-t border-zinc-100">
                      <td className="px-2 py-2 font-medium">{s.userName}</td>
                      {[0, 1, 2, 3, 4, 5, 6].map((dow) => {
                        const dayShifts = s.shifts.filter((sh) => sh.dayOfWeek === dow);
                        return (
                          <td key={dow} className="px-2 py-2 text-center">
                            {dayShifts.length > 0 ? (
                              dayShifts.map((sh, i) => (
                                <span key={i} className={`inline-block px-1 py-0.5 font-mono text-xs ${
                                  sh.activity === "work" ? "bg-emerald-100 text-emerald-700" :
                                  sh.activity === "break" ? "bg-blue-100 text-blue-700" :
                                  "bg-zinc-100 text-zinc-600"
                                }`}>
                                  {sh.startTime}
                                </span>
                              ))
                            ) : (
                              <span className="font-mono text-xs text-zinc-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function AdherenceTab({ adherence }: { adherence: AdherenceRecord[] }) {
  const adherentCount = adherence.filter((a) => a.adherent).length;
  const rate = adherence.length > 0 ? Math.round((adherentCount / adherence.length) * 100) : 0;

  return (
    <div className="mt-4 space-y-4">
      {/* Adherence Gauge */}
      <section className="border-2 border-zinc-950 bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">Schedule Adherence Rate</p>
            <p className={`mt-2 text-4xl font-bold ${rate >= 80 ? "text-emerald-600" : rate >= 60 ? "text-amber-500" : "text-red-500"}`}>
              {rate}%
            </p>
          </div>
          <div className="h-24 w-24">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#e4e4e7" strokeWidth="8" />
              <circle
                cx="50" cy="50" r="40" fill="none"
                stroke={rate >= 80 ? "#10b981" : rate >= 60 ? "#f59e0b" : "#ef4444"}
                strokeWidth="8"
                strokeDasharray={`${rate * 2.51} 251`}
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
        <p className="mt-2 font-mono text-xs text-zinc-400">
          {adherentCount} of {adherence.length} on-shift agents adherent — auto-refreshes every 30s
        </p>
      </section>

      {/* Adherence Table */}
      {adherence.length > 0 ? (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Agent</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Scheduled</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Actual</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Adherent</th>
                </tr>
              </thead>
              <tbody>
                {adherence.map((a) => (
                  <tr key={a.userId} className={`border-b border-zinc-100 ${!a.adherent ? "bg-red-50" : ""}`}>
                    <td className="px-4 py-3 font-medium">{a.userName}</td>
                    <td className="px-4 py-3 font-mono text-xs">{a.scheduledActivity}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${statusColors[a.actualStatus] ?? "bg-zinc-200"}`}>
                        {a.actualStatus.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs font-bold uppercase ${a.adherent ? "text-emerald-600" : "text-red-500"}`}>
                        {a.adherent ? "YES" : "NO"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">No on-shift agents to track.</p>
        </section>
      )}
    </div>
  );
}

function ForecastTab({ forecast, staffing }: { forecast: ForecastPoint[]; staffing: StaffingRecommendation[] }) {
  const maxVolume = Math.max(...forecast.map((f) => f.confidence.high), 1);

  return (
    <div className="mt-4 space-y-4">
      {/* Forecast Chart */}
      <section className="border-2 border-zinc-950 bg-white p-6">
        <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">Hourly Volume Forecast</h2>
        {forecast.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-zinc-500">No historical data for forecasting.</p>
        ) : (
          <div className="mt-4 flex items-end gap-1" style={{ height: "200px" }}>
            {forecast.slice(0, 48).map((f, i) => {
              const barHeight = (f.predictedVolume / maxVolume) * 100;
              const confLow = (f.confidence.low / maxVolume) * 100;
              const confHigh = (f.confidence.high / maxVolume) * 100;
              return (
                <div key={i} className="group relative flex-1" style={{ height: "100%" }}>
                  {/* Confidence band */}
                  <div
                    className="absolute bottom-0 w-full bg-blue-100"
                    style={{ height: `${confHigh}%`, bottom: 0 }}
                  />
                  {/* Predicted bar */}
                  <div
                    className="absolute bottom-0 w-full bg-blue-500 transition-all group-hover:bg-blue-600"
                    style={{ height: `${barHeight}%` }}
                  />
                  {/* Tooltip */}
                  <div className="absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 font-mono text-xs text-white group-hover:block">
                    {f.hour.slice(11, 16)} — {f.predictedVolume} ({f.confidence.low}–{f.confidence.high})
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 font-mono text-xs text-zinc-400">
          Showing next {Math.min(forecast.length, 48)} hours — bars = predicted, bands = confidence
        </p>
      </section>

      {/* Staffing Recommendations */}
      <section className="border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-950 p-4">
          <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">Staffing Recommendations</h2>
        </div>
        {staffing.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-mono text-sm text-zinc-500">No staffing data available.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Hour</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Required</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Scheduled</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Gap</th>
                </tr>
              </thead>
              <tbody>
                {staffing.slice(0, 24).map((s) => (
                  <tr key={s.hour} className={`border-b border-zinc-100 ${s.gap > 0 ? "bg-red-50" : s.gap < 0 ? "bg-emerald-50" : ""}`}>
                    <td className="px-4 py-3 font-mono text-xs">{s.hour.slice(0, 16)}</td>
                    <td className="px-4 py-3 font-mono text-sm font-bold">{s.requiredAgents}</td>
                    <td className="px-4 py-3 font-mono text-sm">{s.scheduledAgents}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-sm font-bold ${
                        s.gap > 0 ? "text-red-500" : s.gap < 0 ? "text-emerald-600" : "text-zinc-400"
                      }`}>
                        {s.gap > 0 ? `+${s.gap} understaffed` : s.gap < 0 ? `${s.gap} overstaffed` : "balanced"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function TimeOffTab({ requests, onDecide }: { requests: TimeOffRequest[]; onDecide: (id: string, decision: "approved" | "denied") => void }) {
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <div className="mt-4 space-y-4">
      {/* Pending Requests */}
      <section className="border-2 border-zinc-950 bg-white">
        <div className="border-b-2 border-zinc-950 p-4">
          <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">
            Pending Requests ({pending.length})
          </h2>
        </div>
        {pending.length === 0 ? (
          <div className="p-6 text-center">
            <p className="font-mono text-sm text-zinc-500">No pending time-off requests.</p>
          </div>
        ) : (
          <div className="space-y-2 p-4">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border border-zinc-200 p-4">
                <div>
                  <p className="font-medium">{r.userName}</p>
                  <p className="font-mono text-xs text-zinc-500">
                    {r.startDate} to {r.endDate}
                    {r.reason ? ` — ${r.reason}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onDecide(r.id, "approved")}
                    className="border-2 border-emerald-600 bg-emerald-600 px-3 py-1 font-mono text-xs font-bold uppercase text-white hover:bg-emerald-700"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onDecide(r.id, "denied")}
                    className="border-2 border-red-500 px-3 py-1 font-mono text-xs font-bold uppercase text-red-500 hover:bg-red-50"
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Decided Requests */}
      {decided.length > 0 && (
        <section className="border-2 border-zinc-950 bg-white">
          <div className="border-b-2 border-zinc-950 p-4">
            <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Agent</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Dates</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Reason</th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100">
                    <td className="px-4 py-3 font-medium">{r.userName}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.startDate} to {r.endDate}</td>
                    <td className="px-4 py-3 text-sm text-zinc-600">{r.reason ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs font-bold uppercase ${
                        r.status === "approved" ? "text-emerald-600" : "text-red-500"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

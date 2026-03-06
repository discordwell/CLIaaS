"use client";

import { useEffect, useState, useCallback } from "react";

interface TimeWindow {
  start: string;
  end: string;
}

interface BusinessHoursConfig {
  id: string;
  name: string;
  timezone: string;
  schedule: Record<string, TimeWindow[]>;
  holidays: string[];
  isDefault: boolean;
}

interface HolidayEntry {
  id: string;
  name: string;
  date: string;
  recurring?: boolean;
}

interface HolidayCalendar {
  id: string;
  name: string;
  description?: string;
  entries: HolidayEntry[];
}

interface Preset {
  id: string;
  name: string;
  country: string;
  description: string;
}

const DAYS = [
  { key: "0", label: "Sunday" },
  { key: "1", label: "Monday" },
  { key: "2", label: "Tuesday" },
  { key: "3", label: "Wednesday" },
  { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" },
  { key: "6", label: "Saturday" },
];

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export default function BusinessHoursContent() {
  const [tab, setTab] = useState<"schedules" | "holidays">("schedules");
  const [schedules, setSchedules] = useState<BusinessHoursConfig[]>([]);
  const [calendars, setCalendars] = useState<HolidayCalendar[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);

  // Schedule form
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleTz, setScheduleTz] = useState("UTC");
  const [dayWindows, setDayWindows] = useState<Record<string, TimeWindow[]>>({
    "1": [{ start: "09:00", end: "17:00" }],
    "2": [{ start: "09:00", end: "17:00" }],
    "3": [{ start: "09:00", end: "17:00" }],
    "4": [{ start: "09:00", end: "17:00" }],
    "5": [{ start: "09:00", end: "17:00" }],
  });
  const [saving, setSaving] = useState(false);

  // Holiday form
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [holidayName, setHolidayName] = useState("");
  const [holidayDescription, setHolidayDescription] = useState("");
  const [holidayEntryName, setHolidayEntryName] = useState("");
  const [holidayEntryDate, setHolidayEntryDate] = useState("");
  const [holidayEntryRecurring, setHolidayEntryRecurring] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [schRes, calRes, preRes] = await Promise.all([
        fetch("/api/business-hours"),
        fetch("/api/holidays"),
        fetch("/api/holidays/presets"),
      ]);
      const schData = await schRes.json();
      const calData = await calRes.json();
      const preData = await preRes.json();
      setSchedules(schData.businessHours || []);
      setCalendars(calData.calendars || []);
      setPresets(preData.presets || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function toggleDay(dayKey: string) {
    setDayWindows((prev) => {
      if (prev[dayKey]) {
        const { [dayKey]: _, ...rest } = prev;
        void _;
        return rest;
      }
      return { ...prev, [dayKey]: [{ start: "09:00", end: "17:00" }] };
    });
  }

  function updateWindow(dayKey: string, idx: number, field: "start" | "end", value: string) {
    setDayWindows((prev) => ({
      ...prev,
      [dayKey]: (prev[dayKey] || []).map((w, i) =>
        i === idx ? { ...w, [field]: value } : w
      ),
    }));
  }

  function addWindow(dayKey: string) {
    setDayWindows((prev) => ({
      ...prev,
      [dayKey]: [...(prev[dayKey] || []), { start: "13:00", end: "17:00" }],
    }));
  }

  function removeWindow(dayKey: string, idx: number) {
    setDayWindows((prev) => ({
      ...prev,
      [dayKey]: (prev[dayKey] || []).filter((_, i) => i !== idx),
    }));
  }

  function copyToWeekdays() {
    const mondayWindows = dayWindows["1"] || [{ start: "09:00", end: "17:00" }];
    setDayWindows((prev) => {
      const next = { ...prev };
      for (const d of ["2", "3", "4", "5"]) {
        next[d] = mondayWindows.map((w) => ({ ...w }));
      }
      return next;
    });
  }

  async function createSchedule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/business-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scheduleName,
          timezone: scheduleTz,
          schedule: dayWindows,
        }),
      });
      setShowScheduleForm(false);
      setScheduleName("");
      loadAll();
    } finally {
      setSaving(false);
    }
  }

  async function deleteSchedule(id: string) {
    await fetch(`/api/business-hours/${id}`, { method: "DELETE" });
    loadAll();
  }

  async function createCalendar(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: holidayName,
          description: holidayDescription || undefined,
        }),
      });
      setShowHolidayForm(false);
      setHolidayName("");
      setHolidayDescription("");
      loadAll();
    } finally {
      setSaving(false);
    }
  }

  async function addEntry(calendarId: string) {
    if (!holidayEntryName || !holidayEntryDate) return;
    await fetch(`/api/holidays/${calendarId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: holidayEntryName,
        date: holidayEntryDate,
        recurring: holidayEntryRecurring,
      }),
    });
    setHolidayEntryName("");
    setHolidayEntryDate("");
    setHolidayEntryRecurring(false);
    loadAll();
  }

  async function removeEntry(calendarId: string, entryId: string) {
    await fetch(`/api/holidays/${calendarId}/entries`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId }),
    });
    loadAll();
  }

  async function deleteCalendar(id: string) {
    await fetch(`/api/holidays/${id}`, { method: "DELETE" });
    loadAll();
  }

  async function importPreset(presetId: string) {
    await fetch("/api/holidays/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId }),
    });
    loadAll();
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Business Hours & Schedules
        </p>
        <h1 className="mt-2 text-3xl font-bold">Operating Hours</h1>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setTab("schedules")}
            className={`px-4 py-2 font-mono text-xs font-bold uppercase transition-colors ${
              tab === "schedules"
                ? "bg-zinc-950 text-white"
                : "border-2 border-zinc-300 text-zinc-600 hover:border-zinc-950"
            }`}
          >
            Schedules ({schedules.length})
          </button>
          <button
            onClick={() => setTab("holidays")}
            className={`px-4 py-2 font-mono text-xs font-bold uppercase transition-colors ${
              tab === "holidays"
                ? "bg-zinc-950 text-white"
                : "border-2 border-zinc-300 text-zinc-600 hover:border-zinc-950"
            }`}
          >
            Holiday Calendars ({calendars.length})
          </button>
        </div>
      </header>

      {loading && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        </section>
      )}

      {/* SCHEDULES TAB */}
      {!loading && tab === "schedules" && (
        <>
          <section className="mt-4 flex justify-end">
            <button
              onClick={() => setShowScheduleForm(!showScheduleForm)}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              {showScheduleForm ? "Cancel" : "New Schedule"}
            </button>
          </section>

          {showScheduleForm && (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
              <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">
                Create Schedule
              </h2>
              <form onSubmit={createSchedule} className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="font-mono text-xs font-bold uppercase">Name</span>
                    <input
                      type="text"
                      required
                      value={scheduleName}
                      onChange={(e) => setScheduleName(e.target.value)}
                      className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                      placeholder="e.g., US Business Hours"
                    />
                  </label>
                  <label className="block">
                    <span className="font-mono text-xs font-bold uppercase">Timezone</span>
                    <select
                      value={scheduleTz}
                      onChange={(e) => setScheduleTz(e.target.value)}
                      className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                    >
                      {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold uppercase">Weekly Schedule</span>
                    <button
                      type="button"
                      onClick={copyToWeekdays}
                      className="font-mono text-xs font-bold uppercase text-blue-600 hover:underline"
                    >
                      Copy Mon → Weekdays
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {DAYS.map((day) => {
                      const isEnabled = !!dayWindows[day.key];
                      const windows = dayWindows[day.key] || [];
                      return (
                        <div
                          key={day.key}
                          className="flex flex-wrap items-start gap-3 border border-zinc-200 p-3"
                        >
                          <label className="flex w-28 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => toggleDay(day.key)}
                              className="h-4 w-4"
                            />
                            <span className="font-mono text-xs font-bold uppercase">
                              {day.label}
                            </span>
                          </label>
                          {isEnabled && (
                            <div className="flex flex-1 flex-wrap items-center gap-2">
                              {windows.map((w, idx) => (
                                <div key={idx} className="flex items-center gap-1">
                                  <input
                                    type="time"
                                    value={w.start}
                                    onChange={(e) =>
                                      updateWindow(day.key, idx, "start", e.target.value)
                                    }
                                    className="border border-zinc-300 px-2 py-1 font-mono text-xs"
                                  />
                                  <span className="text-zinc-400">–</span>
                                  <input
                                    type="time"
                                    value={w.end}
                                    onChange={(e) =>
                                      updateWindow(day.key, idx, "end", e.target.value)
                                    }
                                    className="border border-zinc-300 px-2 py-1 font-mono text-xs"
                                  />
                                  {windows.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeWindow(day.key, idx)}
                                      className="font-mono text-xs text-red-500"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => addWindow(day.key)}
                                className="font-mono text-xs text-blue-600 hover:underline"
                              >
                                + interval
                              </button>
                            </div>
                          )}
                          {!isEnabled && (
                            <span className="font-mono text-xs text-zinc-400">Closed</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="border-2 border-zinc-950 bg-zinc-950 px-6 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create Schedule"}
                </button>
              </form>
            </section>
          )}

          {/* Schedule list */}
          {schedules.length === 0 ? (
            <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="text-lg font-bold">No schedules found</p>
              <p className="mt-2 text-sm text-zinc-600">
                Create a business hours schedule to track operating hours.
              </p>
            </section>
          ) : (
            <section className="mt-8 space-y-4">
              {schedules.map((s) => (
                <div key={s.id} className="border-2 border-zinc-950 bg-white p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-sm font-bold">{s.name}</span>
                      <span className="ml-3 font-mono text-xs text-zinc-500">{s.timezone}</span>
                      {s.isDefault && (
                        <span className="ml-2 bg-zinc-200 px-2 py-0.5 font-mono text-xs font-bold uppercase">
                          Default
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteSchedule(s.id)}
                      className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-7 gap-1">
                    {DAYS.map((day) => {
                      const windows = s.schedule[day.key] || [];
                      return (
                        <div key={day.key} className="text-center">
                          <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                            {day.label.slice(0, 3)}
                          </p>
                          {windows.length > 0 ? (
                            windows.map((w, i) => (
                              <p key={i} className="font-mono text-xs">
                                {w.start}–{w.end}
                              </p>
                            ))
                          ) : (
                            <p className="font-mono text-xs text-zinc-300">—</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 font-mono text-xs text-zinc-400">ID: {s.id}</p>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {/* HOLIDAYS TAB */}
      {!loading && tab === "holidays" && (
        <>
          <section className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => setShowHolidayForm(!showHolidayForm)}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              {showHolidayForm ? "Cancel" : "New Calendar"}
            </button>
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => importPreset(p.id)}
                className="border-2 border-zinc-300 px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
              >
                Import {p.country}
              </button>
            ))}
          </section>

          {showHolidayForm && (
            <section className="mt-4 border-2 border-zinc-950 bg-white p-6">
              <h2 className="font-mono text-xs font-bold uppercase text-zinc-500">
                Create Holiday Calendar
              </h2>
              <form onSubmit={createCalendar} className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <input
                    type="text"
                    required
                    value={holidayName}
                    onChange={(e) => setHolidayName(e.target.value)}
                    className="flex-1 border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                    placeholder="Calendar name"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Create
                  </button>
                </div>
                <input
                  type="text"
                  value={holidayDescription}
                  onChange={(e) => setHolidayDescription(e.target.value)}
                  className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                  placeholder="Optional description (e.g., US federal holidays 2026)"
                />
              </form>
            </section>
          )}

          {calendars.length === 0 ? (
            <section className="mt-8 border-2 border-zinc-950 bg-white p-8 text-center">
              <p className="text-lg font-bold">No holiday calendars</p>
              <p className="mt-2 text-sm text-zinc-600">
                Create a calendar or import a preset to get started.
              </p>
            </section>
          ) : (
            <section className="mt-8 space-y-4">
              {calendars.map((cal) => {
                const today = new Date().toISOString().slice(0, 10);
                const upcomingCount = cal.entries.filter(
                  (e) => e.recurring || e.date >= today
                ).length;
                const pastCount = cal.entries.length - upcomingCount;

                return (
                <div key={cal.id} className="border-2 border-zinc-950 bg-white p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-sm font-bold">{cal.name}</span>
                      {cal.description && (
                        <span className="ml-3 font-mono text-xs text-zinc-500">
                          {cal.description}
                        </span>
                      )}
                      <div className="mt-1 flex gap-3 font-mono text-xs text-zinc-400">
                        <span>{cal.entries.length} date{cal.entries.length !== 1 ? "s" : ""}</span>
                        {upcomingCount > 0 && (
                          <span className="text-emerald-600">
                            {upcomingCount} upcoming
                          </span>
                        )}
                        {pastCount > 0 && (
                          <span className="text-zinc-400">
                            {pastCount} past
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteCalendar(cal.id)}
                      className="font-mono text-xs font-bold uppercase text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>

                  {/* Entry list */}
                  {cal.entries.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {cal.entries.map((entry) => (
                        <span
                          key={entry.id}
                          className="inline-flex items-center gap-1 border border-zinc-200 px-2 py-1 font-mono text-xs"
                        >
                          <span className="font-bold">{entry.name}</span>
                          <span className="text-zinc-400">{entry.date}</span>
                          {entry.recurring && (
                            <span className="text-blue-500">↻</span>
                          )}
                          <button
                            onClick={() => removeEntry(cal.id, entry.id)}
                            className="ml-1 text-red-400 hover:text-red-600"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Add entry inline */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
                    <input
                      type="text"
                      placeholder="Holiday name"
                      value={holidayEntryName}
                      onChange={(e) => setHolidayEntryName(e.target.value)}
                      className="border border-zinc-300 px-2 py-1 font-mono text-xs outline-none focus:border-zinc-950"
                    />
                    <input
                      type="date"
                      value={holidayEntryDate}
                      onChange={(e) => setHolidayEntryDate(e.target.value)}
                      className="border border-zinc-300 px-2 py-1 font-mono text-xs outline-none focus:border-zinc-950"
                    />
                    <label className="flex items-center gap-1 font-mono text-xs">
                      <input
                        type="checkbox"
                        checked={holidayEntryRecurring}
                        onChange={(e) => setHolidayEntryRecurring(e.target.checked)}
                      />
                      Recurring
                    </label>
                    <button
                      onClick={() => addEntry(cal.id)}
                      disabled={!holidayEntryName || !holidayEntryDate}
                      className="border border-zinc-950 px-3 py-1 font-mono text-xs font-bold uppercase hover:bg-zinc-100 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </main>
  );
}

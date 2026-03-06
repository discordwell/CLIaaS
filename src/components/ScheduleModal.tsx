"use client";

import { useState } from 'react';

interface ScheduleModalProps {
  reportId: string;
  onClose: () => void;
  onSave: (schedule: Record<string, unknown>) => void;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ScheduleModal({ reportId, onClose, onSave }: ScheduleModalProps) {
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [hourUtc, setHourUtc] = useState(9);
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [recipientsText, setRecipientsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const recipients = recipientsText
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      setError('At least one recipient email is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        reportId,
        frequency,
        recipients,
        format,
        hourUtc,
      };
      if (frequency === 'weekly') body.dayOfWeek = dayOfWeek;
      if (frequency === 'monthly') body.dayOfMonth = dayOfMonth;

      const res = await fetch('/api/report-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      onSave(data.schedule);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg border-2 border-zinc-950 bg-white p-6">
        <h3 className="text-lg font-bold">Schedule Export</h3>
        <p className="mt-1 text-sm text-zinc-600">
          Automatically export and email this report on a recurring schedule.
        </p>

        {error && (
          <div className="mt-3 border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {/* Frequency */}
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-700">
              Frequency
            </label>
            <select
              value={frequency}
              onChange={e => setFrequency(e.target.value as 'daily' | 'weekly' | 'monthly')}
              className="mt-1 w-full border-2 border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          {/* Day of week (weekly only) */}
          {frequency === 'weekly' && (
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-700">
                Day of Week
              </label>
              <select
                value={dayOfWeek}
                onChange={e => setDayOfWeek(Number(e.target.value))}
                className="mt-1 w-full border-2 border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
              >
                {DAYS_OF_WEEK.map((day, i) => (
                  <option key={i} value={i}>{day}</option>
                ))}
              </select>
            </div>
          )}

          {/* Day of month (monthly only) */}
          {frequency === 'monthly' && (
            <div>
              <label className="block font-mono text-xs font-bold uppercase text-zinc-700">
                Day of Month
              </label>
              <select
                value={dayOfMonth}
                onChange={e => setDayOfMonth(Number(e.target.value))}
                className="mt-1 w-full border-2 border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          )}

          {/* Hour UTC */}
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-700">
              Hour (UTC)
            </label>
            <select
              value={hourUtc}
              onChange={e => setHourUtc(Number(e.target.value))}
              className="mt-1 w-full border-2 border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, '0')}:00 UTC</option>
              ))}
            </select>
          </div>

          {/* Format */}
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-700">
              Format
            </label>
            <select
              value={format}
              onChange={e => setFormat(e.target.value as 'csv' | 'json')}
              className="mt-1 w-full border-2 border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>

          {/* Recipients */}
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-700">
              Recipients
            </label>
            <input
              type="text"
              value={recipientsText}
              onChange={e => setRecipientsText(e.target.value)}
              placeholder="email1@example.com, email2@example.com"
              className="mt-1 w-full border-2 border-zinc-300 bg-white px-3 py-2 font-mono text-sm"
            />
            <p className="mt-1 text-xs text-zinc-500">Comma-separated email addresses</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="border-2 border-zinc-300 px-4 py-2 font-mono text-xs font-bold uppercase hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Create Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

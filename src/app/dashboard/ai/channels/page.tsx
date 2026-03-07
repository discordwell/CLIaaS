'use client';

import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types (mirrors ChannelPolicy from src/lib/ai/admin-controls.ts)
// ---------------------------------------------------------------------------

type Mode = 'suggest' | 'approve' | 'auto';

interface ChannelPolicy {
  channel: string;
  enabled: boolean;
  mode: Mode;
  maxAutoResolvesPerHour: number;
  confidenceThreshold: number;
  excludedTopics: string[];
}

// ---------------------------------------------------------------------------
// Default channel policies
// ---------------------------------------------------------------------------

const DEFAULT_POLICIES: ChannelPolicy[] = [
  {
    channel: 'email',
    enabled: true,
    mode: 'suggest',
    maxAutoResolvesPerHour: 50,
    confidenceThreshold: 75,
    excludedTopics: ['billing-disputes', 'legal'],
  },
  {
    channel: 'chat',
    enabled: true,
    mode: 'approve',
    maxAutoResolvesPerHour: 100,
    confidenceThreshold: 70,
    excludedTopics: ['account-deletion'],
  },
  {
    channel: 'sms',
    enabled: false,
    mode: 'suggest',
    maxAutoResolvesPerHour: 30,
    confidenceThreshold: 80,
    excludedTopics: [],
  },
  {
    channel: 'phone',
    enabled: false,
    mode: 'suggest',
    maxAutoResolvesPerHour: 20,
    confidenceThreshold: 85,
    excludedTopics: ['escalations'],
  },
  {
    channel: 'social',
    enabled: true,
    mode: 'auto',
    maxAutoResolvesPerHour: 200,
    confidenceThreshold: 60,
    excludedTopics: ['pr-crisis'],
  },
];

// ---------------------------------------------------------------------------
// Tag Input Component
// ---------------------------------------------------------------------------

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const addTag = useCallback(() => {
    const value = input.trim().toLowerCase().replace(/\s+/g, '-');
    if (value && !tags.includes(value)) {
      onChange([...tags, value]);
    }
    setInput('');
  }, [input, tags, onChange]);

  const removeTag = useCallback(
    (tag: string) => {
      onChange(tags.filter((t) => t !== tag));
    },
    [tags, onChange],
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="Add topic..."
          className="flex-1 border-2 border-line bg-panel px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground"
        />
        <button
          type="button"
          onClick={addTag}
          className="border-2 border-line bg-panel px-4 py-2 font-mono text-xs font-bold uppercase transition-colors hover:bg-accent-soft"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 border-2 border-line bg-accent-soft px-2.5 py-1 font-mono text-[10px] font-bold uppercase"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-muted transition-colors hover:text-foreground"
                aria-label={`Remove ${tag}`}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel Card
// ---------------------------------------------------------------------------

function ChannelCard({
  policy,
  onUpdate,
}: {
  policy: ChannelPolicy;
  onUpdate: (updated: ChannelPolicy) => void;
}) {
  const [local, setLocal] = useState<ChannelPolicy>(policy);
  const [saved, setSaved] = useState(false);

  const isDirty =
    JSON.stringify(local) !== JSON.stringify(policy);

  const handleSave = () => {
    onUpdate(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const channelIcons: Record<string, string> = {
    email: '@',
    chat: '#',
    sms: '$',
    phone: '~',
    social: '&',
  };

  return (
    <div
      className={`border-2 border-line bg-panel p-6 transition-colors ${
        !local.enabled ? 'opacity-60' : ''
      }`}
    >
      {/* Card header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border-2 border-line font-mono text-lg font-bold">
            {channelIcons[local.channel] ?? '?'}
          </span>
          <div>
            <p className="font-mono text-sm font-bold uppercase">
              {local.channel}
            </p>
            <p className="font-mono text-[10px] text-muted">
              {local.enabled ? 'Active' : 'Disabled'}
            </p>
          </div>
        </div>

        {/* Enable/Disable toggle */}
        <button
          type="button"
          onClick={() => setLocal((p) => ({ ...p, enabled: !p.enabled }))}
          className={`h-5 w-10 border-2 border-line transition-colors ${
            local.enabled ? 'bg-foreground' : 'bg-panel'
          } relative`}
        >
          <div
            className={`absolute top-0.5 h-3 w-4 transition-all ${
              local.enabled
                ? 'left-[calc(100%-1.125rem)] bg-panel'
                : 'left-0.5 bg-muted'
            }`}
          />
        </button>
      </div>

      {/* Card body */}
      <div className="mt-5 space-y-4">
        {/* Mode */}
        <div className="space-y-2">
          <label className="block font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Mode
          </label>
          <select
            value={local.mode}
            onChange={(e) =>
              setLocal((p) => ({ ...p, mode: e.target.value as Mode }))
            }
            className="w-full border-2 border-line bg-panel px-3 py-2 font-mono text-sm font-bold uppercase text-foreground focus:outline-none focus:ring-2 focus:ring-foreground"
          >
            <option value="suggest">Suggest</option>
            <option value="approve">Approve</option>
            <option value="auto">Auto</option>
          </select>
        </div>

        {/* Confidence Threshold */}
        <div className="space-y-2">
          <label className="block font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Confidence Threshold
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={100}
              value={local.confidenceThreshold}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  confidenceThreshold: Math.max(
                    0,
                    Math.min(100, Number(e.target.value)),
                  ),
                }))
              }
              className="w-24 border-2 border-line bg-panel px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground"
            />
            <span className="font-mono text-xs text-muted">%</span>
            {/* Visual bar */}
            <div className="flex-1 h-2 border-2 border-line bg-panel overflow-hidden">
              <div
                className="h-full bg-foreground transition-all"
                style={{ width: `${local.confidenceThreshold}%` }}
              />
            </div>
          </div>
        </div>

        {/* Rate Limit */}
        <div className="space-y-2">
          <label className="block font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Rate Limit
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={1000}
              value={local.maxAutoResolvesPerHour}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  maxAutoResolvesPerHour: Math.max(
                    1,
                    Math.min(1000, Number(e.target.value)),
                  ),
                }))
              }
              className="w-24 border-2 border-line bg-panel px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground"
            />
            <span className="font-mono text-xs text-muted">per hour</span>
          </div>
        </div>

        {/* Excluded Topics */}
        <div className="space-y-2">
          <label className="block font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Excluded Topics
          </label>
          <TagInput
            tags={local.excludedTopics}
            onChange={(topics) =>
              setLocal((p) => ({ ...p, excludedTopics: topics }))
            }
          />
        </div>
      </div>

      {/* Save button */}
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty && !saved}
          className={`border-2 border-line px-6 py-2 font-mono text-sm font-bold uppercase transition-colors ${
            saved
              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
              : isDirty
                ? 'bg-foreground text-panel hover:bg-zinc-800'
                : 'bg-panel text-muted opacity-50'
          }`}
        >
          {saved ? 'Saved' : 'Save'}
        </button>
        {isDirty && !saved && (
          <span className="font-mono text-[10px] font-bold uppercase text-muted">
            Unsaved changes
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AIChannelPolicyPage() {
  const [policies, setPolicies] = useState<ChannelPolicy[]>(DEFAULT_POLICIES);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [bulkSaved, setBulkSaved] = useState(false);

  const handleUpdate = useCallback(
    (updated: ChannelPolicy) => {
      setPolicies((prev) =>
        prev.map((p) => (p.channel === updated.channel ? updated : p)),
      );
    },
    [],
  );

  const handleToggleAll = () => {
    const next = !globalEnabled;
    setGlobalEnabled(next);
    setPolicies((prev) => prev.map((p) => ({ ...p, enabled: next })));
    setBulkSaved(true);
    setTimeout(() => setBulkSaved(false), 2000);
  };

  const activeCount = policies.filter((p) => p.enabled).length;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-foreground">
      {/* Header */}
      <header className="border-2 border-line bg-panel p-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
              AI Configuration
            </p>
            <h1 className="mt-4 text-4xl font-bold">Channel Policies</h1>
          </div>
          <a
            href="/dashboard/ai/setup"
            className="border-2 border-line bg-panel px-6 py-2 font-mono text-sm font-bold uppercase text-foreground hover:bg-accent-soft text-center"
          >
            Setup Wizard
          </a>
        </div>
      </header>

      {/* Stats bar */}
      <section className="mt-8 grid grid-cols-3 gap-4">
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">{policies.length}</p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Total Channels
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">{activeCount}</p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Active
          </p>
        </div>
        <div className="border-2 border-line bg-panel p-5 text-center">
          <p className="font-mono text-3xl font-bold">
            {policies.length - activeCount}
          </p>
          <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wider text-muted">
            Disabled
          </p>
        </div>
      </section>

      {/* Global toggle */}
      <section className="mt-8 border-2 border-line bg-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-sm font-bold uppercase">
              Global AI Toggle
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted">
              Enable or disable AI assistance across all channels at once.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {bulkSaved && (
              <span className="font-mono text-[10px] font-bold uppercase text-emerald-700">
                Applied
              </span>
            )}
            <button
              type="button"
              onClick={handleToggleAll}
              className={`border-2 border-line px-6 py-2 font-mono text-sm font-bold uppercase transition-colors ${
                globalEnabled
                  ? 'bg-foreground text-panel hover:bg-zinc-800'
                  : 'bg-panel text-foreground hover:bg-accent-soft'
              }`}
            >
              {globalEnabled ? 'Disable All' : 'Enable All'}
            </button>
          </div>
        </div>
      </section>

      {/* Channel cards */}
      <section className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {policies.map((policy) => (
          <ChannelCard
            key={policy.channel}
            policy={policy}
            onUpdate={handleUpdate}
          />
        ))}
      </section>

      {/* Legend */}
      <section className="mt-8 border-2 border-line bg-panel p-6">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
          Mode Reference
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              mode: 'Suggest',
              desc: 'AI drafts a response and presents it to the agent for review. The agent decides whether to send, edit, or discard.',
            },
            {
              mode: 'Approve',
              desc: 'AI queues the response for one-click agent approval. Responses auto-expire after the configured timeout.',
            },
            {
              mode: 'Auto',
              desc: 'AI sends responses automatically when confidence exceeds the threshold. Rate limits and circuit breakers apply.',
            },
          ].map((item) => (
            <div key={item.mode} className="space-y-2">
              <p className="font-mono text-sm font-bold uppercase">
                {item.mode}
              </p>
              <p className="font-mono text-[10px] leading-relaxed text-muted">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

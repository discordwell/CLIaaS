'use client';

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Provider = 'openai' | 'anthropic' | 'custom';
type Mode = 'suggest' | 'approve' | 'auto';

interface ChannelConfig {
  email: boolean;
  chat: boolean;
  phone: boolean;
}

interface ChannelModes {
  email: Mode;
  chat: Mode;
  phone: Mode;
}

interface FormData {
  provider: Provider;
  apiKey: string;
  customEndpoint: string;
  channels: ChannelConfig;
  channelModes: ChannelModes;
  confidenceThreshold: number;
  rateLimit: number;
  testMessage: string;
  testResponse: string | null;
  testLoading: boolean;
}

const STEPS = [
  'Provider',
  'Channels',
  'Mode',
  'Thresholds',
  'Test',
  'Activate',
] as const;

const INITIAL_FORM: FormData = {
  provider: 'openai',
  apiKey: '',
  customEndpoint: '',
  channels: { email: true, chat: true, phone: false },
  channelModes: { email: 'suggest', chat: 'suggest', phone: 'suggest' },
  confidenceThreshold: 75,
  rateLimit: 50,
  testMessage: '',
  testResponse: null,
  testLoading: false,
};

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`flex h-9 w-9 items-center justify-center border-2 border-line font-mono text-xs font-bold ${
              i < current
                ? 'bg-foreground text-panel'
                : i === current
                  ? 'bg-accent-soft text-foreground'
                  : 'bg-panel text-muted'
            }`}
          >
            {i + 1}
          </div>
          {i < total - 1 && (
            <div
              className={`h-0.5 w-8 sm:w-12 ${
                i < current ? 'bg-foreground' : 'bg-line'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Provider
// ---------------------------------------------------------------------------

function StepProvider({
  form,
  setForm,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
}) {
  const providers: { id: Provider; label: string; desc: string }[] = [
    { id: 'openai', label: 'OpenAI', desc: 'GPT-4o, GPT-5.3-Codex-Spark' },
    { id: 'anthropic', label: 'Anthropic', desc: 'Claude Opus, Sonnet, Haiku' },
    { id: 'custom', label: 'Custom', desc: 'Self-hosted or third-party endpoint' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Select AI Provider</h2>
        <p className="mt-1 font-mono text-xs text-muted">
          Choose the LLM provider that will power AI assistance across your
          channels.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setForm((f) => ({ ...f, provider: p.id }))}
            className={`border-2 border-line p-5 text-left transition-colors hover:bg-accent-soft ${
              form.provider === p.id ? 'bg-accent-soft' : 'bg-panel'
            }`}
          >
            <p className="font-mono text-sm font-bold uppercase">{p.label}</p>
            <p className="mt-1 font-mono text-xs text-muted">{p.desc}</p>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <label className="block font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
          API Key
        </label>
        <input
          type="password"
          value={form.apiKey}
          onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
          placeholder="sk-..."
          className="w-full border-2 border-line bg-panel px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground"
        />
      </div>

      {form.provider === 'custom' && (
        <div className="space-y-3">
          <label className="block font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Custom Endpoint URL
          </label>
          <input
            type="url"
            value={form.customEndpoint}
            onChange={(e) =>
              setForm((f) => ({ ...f, customEndpoint: e.target.value }))
            }
            placeholder="https://api.example.com/v1/chat"
            className="w-full border-2 border-line bg-panel px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Channels
// ---------------------------------------------------------------------------

function StepChannels({
  form,
  setForm,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
}) {
  const channelList: { id: keyof ChannelConfig; label: string; icon: string }[] = [
    { id: 'email', label: 'Email', icon: '@' },
    { id: 'chat', label: 'Live Chat', icon: '#' },
    { id: 'phone', label: 'Phone / Voice', icon: '~' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Enable AI Channels</h2>
        <p className="mt-1 font-mono text-xs text-muted">
          Toggle which support channels receive AI-powered assistance.
        </p>
      </div>

      <div className="space-y-3">
        {channelList.map((ch) => (
          <button
            key={ch.id}
            type="button"
            onClick={() =>
              setForm((f) => ({
                ...f,
                channels: { ...f.channels, [ch.id]: !f.channels[ch.id] },
              }))
            }
            className={`flex w-full items-center justify-between border-2 border-line p-5 transition-colors hover:bg-accent-soft ${
              form.channels[ch.id] ? 'bg-accent-soft' : 'bg-panel'
            }`}
          >
            <div className="flex items-center gap-4">
              <span className="flex h-10 w-10 items-center justify-center border-2 border-line bg-panel font-mono text-lg font-bold">
                {ch.icon}
              </span>
              <span className="font-mono text-sm font-bold uppercase">
                {ch.label}
              </span>
            </div>
            <div
              className={`h-5 w-10 border-2 border-line transition-colors ${
                form.channels[ch.id] ? 'bg-foreground' : 'bg-panel'
              } relative`}
            >
              <div
                className={`absolute top-0.5 h-3 w-4 transition-all ${
                  form.channels[ch.id]
                    ? 'left-[calc(100%-1.125rem)] bg-panel'
                    : 'left-0.5 bg-muted'
                }`}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Mode
// ---------------------------------------------------------------------------

function StepMode({
  form,
  setForm,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
}) {
  const modes: { id: Mode; label: string; desc: string }[] = [
    { id: 'suggest', label: 'Suggest', desc: 'AI drafts replies; agents review and send' },
    { id: 'approve', label: 'Approve', desc: 'AI sends after agent approval' },
    { id: 'auto', label: 'Auto', desc: 'AI sends automatically above confidence threshold' },
  ];

  const activeChannels = (
    Object.entries(form.channels) as [keyof ChannelConfig, boolean][]
  ).filter(([, v]) => v);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Set AI Mode</h2>
        <p className="mt-1 font-mono text-xs text-muted">
          Choose how the AI operates on each enabled channel.
        </p>
      </div>

      {activeChannels.length === 0 ? (
        <div className="border-2 border-line bg-panel p-6 text-center">
          <p className="font-mono text-sm text-muted">
            No channels enabled. Go back and enable at least one channel.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeChannels.map(([chId]) => (
            <div key={chId} className="border-2 border-line bg-panel p-5">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
                {chId}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {modes.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        channelModes: { ...f.channelModes, [chId]: m.id },
                      }))
                    }
                    className={`border-2 border-line p-3 text-left transition-colors hover:bg-accent-soft ${
                      form.channelModes[chId] === m.id
                        ? 'bg-accent-soft'
                        : 'bg-panel'
                    }`}
                  >
                    <p className="font-mono text-sm font-bold uppercase">
                      {m.label}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      {m.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Thresholds
// ---------------------------------------------------------------------------

function StepThresholds({
  form,
  setForm,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Configure Thresholds</h2>
        <p className="mt-1 font-mono text-xs text-muted">
          Set the confidence floor and rate limits for AI operations.
        </p>
      </div>

      <div className="border-2 border-line bg-panel p-6 space-y-6">
        {/* Confidence threshold */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
              Confidence Threshold
            </label>
            <span className="font-mono text-2xl font-bold">
              {form.confidenceThreshold}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={form.confidenceThreshold}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                confidenceThreshold: Number(e.target.value),
              }))
            }
            className="w-full accent-foreground"
          />
          <div className="flex justify-between font-mono text-[10px] text-muted">
            <span>0% — Permissive</span>
            <span>100% — Strict</span>
          </div>
        </div>

        {/* Rate limit */}
        <div className="space-y-3">
          <label className="block font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Max Auto-Resolves per Hour
          </label>
          <input
            type="number"
            min={1}
            max={1000}
            value={form.rateLimit}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                rateLimit: Math.max(1, Math.min(1000, Number(e.target.value))),
              }))
            }
            className="w-full border-2 border-line bg-panel px-4 py-3 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground"
          />
          <p className="font-mono text-[10px] text-muted">
            Circuit breaker engages if this limit is exceeded.
          </p>
        </div>
      </div>

      {/* Quick-pick cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Conservative', confidence: 90, rate: 20 },
          { label: 'Balanced', confidence: 75, rate: 50 },
          { label: 'Aggressive', confidence: 50, rate: 200 },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() =>
              setForm((f) => ({
                ...f,
                confidenceThreshold: preset.confidence,
                rateLimit: preset.rate,
              }))
            }
            className={`border-2 border-line p-4 text-left transition-colors hover:bg-accent-soft ${
              form.confidenceThreshold === preset.confidence &&
              form.rateLimit === preset.rate
                ? 'bg-accent-soft'
                : 'bg-panel'
            }`}
          >
            <p className="font-mono text-sm font-bold uppercase">
              {preset.label}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {preset.confidence}% / {preset.rate} per hr
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Test
// ---------------------------------------------------------------------------

function StepTest({
  form,
  setForm,
}: {
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
}) {
  const handleTest = () => {
    if (!form.testMessage.trim()) return;
    setForm((f) => ({ ...f, testLoading: true, testResponse: null }));
    // Simulate AI response after a short delay
    setTimeout(() => {
      setForm((f) => ({
        ...f,
        testLoading: false,
        testResponse: `Thank you for reaching out. I understand your concern about "${f.testMessage.slice(0, 60)}". Based on our knowledge base, here is what I recommend:\n\n1. Verify your account settings under Preferences > General.\n2. If the issue persists, our team can escalate this for priority review.\n\nIs there anything else I can help with?\n\n— AI Assistant (${f.provider}, confidence: ${f.confidenceThreshold}%)`,
      }));
    }, 1200);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Test AI Response</h2>
        <p className="mt-1 font-mono text-xs text-muted">
          Send a test message to verify your configuration before going live.
        </p>
      </div>

      <div className="border-2 border-line bg-panel p-6 space-y-4">
        <label className="block font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
          Sample Customer Message
        </label>
        <textarea
          rows={3}
          value={form.testMessage}
          onChange={(e) =>
            setForm((f) => ({ ...f, testMessage: e.target.value }))
          }
          placeholder="e.g. I can't log in to my account after resetting my password..."
          className="w-full resize-none border-2 border-line bg-panel px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground"
        />
        <button
          type="button"
          onClick={handleTest}
          disabled={form.testLoading || !form.testMessage.trim()}
          className="border-2 border-line bg-panel px-6 py-2 font-mono text-sm font-bold uppercase transition-colors hover:bg-accent-soft disabled:opacity-40"
        >
          {form.testLoading ? 'Processing...' : 'Send Test'}
        </button>
      </div>

      {form.testResponse && (
        <div className="border-2 border-line bg-panel p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            AI Response
          </p>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-sm text-foreground">
            {form.testResponse}
          </pre>
          <div className="mt-4 flex gap-3">
            <span className="border-2 border-line bg-emerald-100 px-3 py-1 font-mono text-[10px] font-bold uppercase text-emerald-800">
              Passed
            </span>
            <span className="font-mono text-xs text-muted">
              Response generated in 1.2s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6: Activate
// ---------------------------------------------------------------------------

function StepActivate({ form }: { form: FormData }) {
  const [activated, setActivated] = useState(false);

  const activeChannels = (
    Object.entries(form.channels) as [keyof ChannelConfig, boolean][]
  ).filter(([, v]) => v);

  const summaryRows = [
    { label: 'Provider', value: form.provider.toUpperCase() },
    { label: 'API Key', value: form.apiKey ? '\u2022\u2022\u2022\u2022' + form.apiKey.slice(-4) : 'Not set' },
    ...(form.provider === 'custom'
      ? [{ label: 'Endpoint', value: form.customEndpoint || 'Not set' }]
      : []),
    {
      label: 'Channels',
      value: activeChannels.map(([ch]) => ch.toUpperCase()).join(', ') || 'None',
    },
    ...activeChannels.map(([ch]) => ({
      label: `${ch.toUpperCase()} Mode`,
      value: form.channelModes[ch].toUpperCase(),
    })),
    { label: 'Confidence', value: `${form.confidenceThreshold}%` },
    { label: 'Rate Limit', value: `${form.rateLimit} / hr` },
    {
      label: 'Test',
      value: form.testResponse ? 'Passed' : 'Skipped',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Review &amp; Activate</h2>
        <p className="mt-1 font-mono text-xs text-muted">
          Confirm your setup before enabling AI assistance across your workspace.
        </p>
      </div>

      <div className="border-2 border-line bg-panel divide-y-2 divide-line">
        {summaryRows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between px-6 py-4"
          >
            <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
              {row.label}
            </span>
            <span className="font-mono text-sm font-bold">{row.value}</span>
          </div>
        ))}
      </div>

      {!activated ? (
        <button
          type="button"
          onClick={() => setActivated(true)}
          className="w-full border-2 border-line bg-foreground px-6 py-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-panel transition-colors hover:bg-zinc-800"
        >
          Activate AI Assistance
        </button>
      ) : (
        <div className="border-2 border-line bg-emerald-50 p-6 text-center">
          <p className="font-mono text-lg font-bold text-emerald-800">
            AI Assistance Activated
          </p>
          <p className="mt-2 font-mono text-xs text-emerald-700">
            Your workspace is now using {form.provider.toUpperCase()} across{' '}
            {activeChannels.length} channel
            {activeChannels.length !== 1 ? 's' : ''}. Monitor performance on
            the AI Dashboard.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Wizard Page
// ---------------------------------------------------------------------------

export default function AISetupWizardPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);

  const canAdvance = (): boolean => {
    switch (step) {
      case 0:
        return form.apiKey.length > 0;
      case 1:
        return Object.values(form.channels).some(Boolean);
      case 2:
        return true;
      case 3:
        return form.confidenceThreshold >= 0 && form.rateLimit > 0;
      case 4:
        return true; // Test is optional
      case 5:
        return true;
      default:
        return false;
    }
  };

  const stepContent = () => {
    switch (step) {
      case 0:
        return <StepProvider form={form} setForm={setForm} />;
      case 1:
        return <StepChannels form={form} setForm={setForm} />;
      case 2:
        return <StepMode form={form} setForm={setForm} />;
      case 3:
        return <StepThresholds form={form} setForm={setForm} />;
      case 4:
        return <StepTest form={form} setForm={setForm} />;
      case 5:
        return <StepActivate form={form} />;
      default:
        return null;
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-foreground">
      {/* Header */}
      <header className="border-2 border-line bg-panel p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-foreground">
          AI Configuration
        </p>
        <h1 className="mt-4 text-4xl font-bold">Setup Wizard</h1>
      </header>

      {/* Step Indicator */}
      <div className="mt-8 border-2 border-line bg-panel p-6">
        <StepIndicator current={step} total={STEPS.length} />
        <p className="mt-4 text-center font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
          Step {step + 1} of {STEPS.length} — {STEPS[step]}
        </p>
      </div>

      {/* Step Content */}
      <div className="mt-8 border-2 border-line bg-panel p-8">
        {stepContent()}
      </div>

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="border-2 border-line bg-panel px-8 py-3 font-mono text-sm font-bold uppercase transition-colors hover:bg-accent-soft disabled:opacity-30"
        >
          Back
        </button>
        {step < STEPS.length - 1 && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            disabled={!canAdvance()}
            className="border-2 border-line bg-foreground px-8 py-3 font-mono text-sm font-bold uppercase text-panel transition-colors hover:bg-zinc-800 disabled:opacity-30"
          >
            Next
          </button>
        )}
      </div>
    </main>
  );
}

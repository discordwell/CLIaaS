'use client';

// Revalidate cached data every 60 seconds
export const revalidate = 60;

import { useState } from 'react';

type Step = 'database' | 'llm' | 'connector' | 'summary';
type LLMProvider = 'claude' | 'openai' | 'openclaw';

interface SetupState {
  databaseUrl: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
  openclawBaseUrl: string;
  openclawModel: string;
  connector: string;
}

interface SetupResult {
  ok: boolean;
  database: { connected: boolean; url: string };
  llm: { provider: string; keyProvided: boolean; keyValid: boolean; warning: string | null };
  connector: { name: string; valid: boolean } | null;
  nextSteps: string[];
}

const CONNECTORS = [
  { value: '', label: 'None (set up later)' },
  { value: 'zendesk', label: 'Zendesk' },
  { value: 'kayako', label: 'Kayako' },
  { value: 'kayako-classic', label: 'Kayako Classic' },
  { value: 'freshdesk', label: 'Freshdesk' },
  { value: 'helpcrunch', label: 'HelpCrunch' },
  { value: 'groove', label: 'Groove' },
  { value: 'intercom', label: 'Intercom' },
  { value: 'helpscout', label: 'Help Scout' },
  { value: 'zoho-desk', label: 'Zoho Desk' },
  { value: 'hubspot', label: 'HubSpot' },
];

const STEPS: { key: Step; label: string; number: number }[] = [
  { key: 'database', label: 'Database', number: 1 },
  { key: 'llm', label: 'LLM Provider', number: 2 },
  { key: 'connector', label: 'Connector', number: 3 },
  { key: 'summary', label: 'Summary', number: 4 },
];

export default function SetupPage() {
  const [step, setStep] = useState<Step>('database');
  const [state, setState] = useState<SetupState>({
    databaseUrl: 'postgresql://cliaas:cliaas@localhost:5432/cliaas',
    llmProvider: 'claude',
    llmApiKey: '',
    openclawBaseUrl: 'http://localhost:11434',
    openclawModel: 'llama3',
    connector: '',
  });
  const [testing, setTesting] = useState(false);
  const [dbStatus, setDbStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [dbError, setDbError] = useState('');
  const [result, setResult] = useState<SetupResult | null>(null);
  const [submitError, setSubmitError] = useState('');

  function update(field: keyof SetupState, value: string) {
    setState((prev) => ({ ...prev, [field]: value }));
  }

  async function testDatabase() {
    setTesting(true);
    setDbStatus('idle');
    setDbError('');

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseUrl: state.databaseUrl,
          llmProvider: state.llmProvider,
        }),
      });
      const data = await res.json();

      if (res.ok && data.database?.connected) {
        setDbStatus('ok');
      } else {
        setDbStatus('error');
        setDbError(data.details || data.error || 'Connection failed');
      }
    } catch (err) {
      setDbStatus('error');
      setDbError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setTesting(false);
    }
  }

  async function submitSetup() {
    setTesting(true);
    setSubmitError('');

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseUrl: state.databaseUrl,
          llmProvider: state.llmProvider,
          llmApiKey: state.llmApiKey || undefined,
          openclawBaseUrl: state.llmProvider === 'openclaw' ? state.openclawBaseUrl : undefined,
          openclawModel: state.llmProvider === 'openclaw' ? state.openclawModel : undefined,
          connector: state.connector || undefined,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setResult(data);
      } else {
        setSubmitError(data.details || data.error || 'Setup validation failed');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setTesting(false);
    }
  }

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-12 text-foreground sm:px-10">
      <header className="border-2 border-line bg-panel p-6">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
          BYOC Setup Wizard
        </p>
        <h1 className="mt-2 text-2xl font-bold">Configure CLIaaS</h1>
      </header>

      {/* Step indicator */}
      <nav className="mt-6 flex gap-2">
        {STEPS.map((s, i) => (
          <div
            key={s.key}
            className={`flex-1 border-2 px-3 py-2 text-center font-mono text-xs font-bold uppercase ${
              i === currentStepIndex
                ? 'border-foreground bg-foreground text-background'
                : i < currentStepIndex
                  ? 'border-line bg-panel text-muted'
                  : 'border-line bg-panel text-muted opacity-50'
            }`}
          >
            {s.number}. {s.label}
          </div>
        ))}
      </nav>

      {/* Step content */}
      <div className="mt-6 border-2 border-line bg-panel p-6">
        {step === 'database' && (
          <div>
            <h2 className="font-mono text-sm font-bold uppercase">
              Step 1: Database Configuration
            </h2>
            <p className="mt-2 text-sm text-muted">
              CLIaaS uses PostgreSQL for ticket storage, user management, and full-text search.
            </p>

            <label className="mt-6 block">
              <span className="font-mono text-xs font-bold uppercase text-muted">
                PostgreSQL Connection URL
              </span>
              <input
                type="text"
                value={state.databaseUrl}
                onChange={(e) => update('databaseUrl', e.target.value)}
                placeholder="postgresql://user:password@localhost:5432/cliaas"
                className="mt-1 block w-full border-2 border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted focus:border-foreground focus:outline-none"
              />
            </label>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={testDatabase}
                disabled={testing || !state.databaseUrl}
                className="border-2 border-line bg-foreground px-4 py-2 font-mono text-xs font-bold uppercase text-background transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>

              {dbStatus === 'ok' && (
                <span className="font-mono text-xs font-bold text-emerald-600">
                  Connected
                </span>
              )}
              {dbStatus === 'error' && (
                <span className="font-mono text-xs font-bold text-red-600">
                  Failed: {dbError}
                </span>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setStep('llm')}
                className="border-2 border-line bg-foreground px-6 py-2 font-mono text-xs font-bold uppercase text-background transition-opacity hover:opacity-80"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 'llm' && (
          <div>
            <h2 className="font-mono text-sm font-bold uppercase">
              Step 2: LLM Provider
            </h2>
            <p className="mt-2 text-sm text-muted">
              Select the AI provider for triage, drafts, sentiment analysis, and other AI features.
            </p>

            <div className="mt-6 space-y-3">
              {(['claude', 'openai', 'openclaw'] as const).map((provider) => (
                <label
                  key={provider}
                  className={`flex cursor-pointer items-center gap-3 border-2 p-3 ${
                    state.llmProvider === provider
                      ? 'border-foreground bg-background'
                      : 'border-line bg-panel'
                  }`}
                >
                  <input
                    type="radio"
                    name="llmProvider"
                    value={provider}
                    checked={state.llmProvider === provider}
                    onChange={(e) =>
                      update('llmProvider', e.target.value)
                    }
                    className="accent-foreground"
                  />
                  <div>
                    <span className="font-mono text-sm font-bold uppercase">
                      {provider === 'claude'
                        ? 'Anthropic Claude'
                        : provider === 'openai'
                          ? 'OpenAI GPT'
                          : 'OpenClaw (Self-hosted)'}
                    </span>
                    <p className="text-xs text-muted">
                      {provider === 'claude'
                        ? 'Recommended. Uses Claude for all AI operations.'
                        : provider === 'openai'
                          ? 'Uses GPT models for AI operations.'
                          : 'Self-hosted or custom OpenAI-compatible endpoint.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {state.llmProvider !== 'openclaw' && (
              <label className="mt-6 block">
                <span className="font-mono text-xs font-bold uppercase text-muted">
                  {state.llmProvider === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}
                </span>
                <input
                  type="password"
                  value={state.llmApiKey}
                  onChange={(e) => update('llmApiKey', e.target.value)}
                  placeholder={
                    state.llmProvider === 'claude' ? 'sk-ant-...' : 'sk-...'
                  }
                  className="mt-1 block w-full border-2 border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted focus:border-foreground focus:outline-none"
                />
                <p className="mt-1 text-xs text-muted">
                  Optional during setup. Can be added to .env later.
                </p>
              </label>
            )}

            {state.llmProvider === 'openclaw' && (
              <div className="mt-6 space-y-4">
                <label className="block">
                  <span className="font-mono text-xs font-bold uppercase text-muted">
                    Base URL
                  </span>
                  <input
                    type="text"
                    value={state.openclawBaseUrl}
                    onChange={(e) => update('openclawBaseUrl', e.target.value)}
                    placeholder="http://localhost:11434"
                    className="mt-1 block w-full border-2 border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted focus:border-foreground focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-xs font-bold uppercase text-muted">
                    Model Name
                  </span>
                  <input
                    type="text"
                    value={state.openclawModel}
                    onChange={(e) => update('openclawModel', e.target.value)}
                    placeholder="llama3"
                    className="mt-1 block w-full border-2 border-line bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted focus:border-foreground focus:outline-none"
                  />
                </label>
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button
                onClick={() => setStep('database')}
                className="border-2 border-line bg-panel px-6 py-2 font-mono text-xs font-bold uppercase text-foreground transition-colors hover:bg-accent-soft"
              >
                Back
              </button>
              <button
                onClick={() => setStep('connector')}
                className="border-2 border-line bg-foreground px-6 py-2 font-mono text-xs font-bold uppercase text-background transition-opacity hover:opacity-80"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 'connector' && (
          <div>
            <h2 className="font-mono text-sm font-bold uppercase">
              Step 3: Helpdesk Connector
            </h2>
            <p className="mt-2 text-sm text-muted">
              Optionally connect to your existing helpdesk to import tickets, KB articles, and customer data.
            </p>

            <label className="mt-6 block">
              <span className="font-mono text-xs font-bold uppercase text-muted">
                Connector
              </span>
              <select
                value={state.connector}
                onChange={(e) => update('connector', e.target.value)}
                className="mt-1 block w-full border-2 border-line bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-foreground focus:outline-none"
              >
                {CONNECTORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            {state.connector && (
              <div className="mt-4 border-2 border-line bg-background p-4">
                <p className="font-mono text-xs font-bold uppercase text-muted">
                  Connector credentials
                </p>
                <p className="mt-2 text-sm text-muted">
                  Credentials for <span className="font-bold">{state.connector}</span> should
                  be set in your <code className="font-mono text-foreground">.env</code> file.
                  See <code className="font-mono text-foreground">.env.example</code> for the
                  required environment variables.
                </p>
                <p className="mt-2 text-sm text-muted">
                  After setup, run:{' '}
                  <code className="font-mono text-foreground">
                    pnpm cliaas sync run --connector {state.connector}
                  </code>
                </p>
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button
                onClick={() => setStep('llm')}
                className="border-2 border-line bg-panel px-6 py-2 font-mono text-xs font-bold uppercase text-foreground transition-colors hover:bg-accent-soft"
              >
                Back
              </button>
              <button
                onClick={() => {
                  setStep('summary');
                  submitSetup();
                }}
                className="border-2 border-line bg-foreground px-6 py-2 font-mono text-xs font-bold uppercase text-background transition-opacity hover:opacity-80"
              >
                Complete Setup
              </button>
            </div>
          </div>
        )}

        {step === 'summary' && (
          <div>
            <h2 className="font-mono text-sm font-bold uppercase">
              Step 4: Summary
            </h2>

            {testing && (
              <p className="mt-4 text-sm text-muted">Validating configuration...</p>
            )}

            {submitError && (
              <div className="mt-4 border-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">
                <p className="font-mono font-bold">Setup Error</p>
                <p className="mt-1">{submitError}</p>
                <button
                  onClick={() => {
                    setStep('database');
                    setSubmitError('');
                  }}
                  className="mt-3 border-2 border-red-600 bg-white px-4 py-1 font-mono text-xs font-bold uppercase text-red-600 hover:bg-red-50"
                >
                  Go Back
                </button>
              </div>
            )}

            {result && (
              <div className="mt-4 space-y-4">
                {/* Database */}
                <div className="border-2 border-line p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold uppercase text-muted">
                      Database
                    </span>
                    <span
                      className={`font-mono text-xs font-bold ${
                        result.database.connected ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {result.database.connected ? 'CONNECTED' : 'FAILED'}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-sm text-foreground">
                    {result.database.url}
                  </p>
                </div>

                {/* LLM */}
                <div className="border-2 border-line p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold uppercase text-muted">
                      LLM Provider
                    </span>
                    <span className="font-mono text-xs font-bold text-foreground">
                      {result.llm.provider.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    API key: {result.llm.keyProvided ? 'provided' : 'not set (add to .env)'}
                  </p>
                  {result.llm.warning && (
                    <p className="mt-1 text-sm text-amber-600">{result.llm.warning}</p>
                  )}
                </div>

                {/* Connector */}
                {result.connector && (
                  <div className="border-2 border-line p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold uppercase text-muted">
                        Connector
                      </span>
                      <span className="font-mono text-xs font-bold text-foreground">
                        {result.connector.name.toUpperCase()}
                      </span>
                    </div>
                  </div>
                )}

                {/* Next Steps */}
                <div className="border-2 border-line bg-zinc-950 p-4 text-zinc-100">
                  <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
                    Next Steps
                  </p>
                  <pre className="mt-3 overflow-x-auto font-mono text-sm leading-relaxed text-zinc-300">
                    {result.nextSteps.map((s, i) => (
                      <span key={i}>
                        <span className="text-emerald-400">$</span> {s}
                        {'\n'}
                      </span>
                    ))}
                  </pre>
                </div>

                <div className="flex gap-3">
                  <a
                    href="/dashboard"
                    className="border-2 border-line bg-foreground px-6 py-2 font-mono text-xs font-bold uppercase text-background transition-opacity hover:opacity-80"
                  >
                    Open Dashboard
                  </a>
                  <button
                    onClick={() => {
                      setStep('database');
                      setResult(null);
                    }}
                    className="border-2 border-line bg-panel px-6 py-2 font-mono text-xs font-bold uppercase text-foreground transition-colors hover:bg-accent-soft"
                  >
                    Reconfigure
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

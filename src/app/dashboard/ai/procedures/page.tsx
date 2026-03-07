'use client';

import { useEffect, useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Procedure {
  id: string;
  name: string;
  description: string | null;
  steps: unknown[];
  triggerTopics: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

type Status = 'active' | 'draft' | 'disabled';

function deriveStatus(p: Procedure): Status {
  if (!p.enabled) return 'disabled';
  if (p.steps.length === 0 && p.triggerTopics.length === 0) return 'draft';
  return 'active';
}

const statusStyle: Record<Status, string> = {
  active: 'bg-emerald-500 text-white',
  draft: 'bg-amber-400 text-black',
  disabled: 'bg-zinc-300 text-zinc-600',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AIProceduresPage() {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);

  // Inline editor state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formTriggers, setFormTriggers] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);

  // Test section
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);

  // --------------------------------------------------
  // Data loading
  // --------------------------------------------------

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/procedures');
      const data = await res.json();
      setProcedures(data.procedures ?? []);
    } catch {
      setProcedures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // --------------------------------------------------
  // Helpers: populate form from a procedure
  // --------------------------------------------------

  function populateForm(p: Procedure) {
    setFormName(p.name);
    setFormDescription(p.description ?? '');
    setFormBody(JSON.stringify(p.steps, null, 2));
    setFormTriggers(p.triggerTopics.join(', '));
    setFormEnabled(p.enabled);
    setTestInput('');
    setTestResult(null);
  }

  function resetForm() {
    setFormName('');
    setFormDescription('');
    setFormBody('[\n  \n]');
    setFormTriggers('');
    setFormEnabled(true);
    setTestInput('');
    setTestResult(null);
  }

  // --------------------------------------------------
  // CRUD actions
  // --------------------------------------------------

  async function handleCreate() {
    let steps: unknown[];
    try {
      steps = JSON.parse(formBody);
    } catch {
      steps = [{ instruction: formBody }];
    }
    const triggers = formTriggers
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    await fetch('/api/ai/procedures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formName,
        description: formDescription || null,
        steps,
        triggerTopics: triggers,
        enabled: formEnabled,
      }),
    });
    setCreating(false);
    resetForm();
    load();
  }

  async function handleUpdate(id: string) {
    let steps: unknown[];
    try {
      steps = JSON.parse(formBody);
    } catch {
      steps = [{ instruction: formBody }];
    }
    const triggers = formTriggers
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    await fetch(`/api/ai/procedures/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formName,
        description: formDescription || null,
        steps,
        triggerTopics: triggers,
        enabled: formEnabled,
      }),
    });
    setExpandedId(null);
    resetForm();
    load();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/ai/procedures/${id}`, { method: 'DELETE' });
    if (expandedId === id) {
      setExpandedId(null);
      resetForm();
    }
    load();
  }

  async function handleToggle(p: Procedure) {
    await fetch(`/api/ai/procedures/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !p.enabled }),
    });
    load();
  }

  async function handleTest() {
    setTestRunning(true);
    setTestResult(null);
    try {
      // Use the AI draft endpoint as a lightweight test harness
      const res = await fetch('/api/ai/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: testInput, dryRun: true }),
      });
      const data = await res.json();
      setTestResult(
        data.resolution ?? data.reply ?? data.error ?? JSON.stringify(data, null, 2),
      );
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestRunning(false);
    }
  }

  // --------------------------------------------------
  // Inline editor panel (shared between create & edit)
  // --------------------------------------------------

  function renderEditor(mode: 'create' | 'edit', procedureId?: string) {
    return (
      <div className="border-2 border-line bg-panel p-6 mt-4 space-y-5">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
          {mode === 'create' ? 'New Procedure' : 'Edit Procedure'}
        </p>

        {/* Name */}
        <div>
          <label className="block font-mono text-xs font-bold uppercase tracking-wider text-muted mb-1">
            Name
          </label>
          <input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            className="w-full border-2 border-line bg-panel px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground"
            placeholder="e.g. Password Reset Flow"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block font-mono text-xs font-bold uppercase tracking-wider text-muted mb-1">
            Description
          </label>
          <textarea
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            rows={2}
            className="w-full border-2 border-line bg-panel px-3 py-2 font-mono text-sm text-foreground resize-y focus:outline-none focus:ring-2 focus:ring-foreground"
            placeholder="Brief summary of what this procedure does"
          />
        </div>

        {/* Procedure body */}
        <div>
          <label className="block font-mono text-xs font-bold uppercase tracking-wider text-muted mb-1">
            Procedure Body (JSON steps or plain instructions)
          </label>
          <textarea
            value={formBody}
            onChange={(e) => setFormBody(e.target.value)}
            rows={10}
            className="w-full border-2 border-line bg-panel px-3 py-2 font-mono text-xs text-foreground resize-y focus:outline-none focus:ring-2 focus:ring-foreground"
            placeholder={'[\n  { "instruction": "Verify the customer identity" },\n  { "instruction": "Send password reset link" }\n]'}
          />
        </div>

        {/* Trigger conditions */}
        <div>
          <label className="block font-mono text-xs font-bold uppercase tracking-wider text-muted mb-1">
            Trigger Topics (comma-separated)
          </label>
          <input
            value={formTriggers}
            onChange={(e) => setFormTriggers(e.target.value)}
            className="w-full border-2 border-line bg-panel px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground"
            placeholder="password_reset, account_lockout"
          />
        </div>

        {/* Enable toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <button
            type="button"
            role="switch"
            aria-checked={formEnabled}
            onClick={() => setFormEnabled(!formEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center border-2 border-line transition-colors ${
              formEnabled ? 'bg-emerald-500' : 'bg-zinc-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 bg-white border border-line transition-transform ${
                formEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
            {formEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>

        {/* Test section */}
        <div className="border-t-2 border-line pt-5">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted mb-3">
            Test
          </p>
          <div className="flex gap-3">
            <input
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              className="flex-1 border-2 border-line bg-panel px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground"
              placeholder="Enter a test message..."
            />
            <button
              onClick={handleTest}
              disabled={testRunning || !testInput.trim()}
              className="border-2 border-line px-4 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testRunning ? 'Running...' : 'Run Test'}
            </button>
          </div>
          {testResult !== null && (
            <pre className="mt-3 border-2 border-line bg-zinc-50 p-4 font-mono text-xs text-foreground whitespace-pre-wrap overflow-x-auto max-h-48">
              {testResult}
            </pre>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={() =>
              mode === 'create' ? handleCreate() : handleUpdate(procedureId!)
            }
            disabled={!formName.trim()}
            className="border-2 border-line bg-foreground px-5 py-2 font-mono text-xs font-bold uppercase text-panel hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mode === 'create' ? 'Create' : 'Save Changes'}
          </button>
          <button
            onClick={() => {
              if (mode === 'create') setCreating(false);
              else setExpandedId(null);
              resetForm();
            }}
            className="border-2 border-line px-5 py-2 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-foreground">
      {/* Header */}
      <header className="border-2 border-line bg-panel p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
              AI Configuration
            </p>
            <h1 className="mt-2 text-3xl font-bold">AI Procedures</h1>
          </div>
          <button
            onClick={() => {
              if (creating) {
                setCreating(false);
                resetForm();
              } else {
                setExpandedId(null);
                resetForm();
                setFormBody('[\n  \n]');
                setCreating(true);
              }
            }}
            className="border-2 border-line bg-foreground px-5 py-2 font-mono text-xs font-bold uppercase text-panel hover:opacity-90"
          >
            {creating ? 'Cancel' : 'Create New'}
          </button>
        </div>
      </header>

      {/* Create panel */}
      {creating && renderEditor('create')}

      {/* Loading state */}
      {loading ? (
        <section className="mt-8 border-2 border-line bg-panel p-8 text-center">
          <p className="font-mono text-sm text-muted">Loading procedures...</p>
        </section>
      ) : procedures.length === 0 && !creating ? (
        <section className="mt-8 border-2 border-line bg-panel p-8 text-center">
          <p className="text-lg font-bold">No procedures found</p>
          <p className="mt-2 font-mono text-sm text-muted">
            Create AI procedures to guide automated resolution workflows.
          </p>
        </section>
      ) : (
        /* Procedures list */
        <section className="mt-8 space-y-4">
          {procedures.map((p) => {
            const status = deriveStatus(p);
            const isExpanded = expandedId === p.id;

            return (
              <div key={p.id}>
                {/* Card */}
                <div className="border-2 border-line bg-panel p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    {/* Left: info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <h2 className="text-lg font-bold truncate">{p.name}</h2>
                        <span
                          className={`shrink-0 px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${statusStyle[status]}`}
                        >
                          {status}
                        </span>
                      </div>
                      {p.description && (
                        <p className="mt-1 font-mono text-xs text-muted truncate">
                          {p.description}
                        </p>
                      )}
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted">
                        Updated{' '}
                        {new Date(p.updatedAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {' | '}
                        {p.steps.length} step{p.steps.length !== 1 ? 's' : ''}
                        {p.triggerTopics.length > 0 && (
                          <>
                            {' | '}
                            {p.triggerTopics.join(', ')}
                          </>
                        )}
                      </p>
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Toggle switch */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={p.enabled}
                        onClick={() => handleToggle(p)}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center border-2 border-line transition-colors ${
                          p.enabled ? 'bg-emerald-500' : 'bg-zinc-300'
                        }`}
                        title={p.enabled ? 'Disable' : 'Enable'}
                      >
                        <span
                          className={`inline-block h-4 w-4 bg-white border border-line transition-transform ${
                            p.enabled ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>

                      <button
                        onClick={() => {
                          if (isExpanded) {
                            setExpandedId(null);
                            resetForm();
                          } else {
                            setCreating(false);
                            populateForm(p);
                            setExpandedId(p.id);
                          }
                        }}
                        className="border-2 border-line px-3 py-1.5 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
                      >
                        {isExpanded ? 'Close' : 'Edit'}
                      </button>

                      <button
                        onClick={() => {
                          setCreating(false);
                          if (!isExpanded) {
                            populateForm(p);
                            setExpandedId(p.id);
                          }
                          // Scroll to test section next tick
                          setTimeout(() => {
                            document
                              .getElementById(`test-${p.id}`)
                              ?.scrollIntoView({ behavior: 'smooth' });
                          }, 50);
                        }}
                        className="border-2 border-line px-3 py-1.5 font-mono text-xs font-bold uppercase text-foreground hover:bg-accent-soft"
                      >
                        Test
                      </button>

                      <button
                        onClick={() => handleDelete(p.id)}
                        className="border-2 border-line px-3 py-1.5 font-mono text-xs font-bold uppercase text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded edit panel */}
                {isExpanded && (
                  <div id={`test-${p.id}`}>{renderEditor('edit', p.id)}</div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}

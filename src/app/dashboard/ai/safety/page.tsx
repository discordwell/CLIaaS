import {
  getCircuitBreakerStatus,
  getAuditTrail,
  getUsageSummary,
} from '@/lib/ai/admin-controls';
import SafetyActions from './_actions';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// PII types the system can detect (mirrors compliance/pii/rules defaults)
// ---------------------------------------------------------------------------

const PII_TYPES = [
  { key: 'email', label: 'Email Addresses' },
  { key: 'phone', label: 'Phone Numbers' },
  { key: 'ssn', label: 'Social Security Numbers' },
  { key: 'credit_card', label: 'Credit Card Numbers' },
  { key: 'ip_address', label: 'IP Addresses' },
  { key: 'date_of_birth', label: 'Dates of Birth' },
  { key: 'address', label: 'Physical Addresses' },
  { key: 'passport', label: 'Passport Numbers' },
] as const;

// ---------------------------------------------------------------------------
// Usage quotas (enterprise defaults)
// ---------------------------------------------------------------------------

const QUOTAS = {
  maxCalls: 10_000,
  maxTokens: 5_000_000,
  maxCostCents: 50_000, // $500
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AISafetyPage() {
  const circuitBreaker = getCircuitBreakerStatus();
  const usage = getUsageSummary('default');
  const { entries: auditEntries } = getAuditTrail({ limit: 20 });

  // Circuit breaker visual config
  const cbColor: Record<string, string> = {
    closed: 'bg-emerald-500',
    open: 'bg-red-500',
    half_open: 'bg-amber-400',
  };
  const cbText: Record<string, string> = {
    closed: 'text-emerald-700',
    open: 'text-red-700',
    half_open: 'text-amber-700',
  };
  const cbBg: Record<string, string> = {
    closed: 'bg-emerald-50',
    open: 'bg-red-50',
    half_open: 'bg-amber-50',
  };

  // Usage bar helper
  function pct(current: number, max: number) {
    if (max <= 0) return 0;
    return Math.min(Math.round((current / max) * 100), 100);
  }

  function barColor(percent: number) {
    if (percent >= 90) return 'bg-red-500';
    if (percent >= 70) return 'bg-amber-400';
    return 'bg-emerald-500';
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-foreground">
      {/* ---- Header ---- */}
      <header className="border-2 border-line bg-panel p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
          AI Administration
        </p>
        <h1 className="mt-2 text-3xl font-bold">AI Safety &amp; Controls</h1>
      </header>

      {/* ---- Circuit Breaker Panel ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
          Circuit Breaker
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-8">
          {/* Large status indicator */}
          <div
            className={`flex h-28 w-28 items-center justify-center border-2 border-line ${cbBg[circuitBreaker.state]}`}
          >
            <div className="text-center">
              <span
                className={`inline-block h-4 w-4 rounded-full ${cbColor[circuitBreaker.state]}`}
              />
              <p
                className={`mt-2 font-mono text-sm font-bold uppercase ${cbText[circuitBreaker.state]}`}
              >
                {circuitBreaker.state.replace('_', ' ')}
              </p>
            </div>
          </div>

          {/* Metrics */}
          <div className="space-y-2 font-mono text-sm">
            <div className="flex gap-4">
              <span className="w-32 text-xs font-bold uppercase tracking-wider text-muted">
                Failure Count
              </span>
              <span className="font-bold">{circuitBreaker.failureCount}</span>
            </div>
            <div className="flex gap-4">
              <span className="w-32 text-xs font-bold uppercase tracking-wider text-muted">
                Half-Open Tries
              </span>
              <span className="font-bold">{circuitBreaker.halfOpenAttempts}</span>
            </div>
            <div className="flex gap-4">
              <span className="w-32 text-xs font-bold uppercase tracking-wider text-muted">
                Last Failure
              </span>
              <span className="font-bold text-xs">
                {circuitBreaker.lastFailureAt
                  ? new Date(circuitBreaker.lastFailureAt).toLocaleString()
                  : '--'}
              </span>
            </div>
            <div className="flex gap-4">
              <span className="w-32 text-xs font-bold uppercase tracking-wider text-muted">
                Opened At
              </span>
              <span className="font-bold text-xs">
                {circuitBreaker.openedAt
                  ? new Date(circuitBreaker.openedAt).toLocaleString()
                  : '--'}
              </span>
            </div>
          </div>

          {/* Manual override buttons (client component) */}
          <SafetyActions currentState={circuitBreaker.state} />
        </div>
      </section>

      {/* ---- PII Configuration ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
              PII Protection
            </p>
            <p className="mt-1 font-mono text-xs text-muted">
              Automatic detection and redaction of personally identifiable information in AI
              inputs/outputs.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
              Auto-Redaction
            </span>
            <span className="relative inline-flex h-6 w-11 items-center border-2 border-line bg-emerald-500">
              <span className="inline-block h-4 w-4 translate-x-5 bg-white border border-line" />
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {PII_TYPES.map((t) => (
            <div
              key={t.key}
              className="flex items-center justify-between border-2 border-line p-3"
            >
              <span className="font-mono text-xs font-bold">{t.label}</span>
              <span className="relative inline-flex h-5 w-9 items-center border border-line bg-emerald-500">
                <span className="inline-block h-3 w-3 translate-x-4 bg-white border border-line" />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Usage Quotas ---- */}
      <section className="mt-8 border-2 border-line bg-panel p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
          Usage Quotas
        </p>

        <div className="mt-6 space-y-5">
          {/* AI Calls */}
          {(() => {
            const p = pct(usage.totalRequests, QUOTAS.maxCalls);
            return (
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                    AI Calls
                  </span>
                  <span className="font-mono text-xs font-bold">
                    {usage.totalRequests.toLocaleString()} / {QUOTAS.maxCalls.toLocaleString()}
                  </span>
                </div>
                <div className="h-4 w-full border-2 border-line bg-zinc-100">
                  <div
                    className={`h-full ${barColor(p)} transition-all`}
                    style={{ width: `${p}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {/* Tokens */}
          {(() => {
            const p = pct(usage.totalTokens, QUOTAS.maxTokens);
            return (
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                    Tokens
                  </span>
                  <span className="font-mono text-xs font-bold">
                    {usage.totalTokens.toLocaleString()} /{' '}
                    {QUOTAS.maxTokens.toLocaleString()}
                  </span>
                </div>
                <div className="h-4 w-full border-2 border-line bg-zinc-100">
                  <div
                    className={`h-full ${barColor(p)} transition-all`}
                    style={{ width: `${p}%` }}
                  />
                </div>
              </div>
            );
          })()}

          {/* Cost */}
          {(() => {
            const p = pct(usage.totalCostCents, QUOTAS.maxCostCents);
            return (
              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                    Cost
                  </span>
                  <span className="font-mono text-xs font-bold">
                    ${(usage.totalCostCents / 100).toFixed(2)} / $
                    {(QUOTAS.maxCostCents / 100).toFixed(2)}
                  </span>
                </div>
                <div className="h-4 w-full border-2 border-line bg-zinc-100">
                  <div
                    className={`h-full ${barColor(p)} transition-all`}
                    style={{ width: `${p}%` }}
                  />
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* ---- Audit Trail ---- */}
      <section className="mt-8 border-2 border-line bg-panel">
        <div className="p-8 pb-4">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">
            Audit Trail
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">
            Last 20 events
          </p>
        </div>

        {auditEntries.length === 0 ? (
          <div className="px-8 pb-8">
            <p className="font-mono text-sm text-muted">No audit events recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-line bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Action
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    User
                  </th>
                  <th className="px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-zinc-100 transition-colors hover:bg-accent-soft"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block border border-line px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                        {entry.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {entry.userId ?? '--'}
                    </td>
                    <td className="max-w-[300px] truncate px-4 py-3 font-mono text-xs text-muted">
                      {entry.ticketId && (
                        <span className="mr-2">Ticket: {entry.ticketId}</span>
                      )}
                      {Object.keys(entry.details).length > 0
                        ? JSON.stringify(entry.details)
                        : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

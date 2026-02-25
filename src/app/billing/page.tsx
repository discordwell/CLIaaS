"use client";

import { useEffect, useState } from "react";

interface BillingData {
  plan: string;
  planName: string;
  price: number | null;
  quotas: {
    ticketsPerMonth: number;
    aiCallsPerMonth: number;
    apiRequestsPerMonth: number;
  };
  usage: {
    ticketsCreated: number;
    aiCallsMade: number;
    apiRequestsMade: number;
    period: string;
  };
  subscription: {
    id: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
}

const PLAN_CARDS = [
  {
    id: "pro_hosted",
    name: "Pro Hosted",
    price: "$59",
    period: "/mo",
    note: "Early adopter lifetime discount (was $79)",
    features: [
      "Fully hosted, local interoperability",
      "Up to 10,000 tickets/mo",
      "Unlimited queries & AI, never upcharged",
      "Power user GUI available",
      "Priority support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    period: "",
    note: ">10k tickets/mo",
    features: [
      "Unlimited everything",
      "SSO / SAML / SCIM",
      "Dedicated support",
      "Custom SLA guarantees",
      "On-prem deploy integration",
    ],
  },
];

function UsageMeter({
  label,
  current,
  limit,
}: {
  label: string;
  current: number;
  limit: number;
}) {
  const pct = limit === Infinity ? 0 : Math.min((current / limit) * 100, 100);
  const isNearLimit = pct >= 80;
  const displayLimit =
    limit === Infinity ? "unlimited" : limit.toLocaleString();

  return (
    <div>
      <div className="flex items-center justify-between font-mono text-xs uppercase">
        <span className="font-bold">{label}</span>
        <span className={isNearLimit ? "text-red-600 font-bold" : "text-zinc-500"}>
          {current.toLocaleString()} / {displayLimit}
        </span>
      </div>
      <div className="mt-2 h-3 w-full border-2 border-zinc-950 bg-zinc-100">
        <div
          className={`h-full transition-all ${isNearLimit ? "bg-red-500" : "bg-zinc-950"
            }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetch("/api/billing")
      .then((r) => r.json())
      .then(setData)
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  const handleCheckout = async (planId: string) => {
    setActionLoading(true);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planId }),
    });
    const result = await res.json();
    if (result.url) {
      window.location.href = result.url;
    }
    setActionLoading(false);
  };

  const handlePortal = async () => {
    setActionLoading(true);
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const result = await res.json();
    if (result.url) {
      window.location.href = result.url;
    }
    setActionLoading(false);
  };

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8">
          <p className="font-mono text-sm text-zinc-500">Loading billing...</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8">
          <p className="font-mono text-sm text-red-600">
            Failed to load billing data.
          </p>
        </div>
      </main>
    );
  }

  const BYOC_PLANS = ['byoc', 'basic', 'founder', 'free', 'starter'];
  const isByoc = BYOC_PLANS.includes(data.plan);
  const isPaid = data.plan === 'pro' || data.plan === 'pro_hosted' || data.plan === 'enterprise';

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* Header */}
      <header className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-950">
          Billing
        </p>
        <div className="mt-4 flex items-center gap-4">
          <h1 className="text-4xl font-bold">{data.planName} Plan</h1>
          {isByoc && (
            <span className="border-2 border-emerald-500 bg-emerald-50 px-3 py-1 font-mono text-xs font-bold uppercase text-emerald-700">
              Free Forever
            </span>
          )}
        </div>
        <p className="mt-4 text-lg font-medium text-zinc-600">
          {isByoc
            ? "Your BYOC plan is free forever as an early adopter."
            : data.price === null
              ? "Custom enterprise pricing."
              : `$${data.price}/mo — manage your subscription below.`}
        </p>
      </header>

      {/* Usage */}
      <section className="mt-6 border-2 border-zinc-950 bg-white p-8">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em]">
          Current Usage
          {data.usage.period && (
            <span className="ml-3 text-zinc-400">{data.usage.period}</span>
          )}
        </h2>
        <div className="mt-6 space-y-5">
          <UsageMeter
            label="Tickets"
            current={data.usage.ticketsCreated}
            limit={data.quotas.ticketsPerMonth}
          />
          <UsageMeter
            label="AI Calls"
            current={data.usage.aiCallsMade}
            limit={data.quotas.aiCallsPerMonth}
          />
          <UsageMeter
            label="API Requests"
            current={data.usage.apiRequestsMade}
            limit={data.quotas.apiRequestsPerMonth}
          />
        </div>
      </section>

      {/* Subscription Management */}
      {data.subscription && (
        <section className="mt-6 border-2 border-zinc-950 bg-white p-8">
          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em]">
            Subscription
          </h2>
          <div className="mt-4 space-y-2 font-mono text-sm">
            <p>
              <span className="text-zinc-500">Status:</span>{" "}
              <span className="font-bold">{data.subscription.status}</span>
            </p>
            {data.subscription.currentPeriodEnd && (
              <p>
                <span className="text-zinc-500">Renews:</span>{" "}
                {new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}
            {data.subscription.cancelAtPeriodEnd && (
              <p className="text-red-600 font-bold">
                Cancels at end of period
              </p>
            )}
          </div>
          <button
            onClick={handlePortal}
            disabled={actionLoading}
            className="mt-6 border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {actionLoading ? "Loading..." : "Manage Subscription"}
          </button>
        </section>
      )}

      {/* Upgrade Cards */}
      {(isByoc || !isPaid) && (
        <section className="mt-6">
          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-950">
            {isByoc ? "Upgrade Your Plan" : "Available Plans"}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {PLAN_CARDS.map((plan) => {
              const isCurrent = data.plan === plan.id;
              return (
                <div
                  key={plan.id}
                  className={`flex flex-col border-2 bg-white p-6 ${isCurrent
                    ? "border-zinc-950 ring-2 ring-zinc-950"
                    : "border-zinc-300"
                    }`}
                >
                  <h3 className="font-mono text-xs font-bold uppercase tracking-[0.2em]">
                    {plan.name}
                  </h3>
                  <p className="mt-2 text-3xl font-bold">
                    {plan.price}
                    {plan.period && (
                      <span className="text-sm font-normal text-zinc-500">
                        {plan.period}
                      </span>
                    )}
                  </p>
                  {plan.note && (
                    <p className="mt-1 font-mono text-xs text-zinc-500">
                      {plan.note}
                    </p>
                  )}
                  <ul className="mt-4 flex-1 space-y-2">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="font-mono text-xs text-zinc-600"
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <p className="mt-6 font-mono text-xs font-bold uppercase text-zinc-400">
                      Current Plan
                    </p>
                  ) : plan.id === "enterprise" ? (
                    <a
                      href="mailto:hello@cliaas.com"
                      className="mt-6 inline-block border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase transition-colors hover:bg-zinc-950 hover:text-white"
                    >
                      Contact Sales
                    </a>
                  ) : (
                    <button
                      onClick={() => handleCheckout(plan.id)}
                      disabled={actionLoading}
                      className="mt-6 border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {actionLoading ? "Loading..." : "Upgrade"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

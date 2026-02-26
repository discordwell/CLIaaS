"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface PortalUser {
  email: string;
  stats: { open: number; pending: number; solved: number; total: number };
  recentTickets: {
    id: string;
    subject: string;
    status: string;
    updatedAt: string;
  }[];
  orgName?: string;
}

const statColors: Record<string, string> = {
  open: "border-blue-500",
  pending: "border-amber-400",
  solved: "border-emerald-500",
};

import { statusColor } from "@/lib/portal/ui";

export default function PortalLandingPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [portalUser, setPortalUser] = useState<PortalUser | null>(null);

  // Sign-in form state
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [formState, setFormState] = useState<
    "form" | "sending" | "check-email"
  >("form");

  // Check if already authenticated
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/portal/me");
        if (res.ok) {
          const data = await res.json();
          setPortalUser(data);
        }
      } catch {
        // Not authenticated
      } finally {
        setAuthChecked(true);
      }
    }
    checkAuth();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setFormState("sending");
    setError("");

    try {
      const res = await fetch("/api/portal/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Authentication failed");
        setFormState("form");
        return;
      }

      // Dev mode: full navigation to set cookie via the verify endpoint
      if (data.verifyUrl) {
        window.location.href = data.verifyUrl;
        return;
      }

      // Production: show "check your email" message
      setFormState("check-email");
    } catch {
      setError("Network error. Please try again.");
      setFormState("form");
    }
  };

  if (!authChecked) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center sm:p-12">
          <p className="font-mono text-sm text-zinc-500">Loading...</p>
        </div>
      </main>
    );
  }

  // Authenticated: show dashboard
  if (portalUser) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 text-zinc-950">
        <header className="border-2 border-zinc-950 bg-white p-8">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 bg-emerald-500"></div>
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
              Dashboard
            </p>
          </div>
          <h1 className="mt-4 text-3xl font-bold">
            Welcome back
          </h1>
          <p className="mt-2 font-mono text-xs text-zinc-500">
            {portalUser.email}
            {portalUser.orgName && (
              <span> · {portalUser.orgName}</span>
            )}
          </p>
        </header>

        {/* Stats */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {(["open", "pending", "solved"] as const).map((key) => (
            <div
              key={key}
              className={`border-2 border-zinc-950 border-l-4 bg-white p-6 ${statColors[key]}`}
            >
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
                {key}
              </p>
              <p className="mt-2 text-3xl font-bold">
                {portalUser.stats[key]}
              </p>
            </div>
          ))}
        </div>

        {/* Recent tickets */}
        {portalUser.recentTickets.length > 0 && (
          <section className="mt-8 border-2 border-zinc-950 bg-white">
            <div className="border-b-2 border-zinc-950 p-6">
              <h2 className="text-lg font-bold">Recent Tickets</h2>
            </div>
            <div className="divide-y divide-zinc-200">
              {portalUser.recentTickets.map((t) => (
                <Link
                  key={t.id}
                  href={`/portal/tickets/${t.id}`}
                  className="flex items-center justify-between p-5 transition-colors hover:bg-zinc-50"
                >
                  <p className="truncate text-sm font-bold">{t.subject}</p>
                  <span
                    className={`ml-4 shrink-0 px-2 py-0.5 font-mono text-xs font-bold uppercase ${
                      statusColor[t.status] ?? "bg-zinc-200 text-black"
                    }`}
                  >
                    {t.status}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Quick links */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/portal/tickets/new"
            className="border-2 border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-950"
          >
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Submit a Request
            </p>
            <p className="mt-2 text-sm font-bold">New Ticket</p>
          </Link>
          <Link
            href="/portal/kb"
            className="border-2 border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-950"
          >
            <p className="font-mono text-xs font-bold uppercase text-zinc-500">
              Self-Service
            </p>
            <p className="mt-2 text-sm font-bold">Knowledge Base</p>
          </Link>
        </div>
      </main>
    );
  }

  // Not authenticated: sign-in form
  if (formState === "check-email") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8 text-center sm:p-12">
          <div className="flex items-center justify-center gap-3">
            <div className="h-3 w-3 bg-emerald-500"></div>
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
              Check Your Email
            </p>
          </div>
          <h1 className="mt-6 text-2xl font-bold">
            Magic link sent
          </h1>
          <p className="mt-3 text-sm text-zinc-600">
            We sent a sign-in link to <strong>{email}</strong>.
            Click the link in your email to access the portal.
          </p>
          <button
            onClick={() => setFormState("form")}
            className="mt-6 font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950"
          >
            Try a different email
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-950">
      <div className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 bg-emerald-500"></div>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-500">
            Support Portal
          </p>
        </div>

        <h1 className="mt-6 text-3xl font-bold">
          How can we help?
        </h1>
        <p className="mt-3 text-sm font-medium leading-relaxed text-zinc-600">
          Sign in with your email to view your tickets, submit a new request,
          or browse our knowledge base.
        </p>

        <form onSubmit={onSubmit} className="mt-8">
          <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="mt-2 w-full border-2 border-zinc-950 px-4 py-3 text-sm focus:outline-none"
            required
          />

          {error && (
            <p className="mt-3 font-mono text-xs font-bold text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={formState === "sending"}
            className="mt-4 w-full border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {formState === "sending" ? "Signing in..." : "View My Tickets"}
          </button>
        </form>

        <div className="mt-8 border-t border-zinc-200 pt-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              href="/portal/tickets/new"
              className="border-2 border-zinc-200 p-4 transition-colors hover:border-zinc-950"
            >
              <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                Submit a Request
              </p>
              <p className="mt-2 text-sm font-bold">New Ticket</p>
              <p className="mt-1 text-xs text-zinc-500">
                Describe your issue and we will get back to you.
              </p>
            </Link>
            <Link
              href="/portal/kb"
              className="border-2 border-zinc-200 p-4 transition-colors hover:border-zinc-950"
            >
              <p className="font-mono text-xs font-bold uppercase text-zinc-500">
                Self-Service
              </p>
              <p className="mt-2 text-sm font-bold">Knowledge Base</p>
              <p className="mt-1 text-xs text-zinc-500">
                Search articles and find answers to common questions.
              </p>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

"use client";

// Revalidate cached data every 60 seconds
export const revalidate = 60;

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function PortalLandingPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
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
        return;
      }

      router.push("/portal/tickets");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
            disabled={loading}
            className="mt-4 w-full border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "View My Tickets"}
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function PortalNewTicketPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !email.includes("@")) {
      setError("A valid email address is required.");
      return;
    }
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }

    setLoading(true);

    try {
      // First, authenticate with email
      const authRes = await fetch("/api/portal/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!authRes.ok) {
        const authData = await authRes.json();
        setError(authData.error ?? "Authentication failed");
        return;
      }

      // Then create the ticket
      const res = await fetch("/api/portal/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          description: description.trim(),
          priority,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to create ticket");
      }

      router.push(`/portal/tickets/${data.ticket.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-zinc-950">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/portal" className="hover:underline">
          Portal
        </Link>
        <span>/</span>
        <Link href="/portal/tickets" className="hover:underline">
          Tickets
        </Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">New</span>
      </nav>

      <div className="border-2 border-zinc-950 bg-white p-8">
        <h1 className="text-2xl font-bold">Submit a Request</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Describe your issue below and our team will get back to you as soon as
          possible.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-6">
          {/* Email */}
          <div>
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
          </div>

          {/* Subject */}
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your issue"
              className="mt-2 w-full border-2 border-zinc-950 px-4 py-3 text-sm focus:outline-none"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Please describe your issue in detail. Include any relevant steps, error messages, or screenshots."
              rows={6}
              className="mt-2 w-full border-2 border-zinc-950 px-4 py-3 text-sm focus:outline-none"
              required
            />
          </div>

          {/* Priority */}
          <div>
            <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
              Priority (optional)
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="mt-2 border-2 border-zinc-950 bg-white px-4 py-3 font-mono text-sm font-bold"
            >
              <option value="low">LOW</option>
              <option value="normal">NORMAL</option>
              <option value="high">HIGH</option>
              <option value="urgent">URGENT</option>
            </select>
          </div>

          {error && (
            <p className="font-mono text-xs font-bold text-red-600">{error}</p>
          )}

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={loading}
              className="border-2 border-zinc-950 bg-zinc-950 px-8 py-3 font-mono text-sm font-bold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? "Submitting..." : "Submit Ticket"}
            </button>
            <Link
              href="/portal"
              className="font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}

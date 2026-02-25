"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSeed() {
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/onboarding/seed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load sample data");
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSkip() {
    router.push("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-10">
      <section className="w-full border-2 border-zinc-950 bg-white p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Get Started
        </p>
        <h1 className="mt-3 text-3xl font-bold">Load sample data?</h1>
        <p className="mt-3 text-sm text-zinc-600">
          We can populate your workspace with sample tickets, customers, and
          knowledge base articles so you can explore CLIaaS right away.
        </p>

        {error && (
          <div className="mt-4 border-2 border-red-500 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSeed}
            disabled={loading}
            className="flex-1 border-2 border-zinc-950 bg-zinc-950 px-4 py-3 font-mono text-xs font-bold uppercase text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Loading data..." : "Yes, load sample data"}
          </button>
          <button
            onClick={handleSkip}
            disabled={loading}
            className="flex-1 border-2 border-zinc-300 px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-600 transition hover:border-zinc-950 disabled:opacity-50"
          >
            Skip
          </button>
        </div>
      </section>
    </main>
  );
}

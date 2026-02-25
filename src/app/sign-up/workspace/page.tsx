"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";

function WorkspaceForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Missing signup token. Please start the signup process again.");
    }
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/google/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, workspaceName }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Signup failed");
        return;
      }

      // If user joined an existing org, go straight to dashboard
      if (data.joined) {
        router.push("/dashboard");
      } else {
        router.push("/onboarding");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-10">
      <section className="w-full border-2 border-zinc-950 bg-white p-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Almost Done
        </p>
        <h1 className="mt-3 text-3xl font-bold">Name your workspace</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Your Google account is verified. Just pick a workspace name to get started.
        </p>

        {error && (
          <div className="mt-4 border-2 border-red-500 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block font-mono text-xs font-bold uppercase">
              Workspace name
            </span>
            <input
              type="text"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              required
              className="w-full border-2 border-zinc-300 px-4 py-3 font-mono text-sm outline-none transition focus:border-zinc-950"
              placeholder="acme-team"
            />
          </label>
          <button
            type="submit"
            disabled={loading || !token}
            className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-3 font-mono text-xs font-bold uppercase text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Creating workspace..." : "Create workspace"}
          </button>
        </form>
        <p className="mt-4 text-sm text-zinc-500">
          Changed your mind?{" "}
          <Link href="/sign-up" className="font-bold text-zinc-950 underline">
            Sign up with email instead
          </Link>
        </p>
      </section>
    </main>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense>
      <WorkspaceForm />
    </Suspense>
  );
}

"use client";

// Revalidate cached data every 60 seconds
export const revalidate = 60;

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [workspaceName, setWorkspaceName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(searchParams.get("error") || "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, workspaceName }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Signup failed");
        return;
      }

      router.push("/dashboard");
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
          Sign Up
        </p>
        <h1 className="mt-3 text-3xl font-bold">Create your CLIaaS workspace</h1>

        {error && (
          <div className="mt-4 border-2 border-red-500 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">
            {error}
          </div>
        )}

        <GoogleAuthButton />

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
          <label className="block">
            <span className="mb-2 block font-mono text-xs font-bold uppercase">
              Your name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full border-2 border-zinc-300 px-4 py-3 font-mono text-sm outline-none transition focus:border-zinc-950"
              placeholder="Jane Smith"
            />
          </label>
          <label className="block">
            <span className="mb-2 block font-mono text-xs font-bold uppercase">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border-2 border-zinc-300 px-4 py-3 font-mono text-sm outline-none transition focus:border-zinc-950"
              placeholder="you@company.com"
            />
          </label>
          <label className="block">
            <span className="mb-2 block font-mono text-xs font-bold uppercase">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full border-2 border-zinc-300 px-4 py-3 font-mono text-sm outline-none transition focus:border-zinc-950"
              placeholder="Minimum 8 characters"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-3 font-mono text-xs font-bold uppercase text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Creating workspace..." : "Create workspace"}
          </button>
        </form>
        <p className="mt-4 text-sm text-zinc-500">
          Already registered?{" "}
          <Link href="/sign-in" className="font-bold text-zinc-950 underline">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}

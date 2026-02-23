"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign-in failed");
        return;
      }

      router.push(next);
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
          Sign In
        </p>
        <h1 className="mt-3 text-3xl font-bold">Welcome back</h1>

        {error && (
          <div className="mt-4 border-2 border-red-500 bg-red-50 px-4 py-3 font-mono text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              className="w-full border-2 border-zinc-300 px-4 py-3 font-mono text-sm outline-none transition focus:border-zinc-950"
              placeholder="********"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full border-2 border-zinc-950 bg-zinc-950 px-4 py-3 font-mono text-xs font-bold uppercase text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <p className="mt-4 text-sm text-zinc-500">
          Need an account?{" "}
          <Link href="/sign-up" className="font-bold text-zinc-950 underline">
            Create one
          </Link>
        </p>

        {/* SSO Section */}
        <SsoSection />
      </section>
    </main>
  );
}

function SsoSection() {
  const [providers, setProviders] = useState<
    Array<{ id: string; name: string; protocol: string; enabled: boolean }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/sso/providers")
      .then((res) => res.json())
      .then((data) => setProviders((data.providers || []).filter((p: { enabled: boolean }) => p.enabled)))
      .catch(() => setProviders([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading || providers.length === 0) return null;

  return (
    <div className="mt-6 border-t-2 border-zinc-200 pt-6">
      <p className="mb-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
        Or sign in with SSO
      </p>
      <div className="space-y-2">
        {providers.map((p) => (
          <a
            key={p.id}
            href={`/api/auth/sso/${p.protocol}/login?provider_id=${p.id}`}
            className="block w-full border-2 border-zinc-300 px-4 py-3 text-center font-mono text-xs font-bold uppercase transition hover:border-zinc-950 hover:bg-zinc-50"
          >
            {p.name}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

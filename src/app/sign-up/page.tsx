"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo, Suspense } from "react";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import { PERSONAL_EMAIL_DOMAINS } from "@/lib/auth/personal-domains";

function isPersonalEmailClient(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return true; // no domain yet, assume personal
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain.includes(".")) return true; // incomplete domain
  return PERSONAL_EMAIL_DOMAINS.has(domain);
}

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [workspaceName, setWorkspaceName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(searchParams.get("error") || "");
  const [loading, setLoading] = useState(false);

  const showWorkspace = useMemo(() => isPersonalEmailClient(email), [email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name,
          workspaceName: showWorkspace ? workspaceName : undefined,
        }),
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
          {showWorkspace ? (
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
          ) : (
            <p className="font-mono text-xs text-zinc-500">
              Your workspace will be created from your company domain.
            </p>
          )}
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

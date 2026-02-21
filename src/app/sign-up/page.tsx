import Link from "next/link";

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-10">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          Sign Up
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Create your CLIaaS workspace</h1>
        <form className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Workspace name</span>
            <input
              type="text"
              className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none ring-accent/40 transition focus:ring"
              placeholder="acme-team"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Email</span>
            <input
              type="email"
              className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none ring-accent/40 transition focus:ring"
              placeholder="you@company.com"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">Password</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none ring-accent/40 transition focus:ring"
              placeholder="********"
            />
          </label>
          <button
            type="button"
            className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-white transition hover:brightness-95"
          >
            Create workspace
          </button>
        </form>
        <p className="mt-4 text-sm text-muted">
          Already registered?{" "}
          <Link href="/sign-in" className="text-accent underline">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}

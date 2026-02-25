"use client";

import Link from "next/link";

export default function PublicNav() {
  return (
    <nav className="sticky top-0 z-50 border-b-2 border-line bg-panel/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3 sm:px-10">
        <Link
          href="/"
          className="font-mono text-sm font-bold uppercase tracking-widest text-foreground"
        >
          CLIaaS
        </Link>
        <div className="flex items-center gap-4">
          <a
            href="/#pricing"
            className="hidden font-mono text-xs font-bold uppercase text-muted transition-colors hover:text-foreground sm:block"
          >
            Pricing
          </a>
          <Link
            href="/docs"
            className="hidden font-mono text-xs font-bold uppercase text-muted transition-colors hover:text-foreground sm:block"
          >
            Docs
          </Link>
          <Link
            href="/sign-in"
            className="font-mono text-xs font-bold uppercase text-muted transition-colors hover:text-foreground"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="border-2 border-foreground bg-foreground px-4 py-2 font-mono text-xs font-bold uppercase text-background transition-opacity hover:opacity-80"
          >
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}

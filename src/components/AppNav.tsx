"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/rules", label: "Rules" },
  { href: "/workflows", label: "Workflows" },
  { href: "/chat", label: "Chat" },
  { href: "/chatbots", label: "Bots" },
  { href: "/channels", label: "Channels" },
  { href: "/ai", label: "AI" },
  { href: "/analytics", label: "Analytics" },
  { href: "/sla", label: "SLA" },
  { href: "/integrations", label: "Integrations" },
  { href: "/security", label: "Security" },
  { href: "/enterprise", label: "Enterprise" },
  { href: "/billing", label: "Billing" },
  { href: "/docs", label: "Docs" },
];

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Network error — redirect anyway to clear client state
    }
    router.push("/");
  }

  return (
    <nav className="border-2 border-zinc-950 bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-2">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-950"
          >
            CLIaaS
          </Link>
          <div className="flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive =
                pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-2 py-1 font-mono text-xs font-bold uppercase transition-colors ${
                    isActive
                      ? "bg-zinc-950 text-white"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="px-2 py-1 font-mono text-xs font-bold uppercase text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950"
        >
          Sign Out
        </button>
      </div>
    </nav>
  );
}

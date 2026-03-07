"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import NotificationBell from "./NotificationBell";
import { usePermissions } from "./rbac/PermissionProvider";

interface NavLink {
  href: string;
  label: string;
  permission?: string;
}

const navLinks: NavLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tickets", label: "Tickets", permission: "tickets:view" },
  { href: "/chat", label: "Chat" },
  { href: "/ai", label: "AI" },
];

function openCommandPalette() {
  window.dispatchEvent(new Event("open-command-palette"));
}

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { rbacActive, hasPermission } = usePermissions();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);

  async function handleSignOut() {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Network error — redirect anyway to clear client state
    }
    router.push("/");
  }

  const visibleLinks =
    rbacActive
      ? navLinks.filter(
          (link) => !link.permission || hasPermission(link.permission),
        )
      : navLinks;

  return (
    <nav className="border-b-2 border-zinc-950 bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-2">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-950"
          >
            CLIaaS
          </Link>
          <div className="flex items-center gap-1">
            {visibleLinks.map((link) => {
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
        <div className="flex items-center gap-3">
          <button
            onClick={openCommandPalette}
            className="flex items-center gap-2 rounded border border-zinc-300 bg-zinc-50 px-2.5 py-1 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            aria-label="Open command palette"
          >
            <span className="text-zinc-500">{isMac ? "⌘" : "Ctrl+"}K</span>
          </button>
          <NotificationBell />
          <button
            onClick={handleSignOut}
            className="px-2 py-1 font-mono text-xs font-bold uppercase text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950"
          >
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  );
}

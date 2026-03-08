"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { usePermissions } from "./rbac/PermissionProvider";
import {
  LayoutDashboard,
  Ticket,
  MessageCircle,
  Brain,
  Zap,
  GitBranch,
  BarChart3,
  FileText,
  Clock,
  BookOpen,
  Megaphone,
  Bot,
  Settings,
  Users,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Command,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import NotificationBell from "./NotificationBell";

/* ── Types ─────────────────────────────────────────────────────── */

interface SidebarLink {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
}

interface SidebarGroup {
  label: string;
  links: SidebarLink[];
}

/* ── Navigation structure ──────────────────────────────────────── */

const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    label: "Primary",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/tickets", label: "Tickets", icon: Ticket, permission: "tickets:view" },
      { href: "/chat", label: "Chat", icon: MessageCircle },
    ],
  },
  {
    label: "AI & Automation",
    links: [
      { href: "/ai", label: "AI Command Center", icon: Brain },
      { href: "/rules", label: "Rules", icon: Zap, permission: "automation:view" },
      { href: "/workflows", label: "Workflows", icon: GitBranch, permission: "automation:view" },
    ],
  },
  {
    label: "Insights",
    links: [
      { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "analytics:view" },
      { href: "/reports", label: "Reports", icon: FileText },
      { href: "/sla", label: "SLA Policies", icon: Clock },
    ],
  },
  {
    label: "Engage",
    links: [
      { href: "/kb", label: "Knowledge Base", icon: BookOpen },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/chatbots", label: "Chatbots", icon: Bot },
    ],
  },
  {
    label: "Configure",
    links: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/billing", label: "Billing", icon: CreditCard, permission: "admin:billing" },
    ],
  },
];

const STORAGE_KEY = "cliaas-sidebar-collapsed";

function openCommandPalette() {
  window.dispatchEvent(new Event("open-command-palette"));
}

/* ── Component ────────────────────────────────────────────────── */

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { rbacActive, hasPermission } = usePermissions();
  const [collapsed, setCollapsed] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hydrate collapse state from localStorage
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setCollapsed(true);
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Network error — redirect anyway to clear client state
    }
    router.push("/");
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function filterLinks(links: SidebarLink[]) {
    if (!rbacActive) return links;
    return links.filter((link) => !link.permission || hasPermission(link.permission));
  }

  const sidebarWidth = collapsed ? "w-[52px]" : "w-[220px]";

  /* ── Sidebar content (shared between desktop and mobile) ───── */

  function renderContent(mobile?: boolean) {
    return (
      <div className="flex h-full flex-col">
        {/* Logo area */}
        <div
          className={`flex h-14 items-center border-b border-zinc-800 px-3 ${
            collapsed && !mobile ? "justify-center" : "justify-between"
          }`}
        >
          {(!collapsed || mobile) && (
            <Link
              href="/"
              className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-100"
            >
              CLIaaS
            </Link>
          )}
          {mobile && (
            <button
              onClick={() => setMobileOpen(false)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          )}
          {collapsed && !mobile && (
            <Link
              href="/"
              className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-100"
            >
              C
            </Link>
          )}
        </div>

        {/* Navigation groups */}
        <nav className="flex-1 overflow-y-auto py-2" aria-label="Main navigation">
          {SIDEBAR_GROUPS.map((group) => {
            const visibleLinks = filterLinks(group.links);
            if (visibleLinks.length === 0) return null;

            return (
              <div key={group.label} className="mb-1">
                {/* Group label */}
                {(!collapsed || mobile) && (
                  <div className="px-3 pb-1 pt-3 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                    {group.label}
                  </div>
                )}
                {collapsed && !mobile && <div className="mt-2" />}

                {/* Links */}
                {visibleLinks.map((link) => {
                  const active = isActive(link.href);
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      title={collapsed && !mobile ? link.label : undefined}
                      className={`group relative mx-1.5 mb-0.5 flex items-center gap-2.5 rounded px-2 py-1.5 font-mono text-xs transition-colors ${
                        active
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                      } ${collapsed && !mobile ? "justify-center" : ""}`}
                    >
                      {/* Active indicator */}
                      {active && (
                        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-white" />
                      )}
                      <Icon size={16} className="flex-shrink-0" />
                      {(!collapsed || mobile) && (
                        <span className="truncate">{link.label}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-zinc-800 py-2">
          {/* Notifications */}
          <div
            className={`mx-1.5 mb-0.5 flex items-center rounded px-2 py-1.5 ${
              collapsed && !mobile ? "justify-center" : ""
            }`}
          >
            <NotificationBell variant="sidebar" collapsed={collapsed && !mobile} />
          </div>

          {/* Command palette shortcut */}
          <button
            onClick={openCommandPalette}
            className={`mx-1.5 mb-0.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded px-2 py-1.5 font-mono text-xs text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-white ${
              collapsed && !mobile ? "justify-center" : ""
            }`}
            title={collapsed && !mobile ? "Command Palette" : undefined}
          >
            <Command size={16} className="flex-shrink-0" />
            {(!collapsed || mobile) && (
              <span className="flex items-center gap-1.5">
                <span>Search</span>
                <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono text-[10px] text-zinc-500">
                  {isMac ? "\u2318" : "Ctrl+"}K
                </kbd>
              </span>
            )}
          </button>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className={`mx-1.5 mb-0.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded px-2 py-1.5 font-mono text-xs text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-red-400 ${
              collapsed && !mobile ? "justify-center" : ""
            }`}
            title={collapsed && !mobile ? "Sign Out" : undefined}
          >
            <LogOut size={16} className="flex-shrink-0" />
            {(!collapsed || mobile) && <span>Sign Out</span>}
          </button>

          {/* Collapse toggle (desktop only) */}
          {!mobile && (
            <button
              onClick={toggleCollapse}
              className="mx-1.5 mt-1 flex w-[calc(100%-12px)] items-center justify-center gap-2 rounded px-2 py-1.5 font-mono text-xs text-zinc-600 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronRight size={16} />
              ) : (
                <>
                  <ChevronLeft size={16} />
                  <span>Collapse</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile hamburger (visible only on small screens) */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-[90] rounded bg-zinc-950 p-2 text-zinc-300 shadow-lg hover:text-white md:hidden"
        aria-label="Open navigation menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-[98] bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-[99] w-[220px] transform bg-zinc-950 transition-transform duration-200 md:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {renderContent(true)}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden h-screen flex-shrink-0 bg-zinc-950 transition-[width] duration-200 ease-in-out md:block ${sidebarWidth}`}
      >
        {renderContent(false)}
      </aside>
    </>
  );
}

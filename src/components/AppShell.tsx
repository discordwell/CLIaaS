"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import PublicNav from "./PublicNav";
import CommandPalette from "./CommandPalette";
import KeyboardShortcuts from "./KeyboardShortcuts";
import TicketDrawerProvider from "./TicketDrawerProvider";
import { DensityProvider } from "./DensityProvider";

/** Routes that render NO nav at all (they have their own or need none). */
const NO_NAV_PREFIXES = ["/portal", "/sign-in", "/sign-up", "/chat/embed", "/demo-recording"];
const NO_NAV_EXACT = ["/"];

/** Public pages — show PublicNav when logged out, sidebar when logged in. */
const PUBLIC_NAV_PREFIXES = ["/docs"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(
      document.cookie.split(";").some((c) => {
        const trimmed = c.trim();
        return trimmed.startsWith("cliaas-logged-in=") && trimmed !== "cliaas-logged-in=" && trimmed !== "cliaas-logged-in=0" && trimmed !== "cliaas-logged-in=false";
      })
    );
  }, [pathname]);

  // No-nav routes: render children only, no shell
  if (NO_NAV_EXACT.includes(pathname)) {
    return <>{children}</>;
  }
  if (NO_NAV_PREFIXES.some((p) => pathname.startsWith(p))) {
    return <>{children}</>;
  }

  // Public pages when logged out: PublicNav (topbar) above content
  if (PUBLIC_NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!loggedIn) {
      return (
        <>
          <PublicNav />
          {children}
        </>
      );
    }
  }

  // Authenticated layout: sidebar + content in a flex row
  return (
    <DensityProvider>
      <TicketDrawerProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <CommandPalette />
          <KeyboardShortcuts />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </TicketDrawerProvider>
    </DensityProvider>
  );
}

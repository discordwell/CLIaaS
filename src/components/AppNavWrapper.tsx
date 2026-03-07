"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import AppNav from "./AppNav";
import PublicNav from "./PublicNav";
import CommandPalette from "./CommandPalette";

/** Routes that render NO nav at all (they have their own or need none). */
const NO_NAV_PREFIXES = ["/portal", "/sign-in", "/sign-up", "/chat/embed", "/demo-recording"];
const NO_NAV_EXACT = ["/"];

/** Public pages — show PublicNav when logged out, AppNav when logged in. */
const PUBLIC_NAV_PREFIXES = ["/docs"];

export default function AppNavWrapper() {
  const pathname = usePathname();
  // Defer cookie check to useEffect to avoid hydration mismatch (#418)
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(
      document.cookie.split(";").some((c) => c.trim().startsWith("cliaas-logged-in="))
    );
  }, [pathname]);

  if (NO_NAV_EXACT.includes(pathname)) return null;
  if (NO_NAV_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  if (PUBLIC_NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return loggedIn ? (
      <>
        <AppNav />
        <CommandPalette />
      </>
    ) : (
      <PublicNav />
    );
  }

  return (
    <>
      <AppNav />
      <CommandPalette />
    </>
  );
}

"use client";

import { usePathname } from "next/navigation";
import AppNav from "./AppNav";
import PublicNav from "./PublicNav";

/** Routes that render NO nav at all (they have their own or need none). */
const NO_NAV_PREFIXES = ["/portal", "/sign-in", "/sign-up", "/chat/embed"];
const NO_NAV_EXACT = ["/"];

/** Public pages — show PublicNav when logged out, AppNav when logged in. */
const PUBLIC_NAV_PREFIXES = ["/docs"];

function hasSession(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith("cliaas-logged-in="));
}

export default function AppNavWrapper() {
  const pathname = usePathname();

  if (NO_NAV_EXACT.includes(pathname)) return null;
  if (NO_NAV_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  if (PUBLIC_NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return hasSession() ? <AppNav /> : <PublicNav />;
  }

  return <AppNav />;
}

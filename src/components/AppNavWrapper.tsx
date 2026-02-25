"use client";

import { usePathname } from "next/navigation";
import AppNav from "./AppNav";
import PublicNav from "./PublicNav";

/** Routes that render NO nav at all (they have their own or need none). */
const NO_NAV_PREFIXES = ["/portal", "/sign-in", "/sign-up", "/chat/embed"];
const NO_NAV_EXACT = ["/"];

/** Public pages that get the lightweight marketing nav instead of the full app nav. */
const PUBLIC_NAV_PREFIXES = ["/docs"];

export default function AppNavWrapper() {
  const pathname = usePathname();

  if (NO_NAV_EXACT.includes(pathname)) return null;
  if (NO_NAV_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  if (PUBLIC_NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return <PublicNav />;
  }

  return <AppNav />;
}

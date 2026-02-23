"use client";

import { usePathname } from "next/navigation";
import AppNav from "./AppNav";

const EXCLUDED_PREFIXES = ["/portal", "/sign-in", "/sign-up", "/chat/embed"];
const EXCLUDED_EXACT = ["/"];

export default function AppNavWrapper() {
  const pathname = usePathname();

  if (EXCLUDED_EXACT.includes(pathname)) return null;
  if (EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  return <AppNav />;
}

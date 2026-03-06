"use client";

import BrandThemeProvider, { useBrandTheme } from "@/components/BrandThemeProvider";
import type { ReactNode } from "react";

function KBBrandedHeader() {
  const { theme, loading } = useBrandTheme();

  if (loading) return null;

  return (
    <>
      {/* Brand header injection */}
      {theme.headerHtml && (
        <div
          className="border-b border-zinc-200"
          dangerouslySetInnerHTML={{
            __html: theme.headerHtml
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<\/?style[^>]*>/gi, ""),
          }}
        />
      )}
      {/* Brand bar with logo + title */}
      {(theme.logoUrl || theme.helpCenterTitle !== "Help Center") && (
        <div
          className="flex items-center gap-3 px-6 py-3"
          style={{ backgroundColor: theme.primaryColor, color: "#fff" }}
        >
          {theme.logoUrl && (
            <img
              src={theme.logoUrl}
              alt={theme.name || "Logo"}
              className="h-6 w-auto"
            />
          )}
          <span className="font-mono text-xs font-bold uppercase tracking-wider">
            {theme.helpCenterTitle}
          </span>
        </div>
      )}
    </>
  );
}

function KBBrandedFooter() {
  const { theme, loading } = useBrandTheme();

  if (loading || !theme.footerHtml) return null;

  return (
    <div
      className="mt-8 border-t border-zinc-200"
      dangerouslySetInnerHTML={{
        __html: theme.footerHtml
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<\/?style[^>]*>/gi, ""),
      }}
    />
  );
}

export default function PortalKBLayout({ children }: { children: ReactNode }) {
  // Use the default brand (brand-main); in a multi-brand setup,
  // this would read from a subdomain or query param
  return (
    <BrandThemeProvider brandId="brand-main">
      <KBBrandedHeader />
      {children}
      <KBBrandedFooter />
    </BrandThemeProvider>
  );
}

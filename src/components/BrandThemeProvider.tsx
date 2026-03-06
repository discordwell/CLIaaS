"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from "react";

export interface BrandTheme {
  id: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  faviconUrl: string;
  customCss: string;
  headerHtml: string;
  footerHtml: string;
  helpCenterTitle: string;
  defaultLocale: string;
  supportedLocales: string[];
}

const DEFAULT_THEME: BrandTheme = {
  id: "",
  name: "",
  primaryColor: "#09090b",
  accentColor: "#3b82f6",
  logoUrl: "",
  faviconUrl: "",
  customCss: "",
  headerHtml: "",
  footerHtml: "",
  helpCenterTitle: "Help Center",
  defaultLocale: "en",
  supportedLocales: ["en"],
};

interface BrandThemeContextValue {
  theme: BrandTheme;
  loading: boolean;
}

const BrandThemeContext = createContext<BrandThemeContextValue>({
  theme: DEFAULT_THEME,
  loading: false,
});

export function useBrandTheme() {
  return useContext(BrandThemeContext);
}

interface BrandThemeProviderProps {
  children: ReactNode;
  brandId?: string;
  initialTheme?: Partial<BrandTheme>;
}

export default function BrandThemeProvider({
  children,
  brandId,
  initialTheme,
}: BrandThemeProviderProps) {
  const [theme, setTheme] = useState<BrandTheme>({
    ...DEFAULT_THEME,
    ...initialTheme,
  });
  const [loading, setLoading] = useState(!!brandId && !initialTheme);

  // Fetch brand config from API when brandId is provided
  useEffect(() => {
    if (!brandId) return;
    if (initialTheme) return; // skip fetch when initial theme is provided via props

    setLoading(true);
    fetch(`/api/brands/${brandId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.brand) return;
        const b = data.brand;
        setTheme({
          id: b.id ?? "",
          name: b.name ?? "",
          primaryColor: b.primaryColor ?? b.primary_color ?? DEFAULT_THEME.primaryColor,
          accentColor: b.accentColor ?? b.accent_color ?? DEFAULT_THEME.accentColor,
          logoUrl: b.logoUrl ?? b.logo_url ?? b.logo ?? "",
          faviconUrl: b.faviconUrl ?? b.favicon_url ?? "",
          customCss: b.customCss ?? b.custom_css ?? "",
          headerHtml: b.headerHtml ?? b.header_html ?? "",
          footerHtml: b.footerHtml ?? b.footer_html ?? "",
          helpCenterTitle: b.helpCenterTitle ?? b.help_center_title ?? b.portalTitle ?? "Help Center",
          defaultLocale: b.defaultLocale ?? b.default_locale ?? "en",
          supportedLocales: b.supportedLocales ?? b.supported_locales ?? ["en"],
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId, initialTheme]);

  // Build CSS variables style
  const cssVars = useMemo(
    () =>
      ({
        "--brand-primary": theme.primaryColor,
        "--brand-accent": theme.accentColor,
      }) as React.CSSProperties,
    [theme.primaryColor, theme.accentColor],
  );

  const value = useMemo(() => ({ theme, loading }), [theme, loading]);

  return (
    <BrandThemeContext.Provider value={value}>
      <div style={cssVars}>
        {/* Inject custom CSS if present (sanitize to prevent XSS via </style> injection) */}
        {theme.customCss && (
          <style dangerouslySetInnerHTML={{ __html: theme.customCss.replace(/<\/?style[^>]*>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') }} />
        )}
        {children}
      </div>
    </BrandThemeContext.Provider>
  );
}

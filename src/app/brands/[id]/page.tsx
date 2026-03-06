"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import LocalePicker, { LOCALE_NAMES } from "@/components/LocalePicker";

interface BrandData {
  id: string;
  name: string;
  subdomain: string | null;
  logoUrl?: string;
  logo_url?: string;
  faviconUrl?: string;
  favicon_url?: string;
  primaryColor?: string;
  primary_color?: string;
  accentColor?: string;
  accent_color?: string;
  headerHtml?: string;
  header_html?: string;
  footerHtml?: string;
  footer_html?: string;
  customCss?: string;
  custom_css?: string;
  helpCenterEnabled?: boolean;
  help_center_enabled?: boolean;
  helpCenterTitle?: string;
  help_center_title?: string;
  defaultLocale?: string;
  default_locale?: string;
  supportedLocales?: string[];
  supported_locales?: string[];
}

function normalize(b: BrandData) {
  return {
    logoUrl: b.logoUrl ?? b.logo_url ?? "",
    faviconUrl: b.faviconUrl ?? b.favicon_url ?? "",
    primaryColor: b.primaryColor ?? b.primary_color ?? "#09090b",
    accentColor: b.accentColor ?? b.accent_color ?? "#3b82f6",
    headerHtml: b.headerHtml ?? b.header_html ?? "",
    footerHtml: b.footerHtml ?? b.footer_html ?? "",
    customCss: b.customCss ?? b.custom_css ?? "",
    helpCenterEnabled: b.helpCenterEnabled ?? b.help_center_enabled ?? false,
    helpCenterTitle: b.helpCenterTitle ?? b.help_center_title ?? "",
    defaultLocale: b.defaultLocale ?? b.default_locale ?? "en",
    supportedLocales: b.supportedLocales ?? b.supported_locales ?? ["en"],
  };
}

const AVAILABLE_LOCALES = Object.keys(LOCALE_NAMES);

export default function BrandEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [brand, setBrand] = useState<BrandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Form fields
  const [logoUrl, setLogoUrl] = useState("");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#09090b");
  const [accentColor, setAccentColor] = useState("#3b82f6");
  const [headerHtml, setHeaderHtml] = useState("");
  const [footerHtml, setFooterHtml] = useState("");
  const [customCss, setCustomCss] = useState("");
  const [helpCenterEnabled, setHelpCenterEnabled] = useState(false);
  const [helpCenterTitle, setHelpCenterTitle] = useState("");
  const [defaultLocale, setDefaultLocale] = useState("en");
  const [supportedLocales, setSupportedLocales] = useState<string[]>(["en"]);

  useEffect(() => {
    fetch(`/api/brands/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.brand) return;
        const b = d.brand as BrandData;
        setBrand(b);

        const n = normalize(b);
        setLogoUrl(n.logoUrl);
        setFaviconUrl(n.faviconUrl);
        setPrimaryColor(n.primaryColor);
        setAccentColor(n.accentColor);
        setHeaderHtml(n.headerHtml);
        setFooterHtml(n.footerHtml);
        setCustomCss(n.customCss);
        setHelpCenterEnabled(n.helpCenterEnabled);
        setHelpCenterTitle(n.helpCenterTitle);
        setDefaultLocale(n.defaultLocale);
        setSupportedLocales(n.supportedLocales);
      })
      .catch(() => setError("Failed to load brand"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch(`/api/brands/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoUrl,
          faviconUrl,
          primaryColor,
          accentColor,
          headerHtml,
          footerHtml,
          customCss,
          helpCenterEnabled,
          helpCenterTitle,
          defaultLocale,
          supportedLocales,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");

      setMessage("Brand theme saved successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
    setSaving(false);
  };

  const toggleLocale = (code: string) => {
    setSupportedLocales((prev) => {
      if (prev.includes(code)) {
        // Don't remove last locale or default locale
        if (prev.length === 1 || code === defaultLocale) return prev;
        return prev.filter((l) => l !== code);
      }
      return [...prev, code];
    });
  };

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-12 text-center font-mono text-xs text-zinc-500">
          Loading...
        </div>
      </main>
    );
  }

  if (!brand) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-12 text-center">
          <h1 className="text-2xl font-bold">Brand Not Found</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/brands" className="hover:underline">
          Brands
        </Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">{brand.name}</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <h1 className="text-2xl font-bold">Theme Editor &mdash; {brand.name}</h1>
        <p className="mt-2 font-mono text-xs text-zinc-500">
          Customize branding, colors, and help center settings.
        </p>
        {message && (
          <p className="mt-2 font-mono text-xs text-emerald-600">{message}</p>
        )}
        {error && (
          <p className="mt-2 font-mono text-xs text-red-600">{error}</p>
        )}
      </header>

      {/* Help Center Toggle */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
          Help Center
        </h3>
        <div className="mt-4 flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={helpCenterEnabled}
              onChange={(e) => setHelpCenterEnabled(e.target.checked)}
              className="h-4 w-4 border-2 border-zinc-950 accent-zinc-950"
            />
            <span className="font-mono text-sm">Enable Help Center</span>
          </label>
        </div>
        <div className="mt-4">
          <label className="block font-mono text-xs text-zinc-500">
            Help Center Title
          </label>
          <input
            type="text"
            value={helpCenterTitle}
            onChange={(e) => setHelpCenterTitle(e.target.value)}
            placeholder="e.g. Knowledge Base"
            className="mt-1 w-full border-2 border-zinc-950 px-3 py-2 font-mono text-sm"
          />
        </div>
      </section>

      {/* Branding Assets */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
          Branding Assets
        </h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block font-mono text-xs text-zinc-500">
              Logo URL
            </label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.svg"
              className="mt-1 w-full border-2 border-zinc-950 px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block font-mono text-xs text-zinc-500">
              Favicon URL
            </label>
            <input
              type="text"
              value={faviconUrl}
              onChange={(e) => setFaviconUrl(e.target.value)}
              placeholder="https://example.com/favicon.ico"
              className="mt-1 w-full border-2 border-zinc-950 px-3 py-2 font-mono text-sm"
            />
          </div>
        </div>
      </section>

      {/* Colors */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
          Colors
        </h3>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <div>
            <label className="block font-mono text-xs text-zinc-500">
              Primary Color
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-[38px] w-[50px] cursor-pointer border-2 border-zinc-950"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-24 border-2 border-zinc-950 px-2 py-2 font-mono text-xs"
              />
            </div>
          </div>
          <div>
            <label className="block font-mono text-xs text-zinc-500">
              Accent Color
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="h-[38px] w-[50px] cursor-pointer border-2 border-zinc-950"
              />
              <input
                type="text"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="w-24 border-2 border-zinc-950 px-2 py-2 font-mono text-xs"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Custom HTML & CSS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
          Custom HTML & CSS
        </h3>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block font-mono text-xs text-zinc-500">
              Header HTML
            </label>
            <textarea
              value={headerHtml}
              onChange={(e) => setHeaderHtml(e.target.value)}
              rows={3}
              placeholder="<div>Custom header content</div>"
              className="mt-1 w-full border-2 border-zinc-950 px-3 py-2 font-mono text-xs"
            />
          </div>
          <div>
            <label className="block font-mono text-xs text-zinc-500">
              Footer HTML
            </label>
            <textarea
              value={footerHtml}
              onChange={(e) => setFooterHtml(e.target.value)}
              rows={3}
              placeholder="<footer>Custom footer</footer>"
              className="mt-1 w-full border-2 border-zinc-950 px-3 py-2 font-mono text-xs"
            />
          </div>
          <div>
            <label className="block font-mono text-xs text-zinc-500">
              Custom CSS
            </label>
            <textarea
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value)}
              rows={5}
              placeholder=".help-center { font-family: Inter, sans-serif; }"
              className="mt-1 w-full border-2 border-zinc-950 px-3 py-2 font-mono text-xs"
            />
          </div>
        </div>
      </section>

      {/* Locale Config */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
          Localization
        </h3>
        <div className="mt-4">
          <label className="block font-mono text-xs text-zinc-500">
            Default Locale
          </label>
          <div className="mt-1">
            <LocalePicker
              locales={supportedLocales}
              current={defaultLocale}
              onChange={setDefaultLocale}
            />
          </div>
        </div>
        <div className="mt-4">
          <label className="block font-mono text-xs text-zinc-500">
            Supported Locales
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {AVAILABLE_LOCALES.map((code) => {
              const active = supportedLocales.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleLocale(code)}
                  className={`border-2 px-2 py-1 font-mono text-xs font-bold ${
                    active
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-300 text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  {code.toUpperCase()}
                </button>
              );
            })}
          </div>
          <p className="mt-2 font-mono text-xs text-zinc-400">
            {supportedLocales.length} locale
            {supportedLocales.length !== 1 ? "s" : ""} selected
          </p>
        </div>
      </section>

      {/* Save */}
      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="border-2 border-zinc-950 bg-zinc-950 px-6 py-3 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Theme"}
        </button>
        <Link
          href="/brands"
          className="border-2 border-zinc-300 bg-white px-6 py-3 font-mono text-xs font-bold uppercase text-zinc-500 hover:border-zinc-950"
        >
          Cancel
        </Link>
      </div>
    </main>
  );
}

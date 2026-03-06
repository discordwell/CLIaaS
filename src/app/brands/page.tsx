"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface BrandRow {
  id: string;
  name: string;
  subdomain: string | null;
  helpCenterEnabled?: boolean;
  help_center_enabled?: boolean;
  supportedLocales?: string[];
  supported_locales?: string[];
  primaryColor?: string;
  primary_color?: string;
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then((d) => setBrands(d.brands ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/settings" className="hover:underline">
          Settings
        </Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">Brands</span>
      </nav>

      <header className="border-2 border-zinc-950 bg-white p-8">
        <h1 className="text-2xl font-bold">Brands</h1>
        <p className="mt-2 font-mono text-xs text-zinc-500">
          Manage brands and their help center configurations.
        </p>
      </header>

      <section className="mt-8 border-2 border-zinc-950 bg-white">
        <div className="border-b border-zinc-200 px-6 py-3">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
            All Brands ({brands.length})
          </h3>
        </div>

        {loading ? (
          <div className="p-6 text-center font-mono text-xs text-zinc-500">
            Loading...
          </div>
        ) : brands.length === 0 ? (
          <div className="p-6 text-center font-mono text-xs text-zinc-500">
            No brands configured yet.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Name
                </th>
                <th className="px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Subdomain
                </th>
                <th className="px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Help Center
                </th>
                <th className="px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Locales
                </th>
                <th className="px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {brands.map((brand) => {
                const hcEnabled =
                  brand.helpCenterEnabled ?? brand.help_center_enabled ?? false;
                const locales =
                  brand.supportedLocales ?? brand.supported_locales ?? [];
                const color =
                  brand.primaryColor ?? brand.primary_color ?? "#09090b";

                return (
                  <tr key={brand.id} className="hover:bg-zinc-50">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 border border-zinc-300"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-mono text-sm font-bold">
                          {brand.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-zinc-500">
                      {brand.subdomain ?? "-"}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center gap-1 font-mono text-xs font-bold ${
                          hcEnabled ? "text-emerald-600" : "text-zinc-400"
                        }`}
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 ${
                            hcEnabled ? "bg-emerald-500" : "bg-zinc-300"
                          }`}
                        />
                        {hcEnabled ? "ENABLED" : "DISABLED"}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-zinc-500">
                      {locales.length > 0
                        ? `${locales.length} locale${locales.length !== 1 ? "s" : ""}`
                        : "-"}
                    </td>
                    <td className="px-6 py-3">
                      <Link
                        href={`/brands/${brand.id}`}
                        className="font-mono text-xs font-bold text-zinc-500 hover:text-zinc-950 hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

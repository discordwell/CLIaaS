import Link from "next/link";
import { loadCustomers, loadOrganizations } from "@/lib/data";

const sourceColor: Record<string, string> = {
  zendesk: "bg-emerald-100 text-emerald-800",
  helpcrunch: "bg-blue-100 text-blue-800",
  freshdesk: "bg-purple-100 text-purple-800",
  groove: "bg-orange-100 text-orange-800",
};

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = sp.q?.toLowerCase() ?? "";
  const sourceFilter = sp.source ?? "";

  let customers = await loadCustomers();
  const organizations = await loadOrganizations();

  if (sourceFilter) {
    customers = customers.filter(c => c.source === sourceFilter);
  }
  if (q) {
    customers = customers.filter(
      c =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
    );
  }

  // Group by source
  const sources = [...new Set(customers.map(c => c.source))];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">Dashboard</Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">Customers</span>
        </nav>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Customers
        </p>
        <h1 className="mt-4 text-4xl font-bold">
          {customers.length} Customer{customers.length !== 1 ? "s" : ""}
        </h1>
        <p className="mt-4 text-lg font-medium text-zinc-600">
          Contacts aggregated from all connected helpdesk platforms.
        </p>
      </header>

      {/* FILTERS */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <form className="flex flex-wrap items-center gap-4">
          <input
            name="q"
            type="text"
            defaultValue={q}
            placeholder="Search by name or email..."
            className="border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none sm:w-80"
          />
          <select
            name="source"
            defaultValue={sourceFilter}
            className="border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none"
          >
            <option value="">All Sources</option>
            {sources.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            type="submit"
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Filter
          </button>
        </form>
      </section>

      {/* ORGANIZATIONS */}
      {organizations.length > 0 && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
          <h2 className="text-lg font-bold">Organizations ({organizations.length})</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {organizations.map((org) => (
              <span
                key={org.id}
                className="flex items-center gap-2 border border-zinc-300 bg-zinc-50 px-3 py-1 font-mono text-xs font-bold"
              >
                {org.name}
                <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase ${sourceColor[org.source] ?? "bg-zinc-200 text-zinc-700"}`}>
                  {org.source}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* CUSTOMER TABLE */}
      <section className="mt-8 border-2 border-zinc-950 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Name
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Email
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Source
                </th>
                <th className="px-4 py-3 font-mono text-xs font-bold uppercase text-zinc-500">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                >
                  <td className="px-4 py-3 font-medium">
                    {c.name || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                    {c.email || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 font-mono text-xs font-bold uppercase ${sourceColor[c.source] ?? "bg-zinc-200 text-zinc-700"}`}
                    >
                      {c.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {c.createdAt
                      ? new Date(c.createdAt).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                    No customers found. Export data from your helpdesk connectors first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

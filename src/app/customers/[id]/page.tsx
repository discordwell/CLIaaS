import Link from "next/link";
import { loadCustomers } from "@/lib/data";
import {
  getCustomerActivities,
  getCustomerNotes,
} from "@/lib/customers/customer-store";

export const dynamic = "force-dynamic";

const activityIcon: Record<string, string> = {
  ticket_created: "NEW",
  ticket_resolved: "OK",
  ticket_updated: "UPD",
  page_viewed: "VIEW",
  survey_submitted: "CSAT",
  customer_merged: "MERGE",
};

const noteTypeLabel: Record<string, string> = {
  note: "NOTE",
  call_log: "CALL",
  meeting: "MTG",
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const customers = await loadCustomers();
  const customer = customers.find(
    (c) => c.id === id || c.email?.toLowerCase() === id.toLowerCase(),
  );

  if (!customer) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-950 bg-white p-8">
          <p className="font-mono text-sm text-zinc-500">Customer not found: {id}</p>
          <Link
            href="/customers"
            className="mt-4 inline-block font-mono text-xs font-bold uppercase underline"
          >
            Back to Customers
          </Link>
        </div>
      </main>
    );
  }

  const activities = getCustomerActivities(customer.id);
  const notes = getCustomerNotes(customer.id);

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-zinc-950">
      {/* HEADER */}
      <header className="border-2 border-zinc-950 bg-white p-8 sm:p-12">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span>/</span>
          <Link href="/customers" className="hover:underline">
            Customers
          </Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">
            {customer.name || customer.email}
          </span>
        </nav>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Customer 360
        </p>
        <h1 className="mt-4 text-3xl font-bold">
          {customer.name || "Unnamed Customer"}
        </h1>
        <div className="mt-4 flex flex-wrap gap-6 font-mono text-sm text-zinc-600">
          <span>
            <span className="font-bold text-zinc-400">EMAIL</span>{" "}
            {customer.email || "\u2014"}
          </span>
          <span>
            <span className="font-bold text-zinc-400">SOURCE</span>{" "}
            {customer.source}
          </span>
          {customer.createdAt && (
            <span>
              <span className="font-bold text-zinc-400">SINCE</span>{" "}
              {new Date(customer.createdAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </header>

      {/* STATS ROW */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Activities", value: activities.length },
          { label: "Notes", value: notes.length },
          { label: "Source", value: customer.source },
          { label: "ID", value: customer.id },
        ].map((stat) => (
          <div
            key={stat.label}
            className="border-2 border-zinc-950 bg-white p-4"
          >
            <p className="font-mono text-xs font-bold uppercase text-zinc-400">
              {stat.label}
            </p>
            <p className="mt-1 truncate font-mono text-lg font-bold">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* TIMELINE */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Activity Timeline
        </h2>
        {activities.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-zinc-400">
            No activities recorded.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {activities.slice(0, 20).map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-4 border-b border-zinc-100 pb-3 last:border-0"
              >
                <span className="mt-0.5 inline-block min-w-[3rem] border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-center font-mono text-[10px] font-bold uppercase text-zinc-600">
                  {activityIcon[a.activityType] ?? a.activityType.slice(0, 4).toUpperCase()}
                </span>
                <div className="flex-1">
                  <p className="font-mono text-sm font-medium">
                    {a.activityType.replace(/_/g, " ")}
                    {a.entityType && a.entityId && (
                      <span className="ml-2 text-zinc-400">
                        [{a.entityType}:{a.entityId}]
                      </span>
                    )}
                  </p>
                  {Object.keys(a.metadata).length > 0 && (
                    <p className="mt-0.5 font-mono text-xs text-zinc-500">
                      {Object.entries(a.metadata)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" | ")}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-xs text-zinc-400">
                  {new Date(a.createdAt).toLocaleDateString()}{" "}
                  {new Date(a.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* NOTES */}
      <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Notes
        </h2>
        {notes.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-zinc-400">No notes yet.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {notes.map((n) => (
              <div
                key={n.id}
                className="border border-zinc-200 bg-zinc-50 p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-block border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-600">
                    {noteTypeLabel[n.noteType] ?? n.noteType}
                  </span>
                  <span className="font-mono text-xs text-zinc-400">
                    {new Date(n.createdAt).toLocaleDateString()}{" "}
                    {new Date(n.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {n.authorId && (
                    <span className="font-mono text-xs text-zinc-400">
                      by {n.authorId}
                    </span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-zinc-700">
                  {n.body}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

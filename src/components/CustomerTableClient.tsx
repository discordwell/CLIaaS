"use client";

import Link from "next/link";
import { useDensity } from "./DensityProvider";
import DensityToggle from "./DensityToggle";

interface CustomerRow {
  id: string;
  name?: string;
  email?: string;
  source: string;
  createdAt?: string;
}

const sourceColor: Record<string, string> = {
  zendesk: "bg-emerald-100 text-emerald-800",
  helpcrunch: "bg-blue-100 text-blue-800",
  freshdesk: "bg-purple-100 text-purple-800",
  groove: "bg-orange-100 text-orange-800",
};

const rowPad = {
  spacious: "px-5 py-4",
  comfortable: "px-4 py-3",
  compact: "px-3 py-1.5",
} as const;

const headerPad = {
  spacious: "px-5 py-4",
  comfortable: "px-4 py-3",
  compact: "px-3 py-1.5",
} as const;

const textSize = {
  spacious: "text-sm",
  comfortable: "text-sm",
  compact: "text-xs",
} as const;

const pillSize = {
  spacious: "px-2 py-0.5 text-xs",
  comfortable: "px-2 py-0.5 text-xs",
  compact: "px-1.5 py-0 text-[9px]",
} as const;

export default function CustomerTableClient({ customers }: { customers: CustomerRow[] }) {
  const { density } = useDensity();

  return (
    <section className="mt-8 border-2 border-zinc-950 bg-white">
      <div className="flex items-center justify-end border-b border-zinc-200 bg-zinc-50 px-3 py-1.5">
        <DensityToggle />
      </div>
      <div className="overflow-x-auto">
        <table className={`w-full ${textSize[density]}`}>
          <thead>
            <tr className="border-b-2 border-zinc-200 bg-zinc-50 text-left">
              <th className={`${headerPad[density]} font-mono text-xs font-bold uppercase text-zinc-500`}>
                Name
              </th>
              <th className={`${headerPad[density]} font-mono text-xs font-bold uppercase text-zinc-500`}>
                Email
              </th>
              <th className={`${headerPad[density]} font-mono text-xs font-bold uppercase text-zinc-500`}>
                Source
              </th>
              <th className={`${headerPad[density]} font-mono text-xs font-bold uppercase text-zinc-500`}>
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
                <td className={`${rowPad[density]} font-medium`}>
                  <Link href={`/customers/${c.id}`} className="hover:underline">
                    {c.name || "\u2014"}
                  </Link>
                </td>
                <td className={`${rowPad[density]} font-mono text-xs text-zinc-600`}>
                  {c.email || "\u2014"}
                </td>
                <td className={rowPad[density]}>
                  <span
                    className={`inline-block font-mono font-bold uppercase ${pillSize[density]} ${sourceColor[c.source] ?? "bg-zinc-200 text-zinc-700"}`}
                  >
                    {c.source}
                  </span>
                </td>
                <td className={`${rowPad[density]} font-mono text-xs text-zinc-500`}>
                  {c.createdAt
                    ? new Date(c.createdAt).toLocaleDateString()
                    : "\u2014"}
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
  );
}

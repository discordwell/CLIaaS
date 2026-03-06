"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

interface ObjectType {
  id: string;
  key: string;
  name: string;
  namePlural: string;
  description?: string;
  fields: Array<{
    key: string;
    name: string;
    type: string;
    required?: boolean;
    options?: string[];
  }>;
  createdAt: string;
}

interface ObjectRecord {
  id: string;
  typeId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export default function CustomObjectRecordsPage({
  params,
}: {
  params: Promise<{ typeKey: string }>;
}) {
  const { typeKey } = use(params);

  const [objectType, setObjectType] = useState<ObjectType | null>(null);
  const [records, setRecords] = useState<ObjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const typesRes = await fetch("/api/custom-objects/types");
      const typesJson = await typesRes.json();
      const types: ObjectType[] = typesJson.types ?? [];
      const found = types.find((t) => t.key === typeKey);

      if (found) {
        setObjectType(found);
        const recordsRes = await fetch(
          `/api/custom-objects/types/${found.id}/records`
        );
        const recordsJson = await recordsRes.json();
        setRecords(recordsJson.records ?? []);
      }
    } catch {
      /* silent */
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey]);

  const resetForm = () => {
    setFormData({});
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!objectType) return;
    setCreating(true);
    try {
      const res = await fetch(
        `/api/custom-objects/types/${objectType.id}/records`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: formData }),
        }
      );
      if (res.ok) {
        setMessage("Record created");
        resetForm();
        loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage(err.error ?? "Failed to create record");
      }
    } catch {
      setMessage("Network error");
    }
    setCreating(false);
  };

  const handleDelete = async (recordId: string) => {
    if (!objectType) return;
    if (!window.confirm("Delete this record? This action cannot be undone."))
      return;
    try {
      const res = await fetch(
        `/api/custom-objects/types/${objectType.id}/records/${recordId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setMessage("Record deleted");
        loadData();
      }
    } catch {
      /* silent */
    }
  };

  const updateFormField = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const renderFieldInput = (field: ObjectType["fields"][number]) => {
    const value = formData[field.key];

    switch (field.type) {
      case "number":
      case "currency":
        return (
          <input
            type="number"
            value={(value as number) ?? ""}
            onChange={(e) =>
              updateFormField(
                field.key,
                e.target.value === "" ? "" : Number(e.target.value)
              )
            }
            step={field.type === "currency" ? "0.01" : "1"}
            className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
        );
      case "boolean":
        return (
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => updateFormField(field.key, e.target.checked)}
              className="h-4 w-4 border-2 border-zinc-300"
            />
            <span className="font-mono text-sm text-zinc-600">
              {field.name}
            </span>
          </label>
        );
      case "select":
        return (
          <select
            value={(value as string) ?? ""}
            onChange={(e) => updateFormField(field.key, e.target.value)}
            className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          >
            <option value="">-- Select --</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case "email":
        return (
          <input
            type="email"
            value={(value as string) ?? ""}
            onChange={(e) => updateFormField(field.key, e.target.value)}
            placeholder={`Enter ${field.name.toLowerCase()}`}
            className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
        );
      case "url":
        return (
          <input
            type="url"
            value={(value as string) ?? ""}
            onChange={(e) => updateFormField(field.key, e.target.value)}
            placeholder="https://"
            className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
        );
      case "date":
        return (
          <input
            type="date"
            value={(value as string) ?? ""}
            onChange={(e) => updateFormField(field.key, e.target.value)}
            className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
        );
      default:
        return (
          <input
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => updateFormField(field.key, e.target.value)}
            placeholder={`Enter ${field.name.toLowerCase()}`}
            className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
          />
        );
    }
  };

  const formatCellValue = (value: unknown, type: string): string => {
    if (value === null || value === undefined) return "--";
    if (type === "boolean") return value ? "Yes" : "No";
    if (type === "currency") return `$${Number(value).toFixed(2)}`;
    return String(value);
  };

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
        <div className="border-2 border-zinc-300 bg-white p-6 text-center font-mono text-xs text-zinc-500">
          Loading...
        </div>
      </main>
    );
  }

  if (!objectType) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
        <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span>/</span>
          <Link href="/custom-objects" className="hover:underline">
            Custom Objects
          </Link>
          <span>/</span>
          <span className="font-bold text-zinc-950">{typeKey}</span>
        </nav>
        <div className="border-2 border-zinc-950 bg-white p-8 text-center">
          <h1 className="text-lg font-bold">Object type not found</h1>
          <p className="mt-2 font-mono text-xs text-zinc-500">
            No object type with key &ldquo;{typeKey}&rdquo; exists.
          </p>
          <Link
            href="/custom-objects"
            className="mt-4 inline-block border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
          >
            Back to Custom Objects
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">
          Dashboard
        </Link>
        <span>/</span>
        <Link href="/custom-objects" className="hover:underline">
          Custom Objects
        </Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">{objectType.name}</span>
      </nav>

      {/* Header */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{objectType.namePlural}</h1>
            {objectType.description && (
              <p className="mt-2 text-sm text-zinc-600">
                {objectType.description}
              </p>
            )}
            <p className="mt-1 font-mono text-xs text-zinc-500">
              Key: {objectType.key} &middot; {objectType.fields.length} field
              {objectType.fields.length !== 1 ? "s" : ""}
            </p>
          </div>
          {!showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              New Record
            </button>
          )}
        </div>
        {message && (
          <p className="mt-2 font-mono text-xs text-emerald-600">{message}</p>
        )}
      </header>

      {/* Create Record Form */}
      {showForm && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            New {objectType.name}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-4">
            {objectType.fields.map((field) => (
              <div
                key={field.key}
                className={field.type === "boolean" ? "flex items-end" : ""}
              >
                {field.type !== "boolean" && (
                  <label className="block font-mono text-xs text-zinc-500">
                    {field.name}
                    {field.required && (
                      <span className="ml-1 text-red-500">*</span>
                    )}
                  </label>
                )}
                {renderFieldInput(field)}
              </div>
            ))}
          </div>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Record"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Records Table */}
      <section className="mt-8 border-2 border-zinc-950 bg-white">
        <div className="border-b border-zinc-200 px-6 py-3">
          <h3 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            Records ({records.length})
          </h3>
        </div>

        {records.length === 0 ? (
          <div className="p-6 text-center font-mono text-xs text-zinc-500">
            No records yet. Create one to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-zinc-200 bg-zinc-50">
                  <th className="px-4 py-3 text-left font-mono text-xs font-bold uppercase text-zinc-500">
                    ID
                  </th>
                  {objectType.fields.map((field) => (
                    <th
                      key={field.key}
                      className="px-4 py-3 text-left font-mono text-xs font-bold uppercase text-zinc-500"
                    >
                      {field.name}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left font-mono text-xs font-bold uppercase text-zinc-500">
                    Created
                  </th>
                  <th className="px-4 py-3 text-right font-mono text-xs font-bold uppercase text-zinc-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr
                    key={record.id}
                    className="border-b border-zinc-100 transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {record.id.slice(0, 8)}
                    </td>
                    {objectType.fields.map((field) => (
                      <td key={field.key} className="px-4 py-3">
                        {formatCellValue(record.data[field.key], field.type)}
                      </td>
                    ))}
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {new Date(record.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(record.id)}
                        className="font-mono text-xs text-red-500 hover:text-red-700 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

"use client";

import { useState, useEffect } from "react";
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

interface FieldDraft {
  key: string;
  name: string;
  type: string;
  required: boolean;
}

const FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "email",
  "url",
  "currency",
  "select",
  "date",
];

function emptyField(): FieldDraft {
  return { key: "", name: "", type: "text", required: false };
}

export default function CustomObjectsPage() {
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  // Form state
  const [formKey, setFormKey] = useState("");
  const [formName, setFormName] = useState("");
  const [formNamePlural, setFormNamePlural] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formFields, setFormFields] = useState<FieldDraft[]>([emptyField()]);

  const loadTypes = () => {
    fetch("/api/custom-objects/types")
      .then((r) => r.json())
      .then((d) => setTypes(d.types ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(loadTypes, []);

  const resetForm = () => {
    setFormKey("");
    setFormName("");
    setFormNamePlural("");
    setFormDescription("");
    setFormFields([emptyField()]);
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!formKey.trim() || !formName.trim() || !formNamePlural.trim()) return;
    const validFields = formFields.filter((f) => f.key.trim() && f.name.trim());
    if (validFields.length === 0) return;

    setCreating(true);
    try {
      const res = await fetch("/api/custom-objects/types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: formKey.trim(),
          name: formName.trim(),
          namePlural: formNamePlural.trim(),
          description: formDescription.trim() || undefined,
          fields: validFields.map((f) => ({
            key: f.key.trim(),
            name: f.name.trim(),
            type: f.type,
            required: f.required,
          })),
        }),
      });
      if (res.ok) {
        setMessage("Object type created");
        resetForm();
        loadTypes();
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage(err.error ?? "Failed to create object type");
      }
    } catch {
      setMessage("Network error");
    }
    setCreating(false);
  };

  const handleDelete = async (typeId: string, typeName: string) => {
    if (!window.confirm(`Delete object type "${typeName}"? This will remove all associated records.`))
      return;
    try {
      const res = await fetch(`/api/custom-objects/types/${typeId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessage("Object type deleted");
        loadTypes();
      }
    } catch {
      /* silent */
    }
  };

  const updateField = (index: number, patch: Partial<FieldDraft>) => {
    setFormFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  const addField = () => {
    setFormFields((prev) => [...prev, emptyField()]);
  };

  const removeField = (index: number) => {
    setFormFields((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12 text-zinc-950">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 font-mono text-xs text-zinc-500">
        <Link href="/dashboard" className="hover:underline">
          Dashboard
        </Link>
        <span>/</span>
        <span className="font-bold text-zinc-950">Custom Objects</span>
      </nav>

      {/* Header */}
      <header className="border-2 border-zinc-950 bg-white p-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Custom Objects</h1>
            <p className="mt-2 font-mono text-xs text-zinc-500">
              Define and manage custom data structures
            </p>
          </div>
          {!showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800"
            >
              New Object Type
            </button>
          )}
        </div>
        {message && (
          <p className="mt-2 font-mono text-xs text-emerald-600">{message}</p>
        )}
      </header>

      {/* Create Form */}
      {showForm && (
        <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
          <h3 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
            New Object Type
          </h3>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-xs text-zinc-500">
                Key
              </label>
              <input
                type="text"
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                placeholder="e.g. asset"
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </div>
            <div>
              <label className="block font-mono text-xs text-zinc-500">
                Name
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Asset"
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </div>
            <div>
              <label className="block font-mono text-xs text-zinc-500">
                Plural Name
              </label>
              <input
                type="text"
                value={formNamePlural}
                onChange={(e) => setFormNamePlural(e.target.value)}
                placeholder="e.g. Assets"
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </div>
            <div>
              <label className="block font-mono text-xs text-zinc-500">
                Description
              </label>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description"
                className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              />
            </div>
          </div>

          {/* Fields */}
          <div className="mt-6">
            <h4 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Fields
            </h4>
            <div className="mt-3 space-y-3">
              {formFields.map((field, i) => (
                <div
                  key={i}
                  className="flex items-end gap-3 border-2 border-zinc-300 bg-zinc-50 p-3"
                >
                  <div className="flex-1">
                    <label className="block font-mono text-xs text-zinc-500">
                      Key
                    </label>
                    <input
                      type="text"
                      value={field.key}
                      onChange={(e) => updateField(i, { key: e.target.value })}
                      placeholder="field_key"
                      className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block font-mono text-xs text-zinc-500">
                      Name
                    </label>
                    <input
                      type="text"
                      value={field.name}
                      onChange={(e) => updateField(i, { name: e.target.value })}
                      placeholder="Field Name"
                      className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                    />
                  </div>
                  <div className="w-32">
                    <label className="block font-mono text-xs text-zinc-500">
                      Type
                    </label>
                    <select
                      value={field.type}
                      onChange={(e) => updateField(i, { type: e.target.value })}
                      className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-1.5 pb-2">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) =>
                        updateField(i, { required: e.target.checked })
                      }
                      className="h-4 w-4 border-2 border-zinc-300"
                    />
                    <span className="font-mono text-xs text-zinc-500">Req</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    disabled={formFields.length <= 1}
                    className="pb-2 font-mono text-xs text-red-500 hover:text-red-700 disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addField}
              className="mt-3 border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
            >
              Add Field
            </button>
          </div>

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={handleCreate}
              disabled={
                creating ||
                !formKey.trim() ||
                !formName.trim() ||
                !formNamePlural.trim() ||
                formFields.every((f) => !f.key.trim() || !f.name.trim())
              }
              className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Object Type"}
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

      {/* Types List */}
      <section className="mt-8">
        <h3 className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Object Types ({types.length})
        </h3>

        {loading ? (
          <div className="border-2 border-zinc-300 bg-white p-6 text-center font-mono text-xs text-zinc-500">
            Loading...
          </div>
        ) : types.length === 0 ? (
          <div className="border-2 border-zinc-300 bg-white p-6 text-center font-mono text-xs text-zinc-500">
            No custom object types defined yet. Create one to get started.
          </div>
        ) : (
          <div className="grid gap-4">
            {types.map((type) => (
              <div
                key={type.id}
                className="border-2 border-zinc-950 bg-white p-6 transition-colors hover:bg-zinc-50"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-lg font-bold">{type.name}</h4>
                    <p className="mt-1 font-mono text-xs text-zinc-500">
                      Key: {type.key}
                    </p>
                    {type.description && (
                      <p className="mt-1 text-sm text-zinc-600">
                        {type.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/custom-objects/${type.key}`}
                      className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
                    >
                      View Records
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDelete(type.id, type.name)}
                      className="font-mono text-xs text-red-500 hover:text-red-700 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-6 font-mono text-xs text-zinc-500">
                  <span>
                    {type.fields.length} field
                    {type.fields.length !== 1 ? "s" : ""}
                  </span>
                  <span>
                    Created{" "}
                    {new Date(type.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

"use client";

import { useState } from "react";

interface ConfigFormProps {
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

interface SchemaProperty {
  type?: string;
  enum?: string[];
  description?: string;
  default?: unknown;
}

export default function PluginConfigForm({
  schema,
  values,
  onChange,
}: ConfigFormProps) {
  const properties = (schema.properties ?? {}) as Record<string, SchemaProperty>;

  function handleChange(key: string, value: unknown) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="space-y-3">
      {Object.entries(properties).map(([key, prop]) => (
        <div key={key}>
          <label className="block font-mono text-xs font-bold uppercase text-zinc-500">
            {key}
            {prop.description && (
              <span className="ml-2 font-normal normal-case text-zinc-400">
                {prop.description}
              </span>
            )}
          </label>

          {prop.type === "boolean" ? (
            <button
              type="button"
              onClick={() => handleChange(key, !values[key])}
              className={`mt-1 border-2 px-3 py-1.5 font-mono text-xs font-bold uppercase ${
                values[key]
                  ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                  : "border-zinc-300 bg-white text-zinc-500"
              }`}
            >
              {values[key] ? "Enabled" : "Disabled"}
            </button>
          ) : prop.enum ? (
            <select
              value={(values[key] ?? prop.default ?? "") as string}
              onChange={(e) => handleChange(key, e.target.value)}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none"
            >
              {prop.enum.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : prop.type === "number" || prop.type === "integer" ? (
            <input
              type="number"
              value={(values[key] ?? prop.default ?? "") as number}
              onChange={(e) => handleChange(key, Number(e.target.value))}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none"
            />
          ) : (
            <input
              type="text"
              value={(values[key] ?? prop.default ?? "") as string}
              onChange={(e) => handleChange(key, e.target.value)}
              className="mt-1 w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm focus:border-zinc-950 focus:outline-none"
            />
          )}
        </div>
      ))}
    </div>
  );
}

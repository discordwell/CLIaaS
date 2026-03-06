"use client";

import { useCallback, useEffect, useState } from "react";

interface Relationship {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationshipType: string;
  createdAt: string;
}

interface RelatedObjectsPanelProps {
  entityType: string;
  entityId: string;
}

const TARGET_TYPE_OPTIONS = [
  "ticket",
  "customer",
  "organization",
  "custom_object",
] as const;

export default function RelatedObjectsPanel({
  entityType,
  entityId,
}: RelatedObjectsPanelProps) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [targetType, setTargetType] = useState<string>(
    TARGET_TYPE_OPTIONS[0]
  );
  const [targetId, setTargetId] = useState("");
  const [relationshipType, setRelationshipType] = useState("related");

  const fetchRelationships = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/custom-objects/relationships?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
      );
      if (!res.ok) throw new Error("Failed to fetch relationships");
      const data = await res.json();
      setRelationships(data.relationships ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    fetchRelationships();
  }, [fetchRelationships]);

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/custom-objects/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: entityType,
          sourceId: entityId,
          targetType,
          targetId: targetId.trim(),
          relationshipType: relationshipType.trim() || "related",
        }),
      });
      if (!res.ok) throw new Error("Failed to create relationship");
      setTargetId("");
      setRelationshipType("related");
      setTargetType(TARGET_TYPE_OPTIONS[0]);
      setShowForm(false);
      await fetchRelationships();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (relId: string) => {
    setRemovingId(relId);
    setError(null);
    try {
      const res = await fetch(
        `/api/custom-objects/relationships?id=${encodeURIComponent(relId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove relationship");
      await fetchRelationships();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="mt-8 border-2 border-zinc-950 bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
          Related Objects
        </h3>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950"
        >
          {showForm ? "Cancel" : "Link Object"}
        </button>
      </div>

      {error && (
        <p className="mt-3 font-mono text-xs text-red-600">{error}</p>
      )}

      {showForm && (
        <form onSubmit={handleLink} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              Target Type
            </label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            >
              {TARGET_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              Target ID
            </label>
            <input
              type="text"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="Enter target ID"
              className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
              required
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">
              Relationship Type
            </label>
            <input
              type="text"
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              placeholder="related"
              className="w-full border-2 border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting ? "Linking..." : "Link"}
          </button>
        </form>
      )}

      <div className="mt-4">
        {loading ? (
          <p className="font-mono text-xs text-zinc-400">Loading...</p>
        ) : relationships.length === 0 ? (
          <p className="font-mono text-xs text-zinc-400">
            No related objects
          </p>
        ) : (
          <ul className="space-y-2">
            {relationships.map((rel) => (
              <li
                key={rel.id}
                className="flex items-center justify-between border-2 border-zinc-950 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px]">
                    {rel.relationshipType}
                  </span>
                  <span className="font-mono text-xs text-zinc-700">
                    {rel.targetType}
                  </span>
                  <span className="font-mono text-xs font-bold text-zinc-950">
                    {rel.targetId}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(rel.id)}
                  disabled={removingId === rel.id}
                  className="border-2 border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-600 hover:border-zinc-950 disabled:opacity-50"
                >
                  {removingId === rel.id ? "Removing..." : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

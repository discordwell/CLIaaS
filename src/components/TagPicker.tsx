"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface TagSuggestion {
  id: string;
  name: string;
  color: string;
}

interface TagPickerProps {
  ticketId: string;
  currentTags: string[];
  onTagsChange?: (tags: string[]) => void;
}

export default function TagPicker({ ticketId, currentTags, onTagsChange }: TagPickerProps) {
  const [tags, setTags] = useState<string[]>(currentTags);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchSuggestions = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/tags/autocomplete?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const filtered = (data.tags ?? []).filter(
        (t: TagSuggestion) => !tags.includes(t.name)
      );
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0 || q.trim().length > 0);
    } catch {
      setSuggestions([]);
    }
  }, [tags]);

  useEffect(() => {
    if (!input.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(input), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, fetchSuggestions]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const addTag = async (tagName: string) => {
    const trimmed = tagName.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed)) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addTags: [trimmed] }),
      });
      if (res.ok) {
        const newTags = [...tags, trimmed];
        setTags(newTags);
        onTagsChange?.(newTags);
      }
    } catch { /* silent */ }
    setSaving(false);
    setInput("");
    setShowSuggestions(false);
  };

  const removeTag = async (tagName: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeTags: [tagName] }),
      });
      if (res.ok) {
        const newTags = tags.filter((t) => t !== tagName);
        setTags(newTags);
        onTagsChange?.(newTags);
      }
    } catch { /* silent */ }
    setSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      addTag(input);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              disabled={saving}
              className="ml-0.5 text-zinc-400 hover:text-zinc-950 disabled:opacity-50"
              aria-label={`Remove tag ${tag}`}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (input.trim()) fetchSuggestions(input); }}
          placeholder={tags.length === 0 ? "Add tag..." : "+"}
          disabled={saving}
          className="min-w-[60px] flex-1 border-0 bg-transparent px-1 py-0.5 font-mono text-xs outline-none placeholder:text-zinc-400"
        />
      </div>

      {showSuggestions && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-40 w-64 overflow-y-auto border-2 border-zinc-950 bg-white shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => addTag(s.name)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-zinc-100"
            >
              <span
                className="inline-block h-2 w-2"
                style={{ backgroundColor: s.color }}
              />
              {s.name}
            </button>
          ))}
          {input.trim() && !suggestions.some((s) => s.name === input.trim().toLowerCase()) && (
            <button
              type="button"
              onClick={() => addTag(input)}
              className="flex w-full items-center gap-2 border-t border-zinc-200 px-3 py-1.5 text-left font-mono text-xs text-zinc-500 hover:bg-zinc-100"
            >
              Create &ldquo;{input.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface User {
  id: string;
  name: string;
  email: string | null;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onMentionsChange?: (userIds: string[]) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  onKeyDown?: () => void;
  onBlur?: () => void;
}

export default function MentionInput({
  value,
  onChange,
  onMentionsChange,
  placeholder,
  rows = 5,
  className = "",
  onKeyDown,
  onBlur,
}: MentionInputProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUsers = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
        setSelectedIndex(0);
      }
    } catch {
      setUsers([]);
    }
  }, []);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);
      onKeyDown?.();

      // Detect @ trigger
      const cursorPos = e.target.selectionStart ?? newValue.length;
      const textBeforeCursor = newValue.slice(0, cursorPos);
      const atMatch = textBeforeCursor.match(/@([\w.]*)$/);

      if (atMatch) {
        const q = atMatch[1];
        setQuery(q);
        setShowDropdown(true);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => fetchUsers(q), 200);
      } else {
        setShowDropdown(false);
      }
    },
    [onChange, onKeyDown, fetchUsers],
  );

  const insertMention = useCallback(
    (user: User) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart ?? value.length;
      const textBeforeCursor = value.slice(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf("@");
      if (atIndex === -1) return;

      const displayName = user.name.replace(/\s+/g, ".");
      const before = value.slice(0, atIndex);
      const after = value.slice(cursorPos);
      const newValue = `${before}@${displayName} ${after}`;

      onChange(newValue);
      setShowDropdown(false);

      // Track mention
      const newIds = [...new Set([...mentionedIds, user.id])];
      setMentionedIds(newIds);
      onMentionsChange?.(newIds);

      // Restore cursor
      requestAnimationFrame(() => {
        const newPos = atIndex + displayName.length + 2;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      });
    },
    [value, onChange, mentionedIds, onMentionsChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showDropdown || users.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % users.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + users.length) % users.length);
      } else if (e.key === "Enter" && showDropdown) {
        e.preventDefault();
        insertMention(users[selectedIndex]);
      } else if (e.key === "Escape") {
        setShowDropdown(false);
      }
    },
    [showDropdown, users, selectedIndex, insertMention],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
      {showDropdown && users.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute left-0 z-50 mt-1 max-h-48 w-64 overflow-y-auto border-2 border-zinc-950 bg-white shadow-lg"
        >
          {users.map((user, idx) => (
            <button
              key={user.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(user);
              }}
              className={`block w-full px-3 py-2 text-left ${
                idx === selectedIndex
                  ? "bg-zinc-950 text-white"
                  : "hover:bg-zinc-100"
              }`}
            >
              <p className="font-mono text-xs font-bold">{user.name}</p>
              {user.email && (
                <p className="font-mono text-[10px] text-zinc-500">
                  {user.email}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

interface MaskedFieldProps {
  value: string;
  maskedValue?: string;
  hasPii?: boolean;
  canUnmask?: boolean;
  onUnmask?: () => Promise<string | null>;
}

export default function MaskedField({ value, maskedValue, hasPii, canUnmask, onUnmask }: MaskedFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const [originalValue, setOriginalValue] = useState<string | null>(null);

  const displayValue = hasPii && maskedValue && !revealed ? maskedValue : (originalValue ?? value);

  const handleReveal = async () => {
    if (onUnmask) {
      const original = await onUnmask();
      if (original) {
        setOriginalValue(original);
        setRevealed(true);
      }
    } else {
      setRevealed(true);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <span className={hasPii && !revealed ? "text-zinc-500 italic" : ""}>{displayValue}</span>
      {hasPii && canUnmask && !revealed && (
        <button
          onClick={handleReveal}
          className="text-xs text-zinc-500 hover:text-zinc-300 underline"
          title="View original (access logged)"
        >
          unmask
        </button>
      )}
    </span>
  );
}

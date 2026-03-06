"use client";

import { useState } from "react";

interface PiiRedactionBadgeProps {
  maskedValue: string;
  piiType: string;
  canReveal?: boolean;
  onReveal?: () => void;
}

export default function PiiRedactionBadge({ maskedValue, piiType, canReveal, onReveal }: PiiRedactionBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-900/30 border border-red-800/50 rounded text-xs font-mono text-red-300">
      {maskedValue}
      {canReveal && onReveal && (
        <button
          onClick={onReveal}
          className="ml-1 text-red-400 hover:text-red-200 underline"
          title="View original (logged)"
        >
          reveal
        </button>
      )}
    </span>
  );
}

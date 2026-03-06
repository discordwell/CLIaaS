"use client";

interface TranslationStatusBadgeProps {
  translated: number;
  total: number;
}

export default function TranslationStatusBadge({
  translated,
  total,
}: TranslationStatusBadgeProps) {
  const complete = translated >= total;
  const percentage = total > 0 ? Math.round((translated / total) * 100) : 0;

  return (
    <span
      className={`inline-flex items-center gap-1.5 border-2 px-2 py-0.5 font-mono text-xs font-bold ${
        complete
          ? "border-emerald-600 text-emerald-600"
          : "border-zinc-400 text-zinc-500"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 ${
          complete ? "bg-emerald-500" : "bg-zinc-400"
        }`}
      />
      {translated}/{total} locale{total !== 1 ? "s" : ""}
      {!complete && ` (${percentage}%)`}
    </span>
  );
}

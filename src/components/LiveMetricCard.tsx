'use client';

interface LiveMetricCardProps {
  label: string;
  value: number | string;
  trend?: 'up' | 'down' | 'flat';
  unit?: string;
  alert?: boolean;
}

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') {
    return <span className="ml-2 text-sm text-zinc-400" aria-label="trending up">&#x25B2;</span>;
  }
  if (trend === 'down') {
    return <span className="ml-2 text-sm text-zinc-400" aria-label="trending down">&#x25BC;</span>;
  }
  return <span className="ml-2 text-sm text-zinc-400" aria-label="flat">&#x25AC;</span>;
}

/**
 * Live metric card — brutalist zinc styling.
 * Displays a large numeric value with an optional trend arrow and unit.
 * When `alert` is true (e.g. SLA at risk > 0), the value turns red.
 */
export default function LiveMetricCard({
  label,
  value,
  trend,
  unit,
  alert = false,
}: LiveMetricCardProps) {
  return (
    <div className="border-2 border-zinc-950 bg-white p-6">
      <p className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
        {label}
      </p>
      <div className="mt-2 flex items-baseline">
        <span
          className={`text-4xl font-bold ${alert ? 'text-red-600' : 'text-zinc-950'}`}
        >
          {value}
        </span>
        {unit && (
          <span className="ml-1 font-mono text-sm text-zinc-400">{unit}</span>
        )}
        {trend && <TrendArrow trend={trend} />}
      </div>
    </div>
  );
}

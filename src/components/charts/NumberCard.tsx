interface NumberCardProps {
  label: string;
  value: string | number;
  trend?: { direction: 'up' | 'down' | 'flat'; value: string };
  accent?: string;
}

export default function NumberCard({ label, value, trend, accent }: NumberCardProps) {
  const trendColor = trend?.direction === 'up' ? 'text-emerald-600' : trend?.direction === 'down' ? 'text-red-600' : 'text-zinc-500';
  const trendArrow = trend?.direction === 'up' ? '\u2191' : trend?.direction === 'down' ? '\u2193' : '\u2192';

  return (
    <div className="border-2 border-zinc-950 bg-white p-6">
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-2 text-4xl font-bold ${accent ?? 'text-zinc-950'}`}>{value}</p>
      {trend && (
        <p className={`mt-1 font-mono text-xs font-bold ${trendColor}`}>
          {trendArrow} {trend.value}
        </p>
      )}
    </div>
  );
}

"use client";

import dynamic from 'next/dynamic';
import type { ReportResult } from '@/lib/reports/engine';

const BarChart = dynamic(() => import('./BarChart'), { ssr: false });
const LineChart = dynamic(() => import('./LineChart'), { ssr: false });
const PieChart = dynamic(() => import('./PieChart'), { ssr: false });
import NumberCard from './NumberCard';

interface ChartRendererProps {
  result: ReportResult;
  visualization: string;
  onCellClick?: (groupKey: string, groupValue: string) => void;
}

export default function ChartRenderer({ result, visualization, onCellClick }: ChartRendererProps) {
  if (!result.rows || result.rows.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-zinc-400 font-mono text-sm">
        No data available
      </div>
    );
  }

  const xKey = result.columns[0];
  const yKey = result.columns[1] ?? 'count';

  switch (visualization) {
    case 'line':
      return <LineChart data={result.rows} xKey={xKey} yKey={yKey} />;

    case 'pie':
      return <PieChart data={result.rows} nameKey={xKey} valueKey={yKey} />;

    case 'number': {
      const mainValue = result.rows[0]?.[yKey] ?? result.summary[Object.keys(result.summary)[0]];
      return (
        <NumberCard
          label={result.metric.replace(/_/g, ' ')}
          value={String(mainValue ?? 0)}
        />
      );
    }

    case 'bar':
    default:
      return (
        <div onClick={(e) => {
          if (!onCellClick) return;
          const target = e.target as HTMLElement;
          const bar = target.closest('.recharts-bar-rectangle');
          if (bar) {
            const idx = Array.from(bar.parentElement?.children ?? []).indexOf(bar);
            const row = result.rows[idx];
            if (row) onCellClick(xKey, String(row[xKey]));
          }
        }}>
          <BarChart data={result.rows} xKey={xKey} yKey={yKey} />
        </div>
      );
  }
}

"use client";

import { PieChart as RechartsPieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const ZINC_COLORS = ['#09090b', '#27272a', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8'];

interface PieChartProps {
  data: Array<Record<string, unknown>>;
  nameKey: string;
  valueKey: string;
}

export default function PieChart({ data, nameKey, valueKey }: PieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsPieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          outerRadius={100}
          strokeWidth={2}
          stroke="#fff"
        >
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={ZINC_COLORS[index % ZINC_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            border: '2px solid #09090b',
            borderRadius: 0,
            background: '#fff',
          }}
        />
        <Legend
          wrapperStyle={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
        />
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}

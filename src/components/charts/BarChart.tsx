"use client";

import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface BarChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKey: string;
}

export default function BarChart({ data, xKey, yKey }: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsBarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fill: '#71717a' }}
          tickLine={false}
          axisLine={{ stroke: '#09090b' }}
        />
        <YAxis
          tick={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fill: '#71717a' }}
          tickLine={false}
          axisLine={{ stroke: '#09090b' }}
        />
        <Tooltip
          contentStyle={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            border: '2px solid #09090b',
            borderRadius: 0,
            background: '#fff',
          }}
        />
        <Bar dataKey={yKey} fill="#09090b" radius={0} />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

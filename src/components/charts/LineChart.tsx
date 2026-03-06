"use client";

import { LineChart as RechartsLineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface LineChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKey: string;
}

export default function LineChart({ data, xKey, yKey }: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsLineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
        <Line
          type="monotone"
          dataKey={yKey}
          stroke="#09090b"
          strokeWidth={2}
          dot={{ fill: '#09090b', r: 3 }}
          activeDot={{ r: 5 }}
        />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}

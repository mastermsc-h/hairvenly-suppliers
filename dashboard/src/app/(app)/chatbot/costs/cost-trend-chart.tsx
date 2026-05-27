"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, ComposedChart } from "recharts";

interface DayPoint {
  date: string;
  cost: number;
  calls: number;
  input: number;
  output: number;
}

export default function CostTrendChart({ data }: { data: DayPoint[] }) {
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <ComposedChart data={data}>
          <CartesianGrid stroke="#f3f4f6" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#737373" }}
            tickFormatter={(d) => {
              // "2026-05-28" → "28.05."
              const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
              return m ? `${m[3]}.${m[2]}.` : d;
            }}
          />
          <YAxis
            yAxisId="cost"
            orientation="left"
            tick={{ fontSize: 11, fill: "#737373" }}
            tickFormatter={(v) => (v < 1 ? `${(v * 100).toFixed(0)}¢` : `$${v.toFixed(0)}`)}
          />
          <YAxis
            yAxisId="calls"
            orientation="right"
            tick={{ fontSize: 11, fill: "#a3a3a3" }}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            formatter={(value, name) => {
              const v = typeof value === "number" ? value : 0;
              const nm = String(name);
              if (nm === "Kosten") return [v < 1 ? `${(v * 100).toFixed(1)}¢` : `$${v.toFixed(2)}`, nm];
              return [String(v), nm];
            }}
          />
          <Area
            yAxisId="cost"
            type="monotone"
            dataKey="cost"
            name="Kosten"
            stroke="#d97706"
            fill="#fef3c7"
            fillOpacity={0.6}
            strokeWidth={2}
          />
          <Line
            yAxisId="calls"
            type="monotone"
            dataKey="calls"
            name="Calls"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={{ r: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

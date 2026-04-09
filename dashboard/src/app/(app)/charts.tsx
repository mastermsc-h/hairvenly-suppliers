"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export type KgSlice = { name: string; kg: number };

const PIE_COLORS = ["#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#06b6d4", "#a855f7"];

export function TransitKgChart({ data }: { data: KgSlice[] }) {
  const total = data.reduce((s, d) => s + d.kg, 0);
  if (total === 0) {
    return (
      <div className="h-[120px] flex items-center justify-center text-xs text-neutral-400">
        Nichts unterwegs
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={120} height={120}>
        <PieChart>
          <Pie
            data={data}
            dataKey="kg"
            nameKey="name"
            innerRadius={34}
            outerRadius={55}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              fontSize: 11,
              padding: "4px 8px",
            }}
            formatter={(v) => [`${Number(v).toFixed(1)} kg`, ""]}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="text-xs space-y-1 min-w-0">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
            />
            <span className="text-neutral-700 truncate">{d.name}</span>
            <span className="text-neutral-500 ml-auto">{d.kg.toFixed(1)} kg</span>
          </li>
        ))}
        <li className="pt-1 mt-1 border-t border-neutral-100 flex justify-between font-medium text-neutral-900">
          <span>Gesamt</span>
          <span>{total.toFixed(1)} kg</span>
        </li>
      </ul>
    </div>
  );
}
import type { MonthlyVolumePoint } from "@/lib/stats";

const usdShort = (n: number) => {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
};

const tooltipFmt = (v: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

export function VolumeChart({ data }: { data: MonthlyVolumePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.95} />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.55} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={usdShort}
          tick={{ fontSize: 11, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
          width={50}
        />
        <Tooltip
          cursor={{ fill: "#f8fafc" }}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            background: "#ffffff",
            color: "#0f172a",
          }}
          labelStyle={{ color: "#0f172a", fontWeight: 600, marginBottom: 2 }}
          itemStyle={{ color: "#334155" }}
          formatter={(v) => [tooltipFmt(Number(v)), "Bestellvolumen"]}
        />
        <Bar dataKey="bestellvolumen" fill="url(#volGrad)" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DebtChart({ data }: { data: MonthlyVolumePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="debtArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={usdShort}
          tick={{ fontSize: 11, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
          width={50}
        />
        <Tooltip
          cursor={{ stroke: "#f43f5e", strokeWidth: 1, strokeDasharray: "3 3" }}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            background: "#ffffff",
            color: "#0f172a",
          }}
          labelStyle={{ color: "#0f172a", fontWeight: 600, marginBottom: 2 }}
          itemStyle={{ color: "#334155" }}
          formatter={(v) => [tooltipFmt(Number(v)), "Offene Schulden"]}
        />
        <Line
          type="monotone"
          dataKey="offene_schulden"
          stroke="#f43f5e"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "#f43f5e", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          fill="url(#debtArea)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

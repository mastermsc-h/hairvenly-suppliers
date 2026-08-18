"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend,
} from "recharts";

export interface StockSnapshot {
  taken_on: string; // YYYY-MM-DD
  total_kg: number;
  wellig_kg: number;
  glatt_kg: number;
}

type Granularity = "day" | "month";

const MONTH_NAMES = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`;
}

export default function StockHistoryChart({ history }: { history: StockSnapshot[] }) {
  // Monatlich = letzter Snapshot je Monat (Monatsend-Bestand).
  // Default: monatlich sobald mehr als ~2 Monate Daten da sind.
  const monthly = useMemo(() => {
    const byMonth = new Map<string, StockSnapshot>();
    for (const s of history) {
      byMonth.set(s.taken_on.slice(0, 7), s); // sortiert aufsteigend → letzter gewinnt
    }
    return Array.from(byMonth.entries()).map(([ym, s]) => ({ label: fmtMonth(ym), ...s }));
  }, [history]);

  const daily = useMemo(
    () => history.map((s) => ({ label: fmtDay(s.taken_on), ...s })),
    [history],
  );

  const [granularity, setGranularity] = useState<Granularity>(monthly.length >= 3 ? "month" : "day");
  const data = granularity === "month" ? monthly : daily;

  if (history.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-neutral-400">
        Noch keine Verlaufsdaten — der erste Snapshot wird heute Nacht erfasst.
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="text-[11px] text-neutral-400">
          {history.length} Snapshot{history.length === 1 ? "" : "s"} seit {fmtDay(history[0].taken_on)}{history[0].taken_on.slice(0, 4)}
          {history.length < 30 && " · Historie wächst täglich (04:00-Cron)"}
        </div>
        <div className="flex gap-1">
          {([["day", "Täglich"], ["month", "Monatlich"]] as [Granularity, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setGranularity(key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                granularity === key
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#a3a3a3" }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#a3a3a3" }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => `${v} kg`}
          />
          <Tooltip
            formatter={(value, name) => [`${Number(value).toFixed(1)} kg`, String(name)]}
            contentStyle={{ borderRadius: 12, border: "1px solid #e5e5e5", fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone" dataKey="total_kg" name="Gesamt"
            stroke="#f59e0b" strokeWidth={2.5} fill="url(#gradTotal)"
            dot={data.length <= 40} activeDot={{ r: 4 }}
          />
          <Area
            type="monotone" dataKey="wellig_kg" name="Usbekisch Wellig"
            stroke="#3b82f6" strokeWidth={1.5} fill="none"
            dot={false} activeDot={{ r: 3 }}
          />
          <Area
            type="monotone" dataKey="glatt_kg" name="Russisch Glatt"
            stroke="#16a34a" strokeWidth={1.5} fill="none"
            dot={false} activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

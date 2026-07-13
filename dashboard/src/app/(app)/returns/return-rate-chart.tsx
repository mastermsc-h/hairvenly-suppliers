"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { t, type Locale } from "@/lib/i18n";

export interface MonthlyData {
  month: string; // YYYY-MM-01
  revenueExt: number;
  revenueAll: number;
  refundExt: number;
  refundAll: number;
}

type Mode = "ext" | "all";
type PresetPeriod = "all" | "12m" | "3m" | "30d";
type PeriodKey = PresetPeriod | { month: string };

const PERIOD_LABELS: Record<PresetPeriod, string> = {
  all: "Gesamter Zeitraum",
  "12m": "Letzte 12 Monate",
  "3m": "Letzte 3 Monate",
  "30d": "Letzte 30 Tage",
};

const MONTH_NAMES_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function periodRange(p: PeriodKey): { from: string; to: string } | null {
  if (typeof p === "object" && p.month) {
    const [y, m] = p.month.split("-").map(Number);
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    return { from, to };
  }
  if (p === "all") return null;
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const d = new Date(now);
  if (p === "12m") d.setMonth(d.getMonth() - 12);
  else if (p === "3m") d.setMonth(d.getMonth() - 3);
  else if (p === "30d") d.setDate(d.getDate() - 30);
  const from = d.toISOString().slice(0, 10);
  return { from, to };
}

// Cap rate at a plausible max — anomalies above this indicate a data glitch
// (e.g. huge refunds against near-zero revenue from a partial sync). Marking
// them makes the chart legible instead of scaling the axis to a spike.
const RATE_CAP_PERCENT = 100;

export default function ReturnRateChart({
  data,
  locale,
}: {
  data: MonthlyData[];
  locale: Locale;
}) {
  const [mode, setMode] = useState<Mode>("ext");
  const [period, setPeriod] = useState<PeriodKey>("all");

  const range = useMemo(() => periodRange(period), [period]);

  const chartData = useMemo(() => {
    const rows = data.map((d) => {
      const revenue = mode === "ext" ? d.revenueExt : d.revenueAll;
      const refund = mode === "ext" ? d.refundExt : d.refundAll;
      const rawRate = revenue > 0 ? (refund / revenue) * 100 : 0;
      // Anomalies clip to null so Recharts doesn't distort the axis.
      const isAnomaly = rawRate > RATE_CAP_PERCENT * 2;
      return {
        month: d.month.slice(0, 7),
        revenue: Math.round(revenue),
        refund: Math.round(refund),
        rate: isAnomaly ? null : Number(rawRate.toFixed(1)),
        anomaly: isAnomaly,
      };
    });
    if (!range) return rows;
    // Filter to months intersecting the selected range
    const fromMonth = range.from.slice(0, 7);
    const toMonth = range.to.slice(0, 7);
    return rows.filter((r) => r.month >= fromMonth && r.month <= toMonth);
  }, [data, mode, range]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const d of data) {
      const k = d.month.slice(0, 7);
      if (k) set.add(k);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [data]);

  const formatMonth = (m: string) => {
    const [y, mo] = m.split("-");
    const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    return `${months[parseInt(mo, 10) - 1]} ${y?.slice(2)}`;
  };

  const tooltipStyle = {
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    fontSize: 11,
    padding: "4px 8px",
  };

  const empty = chartData.length === 0 || chartData.every((d) => d.revenue === 0 && d.refund === 0);
  const anomalyCount = chartData.filter((d) => d.anomaly).length;
  const selectedMonth = typeof period === "object" ? period.month : "";

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-neutral-900">{t(locale, "returns.chart_rate_title")}</h3>
        <div className="inline-flex rounded-full border border-neutral-200 p-0.5 bg-neutral-50">
          <button
            type="button"
            onClick={() => setMode("ext")}
            className={`text-xs font-medium px-3 py-1 rounded-full transition ${
              mode === "ext" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Nur Extensions
          </button>
          <button
            type="button"
            onClick={() => setMode("all")}
            className={`text-xs font-medium px-3 py-1 rounded-full transition ${
              mode === "all" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Gesamt
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide mr-1">Zeitraum:</span>
        {(["all", "12m", "3m", "30d"] as PresetPeriod[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition ${
              typeof period === "string" && period === p
                ? "bg-neutral-900 text-white"
                : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
        <select
          value={selectedMonth}
          onChange={(e) => {
            const v = e.target.value;
            if (v) setPeriod({ month: v });
          }}
          className={`text-xs font-medium px-3 py-1.5 rounded-full transition border cursor-pointer ${
            selectedMonth
              ? "bg-neutral-900 text-white border-neutral-900"
              : "bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          <option value="">Monat wählen…</option>
          {availableMonths.map((m) => {
            const [y, mo] = m.split("-").map(Number);
            return (
              <option key={m} value={m}>
                {MONTH_NAMES_DE[mo - 1]} {y}
              </option>
            );
          })}
        </select>
      </div>

      {anomalyCount > 0 && (
        <p className="text-[11px] text-amber-600 mb-2">
          Hinweis: {anomalyCount} {anomalyCount === 1 ? "Monat" : "Monate"} zeigen eine unplausible Rate (&gt;{RATE_CAP_PERCENT * 2}%) und wurden ausgeblendet — vermutlich unvollständige Sync-Daten.
        </p>
      )}

      {empty ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-neutral-400">
          {t(locale, "returns.no_revenue_data")}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${v}%`}
              domain={[0, "auto"]}
              allowDataOverflow
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(label) => formatMonth(String(label))}
              formatter={(value, _name, entry) => {
                const key = entry?.dataKey;
                if (key === "rate") return [value == null ? "—" : `${value}%`, t(locale, "returns.chart_rate")];
                if (key === "revenue") return [`${Number(value).toLocaleString("de-DE")} €`, t(locale, "returns.chart_revenue")];
                return [`${Number(value).toLocaleString("de-DE")} €`, t(locale, "returns.chart_refund")];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="revenue" name={t(locale, "returns.chart_revenue")} fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="left" dataKey="refund" name={t(locale, "returns.chart_refund")} fill="#ef4444" radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name={t(locale, "returns.chart_rate")} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

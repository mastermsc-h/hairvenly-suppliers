"use client";

import { useState } from "react";
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

export default function ReturnRateChart({
  data,
  locale,
}: {
  data: MonthlyData[];
  locale: Locale;
}) {
  const [mode, setMode] = useState<Mode>("ext");

  const chartData = data.map((d) => {
    const revenue = mode === "ext" ? d.revenueExt : d.revenueAll;
    const refund = mode === "ext" ? d.refundExt : d.refundAll;
    return {
      month: d.month.slice(0, 7),
      revenue: Math.round(revenue),
      refund: Math.round(refund),
      rate: revenue > 0 ? Number(((refund / revenue) * 100).toFixed(1)) : 0,
    };
  });

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

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-neutral-900">{t(locale, "returns.chart_rate_title")}</h3>
        <div className="flex items-center gap-2">
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
          <p className="text-xs text-neutral-400 hidden md:block">{t(locale, "returns.chart_rate_subtitle")}</p>
        </div>
      </div>
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
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(label) => formatMonth(String(label))}
              formatter={(value, _name, entry) => {
                const key = entry?.dataKey;
                if (key === "rate") return [`${value}%`, t(locale, "returns.chart_rate")];
                if (key === "revenue") return [`${Number(value).toLocaleString("de-DE")} €`, t(locale, "returns.chart_revenue")];
                return [`${Number(value).toLocaleString("de-DE")} €`, t(locale, "returns.chart_refund")];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="revenue" name={t(locale, "returns.chart_revenue")} fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="left" dataKey="refund" name={t(locale, "returns.chart_refund")} fill="#ef4444" radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name={t(locale, "returns.chart_rate")} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

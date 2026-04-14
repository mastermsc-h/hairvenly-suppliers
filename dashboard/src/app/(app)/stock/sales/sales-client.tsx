"use client";

import { useState, useMemo } from "react";
import { Search, BarChart3, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { VerkaufsanalyseRow } from "@/lib/stock-sheets";
import SyncBadge from "../sync-badge";

interface Props {
  data: VerkaufsanalyseRow[];
  title: string;
  subtitle: string;
  lastUpdated?: string | null;
}

export default function SalesClient({ data, title, subtitle, lastUpdated }: Props) {
  const [query, setQuery] = useState("");
  const [qualityFilter, setQualityFilter] = useState<string>("all");

  const qualities = useMemo(() => {
    const s = new Set(data.map((d) => d.quality));
    return Array.from(s);
  }, [data]);

  const filtered = useMemo(() => {
    let result = data.filter((d) => !d.isSummary);
    if (qualityFilter !== "all") {
      result = result.filter((d) => d.quality === qualityFilter);
    }
    if (query.trim()) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((d) => {
        const combined = `${d.collection} ${d.quality}`.toLowerCase();
        return words.every((w) => combined.includes(w));
      });
    }
    return result.sort((a, b) => b.d30Kg - a.d30Kg);
  }, [data, query, qualityFilter]);

  // Summaries
  const summaryRows = data.filter((d) => d.isSummary);
  const total30dKg = filtered.reduce((s, r) => s + r.d30Kg, 0);
  const total3mKg = filtered.reduce((s, r) => s + r.avg3mKg, 0);
  const totalCurMonthEur = filtered.reduce((s, r) => s + r.curMonthEur, 0);

  // Group by quality
  const wellig = filtered.filter((d) => d.quality === "Usbekisch Wellig");
  const glatt = filtered.filter((d) => d.quality === "Russisch Glatt");

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
          <p className="text-sm text-neutral-500 mt-1">{subtitle}</p>
        </div>
        <SyncBadge lastUpdated={lastUpdated ?? null} />
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <KpiCard label="30 Tage" value={`${total30dKg.toFixed(1)} kg`} icon={<BarChart3 size={18} />} color="indigo" />
        <KpiCard label="Ø 3 Monate" value={`${total3mKg.toFixed(1)} kg`} icon={<BarChart3 size={18} />} color="emerald" />
        <KpiCard label="Akt. Monat Umsatz" value={`${Math.round(totalCurMonthEur).toLocaleString("de-DE")} €`} icon={<BarChart3 size={18} />} color="amber" />
        <KpiCard label="Kollektionen" value={filtered.length.toString()} icon={<BarChart3 size={18} />} color="rose" />
      </section>

      {/* Summary rows from sheet (if available) */}
      {summaryRows.length > 0 && (
        <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-neutral-800 text-white font-semibold text-sm">
            Zusammenfassung
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Bereich</th>
                  <th className="px-2 py-1.5 text-right font-medium">Ø 12M (kg)</th>
                  <th className="px-2 py-1.5 text-right font-medium">Ø 12M (€)</th>
                  <th className="px-2 py-1.5 text-right font-medium">Ø 3M (kg)</th>
                  <th className="px-2 py-1.5 text-right font-medium">Ø 3M (€)</th>
                  <th className="px-2 py-1.5 text-right font-medium">30T (kg)</th>
                  <th className="px-2 py-1.5 text-right font-medium">30T (€)</th>
                  <th className="px-2 py-1.5 text-right font-medium">Akt. Monat</th>
                  <th className="px-2 py-1.5 text-center font-medium">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {summaryRows.map((r, i) => (
                  <tr key={i} className="font-semibold bg-neutral-50">
                    <td className="px-2 py-1 text-neutral-900">{r.collection}</td>
                    <td className="px-2 py-1 text-right">{r.avg12mKg.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{Math.round(r.avg12mEur).toLocaleString("de-DE")} €</td>
                    <td className="px-2 py-1 text-right">{r.avg3mKg.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{Math.round(r.avg3mEur).toLocaleString("de-DE")} €</td>
                    <td className="px-2 py-1 text-right">{r.d30Kg.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">{Math.round(r.d30Eur).toLocaleString("de-DE")} €</td>
                    <td className="px-2 py-1 text-right">{Math.round(r.curMonthEur).toLocaleString("de-DE")} €</td>
                    <td className="px-2 py-1 text-center"><TrendBadge trend={r.trend} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kollektion suchen..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          <FilterBtn active={qualityFilter === "all"} onClick={() => setQualityFilter("all")}>Alle</FilterBtn>
          {qualities.map((q) => (
            <FilterBtn key={q} active={qualityFilter === q} onClick={() => setQualityFilter(q)}>{q}</FilterBtn>
          ))}
        </div>
      </div>

      {/* Detail tables */}
      {(qualityFilter === "all" || qualityFilter === "Usbekisch Wellig") && wellig.length > 0 && (
        <SalesTable rows={wellig} title="Usbekisch Wellig" headerBg="bg-blue-600" />
      )}
      {(qualityFilter === "all" || qualityFilter === "Russisch Glatt") && glatt.length > 0 && (
        <SalesTable rows={glatt} title="Russisch Glatt" headerBg="bg-green-700" />
      )}

      {filtered.length === 0 && (
        <div className="text-center py-12 text-neutral-400">Keine Verkaufsdaten gefunden</div>
      )}
    </div>
  );
}

function SalesTable({ rows, title, headerBg }: { rows: VerkaufsanalyseRow[]; title: string; headerBg: string }) {
  const total30 = rows.reduce((s, r) => s + r.d30Kg, 0);
  return (
    <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className={`${headerBg} text-white px-4 py-3 font-semibold text-sm flex items-center justify-between`}>
        <span>{title} <span className="font-normal opacity-80">({rows.length} Kollektionen)</span></span>
        <span className="font-normal text-sm opacity-80">{total30.toFixed(1)} kg / 30T</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50/60 text-left text-[10px] uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-1.5 font-medium">Kollektion</th>
              <th className="px-2 py-1.5 font-medium text-center">g/Stk</th>
              <th className="px-2 py-1.5 font-medium text-right">Ø 12M (kg)</th>
              <th className="px-2 py-1.5 font-medium text-right">Ø 12M (€)</th>
              <th className="px-2 py-1.5 font-medium text-right">Ø 3M (kg)</th>
              <th className="px-2 py-1.5 font-medium text-right">Ø 3M (€)</th>
              <th className="px-2 py-1.5 font-medium text-right">30T (kg)</th>
              <th className="px-2 py-1.5 font-medium text-right">30T (€)</th>
              <th className="px-2 py-1.5 font-medium text-right">Akt. M (kg)</th>
              <th className="px-2 py-1.5 font-medium text-right">Akt. M (€)</th>
              <th className="px-2 py-1.5 font-medium text-center">Trend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-neutral-50 transition">
                <td className="px-2 py-1 font-medium text-neutral-900">{row.collection}</td>
                <td className="px-2 py-1 text-center text-neutral-500">{row.gPerUnit || "–"}</td>
                <td className="px-2 py-1 text-right text-neutral-700">{row.avg12mKg > 0 ? row.avg12mKg.toFixed(2) : "–"}</td>
                <td className="px-2 py-1 text-right text-neutral-600">{row.avg12mEur > 0 ? `${Math.round(row.avg12mEur).toLocaleString("de-DE")} €` : "–"}</td>
                <td className="px-2 py-1 text-right text-neutral-700">{row.avg3mKg > 0 ? row.avg3mKg.toFixed(2) : "–"}</td>
                <td className="px-2 py-1 text-right text-neutral-600">{row.avg3mEur > 0 ? `${Math.round(row.avg3mEur).toLocaleString("de-DE")} €` : "–"}</td>
                <td className="px-2 py-1 text-right font-medium text-neutral-900">{row.d30Kg > 0 ? row.d30Kg.toFixed(2) : "–"}</td>
                <td className="px-2 py-1 text-right text-neutral-600">{row.d30Eur > 0 ? `${Math.round(row.d30Eur).toLocaleString("de-DE")} €` : "–"}</td>
                <td className="px-2 py-1 text-right text-neutral-700">{row.curMonthKg > 0 ? row.curMonthKg.toFixed(2) : "–"}</td>
                <td className="px-2 py-1 text-right text-neutral-600">{row.curMonthEur > 0 ? `${Math.round(row.curMonthEur).toLocaleString("de-DE")} €` : "–"}</td>
                <td className="px-2 py-1 text-center"><TrendBadge trend={row.trend} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrendBadge({ trend }: { trend: string }) {
  if (!trend) return <span className="text-neutral-300">–</span>;
  const isUp = trend.includes("↑") || trend.includes("+");
  const isDown = trend.includes("↓");
  const color = isUp ? "text-green-600" : isDown ? "text-red-600" : "text-neutral-500";
  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon size={12} />
      {trend.replace(/[↑↓→]/g, "").trim()}
    </span>
  );
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
        active ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

function KpiCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: "indigo" | "emerald" | "amber" | "rose" }) {
  const colors = { indigo: "bg-indigo-50 text-indigo-600", emerald: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", rose: "bg-rose-50 text-rose-600" };
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-neutral-900">{value}</div>
    </div>
  );
}

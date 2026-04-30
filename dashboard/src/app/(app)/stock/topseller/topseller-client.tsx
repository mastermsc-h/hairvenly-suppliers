"use client";

import { useState } from "react";
import { Search, TrendingUp, TrendingDown, ArrowUp, ArrowDown } from "lucide-react";
import type { TopsSellerSection, TopsSellerItem } from "@/lib/stock-sheets";
import SyncBadge from "../sync-badge";

const TIER_COLORS: Record<string, string> = {
  TOP7: "bg-yellow-50 border-yellow-200",
  MID: "bg-blue-50 border-blue-200",
  REST: "bg-white border-neutral-200",
  KAUM: "bg-neutral-50 border-neutral-200 opacity-60",
};

const TIER_BADGE: Record<string, string> = {
  TOP7: "bg-yellow-100 text-yellow-800",
  MID: "bg-blue-100 text-blue-800",
  REST: "bg-neutral-100 text-neutral-600",
  KAUM: "bg-neutral-100 text-neutral-400",
};

const QUALITY_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  "Usbekisch Wellig": { bg: "bg-blue-600", text: "text-white", accent: "text-blue-600" },
  "Russisch Glatt": { bg: "bg-green-700", text: "text-white", accent: "text-green-700" },
};

interface Props {
  sections: TopsSellerSection[];
  title: string;
  subtitle: string;
  lastUpdated?: string | null;
}

type StockFilter = "all" | "zero_no_order" | "zero" | "low";
type SortBy = "rang" | "verkauftG" | "verkauft30d" | "lagerG" | "unterwegsG";
type SortDir = "asc" | "desc";
const ALL_TIERS = ["TOP7", "MID", "REST", "KAUM"] as const;

const SORT_OPTIONS: { key: SortBy; label: string }[] = [
  { key: "rang", label: "Rang" },
  { key: "verkauft30d", label: "30T" },
  { key: "verkauftG", label: "90T" },
  { key: "lagerG", label: "Lager" },
  { key: "unterwegsG", label: "Unterwegs" },
];

export default function TopsellerClient({ sections, title, subtitle, lastUpdated }: Props) {
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [activeTiers, setActiveTiers] = useState<Set<string>>(new Set(ALL_TIERS));
  const [sortBy, setSortBy] = useState<SortBy>("rang");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onSortClick = (key: SortBy) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      // Default immer desc = "beste oben":
      // - Rang desc = Sheet-Reihenfolge (Rang 1 oben)
      // - Zahlen desc = größte zuerst
      setSortDir("desc");
    }
  };

  const toggleTier = (tier: string) => {
    setActiveTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };
  const allTiersActive = activeTiers.size === ALL_TIERS.length;

  const totalG30 = sections.reduce((s, sec) => s + sec.totalGrams30, 0);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
          <p className="text-sm text-neutral-500 mt-1">{subtitle}</p>
        </div>
        <SyncBadge lastUpdated={lastUpdated ?? null} />
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {sections.map((sec) => {
          const colors = QUALITY_COLORS[sec.quality] ?? QUALITY_COLORS["Russisch Glatt"];
          return (
            <div key={sec.quality} className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
              <div className="text-xs text-neutral-500 uppercase tracking-wide">{sec.quality}</div>
              <div className={`mt-1 text-2xl font-semibold ${colors.accent}`}>
                {(sec.totalGrams30 / 1000).toFixed(1)} kg
              </div>
              <div className="text-xs text-neutral-400 mt-0.5">Verkauf letzte 30 Tage</div>
            </div>
          );
        })}
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <div className="text-xs text-neutral-500 uppercase tracking-wide">Gesamt 30T</div>
          <div className="mt-1 text-2xl font-semibold text-neutral-900">
            {(totalG30 / 1000).toFixed(1)} kg
          </div>
          <div className="text-xs text-neutral-400 mt-0.5">Budget-Bedarf ~{(totalG30 / 2 / 1000).toFixed(1)} kg / 2 Wochen</div>
        </div>
      </section>

      {/* Search + Filters */}
      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Farbe oder Produkt suchen..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] uppercase text-neutral-400 font-medium self-center mr-1">Bestand:</span>
            {([
              { key: "all" as StockFilter, label: "Alle" },
              { key: "zero_no_order" as StockFilter, label: "Null + nicht bestellt" },
              { key: "zero" as StockFilter, label: "Nullbestand" },
              { key: "low" as StockFilter, label: "< 300g" },
            ]).map((f) => (
              <button
                key={f.key}
                onClick={() => setStockFilter(f.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  stockFilter === f.key
                    ? f.key === "zero_no_order" ? "bg-red-600 text-white" : "bg-neutral-900 text-white"
                    : f.key === "zero_no_order" ? "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] uppercase text-neutral-400 font-medium self-center mr-1">Tier:</span>
            <button
              onClick={() => setActiveTiers(allTiersActive ? new Set() : new Set(ALL_TIERS))}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                allTiersActive ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              Alle
            </button>
            {ALL_TIERS.map((tier) => {
              const active = activeTiers.has(tier);
              const tierColor = active
                ? tier === "TOP7" ? "bg-yellow-500 text-white" : tier === "MID" ? "bg-blue-500 text-white" : tier === "REST" ? "bg-neutral-700 text-white" : "bg-neutral-400 text-white"
                : tier === "TOP7" ? "bg-yellow-50 text-yellow-700 border border-yellow-200" : tier === "MID" ? "bg-blue-50 text-blue-700 border border-blue-200" : tier === "REST" ? "bg-neutral-100 text-neutral-600 border border-neutral-200" : "bg-neutral-50 text-neutral-400 border border-neutral-200";
              return (
                <button
                  key={tier}
                  onClick={() => toggleTier(tier)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${tierColor}`}
                >
                  {tier}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] uppercase text-neutral-400 font-medium self-center mr-1">Sortieren:</span>
            {SORT_OPTIONS.map((opt) => {
              const isActive = sortBy === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => onSortClick(opt.key)}
                  title={isActive ? `Richtung umschalten (aktuell ${sortDir === "desc" ? "absteigend" : "aufsteigend"})` : "Sortieren"}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition inline-flex items-center gap-1 ${
                    isActive ? "bg-indigo-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {opt.label}
                  {isActive && (sortDir === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                </button>
              );
            })}
          </div>
        </div>
        {(stockFilter !== "all" || !allTiersActive || sortBy !== "rang" || sortDir !== "desc") && (
          <div className="text-xs text-neutral-500">
            Filter aktiv
            <button onClick={() => { setStockFilter("all"); setActiveTiers(new Set(ALL_TIERS)); setSortBy("rang"); setSortDir("desc"); }} className="ml-2 text-indigo-600 hover:text-indigo-800 font-medium">Zurücksetzen</button>
          </div>
        )}
      </div>

      {/* Topseller Tables */}
      {sections.map((sec) => (
        <TopsellerSectionView key={sec.quality} section={sec} query={query} stockFilter={stockFilter} activeTiers={activeTiers} sortBy={sortBy} sortDir={sortDir} />
      ))}
    </div>
  );
}

function TopsellerSectionView({ section, query, stockFilter, activeTiers, sortBy, sortDir }: { section: TopsSellerSection; query: string; stockFilter: StockFilter; activeTiers: Set<string>; sortBy: SortBy; sortDir: SortDir }) {
  const colors = QUALITY_COLORS[section.quality] ?? QUALITY_COLORS["Russisch Glatt"];
  const q = query.toLowerCase();
  const orderHeaders = section.orderHeaders;
  const allTiersActive = activeTiers.size === ALL_TIERS.length;

  return (
    <section className="space-y-3">
      <div className={`${colors.bg} ${colors.text} px-4 py-3 rounded-xl font-semibold text-sm`}>
        {section.quality} — Topseller
        <span className="ml-2 font-normal opacity-80">
          ({(section.totalGrams / 1000).toFixed(1)} kg gesamt, {(section.totalGrams30 / 1000).toFixed(1)} kg 30T)
        </span>
      </div>

      {section.sections.map((group) => {
        const words = q ? q.split(/\s+/).filter(Boolean) : [];
        let filtered = group.items;
        // Text search
        if (words.length > 0) {
          filtered = filtered.filter((i) => {
            const combined = `${i.farbe} ${i.laenge} ${group.label}`.toLowerCase();
            return words.every((w) => combined.includes(w));
          });
        }
        // Stock filter
        if (stockFilter === "zero_no_order") filtered = filtered.filter((i) => i.lagerG === 0 && i.unterwegsG === 0);
        else if (stockFilter === "zero") filtered = filtered.filter((i) => i.lagerG === 0);
        else if (stockFilter === "low") filtered = filtered.filter((i) => i.lagerG > 0 && i.lagerG < 300);
        // Tier filter
        if (!allTiersActive) filtered = filtered.filter((i) => activeTiers.has(i.tier));

        // Sort
        if (sortBy === "rang") {
          // desc = natürliche Sheet-Reihenfolge (Rang 1 = bester Seller oben)
          if (sortDir === "asc") filtered = [...filtered].reverse();
        } else {
          filtered = [...filtered].sort((a, b) => {
            const va = (a[sortBy] as number) ?? 0;
            const vb = (b[sortBy] as number) ?? 0;
            return sortDir === "desc" ? vb - va : va - vb;
          });
        }

        if (filtered.length === 0 && (q || stockFilter !== "all" || !allTiersActive)) return null;

        const progLabel = `${section.forecastDays}T Verbr.`;

        // Sums — only 30T and Lager
        const sum30 = filtered.reduce((s, i) => s + (i.verkauft30d || 0), 0);
        const sumLager = filtered.reduce((s, i) => s + (i.lagerG || 0), 0);

        return (
          <div key={group.label} className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-100 font-medium text-sm text-neutral-700">
              {group.label}
              <span className="ml-2 text-neutral-400 font-normal">({filtered.length} Produkte)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50/60 text-left text-[10px] uppercase text-neutral-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium w-8">#</th>
                    <th className="px-2 py-1.5 font-medium">Farbe</th>
                    <th className="px-2 py-1.5 font-medium">Länge</th>
                    <th className="px-2 py-1.5 font-medium text-right">90T</th>
                    <th className="px-2 py-1.5 font-medium text-right">30T</th>
                    <th className="px-2 py-1.5 font-medium text-right">Stk</th>
                    <th className="px-2 py-1.5 font-medium text-right">{progLabel}</th>
                    <th className="px-2 py-1.5 font-medium text-center">Tier</th>
                    <th className="px-2 py-1.5 font-medium text-right">Ziel</th>
                    <th className="px-2 py-1.5 font-medium text-right">Lager</th>
                    <th className="px-2 py-1.5 font-medium text-right">Unterwegs</th>
                    {orderHeaders.length > 0 && (
                      <>
                        <th className="w-px bg-neutral-300" />
                        {orderHeaders.map((h, i) => {
                          const lines = h.split("\n");
                          return (
                            <th key={i} className="px-1.5 py-1.5 font-medium text-right text-[9px] whitespace-nowrap bg-neutral-100">
                              <div>{lines[0]}</div>
                              {lines[1] && <div className="font-normal text-neutral-400">{lines[1]}</div>}
                            </th>
                          );
                        })}
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map((item, i) => (
                    <TopsellerRow key={i} item={item} orderCount={orderHeaders.length} />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-neutral-100 font-semibold text-neutral-800 border-t-2 border-neutral-300 text-[11px]">
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5" colSpan={2}>Summe</td>
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5 text-right">{sum30.toLocaleString("de-DE")}</td>
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5 text-right">{sumLager.toLocaleString("de-DE")}</td>
                    <td className="px-2 py-1.5" />
                    {orderHeaders.length > 0 && (
                      <>
                        <td className="w-px bg-neutral-200" />
                        {orderHeaders.map((_, i) => (
                          <td key={i} className="px-1.5 py-1.5" />
                        ))}
                      </>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function TopsellerRow({ item, orderCount }: { item: TopsSellerItem; orderCount: number }) {
  const tierBg = TIER_COLORS[item.tier] ?? TIER_COLORS.REST;
  const tierBadge = TIER_BADGE[item.tier] ?? TIER_BADGE.REST;
  const lagerColor = item.lagerG === 0 ? "text-red-600 font-semibold" : item.lagerG < 300 ? "text-orange-600 font-medium" : item.lagerG < 600 ? "text-amber-600" : "text-neutral-900";
  const isGrowing = item.verkauft30d * 3 > item.verkauftG;

  // Extract just the color code from the full product name
  const shortFarbe = (() => {
    const f = item.farbe;
    // If starts with #, extract code before descriptive words
    if (f.startsWith("#")) {
      // Find first space after the color code part
      const parts = f.split(" ");
      // Take code tokens (e.g. "#2E", "#4/27T24", "#PEARL WHITE") — stop at method words
      const stopWords = ["STANDARD", "RUSSISCH", "US", "WELLIGE", "TAPE", "BONDING", "MINI", "INVISIBLE", "CLASSIC", "GENIUS", "TRESSEN", "WEFT", "CLIP", "EXTENSIONS", "KERATIN", "GLATT"];
      let result = parts[0];
      for (let i = 1; i < parts.length; i++) {
        if (stopWords.includes(parts[i].toUpperCase().replace(/[♡,]/g, ""))) break;
        result += " " + parts[i];
      }
      return result;
    }
    return f;
  })();

  return (
    <tr className={`${tierBg} hover:bg-indigo-100 hover:shadow-[inset_3px_0_0_0_rgb(79_70_229)] transition`}>
      <td className="px-2 py-1 text-neutral-400 font-mono text-[10px]">{item.rang}</td>
      <td className="px-2 py-1 font-medium text-neutral-900 max-w-[140px] truncate" title={item.farbe}>{shortFarbe}</td>
      <td className="px-2 py-1 text-neutral-500">{item.laenge || "–"}</td>
      <td className="px-2 py-1 text-right text-neutral-700">{item.verkauftG || "–"}</td>
      <td className="px-2 py-1 text-right">
        <span className="inline-flex items-center gap-0.5">
          {item.verkauft30d || "–"}
          {item.verkauft30d > 0 && (
            isGrowing
              ? <TrendingUp size={10} className="text-green-500" />
              : <TrendingDown size={10} className="text-red-400" />
          )}
        </span>
      </td>
      <td className="px-2 py-1 text-right text-neutral-500">{item.verkauftStk || "–"}</td>
      <td className="px-2 py-1 text-right text-neutral-600">{item.prognose || "–"}</td>
      <td className="px-2 py-1 text-center">
        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${tierBadge}`}>
          {item.tier}
        </span>
      </td>
      <td className="px-2 py-1 text-right text-neutral-600">{item.ziel || "–"}</td>
      <td className={`px-2 py-1 text-right ${lagerColor}`}>{item.lagerG}</td>
      <td className="px-2 py-1 text-right">
        {item.unterwegsG > 0 ? (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-cyan-50 text-cyan-700">
            {item.unterwegsG}
          </span>
        ) : (
          <span className="text-neutral-300">–</span>
        )}
      </td>
      {orderCount > 0 && (
        <>
          <td className="w-px bg-neutral-200" />
          {item.perOrder.map((g, i) => (
            <td key={i} className="px-1.5 py-1 text-right text-[10px]">
              {g > 0 ? (
                <span className="font-medium text-indigo-700">{g}</span>
              ) : (
                <span className="text-neutral-200">–</span>
              )}
            </td>
          ))}
          {/* Fill empty cells if perOrder is shorter than orderCount */}
          {Array.from({ length: Math.max(0, orderCount - item.perOrder.length) }).map((_, i) => (
            <td key={`empty-${i}`} className="px-1.5 py-1 text-right text-[10px] text-neutral-200">–</td>
          ))}
        </>
      )}
    </tr>
  );
}

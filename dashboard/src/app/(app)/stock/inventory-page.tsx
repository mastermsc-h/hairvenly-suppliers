"use client";

import { Package, AlertTriangle, Scale } from "lucide-react";
import StockSearch from "./stock-search";
import StockTable, { slugify } from "./stock-table";
import SyncBadge from "./sync-badge";
import type { InventoryRow } from "@/lib/stock-sheets";

interface TransitInfo {
  label: string;
  eta: string | null;
  quantity: number;
}

export interface InventoryWithTransit extends InventoryRow {
  transitOrders: TransitInfo[];
  transitTotal: number;
}

interface InventoryPageClientProps {
  data: InventoryWithTransit[];
  title: string;
  subtitle: string;
  locale: string;
  lastUpdated?: string | null;
}

export default function InventoryPageClient({ data, title, subtitle, lastUpdated }: InventoryPageClientProps) {
  const totalKg = data.reduce((s, r) => s + r.totalWeight, 0) / 1000;
  const totalProducts = data.length;
  const zeroCount = data.filter((r) => r.quantity === 0).length;

  // Build category list for quick-jump nav: { name, slug, count, kg }
  const categories = (() => {
    const map = new Map<string, { rows: InventoryWithTransit[] }>();
    for (const row of data) {
      const key = row.collection;
      if (!map.has(key)) map.set(key, { rows: [] });
      map.get(key)!.rows.push(row);
    }
    return Array.from(map.entries()).map(([name, g]) => ({
      name,
      slug: slugify(name),
      count: g.rows.length,
      kg: g.rows.reduce((s, r) => s + r.totalWeight, 0) / 1000,
    }));
  })();

  const scrollToCat = (slug: string) => {
    if (typeof window === "undefined") return;
    const el = document.getElementById(`cat-${slug}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
          <p className="text-sm text-neutral-500 mt-1">{subtitle}</p>
        </div>
        <SyncBadge lastUpdated={lastUpdated ?? null} />
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Gesamt" value={`${totalKg.toFixed(2)} kg`} icon={<Scale size={18} />} color="indigo" />
        <KpiCard label="Produkte" value={totalProducts.toString()} icon={<Package size={18} />} color="emerald" />
        <KpiCard label="Nullbestand" value={zeroCount.toString()} icon={<AlertTriangle size={18} />} color="rose" />
      </section>

      {/* Category quick-nav */}
      {categories.length > 1 && (
        <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-3">
          <div className="text-[10px] uppercase text-neutral-400 font-medium mb-2 px-1">Kategorien</div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.slug}
                onClick={() => scrollToCat(c.slug)}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition inline-flex items-center gap-1.5"
                title={`Zu ${c.name} springen`}
              >
                <span>{c.name}</span>
                <span className="text-indigo-400 font-normal">({c.count}) · {c.kg.toFixed(1)} kg</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-100">
          <StockSearch
            data={data}
            searchFields={["product", "collection"] as (keyof InventoryWithTransit)[]}
            placeholder="Produkt suchen..."
          >
            {(filtered) => (
              <div className="mt-3">
                <div className="text-xs text-neutral-400 mb-2">{filtered.length} Ergebnisse</div>
                <StockTable
                  data={filtered}
                  groupBy={"collection" as keyof InventoryWithTransit}
                  columns={[
                    { key: "product" as keyof InventoryWithTransit, label: "Produkt" },
                    { key: "unitWeight" as keyof InventoryWithTransit, label: "g/Stk", align: "right" },
                    { key: "quantity" as keyof InventoryWithTransit, label: "Menge", align: "right" },
                    {
                      key: "totalWeight" as keyof InventoryWithTransit,
                      label: "Gesamt (g)",
                      align: "right",
                      render: (val) => {
                        const v = Number(val);
                        const color = v === 0 ? "text-red-600 font-semibold" : v < 300 ? "text-orange-600 font-medium" : v < 600 ? "text-amber-600" : "text-neutral-900";
                        return <span className={color}>{v}</span>;
                      },
                    },
                    {
                      key: "transitTotal" as keyof InventoryWithTransit,
                      label: "Unterwegs (g)",
                      align: "right",
                      render: (val, row) => {
                        const total = Number(val);
                        const r = row as InventoryWithTransit;
                        if (total === 0) return <span className="text-neutral-300">–</span>;
                        return (
                          <div className="group relative">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700">
                              {total}g
                            </span>
                            <div className="hidden group-hover:block absolute z-20 right-0 top-full mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 min-w-[220px]">
                              <div className="text-xs font-medium text-neutral-500 mb-1.5">Bestellungen unterwegs</div>
                              {r.transitOrders.map((o, i) => (
                                <div key={i} className="flex justify-between text-xs py-0.5">
                                  <span className="text-neutral-700">{o.label}</span>
                                  <span className="font-medium">{o.quantity}g {o.eta ? `· ${o.eta}` : ""}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      },
                    },
                  ]}
                  rowClassName={(row) => {
                    const r = row as InventoryWithTransit;
                    return r.quantity === 0 ? "bg-red-50/30" : r.totalWeight < 300 ? "bg-orange-50/20" : "";
                  }}
                />
              </div>
            )}
          </StockSearch>
        </div>
      </section>
    </div>
  );
}

function KpiCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: "indigo" | "rose" | "emerald" | "amber" }) {
  const colors = {
    indigo: "bg-indigo-50 text-indigo-600",
    rose: "bg-rose-50 text-rose-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
  };
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

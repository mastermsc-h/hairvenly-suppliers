"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Skull, TrendingDown, PackageX, Truck, Info } from "lucide-react";
import type { ClientOrderMeta } from "@/lib/order-name-map";
import type { DeadStockItem, RecentlyAvailableItem } from "@/lib/stock-deadstock";
import SyncBadge from "../sync-badge";

type Kind = "all" | "tot" | "fasttot" | "ordered";
const MONTH_OPTIONS = [12, 18, 24] as const;

interface Props {
  items: DeadStockItem[];
  recentlyAvailable: RecentlyAvailableItem[];
  tooNew: { count: number; kg: number };
  noData: { count: number; kg: number };
  totalLagerKg: number;
  lastUpdated: string | null;
  orderIdByName: Record<string, ClientOrderMeta>;
}

const kg = (g: number) => (g / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function DeadStockClient({ items, recentlyAvailable, tooNew, noData, totalLagerKg, lastUpdated, orderIdByName }: Props) {
  const [minMonths, setMinMonths] = useState<(typeof MONTH_OPTIONS)[number]>(24);
  const [kind, setKind] = useState<Kind>("all");
  const [collection, setCollection] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Grundmenge nach Monats-Grenze: "tot" immer, "fast tot" nur über der Grenze
  const base = useMemo(
    () => items.filter((d) => d.deadKind === "tot" || (d.monthsCover ?? 0) > minMonths),
    [items, minMonths],
  );

  const sum = (arr: DeadStockItem[]) => arr.reduce((s, d) => s + d.lagerG, 0);
  const tot = base.filter((d) => d.deadKind === "tot");
  const fast = base.filter((d) => d.deadKind === "fasttot");
  const ordered = base.filter((d) => d.unterwegsG > 0);

  const matchKind = (d: DeadStockItem) =>
    kind === "all" ? true : kind === "ordered" ? d.unterwegsG > 0 : d.deadKind === kind;

  const byCollection = useMemo(() => {
    const m = new Map<string, { sheetKey: "wellig" | "glatt"; count: number; g: number }>();
    for (const d of base.filter(matchKind)) {
      const e = m.get(d.collection) ?? { sheetKey: d.sheetKey, count: 0, g: 0 };
      e.count++;
      e.g += d.lagerG;
      m.set(d.collection, e);
    }
    return [...m.entries()].sort((a, b) => b[1].g - a[1].g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, kind]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = base.filter((d) => {
    if (!matchKind(d)) return false;
    if (collection && d.collection !== collection) return false;
    if (words.length) {
      const hay = `${d.product} ${d.collection}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const wellig = filtered.filter((d) => d.sheetKey === "wellig");
  const glatt = filtered.filter((d) => d.sheetKey === "glatt");
  const baseKg = sum(base) / 1000;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Ladenhüter &amp; Sale-Kandidaten</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Produkte mit Lager, die in den letzten 90 Tagen (fast) nichts verkauft haben, obwohl sie lieferbar waren
          </p>
        </div>
        <SyncBadge lastUpdated={lastUpdated} />
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Gesamt"
          value={`${kg(sum(base))} kg`}
          sub={`${base.length} Produkte · ${totalLagerKg > 0 ? Math.round((baseKg / totalLagerKg) * 100) : 0}% vom Lager`}
          icon={<PackageX size={16} />}
          tone="neutral"
        />
        <Kpi
          label="Tot"
          value={`${kg(sum(tot))} kg`}
          sub={`${tot.length} Produkte · 0 g trotz Lieferbarkeit`}
          icon={<Skull size={16} />}
          tone="red"
        />
        <Kpi
          label="Fast tot"
          value={`${kg(sum(fast))} kg`}
          sub={`${fast.length} Produkte · Lager reicht > ${minMonths} Monate`}
          icon={<TrendingDown size={16} />}
          tone="amber"
        />
        <Kpi
          label="Trotzdem bestellt"
          value={`${kg(ordered.reduce((s, d) => s + d.unterwegsG, 0))} kg`}
          sub={`${ordered.length} Produkte mit Ware unterwegs`}
          icon={<Truck size={16} />}
          tone="violet"
        />
      </section>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Produkt suchen..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ["all", "Alle", base.length],
            ["tot", "Tot", tot.length],
            ["fasttot", "Fast tot", fast.length],
            ["ordered", "Trotzdem bestellt", ordered.length],
          ] as const).map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                kind === k ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
            >
              {label} <span className="text-xs opacity-60">({n})</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span title="'Fast tot' = Lager reicht beim Verkaufstempo der lieferbaren Tage länger als …">Fast tot ab</span>
          {MONTH_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => setMinMonths(m)}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                minMonths === m ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
              }`}
            >
              {m} Mon.
            </button>
          ))}
        </div>
      </div>

      {/* kg pro Kollektion */}
      <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-medium text-neutral-600 uppercase tracking-wide">kg pro Kollektion</h2>
          {collection && (
            <button onClick={() => setCollection(null)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
              Alle Kollektionen zeigen
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {byCollection.map(([name, e]) => (
            <button
              key={name}
              onClick={() => setCollection(collection === name ? null : name)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition border ${
                collection === name
                  ? e.sheetKey === "wellig" ? "bg-blue-600 text-white border-blue-600" : "bg-green-700 text-white border-green-700"
                  : e.sheetKey === "wellig" ? "bg-blue-50 text-blue-800 border-blue-100 hover:bg-blue-100" : "bg-green-50 text-green-800 border-green-100 hover:bg-green-100"
              }`}
            >
              {name} <span className="opacity-70">· {kg(e.g)} kg · {e.count}</span>
            </button>
          ))}
        </div>
      </section>

      {wellig.length > 0 && <DeadSection label="Usbekisch Wellig" accent="blue" items={wellig} orderIdByName={orderIdByName} />}
      {glatt.length > 0 && <DeadSection label="Russisch Glatt" accent="green" items={glatt} orderIdByName={orderIdByName} />}
      {filtered.length === 0 && <div className="text-center py-12 text-neutral-400">Keine Produkte für diese Auswahl</div>}

      {recentlyAvailable.length > 0 && (
        <details className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <summary className="px-4 py-2.5 text-sm font-medium text-neutral-700 cursor-pointer select-none">
            Nicht bewertet: {recentlyAvailable.length} Produkte ({kg(recentlyAvailable.reduce((s, d) => s + d.lagerG, 0))} kg) waren
            weniger als 60 von 90 Tagen lieferbar — z.B. ausverkauft und gerade wieder eingetroffen
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50/60 text-left text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Kollektion</th>
                  <th className="px-2 py-1.5 font-medium">Produkt</th>
                  <th className="px-2 py-1.5 font-medium text-right">Lager</th>
                  <th className="px-2 py-1.5 font-medium text-right">Lieferbar</th>
                  <th className="px-2 py-1.5 font-medium text-right">Verkauft 90T</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {recentlyAvailable
                  .filter((d) => !collection || d.collection === collection)
                  .map((d, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1 text-neutral-500 whitespace-nowrap">{d.collection}</td>
                      <td className="px-2 py-1 text-neutral-900 max-w-[320px] truncate" title={d.product}>{d.product}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">{d.lagerG.toLocaleString("de-DE")} g</td>
                      <td className="px-2 py-1 text-right text-neutral-600 whitespace-nowrap">{d.availDays} / 90 T</td>
                      <td className="px-2 py-1 text-right text-neutral-600 whitespace-nowrap">{d.sold90G.toLocaleString("de-DE")} g</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="flex items-start gap-2 text-xs text-neutral-500">
        <Info size={14} className="shrink-0 mt-0.5" />
        <div>
          Bewertet werden nur Tage, an denen das Produkt lieferbar war (mind. 150 g, Clip-ins 1 Stück) — rekonstruiert aus
          aktuellem Bestand, Shopify-Tagesverkäufen und eingelagerten Bestellungen. Zusätzlich nicht bewertet:{" "}
          <strong>{tooNew.count}</strong> neue Produkte (in Shopify jünger als 90 Tage, {tooNew.kg.toFixed(1)} kg)
          {noData.count > 0 && (
            <>
              {" "}und <strong>{noData.count}</strong> Produkte ohne Verkaufsdaten ({noData.kg.toFixed(1)} kg)
            </>
          )}
          .
        </div>
      </div>
    </div>
  );
}

function DeadSection({ label, accent, items, orderIdByName }: {
  label: string;
  accent: "blue" | "green";
  items: DeadStockItem[];
  orderIdByName: Record<string, ClientOrderMeta>;
}) {
  const totalG = items.reduce((s, d) => s + d.lagerG, 0);
  return (
    <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className={`${accent === "blue" ? "bg-blue-600" : "bg-green-700"} text-white px-4 py-2.5 font-semibold text-sm flex justify-between`}>
        <span>
          {label}
          <span className="ml-2 font-normal opacity-80">({items.length} Produkte)</span>
        </span>
        <span>{kg(totalG)} kg</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50/60 text-left text-[10px] uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-1.5 font-medium">Kollektion</th>
              <th className="px-2 py-1.5 font-medium">Produkt</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
              <th className="px-2 py-1.5 font-medium text-right">Lager</th>
              <th className="px-2 py-1.5 font-medium text-right" title="Verkauft in den letzten 90 Tagen (Shopify-Bestellungen)">90T</th>
              <th className="px-2 py-1.5 font-medium text-right" title="An so vielen der letzten 90 Tage war das Produkt lieferbar">Lieferbar</th>
              <th className="px-2 py-1.5 font-medium text-right" title="So lange reicht das Lager beim Verkaufstempo der lieferbaren Tage">Reicht</th>
              <th className="px-2 py-1.5 font-medium">Unterwegs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {items.map((d, i) => (
              <tr key={i} className="hover:bg-indigo-50 transition">
                <td className="px-2 py-1 text-neutral-500 whitespace-nowrap">{d.collection}</td>
                <td className="px-2 py-1 font-medium text-neutral-900 max-w-[320px] truncate" title={d.product}>{d.product}</td>
                <td className="px-2 py-1">
                  {d.deadKind === "tot" ? (
                    <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">Tot</span>
                  ) : (
                    <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">Fast tot</span>
                  )}
                </td>
                <td className="px-2 py-1 text-right font-semibold text-neutral-900 whitespace-nowrap">{d.lagerG.toLocaleString("de-DE")} g</td>
                <td className={`px-2 py-1 text-right ${d.sold90G ? "text-neutral-600" : "text-red-400 font-medium"}`}>{d.sold90G.toLocaleString("de-DE")} g</td>
                <td className="px-2 py-1 text-right text-neutral-600 whitespace-nowrap">{d.availDays} / 90 T</td>
                <td className="px-2 py-1 text-right text-neutral-600 whitespace-nowrap">
                  {d.monthsCover === null ? "∞" : d.monthsCover >= 120 ? "> 10 J." : `${Math.round(d.monthsCover)} Mon.`}
                </td>
                <td className="px-2 py-1">
                  {d.unterwegsG > 0 ? (
                    <div className="flex flex-wrap gap-0.5">
                      {d.perOrder.map((o, j) => {
                        const meta = orderIdByName[o.name];
                        const chip = (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-800" title={`Ladenhüter, aber bestellt: ${o.name} ${o.ankunft}`}>
                            ⚠ {o.menge} g · {o.name}
                          </span>
                        );
                        return meta?.id ? <Link key={j} href={`/orders/${meta.id}`}>{chip}</Link> : <span key={j}>{chip}</span>;
                      })}
                    </div>
                  ) : (
                    <span className="text-neutral-300">–</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, icon, tone }: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  tone: "neutral" | "red" | "amber" | "violet";
}) {
  const t = {
    neutral: "bg-neutral-100 text-neutral-700",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
    violet: "bg-violet-50 text-violet-600",
  }[tone];
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${t}`}>{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-neutral-900">{value}</div>
      <div className="text-[11px] text-neutral-500 mt-0.5">{sub}</div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Boxes, AlertTriangle, Printer, Search, X, RotateCcw } from "lucide-react";
import PrintLabels from "../print-labels";
import { recordPrintedLabels } from "@/lib/actions/printed-labels";
import type { AccessoryGroup, AccessoryVariant } from "@/lib/shopify";

interface Props {
  groups: AccessoryGroup[];
  printedSummary: Record<string, { totalPrinted: number; lastPrintedAt: string | null }>;
  singleCollection?: boolean;
}

const MAX_QTY_PER_ROW = 1000;
const MAX_TOTAL_LABELS = 1000;

function rowKey(g: AccessoryGroup, v: AccessoryVariant, idx: number): string {
  return `${g.slug}|${v.barcode ?? "nobc"}|${idx}`;
}

/** Label-Titel: Produkt + Variante (z.B. "Farbmuster Teststrähne · #1A Schwarze") */
function labelTitle(v: AccessoryVariant): string {
  return v.variantTitle ? `${v.productTitle} · ${v.variantTitle}` : v.productTitle;
}

export default function ZubehoerClient({ groups, printedSummary, singleCollection }: Props) {
  const [query, setQuery] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [printItems, setPrintItems] = useState<{ title: string; barcode: string }[]>([]);
  const [printing, setPrinting] = useState(false);

  // Druck auslösen, sobald die PNG-Labels komponiert sind
  useEffect(() => {
    if (printItems.length === 0) return;
    const ms = Math.max(400, printItems.length * 25);
    const tm = setTimeout(() => {
      window.print();
      setTimeout(() => {
        setPrintItems([]);
        setPrinting(false);
      }, 1500);
    }, ms);
    return () => clearTimeout(tm);
  }, [printItems]);

  const stats = useMemo(() => {
    const allVariants = groups.flatMap((g) => g.variants);
    return {
      variants: allVariants.length,
      products: new Set(allVariants.map((v) => v.productTitle)).size,
      units: allVariants.reduce((s, v) => s + Math.max(0, v.inventoryQuantity), 0),
      missingBarcode: allVariants.filter((v) => !v.barcode).length,
    };
  }, [groups]);

  const q = query.trim().toLowerCase();
  const matches = (v: AccessoryVariant) =>
    !q ||
    v.productTitle.toLowerCase().includes(q) ||
    (v.variantTitle ?? "").toLowerCase().includes(q) ||
    (v.sku ?? "").toLowerCase().includes(q) ||
    (v.barcode ?? "").toLowerCase().includes(q);

  const totalSelected = useMemo(
    () => Object.values(quantities).reduce((s, n) => s + (n || 0), 0),
    [quantities],
  );

  const setQty = (key: string, n: number) => {
    const safe = Math.max(0, Math.min(n || 0, MAX_QTY_PER_ROW));
    setQuantities((prev) => ({ ...prev, [key]: safe }));
  };

  const handlePrint = () => {
    if (totalSelected === 0 || totalSelected > MAX_TOTAL_LABELS || printing) return;
    setPrinting(true);
    const list: { title: string; barcode: string }[] = [];
    const tracked: { barcode: string; productTitle: string; collection: string; quantity: number }[] = [];
    for (const g of groups) {
      g.variants.forEach((v, idx) => {
        const n = quantities[rowKey(g, v, idx)] ?? 0;
        if (n <= 0 || !v.barcode) return;
        for (let i = 0; i < n; i++) list.push({ title: labelTitle(v), barcode: v.barcode });
        tracked.push({ barcode: v.barcode, productTitle: labelTitle(v), collection: g.title, quantity: n });
      });
    }
    if (list.length === 0) {
      setPrinting(false);
      return;
    }
    setPrintItems(list);
    void recordPrintedLabels(tracked).catch(() => {});
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            {singleCollection && groups.length === 1 ? `Zubehör — ${groups[0].title}` : "Zubehör"}
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Nicht-Extensions-Produkte · live aus Shopify
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Produkte" value={String(stats.products)} icon={<Package size={18} />} color="indigo" />
        <KpiCard label="Varianten" value={String(stats.variants)} icon={<Boxes size={18} />} color="emerald" />
        <KpiCard label="Lager (Stück)" value={String(stats.units)} icon={<Boxes size={18} />} color="amber" />
        <KpiCard label="Ohne EAN" value={String(stats.missingBarcode)} icon={<AlertTriangle size={18} />} color={stats.missingBarcode > 0 ? "rose" : "emerald"} />
      </section>

      {/* Suche + Druckleiste */}
      <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Produkt, Variante, SKU oder EAN suchen..."
              className="w-full pl-9 pr-9 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:bg-white"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 p-1"
                aria-label="Suche leeren"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm text-neutral-600">
              <strong>{totalSelected}</strong> Etikett{totalSelected === 1 ? "" : "en"}
            </span>
            <button
              type="button"
              onClick={() => setQuantities({})}
              disabled={totalSelected === 0 || printing}
              title="Alle Etiketten-Mengen auf 0 zurücksetzen"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-300 text-neutral-600 text-sm font-medium hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <RotateCcw size={14} />
              Alle auf 0
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={totalSelected === 0 || totalSelected > MAX_TOTAL_LABELS || printing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Printer size={14} />
              {printing ? "Wird vorbereitet…" : "Drucken"}
            </button>
          </div>
        </div>
        {totalSelected > MAX_TOTAL_LABELS && (
          <div className="text-xs text-red-600 font-medium">
            ⚠ Über {MAX_TOTAL_LABELS} Etiketten ist instabil — bitte in mehreren Druckvorgängen aufteilen.
          </div>
        )}
      </section>

      {/* Druckbereich (nur @media print sichtbar) */}
      <PrintLabels items={printItems} />

      {/* Gruppen */}
      {groups.map((g) => {
        const visible = g.variants
          .map((v, idx) => ({ v, idx }))
          .filter(({ v }) => matches(v));
        if (visible.length === 0 && q) return null;
        return (
          <section key={g.slug} className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="bg-indigo-600 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="font-bold text-sm uppercase tracking-wide">
                {g.title}
                <span className="ml-2 font-semibold text-indigo-200">({g.variants.length})</span>
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    // Schnellaktion: Menge = Lager − bereits gedruckt für alle Zeilen der Gruppe
                    setQuantities((prev) => {
                      const next = { ...prev };
                      g.variants.forEach((v, idx) => {
                        if (!v.barcode) return;
                        const printed = printedSummary[v.barcode]?.totalPrinted ?? 0;
                        next[rowKey(g, v, idx)] = Math.max(0, Math.min(MAX_QTY_PER_ROW, Math.floor(v.inventoryQuantity) - printed));
                      });
                      return next;
                    });
                  }}
                  className="relative z-20 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white/15 hover:bg-white/25 text-white border border-white/30 cursor-pointer"
                  title="Mengen auf Vorschlag setzen (Lager − bereits gedruckt)"
                >
                  <Printer size={12} /> Vorschlag übernehmen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuantities((prev) => {
                      const next = { ...prev };
                      g.variants.forEach((v, idx) => { next[rowKey(g, v, idx)] = 0; });
                      return next;
                    });
                  }}
                  className="relative z-20 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white/15 hover:bg-white/25 text-white border border-white/30 cursor-pointer"
                  title={`Alle Mengen in "${g.title}" auf 0 setzen`}
                >
                  <RotateCcw size={12} /> Auf 0
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="text-left px-3 py-2 w-[44px]"></th>
                  <th className="text-left px-3 py-2">Produkt / Variante</th>
                  <th className="text-left px-3 py-2 w-[150px]">SKU</th>
                  <th className="text-left px-3 py-2 w-[110px]">EAN</th>
                  <th className="text-right px-3 py-2 w-[70px]">Lager</th>
                  <th className="text-right px-3 py-2 w-[90px]">Bisher</th>
                  <th className="text-right px-3 py-2 w-[90px]">Etiketten</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-neutral-400 text-sm">
                      Keine Produkte in dieser Kollektion.
                    </td>
                  </tr>
                ) : (
                  visible.map(({ v, idx }) => {
                    const key = rowKey(g, v, idx);
                    const printed = v.barcode ? (printedSummary[v.barcode]?.totalPrinted ?? 0) : 0;
                    return (
                      <tr key={key} className="hover:bg-neutral-50/60">
                        <td className="px-3 py-1.5">
                          {v.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-neutral-100" />
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="text-neutral-900 line-clamp-1">{v.productTitle}</div>
                          {v.variantTitle && (
                            <div className="text-xs text-neutral-500">{v.variantTitle}</div>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {v.sku ? (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 border border-neutral-200">{v.sku}</span>
                          ) : (
                            <span className="text-neutral-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {v.barcode ?? <span className="text-red-500 font-sans font-medium text-xs">fehlt</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-neutral-700">
                          {v.inventoryQuantity}
                        </td>
                        <td className="px-3 py-1.5 text-right text-xs text-neutral-500 tabular-nums">
                          {printed > 0 ? printed : <span className="text-neutral-300">–</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            max={MAX_QTY_PER_ROW}
                            value={quantities[key] ?? 0}
                            disabled={!v.barcode}
                            onChange={(e) => setQty(key, parseInt(e.target.value || "0", 10))}
                            className="w-16 text-right rounded border border-neutral-300 px-2 py-1 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none disabled:opacity-40 disabled:bg-neutral-50"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>
        );
      })}
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

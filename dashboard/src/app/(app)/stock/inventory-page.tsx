"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Package, AlertTriangle, Scale, Printer, X } from "lucide-react";
import JsBarcode from "jsbarcode";
import StockSearch from "./stock-search";
import StockTable, { slugify } from "./stock-table";
import SyncBadge from "./sync-badge";
import type { InventoryRow } from "@/lib/stock-sheets";
import { recordPrintedLabels } from "@/lib/actions/printed-labels";

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
  // Map<barcode, { totalPrinted, lastPrintedAt }> — für Druck-Vorschlag
  printedSummary?: Record<string, { totalPrinted: number; lastPrintedAt: string | null }>;
}

export default function InventoryPageClient({ data, title, subtitle, lastUpdated, printedSummary }: InventoryPageClientProps) {
  const totalKg = data.reduce((s, r) => s + r.totalWeight, 0) / 1000;
  const totalProducts = data.length;
  const zeroCount = data.filter((r) => r.quantity === 0).length;

  // Druck-State: Liste der zu druckenden Etiketten ([{title, barcode}, ...] mehrfach pro Menge)
  const [printItems, setPrintItems] = useState<{ title: string; barcode: string }[]>([]);
  // Modal-State: Gruppe die der User gerade auswählt (zum Drucken)
  const [modalGroup, setModalGroup] = useState<{ key: string; rows: InventoryWithTransit[] } | null>(null);

  // Wenn printItems gesetzt: kurz warten bis SVGs gerendert sind, dann drucken + reset
  useEffect(() => {
    if (printItems.length === 0) return;
    const tm = setTimeout(() => {
      window.print();
      // Nach kurzer Zeit reset, damit der Druckbereich verschwindet
      setTimeout(() => setPrintItems([]), 1000);
    }, 200);
    return () => clearTimeout(tm);
  }, [printItems]);

  function openPrintModal(groupKey: string, rows: InventoryWithTransit[]) {
    setModalGroup({ key: groupKey, rows });
  }

  function handleConfirmPrint(items: { title: string; barcode: string; collection: string; quantity: number }[]) {
    setModalGroup(null);
    const list: { title: string; barcode: string }[] = [];
    for (const it of items) {
      for (let i = 0; i < it.quantity; i++) list.push({ title: it.title, barcode: it.barcode });
    }
    if (list.length === 0) return;
    setPrintItems(list);
    // Server-Action: tracken was gedruckt wurde
    void recordPrintedLabels(
      items
        .filter((it) => it.quantity > 0)
        .map((it) => ({
          barcode: it.barcode,
          productTitle: it.title,
          collection: it.collection,
          quantity: it.quantity,
        })),
    ).catch(() => {});
  }

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

      {/* Druckbereich: nur via @media print sichtbar; Hauptseite bleibt erhalten */}
      <PrintLabels items={printItems} />

      {/* Modal: Mengen-Auswahl + Vorschlag (Lager - bereits gedruckt) */}
      {modalGroup && (
        <PrintModal
          groupKey={modalGroup.key}
          rows={modalGroup.rows}
          printedSummary={printedSummary ?? {}}
          onClose={() => setModalGroup(null)}
          onConfirm={handleConfirmPrint}
        />
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
                  groupAction={(groupKey, rows) => {
                    const withBarcode = (rows as InventoryWithTransit[]).filter((r) => !!r.barcode);
                    if (withBarcode.length === 0) return null;
                    // Auto-Vorschlag: max(0, Lager - bereits gedruckt)
                    const totalSuggested = withBarcode.reduce((s, r) => {
                      const printed = printedSummary?.[r.barcode!]?.totalPrinted ?? 0;
                      return s + Math.max(0, Math.floor(r.quantity) - printed);
                    }, 0);
                    return (
                      <button
                        type="button"
                        onClick={() => openPrintModal(groupKey, rows as InventoryWithTransit[])}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white/15 hover:bg-white/25 text-white border border-white/30"
                        title={`Etiketten-Auswahl öffnen (Vorschlag: ${totalSuggested} fehlend)`}
                      >
                        <Printer size={12} />
                        Barcode drucken{totalSuggested > 0 ? ` (${totalSuggested})` : ""}
                      </button>
                    );
                  }}
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

function PrintModal({
  groupKey,
  rows,
  printedSummary,
  onClose,
  onConfirm,
}: {
  groupKey: string;
  rows: InventoryWithTransit[];
  printedSummary: Record<string, { totalPrinted: number; lastPrintedAt: string | null }>;
  onClose: () => void;
  onConfirm: (
    items: { title: string; barcode: string; collection: string; quantity: number }[],
  ) => void;
}) {
  // Initial-Mengen: max(0, Lager - bereits gedruckt) pro Produkt mit Barcode
  const initialQty = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) {
      if (!r.barcode) continue;
      const printed = printedSummary[r.barcode]?.totalPrinted ?? 0;
      map[`${r.barcode}|${r.unitWeight}`] = Math.max(0, Math.floor(r.quantity) - printed);
    }
    return map;
  }, [rows, printedSummary]);

  const [quantities, setQuantities] = useState<Record<string, number>>(initialQty);

  const total = useMemo(
    () => Object.values(quantities).reduce((s, n) => s + (n || 0), 0),
    [quantities],
  );

  const itemsWithBarcode = useMemo(() => rows.filter((r) => !!r.barcode), [rows]);
  const skipped = rows.length - itemsWithBarcode.length;

  function setBulk(getQty: (r: InventoryWithTransit) => number) {
    const next: Record<string, number> = {};
    for (const r of itemsWithBarcode) {
      next[`${r.barcode}|${r.unitWeight}`] = Math.max(0, getQty(r));
    }
    setQuantities(next);
  }

  function setQty(r: InventoryWithTransit, q: number) {
    setQuantities({ ...quantities, [`${r.barcode}|${r.unitWeight}`]: Math.max(0, q || 0) });
  }

  function handlePrint() {
    const items: { title: string; barcode: string; collection: string; quantity: number }[] = [];
    for (const r of itemsWithBarcode) {
      const q = quantities[`${r.barcode}|${r.unitWeight}`] ?? 0;
      if (q > 0) {
        items.push({
          title: r.product,
          barcode: r.barcode!,
          collection: r.collection,
          quantity: q,
        });
      }
    }
    onConfirm(items);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-neutral-200">
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wide">Etiketten drucken</div>
            <div className="text-lg font-semibold text-neutral-900 mt-0.5">{groupKey}</div>
            <div className="text-xs text-neutral-500 mt-1">
              Vorschlag = Lager − bereits gedruckt. Du kannst pro Zeile anpassen.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 shrink-0"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap p-3 border-b border-neutral-200 bg-neutral-50 text-xs">
          <span className="text-neutral-600">Schnellaktionen:</span>
          <button
            type="button"
            onClick={() => setBulk(() => 0)}
            className="px-2 py-1 rounded border border-neutral-300 hover:bg-white"
          >
            Alle auf 0
          </button>
          <button
            type="button"
            onClick={() =>
              setBulk((r) => {
                const printed = printedSummary[r.barcode!]?.totalPrinted ?? 0;
                return Math.max(0, Math.floor(r.quantity) - printed);
              })
            }
            className="px-2 py-1 rounded border border-neutral-300 hover:bg-white"
          >
            Vorschlag wiederherstellen
          </button>
          <button
            type="button"
            onClick={() => setBulk((r) => Math.floor(r.quantity))}
            className="px-2 py-1 rounded border border-neutral-300 hover:bg-white"
          >
            = Lager
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 sticky top-0 z-10">
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-600">
                <th className="px-3 py-2">Produkt</th>
                <th className="px-3 py-2 w-[80px] text-right">Lager</th>
                <th className="px-3 py-2 w-[110px] text-right">Bisher</th>
                <th className="px-3 py-2 w-[90px] text-right">Etiketten</th>
              </tr>
            </thead>
            <tbody>
              {itemsWithBarcode.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-neutral-500 text-sm">
                    Keine Produkte mit hinterlegter EAN in dieser Kategorie.
                  </td>
                </tr>
              ) : (
                itemsWithBarcode.map((r, i) => {
                  const k = `${r.barcode}|${r.unitWeight}`;
                  const q = quantities[k] ?? 0;
                  const printedInfo = printedSummary[r.barcode!];
                  const printed = printedInfo?.totalPrinted ?? 0;
                  const lastDate = printedInfo?.lastPrintedAt
                    ? new Date(printedInfo.lastPrintedAt).toLocaleDateString("de-DE")
                    : null;
                  const suggested = Math.max(0, Math.floor(r.quantity) - printed);
                  return (
                    <tr key={i} className="border-t border-neutral-100 hover:bg-neutral-50">
                      <td className="px-3 py-2">
                        <div className="text-neutral-900 line-clamp-1">{r.product}</div>
                        {r.unitWeight > 0 && (
                          <div className="text-[10px] text-neutral-500">
                            {r.unitWeight}g/Stk
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-700">{r.quantity}</td>
                      <td className="px-3 py-2 text-right text-xs">
                        {printed > 0 ? (
                          <div>
                            <span className="text-neutral-700">{printed}</span>
                            {lastDate && (
                              <div className="text-[10px] text-neutral-400">{lastDate}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-neutral-300">–</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={q}
                          onChange={(e) => setQty(r, parseInt(e.target.value || "0", 10))}
                          className={`w-16 text-right rounded border px-2 py-1 text-sm focus:ring-2 focus:outline-none ${
                            q !== suggested
                              ? "border-amber-400 focus:ring-amber-500"
                              : "border-neutral-300 focus:ring-neutral-900"
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 p-4 border-t border-neutral-200">
          <div className="text-sm text-neutral-700">
            <strong>{total}</strong> Etikett{total === 1 ? "" : "en"} drucken
            {skipped > 0 && (
              <span className="text-neutral-400 ml-2">· {skipped} Produkt(e) ohne EAN übersprungen</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={total === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer size={14} />
              Drucken
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrintLabels({ items }: { items: { title: string; barcode: string }[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <style>{`
        @media screen { .stock-label-sheet { display: none; } }
        @media print {
          /* Alles ausblenden, nur Label-Sheet zeigen — visibility statt display
             damit Layout des restlichen Dokuments nicht zusammenfaellt */
          body * { visibility: hidden !important; }
          .stock-label-sheet-wrap, .stock-label-sheet-wrap * { visibility: visible !important; }
          .stock-label-sheet-wrap {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
          }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          @page { size: 50mm 25mm; margin: 0; }
          .stock-label {
            width: 50mm;
            height: 25mm;
            padding: 1mm;
            box-sizing: border-box;
            page-break-after: always;
            break-after: page;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }
          .stock-label:last-child { page-break-after: auto; break-after: auto; }
          .stock-label-title {
            font-size: 6pt;
            line-height: 1.1;
            text-align: center;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            color: #000;
            max-height: 7mm;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            margin-bottom: 0.5mm;
          }
          .stock-label-barcode { width: 100%; max-height: 14mm; }
          .stock-label-barcode svg { width: 100%; height: 100%; max-height: 14mm; }
        }
      `}</style>
      <div className="stock-label-sheet-wrap stock-label-sheet">
        {items.map((it, i) => (
          <SingleLabel key={i} title={it.title} barcode={it.barcode} />
        ))}
      </div>
    </>
  );
}

function SingleLabel({ title, barcode }: { title: string; barcode: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, barcode, {
        format: "CODE128",
        displayValue: true,
        fontSize: 10,
        height: 36,
        margin: 0,
        textMargin: 1,
      });
    } catch {
      // ignore
    }
  }, [barcode]);
  return (
    <div className="stock-label">
      <div className="stock-label-title">{title}</div>
      <div className="stock-label-barcode">
        <svg ref={ref} />
      </div>
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

"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet, ExternalLink, Loader2, FileDown } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { exportOrderToGoogleSheet, generateAndUploadPDF } from "@/lib/actions/orders";
import type { OrderItem } from "@/lib/types";

interface ItemGroup {
  label: string;
  items: OrderItem[];
}

interface Props {
  items: OrderItem[];
  itemGroups: ItemGroup[];
  totalQty: number;
  locale: Locale;
  sheetUrl: string | null;
  orderId: string;
  isAdmin: boolean;
}

const fmt = (n: number) => new Intl.NumberFormat("de-DE").format(n);

const METHOD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Bondings: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  "Standard Tapes": { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200" },
  Minitapes: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
  "Classic Weft": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  "Invisible Weft": { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200" },
  "Clip-ins": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  Tapes: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
  "Classic Tressen": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "Genius Weft": { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
};

const DEFAULT_COLOR = { bg: "bg-neutral-50", text: "text-neutral-700", border: "border-neutral-200" };

function getMethodColor(method: string) {
  return METHOD_COLORS[method] ?? DEFAULT_COLOR;
}

export default function OrderItemsSection({ items, itemGroups, totalQty, locale, sheetUrl, orderId, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const [exporting, startExport] = useTransition();
  const [generatingPdf, startPdf] = useTransition();
  const [exportError, setExportError] = useState("");
  const [currentSheetUrl, setCurrentSheetUrl] = useState(sheetUrl);

  const handleExport = () => {
    setExportError("");
    startExport(async () => {
      const result = await exportOrderToGoogleSheet(orderId);
      if (result.error) {
        setExportError(result.error);
      } else if (result.sheetUrl) {
        setCurrentSheetUrl(result.sheetUrl);
      }
    });
  };

  const unit = items[0]?.unit ?? "g";

  return (
    <section className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-sm">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 md:px-6 py-4 text-left hover:bg-neutral-50/50 transition"
      >
        <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
          <FileSpreadsheet size={16} className="text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">{t(locale, "order.items_title")}</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {items.length} {t(locale, "wizard.positions")} · {fmt(totalQty)} {unit}
          </p>
        </div>
        {currentSheetUrl && (
          <a
            href={currentSheetUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg border border-emerald-200 hover:bg-emerald-100 transition shrink-0"
          >
            <ExternalLink size={12} /> Google Sheet
          </a>
        )}
        {open ? <ChevronDown size={16} className="text-neutral-400" /> : <ChevronRight size={16} className="text-neutral-400" />}
      </button>

      {/* Collapsible content */}
      {open && (
        <div className="px-4 md:px-6 pb-5 border-t border-neutral-100">
          {/* Groups */}
          <div className="mt-4 space-y-4">
            {itemGroups.map((group, gi) => {
              const methodName = group.items[0]?.method_name ?? "";
              const mc = getMethodColor(methodName);
              const groupQty = group.items.reduce((s, i) => s + i.quantity, 0);

              return (
                <div key={gi} className={`rounded-xl border ${mc.border} overflow-hidden`}>
                  {/* Group header */}
                  <div className={`${mc.bg} px-4 py-2.5 flex items-center justify-between`}>
                    <span className={`text-xs font-semibold uppercase tracking-wider ${mc.text}`}>
                      {group.label}
                    </span>
                    <span className={`text-xs font-medium ${mc.text}`}>
                      {fmt(groupQty)} {unit}
                    </span>
                  </div>
                  {/* Items */}
                  <div className="divide-y divide-neutral-50">
                    {group.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-50/50 transition">
                        <span className="text-sm font-medium text-neutral-900">#{item.color_name}</span>
                        <span className="text-sm tabular-nums text-neutral-600 font-medium">
                          {fmt(item.quantity)} {item.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer: total + export button */}
          <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between">
            <div className="text-sm">
              <span className="text-neutral-600">{t(locale, "wizard.total_quantity")}: </span>
              <span className="font-bold text-neutral-900 tabular-nums">{fmt(totalQty)} {unit}</span>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2">
                {!currentSheetUrl && (
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition"
                  >
                    {exporting ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
                    {exporting ? "Exportiert..." : "Sheet Export"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setExportError("");
                    startPdf(async () => {
                      const result = await generateAndUploadPDF(orderId);
                      if (result.error) setExportError(result.error);
                    });
                  }}
                  disabled={generatingPdf}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {generatingPdf ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                  {generatingPdf ? "Erstellt..." : "PDF erstellen"}
                </button>
              </div>
            )}
          </div>

          {exportError && (
            <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {exportError}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

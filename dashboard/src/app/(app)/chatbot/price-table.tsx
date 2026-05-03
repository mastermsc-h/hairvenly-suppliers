"use client";

import { useState } from "react";
import { calcPacks, METHOD_LABELS, type Method, type PriceRow } from "@/lib/chatbot/pricing";
import { Calculator } from "lucide-react";

const METHOD_ORDER: Method[] = [
  "tape", "mini_tape", "bondings", "tressen",
  "genius_weft", "invisible_tape", "clip_in", "ponytail",
];

const SUPPLIER_CONFIG = {
  amanda: {
    label: "Amanda — Russisch Glatt",
    badge: "bg-blue-100 text-blue-700",
    accent: "border-blue-200",
    desc: "60cm · glatt · Russian Hair",
  },
  ebru: {
    label: "Eyfel Ebru — Usbekisch Wellig",
    badge: "bg-amber-100 text-amber-700",
    accent: "border-amber-200",
    desc: "45 / 55 / 65 / 85cm · wellig · Chinese/Turkish Hair",
  },
} as const;

interface Props {
  prices: PriceRow[];
}

function LineTable({ prices, line }: { prices: PriceRow[]; line: "amanda" | "ebru" }) {
  const cfg = SUPPLIER_CONFIG[line];
  const rows = prices.filter((p) => p.supplier_line === line);

  // Group by method
  const byMethod: Record<string, PriceRow[]> = {};
  for (const p of rows) {
    if (!byMethod[p.method]) byMethod[p.method] = [];
    byMethod[p.method].push(p);
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${cfg.accent}`}>
      {/* Header */}
      <div className="px-4 py-3 bg-neutral-50 flex items-center gap-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
          {line === "amanda" ? "Amanda" : "Ebru"}
        </span>
        <span className="text-sm font-medium text-neutral-800">{cfg.label}</span>
        <span className="text-xs text-neutral-400 ml-1">· {cfg.desc}</span>
      </div>

      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-xs font-medium text-neutral-400 uppercase tracking-wide">
            <th className="text-left py-2 px-4">Methode</th>
            <th className="text-left py-2 px-3">Länge / Größe</th>
            <th className="text-right py-2 px-3">g/Pack</th>
            <th className="text-right py-2 px-4">€/Pack</th>
          </tr>
        </thead>
        <tbody>
          {METHOD_ORDER.map((method) => {
            const entries = byMethod[method];
            if (!entries?.length) return null;
            return entries.map((p, i) => (
              <tr
                key={`${method}-${i}`}
                className="border-b border-neutral-50 hover:bg-neutral-50 transition-colors"
              >
                <td className="py-2 px-4 font-medium text-neutral-800">
                  {i === 0 ? METHOD_LABELS[method] : ""}
                </td>
                <td className="py-2 px-3 text-neutral-600">
                  {p.gram_label ?? (p.length_cm ? `${p.length_cm}cm` : "—")}
                </td>
                <td className="py-2 px-3 text-right text-neutral-500">
                  {p.gram_per_pack}g
                </td>
                <td className="py-2 px-4 text-right font-semibold text-neutral-900">
                  €{p.price_eur.toFixed(2)}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PriceTable({ prices }: Props) {
  const [calcLine, setCalcLine]     = useState<"amanda" | "ebru">("ebru");
  const [calcMethod, setCalcMethod] = useState<Method>("tape");
  const [calcLength, setCalcLength] = useState(65);
  const [calcGrams, setCalcGrams]   = useState(150);

  // Available methods for selected line
  const lineprices = prices.filter((p) => p.supplier_line === calcLine);
  const availMethods = METHOD_ORDER.filter((m) =>
    lineprices.some((p) => p.method === m)
  );

  // Auto-pick first available length for selected line+method
  const methodPrices = lineprices.filter((p) => p.method === calcMethod);
  const availLengths = [...new Set(
    methodPrices.filter((p) => p.length_cm && !p.gram_label).map((p) => p.length_cm!)
  )].sort((a, b) => a - b);

  const calcResult = calcPacks(lineprices, calcMethod, calcLength, calcGrams);

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100 flex items-center gap-2">
        <Calculator size={16} className="text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-800">
          Preistabelle &amp; Pack-Kalkulator
        </h2>
        <span className="text-xs text-neutral-400 ml-1">· Quelle: Shopify live</span>
      </div>

      <div className="p-5 space-y-5">
        {/* Two line tables side by side */}
        <div className="grid md:grid-cols-2 gap-4">
          <LineTable prices={prices} line="amanda" />
          <LineTable prices={prices} line="ebru" />
        </div>

        {/* Pack calculator */}
        <div className="bg-neutral-50 rounded-xl p-4 space-y-4 border border-neutral-200">
          <h3 className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
            Pack-Kalkulator · Bot-Antwort Vorschau
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Line selector */}
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Produktlinie</label>
              <select
                value={calcLine}
                onChange={(e) => {
                  setCalcLine(e.target.value as "amanda" | "ebru");
                  setCalcMethod("tape");
                  setCalcLength(e.target.value === "amanda" ? 60 : 65);
                }}
                className="w-full text-sm rounded-lg border border-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              >
                <option value="amanda">Amanda (RU Glatt)</option>
                <option value="ebru">Ebru (Wellig)</option>
              </select>
            </div>

            {/* Method */}
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Methode</label>
              <select
                value={calcMethod}
                onChange={(e) => setCalcMethod(e.target.value as Method)}
                className="w-full text-sm rounded-lg border border-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              >
                {availMethods.map((m) => (
                  <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                ))}
              </select>
            </div>

            {/* Length */}
            <div>
              <label className="text-xs text-neutral-500 block mb-1">
                Länge {availLengths.length > 0 ? `(${availLengths.join("/")}cm)` : ""}
              </label>
              <select
                value={calcLength}
                onChange={(e) => setCalcLength(parseInt(e.target.value))}
                className="w-full text-sm rounded-lg border border-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              >
                {availLengths.length > 0
                  ? availLengths.map((l) => (
                      <option key={l} value={l}>{l}cm</option>
                    ))
                  : <option value={calcLength}>{calcLength}cm</option>
                }
              </select>
            </div>

            {/* Grams needed */}
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Grammbedarf</label>
              <input
                type="number"
                value={calcGrams}
                onChange={(e) => setCalcGrams(parseInt(e.target.value) || 100)}
                min={25} max={500} step={25}
                className="w-full text-sm rounded-lg border border-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
          </div>

          {calcResult ? (
            <div className="bg-white rounded-lg border border-neutral-200 p-4 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SUPPLIER_CONFIG[calcLine].badge}`}>
                  {calcLine === "amanda" ? "Amanda · RU Glatt" : "Ebru · Wellig"}
                </span>
                <span className="text-xs text-neutral-400">
                  {calcResult.method_label} · {calcResult.length_cm}cm
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500">Packungen</span>
                <span className="font-bold text-neutral-900 text-xl">
                  {calcResult.packs}×
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>à {calcResult.pack_grams}g = {calcResult.total_grams}g gesamt</span>
                <span>à €{calcResult.price_per_pack.toFixed(2)}</span>
              </div>
              <div className="border-t border-neutral-100 pt-2 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-700">Gesamtpreis</span>
                <span className="text-2xl font-bold text-neutral-900">
                  €{calcResult.total_price.toFixed(2)}
                </span>
              </div>
              <div className="mt-2 p-2 bg-neutral-50 rounded-lg text-xs text-neutral-600 border border-neutral-100">
                <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide block mb-1">Bot würde antworten:</span>
                {calcResult.message}
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-400 italic p-3 bg-white rounded-lg border border-neutral-100">
              Keine Preisdaten für diese Kombination ({calcLine} · {calcMethod} · {calcLength}cm)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

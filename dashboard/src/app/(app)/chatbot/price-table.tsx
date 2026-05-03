"use client";

import { useState } from "react";
import { calcPacks, METHOD_LABELS, GRAMS_PER_PACK, type Method, type PriceRow } from "@/lib/chatbot/pricing";
import { Calculator } from "lucide-react";

const METHOD_ORDER: Method[] = [
  "tape", "mini_tape", "bondings", "tressen",
  "genius_weft", "invisible_tape", "clip_in", "ponytail",
];

interface Props {
  prices: PriceRow[];
}

export default function PriceTable({ prices }: Props) {
  const [calcMethod, setCalcMethod]   = useState<Method>("tape");
  const [calcLength, setCalcLength]   = useState(65);
  const [calcGrams, setCalcGrams]     = useState(150);

  // Group prices by method
  const byMethod: Record<string, PriceRow[]> = {};
  for (const p of prices) {
    if (!byMethod[p.method]) byMethod[p.method] = [];
    byMethod[p.method].push(p);
  }

  const calcResult = calcPacks(prices, calcMethod, calcLength, calcGrams);

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100 flex items-center gap-2">
        <Calculator size={16} className="text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-800">
          Preistabelle &amp; Pack-Kalkulator
        </h2>
        <span className="text-xs text-neutral-400 ml-1">
          · Quelle: Shopify (min. Verkaufspreis pro Packung)
        </span>
      </div>

      <div className="p-5 grid md:grid-cols-2 gap-6">

        {/* Price table */}
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                <th className="text-left py-2 pr-4">Methode</th>
                <th className="text-left py-2 pr-3">Länge / Größe</th>
                <th className="text-right py-2 pr-3">g/Pack</th>
                <th className="text-right py-2">€/Pack</th>
              </tr>
            </thead>
            <tbody>
              {METHOD_ORDER.map((method) => {
                const rows = byMethod[method] ?? [];
                if (rows.length === 0) return null;
                return rows.map((p, i) => (
                  <tr
                    key={`${method}-${i}`}
                    className="border-b border-neutral-50 hover:bg-neutral-50"
                  >
                    <td className="py-2 pr-4 font-medium text-neutral-800">
                      {i === 0 ? METHOD_LABELS[method] : ""}
                    </td>
                    <td className="py-2 pr-3 text-neutral-600">
                      {p.gram_label
                        ? p.gram_label
                        : p.length_cm
                        ? `${p.length_cm}cm`
                        : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right text-neutral-500">
                      {p.gram_per_pack}g
                    </td>
                    <td className="py-2 text-right font-medium text-neutral-900">
                      €{p.price_eur.toFixed(2)}
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>

        {/* Pack calculator */}
        <div className="bg-neutral-50 rounded-xl p-4 space-y-4">
          <h3 className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
            Pack-Kalkulator (Vorschau)
          </h3>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Methode</label>
              <select
                value={calcMethod}
                onChange={(e) => setCalcMethod(e.target.value as Method)}
                className="w-full text-sm rounded-lg border border-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              >
                {METHOD_ORDER.map((m) => (
                  <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Länge (cm)</label>
              <input
                type="number"
                value={calcLength}
                onChange={(e) => setCalcLength(parseInt(e.target.value) || 65)}
                min={40} max={100} step={5}
                className="w-full text-sm rounded-lg border border-neutral-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Gramm (Bedarf)</label>
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
            <div className="bg-white rounded-lg border border-neutral-200 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500">Packungen</span>
                <span className="font-bold text-neutral-900 text-lg">
                  {calcResult.packs}×
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500">
                  à {calcResult.pack_grams}g = {calcResult.total_grams}g gesamt
                </span>
                <span className="text-neutral-500">
                  à €{calcResult.price_per_pack.toFixed(2)}
                </span>
              </div>
              <div className="border-t border-neutral-100 pt-2 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-700">Gesamtpreis</span>
                <span className="text-xl font-bold text-neutral-900">
                  €{calcResult.total_price.toFixed(2)}
                </span>
              </div>
              <div className="mt-2 text-xs text-neutral-500 bg-neutral-50 rounded p-2">
                <span className="font-medium text-neutral-700">Bot-Antwort:</span>{" "}
                {calcResult.message}
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-400 italic">
              Keine Preisdaten für diese Kombination
            </div>
          )}

          <p className="text-xs text-neutral-400">
            Packungsgrößen: Tape 25g · Bondings/Tressen/Mini Tape/Genius Weft/Invisible Tape 50g · Clip-in 100/150/225g · Ponytail 130g
          </p>
        </div>
      </div>
    </div>
  );
}

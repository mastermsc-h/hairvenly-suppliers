"use client";

import { useState, useMemo, useTransition } from "react";
import { t, type Locale } from "@/lib/i18n";
import { pushToShopify, removeFromShopify } from "@/lib/actions/preorders";
import type { PreorderCandidate, ShopifyPreorder, PreorderOrder } from "@/lib/actions/preorders";
import { Search, Send, Undo2, RefreshCw, ShoppingBag, Package, Check, AlertCircle } from "lucide-react";

const ORDER_COLORS = [
  "bg-violet-50 text-violet-700",
  "bg-sky-50 text-sky-700",
  "bg-amber-50 text-amber-700",
  "bg-emerald-50 text-emerald-700",
  "bg-rose-50 text-rose-700",
];

interface Props {
  candidates: PreorderCandidate[];
  preorders: ShopifyPreorder[];
  locale: Locale;
}

export default function PreordersClient({ candidates, preorders, locale }: Props) {
  const [query, setQuery] = useState("");
  const [filterKey, setFilterKey] = useState<"all" | "wellig" | "glatt">("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pushPending, startPushTransition] = useTransition();
  const [removePending, startRemoveTransition] = useTransition();
  const [result, setResult] = useState<{ success: string[]; errors: string[] } | null>(null);

  const filtered = useMemo(() => {
    return candidates.filter((c) => {
      if (filterKey !== "all" && c.sheetKey !== filterKey) return false;
      if (!query.trim()) return true;
      const words = query.toLowerCase().split(/\s+/);
      const text = `${c.product} ${c.collection} ${c.shopifyName ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [candidates, query, filterKey]);

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((_, i) => i)));
    }
  };

  const handlePush = () => {
    const items = filtered
      .filter((_, i) => selected.has(i))
      .filter((c) => c.shopifyName)
      .map((c) => ({ shopifyName: c.shopifyName!, eta: c.eta }));

    if (items.length === 0) return;

    setResult(null);
    const fd = new FormData();
    fd.set("selected", JSON.stringify(items));

    startPushTransition(async () => {
      const res = await pushToShopify(null, fd);
      setResult(res);
      setSelected(new Set());
    });
  };

  const handleRemove = () => {
    const items = filtered
      .filter((_, i) => selected.has(i))
      .filter((c) => c.shopifyName)
      .map((c) => ({ shopifyName: c.shopifyName! }));

    if (items.length === 0) return;

    setResult(null);
    const fd = new FormData();
    fd.set("selected", JSON.stringify(items));

    startRemoveTransition(async () => {
      const res = await removeFromShopify(null, fd);
      setResult(res);
      setSelected(new Set());
    });
  };

  const selectedWithShopify = filtered.filter((_, i) => selected.has(i)).filter((c) => c.shopifyName).length;
  const isPending = pushPending || removePending;

  return (
    <div className="space-y-6">
      {/* Section A: Candidates */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50 text-amber-600">
            <Package size={18} />
          </div>
          <h2 className="text-lg font-semibold text-neutral-900">
            {t(locale, "preorders.candidates")}
          </h2>
          <span className="text-sm text-neutral-500">({candidates.length})</span>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(locale, "preorders.search")}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
            />
          </div>
          <select
            value={filterKey}
            onChange={(e) => setFilterKey(e.target.value as "all" | "wellig" | "glatt")}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="all">{t(locale, "preorders.filter_all")}</option>
            <option value="wellig">{t(locale, "nav.stock.uzbek")}</option>
            <option value="glatt">{t(locale, "nav.stock.russian")}</option>
          </select>

          <button
            onClick={handlePush}
            disabled={isPending || selectedWithShopify === 0}
            className="inline-flex items-center gap-2 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-800 transition"
          >
            {pushPending ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            {pushPending ? t(locale, "preorders.pushing") : t(locale, "preorders.push")}
            {selectedWithShopify > 0 && ` (${selectedWithShopify})`}
          </button>

          <button
            onClick={handleRemove}
            disabled={isPending || selectedWithShopify === 0}
            className="inline-flex items-center gap-2 border border-neutral-300 text-neutral-700 font-medium rounded-lg px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-100 hover:shadow-[inset_3px_0_0_0_rgb(79_70_229)] transition"
          >
            {removePending ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Undo2 size={14} />
            )}
            {t(locale, "preorders.remove")}
          </button>
        </div>

        {/* Result feedback */}
        {result && (
          <div className="mb-4 space-y-2">
            {result.success.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 text-green-800 text-sm">
                <Check size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{t(locale, "preorders.push_success")}</div>
                  <div className="text-xs mt-1">{result.success.join(", ")}</div>
                </div>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-800 text-sm">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{t(locale, "preorders.push_error")}</div>
                  <div className="text-xs mt-1">{result.errors.join("; ")}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Table */}
        {filtered.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center">{t(locale, "preorders.no_candidates")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th className="py-2 px-2 text-left w-8">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                      className="rounded border-neutral-300"
                    />
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_product")}
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_variant")}
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_collection")}
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_shopify")}
                  </th>
                  <th className="py-2 px-2 text-right text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_transit")}
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_eta")}
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_orders")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr
                    key={`${c.product}-${c.collection}-${i}`}
                    className={`border-b border-neutral-100 hover:bg-indigo-100 hover:shadow-[inset_3px_0_0_0_rgb(79_70_229)] transition ${
                      selected.has(i) ? "bg-neutral-50" : ""
                    }`}
                  >
                    <td className="py-2.5 px-2">
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => toggleSelect(i)}
                        className="rounded border-neutral-300"
                      />
                    </td>
                    <td className="py-2.5 px-2 font-medium text-neutral-900">{c.product}</td>
                    <td className="py-2.5 px-2 text-neutral-600">
                      {c.variant ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-neutral-100 text-xs font-medium text-neutral-700">
                          {c.variant}g
                        </span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-neutral-600">{c.collection}</td>
                    <td className="py-2.5 px-2">
                      {c.shopifyName ? (
                        <span className="text-neutral-700">{c.shopifyName}</span>
                      ) : (
                        <span className="text-neutral-400 italic">{t(locale, "preorders.no_mapping")}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-neutral-700">
                      {c.unterwegsG.toLocaleString("de-DE")}g
                    </td>
                    <td className="py-2.5 px-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        {c.eta}
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="flex flex-wrap gap-1.5">
                        {c.orders.map((o, oi) => (
                          <div
                            key={oi}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs ${ORDER_COLORS[oi % ORDER_COLORS.length]}`}
                          >
                            <span className="font-medium">{o.name}</span>
                            <span className="opacity-50">·</span>
                            <span>{o.ankunft}</span>
                            <span className="opacity-50">·</span>
                            <span className="font-mono">{o.menge.toLocaleString("de-DE")}g</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section B: Active Shopify Pre-orders */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-50 text-purple-600">
            <ShoppingBag size={18} />
          </div>
          <h2 className="text-lg font-semibold text-neutral-900">
            {t(locale, "preorders.active")}
          </h2>
          <span className="text-sm text-neutral-500">({preorders.length})</span>
        </div>

        {preorders.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center">{t(locale, "preorders.no_orders")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_order")}
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_customer")}
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_date")}
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_items")}
                  </th>
                  <th className="py-2 px-2 text-right text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    {t(locale, "preorders.col_total")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {preorders.map((o) => (
                  <tr key={o.id} className="border-b border-neutral-100 hover:bg-indigo-100 hover:shadow-[inset_3px_0_0_0_rgb(79_70_229)] transition">
                    <td className="py-2.5 px-2 font-medium text-neutral-900">{o.name}</td>
                    <td className="py-2.5 px-2 text-neutral-600">{o.customer}</td>
                    <td className="py-2.5 px-2 text-neutral-600">
                      {new Date(o.createdAt).toLocaleDateString("de-DE")}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-neutral-600">
                      {o.items.map((item) => `${item.quantity}x ${item.title}`).join(", ")}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-neutral-700">
                      {parseFloat(o.total).toLocaleString("de-DE", { minimumFractionDigits: 2 })} {o.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { PriceListFull, SellingPriceTier } from "@/lib/types";
import type { Locale } from "@/lib/i18n";
import {
  mapProductToCategory,
  unmapProduct,
  updatePriceEntry,
  updateSellingPrices,
} from "@/lib/actions/prices";

/* ── Types ───────────────────────────────────────────────────────── */

type SupplierColor = {
  id: string;
  name_hairvenly: string;
  name_shopify: string | null;
  method_name: string;
  length_value: string;
};

type VkMode = "netto" | "brutto" | "gewerbe";
type EntryType = PriceListFull["length_groups"][number]["entries"][number];

interface ProductRow {
  method: string;
  lgId: string;
  lgLabel: string;
  lengthValues: string[];
  lgSellingPrices: Record<string, SellingPriceTier>;
  vk: SellingPriceTier | null;
  avgEk: number | null;
  categories: { entry: EntryType; ek: number | null }[];
}

interface MethodGroup {
  method: string;
  rows: ProductRow[];
}

/* ── Build grouped data ──────────────────────────────────────────── */

function buildMethodGroups(list: PriceListFull): MethodGroup[] {
  const groupMap = new Map<string, ProductRow[]>();

  // Preserve method order from price list
  for (const m of list.methods) {
    groupMap.set(m.name, []);
  }

  for (const lg of list.length_groups) {
    const sp = lg.selling_prices ?? {};
    for (const m of list.methods) {
      const cats = lg.entries
        .map((entry) => ({
          entry,
          ek: (entry.prices[m.name] as number | undefined) ?? null,
        }))
        .filter((c) => c.ek != null);

      if (cats.length === 0) continue;

      const totalEk = cats.reduce((s, c) => s + (c.ek ?? 0), 0);

      groupMap.get(m.name)!.push({
        method: m.name,
        lgId: lg.id,
        lgLabel: lg.label,
        lengthValues: lg.length_values,
        lgSellingPrices: sp as Record<string, SellingPriceTier>,
        vk: (sp[m.name] as SellingPriceTier | undefined) ?? null,
        avgEk: totalEk / cats.length,
        categories: cats,
      });
    }
  }

  return Array.from(groupMap.entries())
    .filter(([, rows]) => rows.length > 0)
    .map(([method, rows]) => ({ method, rows }));
}

/* ── Main Component ──────────────────────────────────────────────── */

interface Props {
  priceLists: PriceListFull[];
  supplierColors: Record<string, SupplierColor[]>;
  locale: Locale;
}

const ZOLL_DEFAULT = 2.5;

export default function PriceTables({ priceLists, supplierColors, locale }: Props) {
  const [activeTab, setActiveTab] = useState(0);
  const [vkMode, setVkMode] = useState<VkMode>("netto");
  const [zollPct, setZollPct] = useState(ZOLL_DEFAULT);
  const [ekInEur, setEkInEur] = useState(false);
  const [usdEurRate, setUsdEurRate] = useState(0.92);

  if (priceLists.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm text-center text-neutral-500">
        Noch keine Preistabellen vorhanden.
      </div>
    );
  }

  const list = priceLists[activeTab];
  const colors = supplierColors[list.supplier_id] ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200">
        <div className="flex gap-1">
          {priceLists.map((pl, i) => (
            <button
              key={pl.id}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition ${
                i === activeTab
                  ? "bg-white text-neutral-900 border border-neutral-200 border-b-white -mb-px relative z-10"
                  : "bg-neutral-100 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 border border-transparent"
              }`}
            >
              {pl.supplier_name} — {pl.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 pb-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-neutral-400 mr-1">VK:</span>
            {(["netto", "brutto", "gewerbe"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setVkMode(m)}
                className={`px-2 py-0.5 text-[10px] rounded-md transition ${
                  vkMode === m
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                }`}
              >
                {m === "netto" ? "Netto" : m === "brutto" ? "Brutto" : "Gewerbe"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-neutral-400">Zoll:</span>
            <input
              type="number"
              step="0.1"
              value={zollPct}
              onChange={(e) => setZollPct(Number(e.target.value) || 0)}
              className="w-12 text-[10px] text-right rounded border border-neutral-300 px-1 py-0.5 tabular-nums"
            />
            <span className="text-[10px] text-neutral-400">%</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEkInEur(!ekInEur)}
              className={`px-2 py-0.5 text-[10px] rounded-md transition ${
                ekInEur
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
              }`}
            >
              EK → €
            </button>
            {ekInEur && (
              <>
                <input
                  type="number"
                  step="0.01"
                  value={usdEurRate}
                  onChange={(e) => setUsdEurRate(Number(e.target.value) || 0)}
                  className="w-14 text-[10px] text-right rounded border border-blue-300 px-1 py-0.5 tabular-nums"
                />
                <span className="text-[10px] text-neutral-400">$/€</span>
              </>
            )}
          </div>
        </div>
      </div>

      <OverviewTable list={list} supplierColors={colors} vkMode={vkMode} zollPct={zollPct} ekInEur={ekInEur} usdEurRate={usdEurRate} locale={locale} />
    </div>
  );
}

/* ── Overview Table ──────────────────────────────────────────────── */

function OverviewTable({
  list,
  supplierColors,
  vkMode,
  zollPct,
  ekInEur,
  usdEurRate,
  locale,
}: {
  list: PriceListFull;
  supplierColors: SupplierColor[];
  vkMode: VkMode;
  zollPct: number;
  ekInEur: boolean;
  usdEurRate: number;
  locale: Locale;
}) {
  const groups = useMemo(() => buildMethodGroups(list), [list]);
  const zollFactor = 1 + zollPct / 100;

  // Calculate totals across all methods/lengths
  const totals = useMemo(() => {
    let ekSum = 0;
    let ekZollSum = 0;
    let vkNettoSum = 0;
    let count = 0;

    for (const group of groups) {
      for (const row of group.rows) {
        if (row.avgEk != null && row.vk) {
          const vkNetto = row.vk.netto;
          if (vkNetto && vkNetto > 0) {
            ekSum += row.avgEk;
            ekZollSum += row.avgEk * zollFactor;
            vkNettoSum += vkNetto;
            count++;
          }
        }
      }
    }

    if (count === 0) return null;

    const avgEk = ekSum / count;
    const avgEkZoll = ekZollSum / count;
    const avgVkNetto = vkNettoSum / count;
    // When ekInEur: convert EK+Zoll to EUR, then compare with VK netto EUR
    const ekForMargin = ekInEur ? avgEkZoll * usdEurRate : avgEkZoll;
    const vkForMargin = ekInEur ? avgVkNetto : avgVkNetto;
    const aufschlag = ((vkForMargin - ekForMargin) / ekForMargin) * 100;
    const marge = ((vkForMargin - ekForMargin) / vkForMargin) * 100;

    return { avgEk, avgEkZoll, avgVkNetto, aufschlag, marge, count };
  }, [groups, zollFactor, ekInEur, usdEurRate]);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div
          key={group.method}
          className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden"
        >
          {/* Method group header */}
          <div className="bg-neutral-50 px-4 py-2.5 border-b border-neutral-200">
            <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-wide">
              {group.method}
            </h3>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className="text-left px-4 py-2 text-[10px] font-medium text-neutral-400 uppercase tracking-wide w-[30%]">
                  Länge
                </th>
                <th className="text-right px-3 py-2 text-[10px] font-medium text-neutral-400 uppercase tracking-wide">
                  {"\u00D8"} EK
                </th>
                <th className="text-right px-3 py-2 text-[10px] font-medium text-neutral-400 uppercase tracking-wide">
                  Zoll {zollPct}%
                </th>
                <th className="text-right px-3 py-2 text-[10px] font-medium text-neutral-400 uppercase tracking-wide">
                  VK {vkMode === "brutto" ? "Brutto" : vkMode === "gewerbe" ? "Gew." : "Netto"}
                </th>
                <th className="text-right px-3 py-2 text-[10px] font-medium text-neutral-400 uppercase tracking-wide">
                  Aufschlag
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-medium text-neutral-400 uppercase tracking-wide">
                  Marge
                </th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <ProductRowView
                  key={row.lgId}
                  row={row}
                  vkMode={vkMode}
                  zollFactor={zollFactor}
                  ekInEur={ekInEur}
                  usdEurRate={usdEurRate}
                  supplierColors={supplierColors}
                  locale={locale}
                  isLast={row === group.rows[group.rows.length - 1]}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Summary */}
      {totals && (
        <div className="bg-neutral-900 text-white rounded-2xl px-5 py-3 flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide">
            Gesamt ({totals.count} Kategorien)
          </div>
          <div className="flex items-center gap-6 text-sm tabular-nums">
            <div className="text-center">
              <div className="text-[10px] text-neutral-400 uppercase">Ø EK</div>
              <div>${Math.round(totals.avgEk).toLocaleString("de-DE")}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-neutral-400 uppercase">+ Zoll</div>
              <div>${Math.round(totals.avgEkZoll).toLocaleString("de-DE")}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-neutral-400 uppercase">Ø VK Netto</div>
              <div className="text-blue-400">€{totals.avgVkNetto.toLocaleString("de-DE", { maximumFractionDigits: 0 })}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-neutral-400 uppercase">Aufschlag</div>
              <div className={totals.aufschlag >= 80 ? "text-green-400" : totals.aufschlag >= 50 ? "text-yellow-400" : "text-red-400"}>
                {totals.aufschlag.toFixed(1)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-neutral-400 uppercase">Marge</div>
              <div className={totals.marge >= 40 ? "text-green-400" : totals.marge >= 30 ? "text-yellow-400" : "text-red-400"}>
                {totals.marge.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Product Row (one length within a method group) ──────────────── */

function ProductRowView({
  row,
  vkMode,
  zollFactor,
  ekInEur,
  usdEurRate,
  supplierColors,
  locale,
  isLast,
}: {
  row: ProductRow;
  vkMode: VkMode;
  zollFactor: number;
  ekInEur: boolean;
  usdEurRate: number;
  supplierColors: SupplierColor[];
  locale: Locale;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingVk, setEditingVk] = useState(false);
  const [vkBrutto, setVkBrutto] = useState(row.vk?.brutto ?? 0);
  const [vkGewerbe, setVkGewerbe] = useState(row.vk?.gewerbe ?? 0);
  const [isPending, startTransition] = useTransition();

  const vkDisplay = row.vk ? row.vk[vkMode] : null;
  const vkNetto = row.vk ? row.vk.netto : null;
  const ekWithZoll = row.avgEk != null ? row.avgEk * zollFactor : null;
  // When ekInEur: convert to EUR for real margin
  const ekForMargin = ekWithZoll != null ? (ekInEur ? ekWithZoll * usdEurRate : ekWithZoll) : null;
  const aufschlagPct = ekForMargin && vkNetto ? ((vkNetto - ekForMargin) / ekForMargin) * 100 : null;
  const margePct = ekForMargin && vkNetto ? ((vkNetto - ekForMargin) / vkNetto) * 100 : null;

  const aufschlagColor =
    aufschlagPct == null ? "" : aufschlagPct >= 80 ? "text-green-600" : aufschlagPct >= 50 ? "text-yellow-600" : "text-red-600";
  const margeColor =
    margePct == null ? "" : margePct >= 40 ? "text-green-600" : margePct >= 30 ? "text-yellow-600" : "text-red-600";

  function saveVk() {
    startTransition(async () => {
      const netto = Math.round((vkBrutto / 1.19) * 100) / 100;
      await updateSellingPrices(row.lgId, {
        ...(row.lgSellingPrices ?? {}),
        [row.method]: { brutto: vkBrutto, netto, gewerbe: vkGewerbe },
      });
      setEditingVk(false);
    });
  }

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className={`hover:bg-neutral-50/80 cursor-pointer transition ${!isLast || expanded ? "border-b border-neutral-100" : ""}`}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="font-medium text-neutral-800">{row.lgLabel}</span>
            <span className="text-[10px] text-neutral-400">
              {row.categories.length} Kat.
            </span>
          </div>
        </td>
        <td className="text-right px-3 py-2.5 tabular-nums text-neutral-700">
          {row.avgEk != null
            ? ekInEur
              ? `€${Math.round(row.avgEk * usdEurRate).toLocaleString("de-DE")}`
              : `$${Math.round(row.avgEk).toLocaleString("de-DE")}`
            : "—"}
        </td>
        <td className="text-right px-3 py-2.5 tabular-nums text-neutral-500 text-xs">
          {ekWithZoll != null
            ? ekInEur
              ? `€${Math.round(ekWithZoll * usdEurRate).toLocaleString("de-DE")}`
              : `$${Math.round(ekWithZoll).toLocaleString("de-DE")}`
            : "—"}
        </td>
        <td className="text-right px-3 py-2.5 tabular-nums text-blue-600 font-medium" onClick={(e) => e.stopPropagation()}>
          {editingVk ? (
            <div className="flex items-center gap-1 justify-end">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-neutral-400">Brutto</span>
                  <input
                    type="number"
                    step="0.01"
                    value={vkBrutto}
                    onChange={(e) => setVkBrutto(Number(e.target.value) || 0)}
                    className="w-20 text-right text-xs rounded border border-blue-300 px-1 py-0.5 tabular-nums font-normal"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-neutral-400">Gewerbe</span>
                  <input
                    type="number"
                    step="0.01"
                    value={vkGewerbe}
                    onChange={(e) => setVkGewerbe(Number(e.target.value) || 0)}
                    className="w-20 text-right text-xs rounded border border-blue-300 px-1 py-0.5 tabular-nums font-normal"
                  />
                </div>
              </div>
              <button onClick={saveVk} disabled={isPending} className="p-1 text-green-600 hover:text-green-800">
                <Check size={14} />
              </button>
              <button onClick={() => setEditingVk(false)} className="p-1 text-neutral-400 hover:text-neutral-700">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1 group/vk">
              {vkDisplay ? `€${vkDisplay.toLocaleString("de-DE")}` : <span className="text-neutral-300">—</span>}
              <button
                onClick={() => {
                  setVkBrutto(row.vk?.brutto ?? 0);
                  setVkGewerbe(row.vk?.gewerbe ?? 0);
                  setEditingVk(true);
                }}
                className="opacity-0 group-hover/vk:opacity-100 p-0.5 text-neutral-400 hover:text-neutral-700 transition"
              >
                <Pencil size={11} />
              </button>
            </div>
          )}
        </td>
        <td className="text-right px-3 py-2.5">
          {aufschlagPct != null ? (
            <span className={`tabular-nums font-semibold ${aufschlagColor}`}>{aufschlagPct.toFixed(1)}%</span>
          ) : <span className="text-neutral-300">—</span>}
        </td>
        <td className="text-right px-4 py-2.5">
          {margePct != null ? (
            <span className={`tabular-nums font-semibold ${margeColor}`}>{margePct.toFixed(1)}%</span>
          ) : <span className="text-neutral-300">—</span>}
        </td>
      </tr>

      {expanded && (
        <CategoryBreakdown
          row={row}
          vkMode={vkMode}
          zollFactor={zollFactor}
          ekInEur={ekInEur}
          usdEurRate={usdEurRate}
          supplierColors={supplierColors}
          locale={locale}
          isLastParent={isLast}
        />
      )}
    </>
  );
}

/* ── Category Breakdown ──────────────────────────────────────────── */

function CategoryBreakdown({
  row,
  vkMode,
  zollFactor,
  ekInEur,
  usdEurRate,
  supplierColors,
  locale,
  isLastParent,
}: {
  row: ProductRow;
  vkMode: VkMode;
  zollFactor: number;
  ekInEur: boolean;
  usdEurRate: number;
  supplierColors: SupplierColor[];
  locale: Locale;
  isLastParent: boolean;
}) {
  const vkNetto = row.vk ? row.vk.netto : null;

  return (
    <>
      {row.categories.map(({ entry, ek }, i) => {
        const ekWithZoll = ek != null ? ek * zollFactor : null;
        const ekForMargin = ekWithZoll != null ? (ekInEur ? ekWithZoll * usdEurRate : ekWithZoll) : null;
        const marginPct = ekForMargin && vkNetto ? ((vkNetto - ekForMargin) / ekForMargin) * 100 : null;
        const isLastCat = i === row.categories.length - 1;
        return (
          <CategoryRow
            key={entry.id}
            entry={entry}
            ek={ek}
            method={row.method}
            vkMode={vkMode}
            ekWithZoll={ekWithZoll}
            ekInEur={ekInEur}
            usdEurRate={usdEurRate}
            marginPct={marginPct}
            supplierColors={supplierColors}
            lengthValues={row.lengthValues}
            locale={locale}
            showBorder={!isLastCat || !isLastParent}
          />
        );
      })}
    </>
  );
}

/* ── Category Row ────────────────────────────────────────────────── */

function CategoryRow({
  entry,
  ek,
  method,
  vkMode,
  ekWithZoll,
  ekInEur,
  usdEurRate,
  marginPct,
  supplierColors,
  lengthValues,
  locale,
  showBorder,
}: {
  entry: EntryType;
  ek: number | null;
  method: string;
  vkMode: VkMode;
  ekWithZoll: number | null;
  ekInEur: boolean;
  usdEurRate: number;
  marginPct: number | null;
  supplierColors: SupplierColor[];
  lengthValues: string[];
  locale: Locale;
  showBorder: boolean;
}) {
  const [showProducts, setShowProducts] = useState(false);
  const [editingEk, setEditingEk] = useState(false);
  const [editEk, setEditEk] = useState(ek ?? 0);
  const [isPending, startTransition] = useTransition();

  const filteredMapped = entry.mapped_products.filter(
    (mp) => lengthValues.length === 0 || lengthValues.includes(mp.length_value),
  );
  const mappedCount = new Set(filteredMapped.map((mp) => mp.color.name_hairvenly)).size;

  // marginPct is Aufschlag (passed from parent, calculated as (VK-EK)/EK)
  const aufschlagPct = marginPct;
  const margePctLocal = ekWithZoll && aufschlagPct != null
    ? ((aufschlagPct / 100) / (1 + aufschlagPct / 100)) * 100
    : null;

  function saveEk() {
    startTransition(async () => {
      await updatePriceEntry(entry.id, {
        ...entry.prices,
        [method]: editEk,
      });
      setEditingEk(false);
    });
  }

  const aufschlagColor =
    aufschlagPct == null ? "" : aufschlagPct >= 80 ? "text-green-600" : aufschlagPct >= 50 ? "text-yellow-600" : "text-red-600";
  const margeColor =
    margePctLocal == null ? "" : margePctLocal >= 40 ? "text-green-600" : margePctLocal >= 30 ? "text-yellow-600" : "text-red-600";

  return (
    <>
      <tr
        onClick={() => setShowProducts(!showProducts)}
        className="bg-neutral-50/40 hover:bg-neutral-100/50 cursor-pointer transition"
      >
        {/* Category name — w-[30%] to match parent table */}
        <td className="pl-10 pr-2 py-1.5 w-[30%]">
          <div className="flex items-center gap-1.5">
            <span className="text-neutral-400 shrink-0">
              {showProducts ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
            <span className="text-xs text-neutral-600 truncate">{entry.category.name}</span>
            {mappedCount > 0 && (
              <span className="text-[9px] text-neutral-400 bg-neutral-200/60 px-1.5 py-0.5 rounded-full shrink-0">
                {mappedCount}
              </span>
            )}
          </div>
        </td>
        {/* EK */}
        <td className="text-right px-3 py-1.5 tabular-nums text-xs text-neutral-600" onClick={(e) => e.stopPropagation()}>
          {editingEk ? (
            <div className="flex items-center gap-1 justify-end">
              <span className="text-neutral-400">$</span>
              <input
                type="number"
                step="0.01"
                value={editEk}
                onChange={(e) => setEditEk(Number(e.target.value) || 0)}
                className="w-20 text-right text-xs rounded border border-neutral-300 px-1 py-0.5 tabular-nums"
                autoFocus
              />
              <button onClick={saveEk} disabled={isPending} className="p-0.5 text-green-600 hover:text-green-800">
                <Check size={11} />
              </button>
              <button onClick={() => setEditingEk(false)} className="p-0.5 text-neutral-400 hover:text-neutral-700">
                <X size={11} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1 group/ek">
              <span>
                {ek != null
                  ? ekInEur
                    ? `€${Math.round(ek * usdEurRate).toLocaleString("de-DE")}`
                    : `$${ek.toLocaleString("de-DE")}`
                  : "—"}
              </span>
              <button
                onClick={() => {
                  setEditEk(ek ?? 0);
                  setEditingEk(true);
                }}
                className="opacity-0 group-hover/ek:opacity-100 p-0.5 text-neutral-400 hover:text-neutral-700 transition"
              >
                <Pencil size={10} />
              </button>
            </div>
          )}
        </td>
        {/* Zoll */}
        <td className="text-right px-3 py-1.5 tabular-nums text-xs text-neutral-400">
          {ekWithZoll != null
            ? ekInEur
              ? `€${Math.round(ekWithZoll * usdEurRate).toLocaleString("de-DE")}`
              : `$${Math.round(ekWithZoll).toLocaleString("de-DE")}`
            : ""}
        </td>
        {/* VK — empty in detail */}
        <td className="px-3 py-1.5" />
        {/* Aufschlag */}
        <td className="text-right px-3 py-1.5">
          {aufschlagPct != null && (
            <span className={`text-xs tabular-nums ${aufschlagColor}`}>{aufschlagPct.toFixed(0)}%</span>
          )}
        </td>
        {/* Marge */}
        <td className="text-right px-4 py-1.5">
          {margePctLocal != null && (
            <span className={`text-xs tabular-nums ${margeColor}`}>{margePctLocal.toFixed(0)}%</span>
          )}
        </td>
      </tr>

      {showProducts && (
        <tr>
          <td colSpan={6} className="pl-14 pr-4 pb-2 pt-0.5">
            <MappedProducts
              entry={entry}
              filteredMapped={filteredMapped}
              supplierColors={supplierColors}
              lengthValues={lengthValues}
              locale={locale}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/* ── Mapped Products ─────────────────────────────────────────────── */

function MappedProducts({
  entry,
  filteredMapped,
  supplierColors,
  lengthValues,
  locale,
}: {
  entry: EntryType;
  filteredMapped: EntryType["mapped_products"];
  supplierColors: SupplierColor[];
  lengthValues: string[];
  locale: Locale;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const mappedIds = new Set(entry.mapped_products.map((m) => m.product_color_id));
  const available = supplierColors.filter(
    (c) =>
      !mappedIds.has(c.id) &&
      (lengthValues.length === 0 || lengthValues.includes(c.length_value)) &&
      (search === "" ||
        c.name_hairvenly.toLowerCase().includes(search.toLowerCase()) ||
        (c.name_shopify ?? "").toLowerCase().includes(search.toLowerCase())),
  );

  // Deduplicate tags by color name — same color in multiple methods shows once
  const uniqueColors = useMemo(() => {
    const seen = new Map<string, { name: string; ids: string[] }>();
    for (const mp of filteredMapped) {
      const name = mp.color.name_hairvenly;
      const existing = seen.get(name);
      if (existing) {
        existing.ids.push(mp.id);
      } else {
        seen.set(name, { name, ids: [mp.id] });
      }
    }
    return Array.from(seen.values());
  }, [filteredMapped]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {uniqueColors.map((uc) => (
          <span
            key={uc.name}
            className="inline-flex items-center gap-1 text-[10px] bg-white border border-neutral-200 rounded px-1.5 py-0.5"
          >
            <span className="font-medium text-neutral-700">{uc.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                startTransition(async () => {
                  for (const id of uc.ids) await unmapProduct(id);
                });
              }}
              disabled={isPending}
              className="text-neutral-300 hover:text-red-500 transition"
            >
              <X size={8} />
            </button>
          </span>
        ))}
        <button
          onClick={(e) => { e.stopPropagation(); setShowAdd(!showAdd); }}
          className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-neutral-700 border border-dashed border-neutral-300 rounded px-1.5 py-0.5 transition"
        >
          <Plus size={9} />
        </button>
      </div>

      {showAdd && (
        <div className="bg-white border border-neutral-200 rounded-lg p-2 space-y-1.5 max-w-sm" onClick={(e) => e.stopPropagation()}>
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1.5 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Farbe suchen..."
              className="w-full pl-6 pr-3 py-1 text-[10px] rounded border border-neutral-300 focus:ring-1 focus:ring-neutral-900"
            />
          </div>
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {available.slice(0, 30).map((c) => (
              <button
                key={c.id}
                onClick={() => startTransition(() => mapProductToCategory(entry.color_category_id, c.id))}
                disabled={isPending}
                className="w-full flex items-center justify-between text-[10px] px-2 py-1 rounded hover:bg-neutral-50 transition text-left"
              >
                <span className="font-medium text-neutral-900">{c.name_hairvenly}</span>
                <span className="text-neutral-400">{c.method_name} · {c.length_value}</span>
              </button>
            ))}
            {available.length === 0 && (
              <div className="text-[10px] text-neutral-400 text-center py-1">Keine verfügbaren Farben</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition, useMemo } from "react";
import { Plus, RefreshCw, Trash2, Edit2, ChevronDown, ChevronUp, Calendar, Search, FileSpreadsheet } from "lucide-react";
import {
  type ReturnWithItems,
  type ReturnType as RType,
  type ReturnStatus,
  RETURN_REASONS,
  RETURN_TYPES,
  RETURN_STATUSES,
  LENGTHS,
  ORIGINS,
  WEIGHTS,
  HANDLERS,
} from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";
import { createReturn, updateReturn, deleteReturn, syncReturnsFromShopify, importFromRetourenSheet, syncShopifyCollectionSales, backfillReturnCollections, refineStoredCollections, type SyncReport, type SheetImportReport } from "@/lib/actions/returns";

const STATUS_COLORS: Record<ReturnStatus, string> = {
  open: "bg-amber-50 text-amber-700",
  in_progress: "bg-blue-50 text-blue-700",
  resolved: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-neutral-100 text-neutral-500",
};

const TYPE_COLORS: Record<RType, string> = {
  return: "bg-red-50 text-red-700",
  exchange: "bg-orange-50 text-orange-700",
  complaint: "bg-purple-50 text-purple-700",
};

function StatusBadge({ status, locale }: { status: ReturnStatus; locale: Locale }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-neutral-100"}`}>
      {t(locale, `returns.status.${status}`)}
    </span>
  );
}

function TypeBadge({ type, locale }: { type: RType; locale: Locale }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[type] ?? "bg-neutral-100"}`}>
      {t(locale, `returns.type.${type}`)}
    </span>
  );
}

function formatChip(item: {
  product_type: string | null;
  color: string | null;
  length: string | null;
  weight: string | null;
}): string {
  // For manual entries: color + weight if present (no product_type)
  if (!item.product_type && item.color) {
    return [item.color, item.weight].filter(Boolean).join(" ");
  }

  if (!item.product_type) return "—";

  // For Shopify imports: product_type is the full product title like
  // "#NORVEGIAN KÜHLES BLOND US WELLIGE TAPE EXTENSIONS 55CM ♡"
  // Extract color code (starts with #), type, length.
  const raw = item.product_type.replace(/♡/g, "").trim();

  // Extract color code: everything from # to first occurrence of a type keyword
  const TYPE_KEYWORDS = /\b(US|RUSSISCHE?|USBEKISCHE?|WELLIGE?|GLATT|TAPE|TAPES|BONDING|BONDINGS|MINI|TRESSEN|WEFT|CLIP|EXTENSIONS?|PONYTAIL|INVISIBLE|CLASSIC|GENIUS|KERATIN|STANDARD)\b/i;
  const match = raw.match(TYPE_KEYWORDS);
  let color = raw;
  if (match?.index !== undefined && match.index > 0) {
    color = raw.slice(0, match.index).trim();
  }
  // Title case the color
  color = color
    .split(/\s+/)
    .map((w) => (w.startsWith("#") ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");

  // Extract length (45cm, 55cm, 63cm, 65cm, 85cm)
  const lengthMatch = raw.match(/\b(\d{2})\s*CM\b/i);
  const length = lengthMatch ? `${lengthMatch[1]}cm` : "";

  // Extract product type
  let type = "";
  if (/TAPE/i.test(raw) && /MINI/i.test(raw)) type = "Mini Tapes";
  else if (/TAPE/i.test(raw)) type = "Tapes";
  else if (/BONDING/i.test(raw)) type = "Bondings";
  else if (/CLIP/i.test(raw)) type = "Clip ins";
  else if (/PONYTAIL/i.test(raw)) type = "Ponytails";
  else if (/GENIUS/i.test(raw)) type = "Genius Tressen";
  else if (/CLASSIC.*TRESS|TRESS.*CLASSIC/i.test(raw)) type = "Classic Tressen";
  else if (/INVISIBLE/i.test(raw)) type = "Invisible Tressen";
  else if (/TRESS/i.test(raw)) type = "Tressen";

  const parts = [color, type, length].filter(Boolean);
  return parts.join(" · ");
}

function ProductChips({
  items,
  isExchange,
  expanded,
  onToggle,
}: {
  items: { id: string; product_type: string | null; color: string | null; length: string | null; origin: string | null; weight: string | null; exchange_product: string | null; exchange_weight: string | null; exchange_tracking: string | null }[];
  isExchange: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (items.length === 0) return <span className="text-neutral-400 text-xs">—</span>;

  const visible = expanded ? items : items.slice(0, 3);
  const hidden = items.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1 max-w-[220px]">
      {visible.map((item) => {
        const tooltip = [item.product_type, item.color, item.weight]
          .filter(Boolean)
          .join(" · ");
        return (
          <span key={item.id}
            title={tooltip}
            className="inline-flex items-center gap-1 bg-neutral-100 text-neutral-700 text-[11px] font-medium rounded-full px-2 py-0.5 max-w-full">
            <span className="truncate">{formatChip(item)}</span>
            {isExchange && item.exchange_product && (
              <span className="text-orange-600 shrink-0">→ {item.exchange_weight ?? ""}</span>
            )}
          </span>
        );
      })}
      {hidden > 0 && (
        <button type="button" onClick={onToggle}
          className="inline-flex items-center gap-0.5 text-[11px] text-neutral-500 hover:text-neutral-900 bg-neutral-50 hover:bg-neutral-100 rounded-full px-2 py-0.5">
          +{hidden} <ChevronDown size={10} />
        </button>
      )}
      {expanded && items.length > 3 && (
        <button type="button" onClick={onToggle}
          className="inline-flex items-center gap-0.5 text-[11px] text-neutral-500 hover:text-neutral-900 bg-neutral-50 hover:bg-neutral-100 rounded-full px-2 py-0.5">
          <ChevronUp size={10} />
        </button>
      )}
    </div>
  );
}

function InlineSelect({
  value,
  options,
  onChange,
  className = "",
  ariaLabel,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <span className={`group relative inline-flex items-center gap-0.5 rounded-full text-xs font-medium pl-2 pr-1 py-0.5 hover:ring-1 hover:ring-neutral-300 transition ${className}`}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          e.stopPropagation();
          onChange(e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
        className="appearance-none cursor-pointer bg-transparent border-0 outline-none pr-3 focus:ring-0 font-medium"
        style={{ backgroundImage: "none" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={10} className="absolute right-1.5 opacity-50 group-hover:opacity-100 pointer-events-none" />
    </span>
  );
}

function shopifyOrderUrl(shopifyOrderId: string | null, orderNumber: string | null): string | null {
  // Direct link if we have the GID: gid://shopify/Order/1234567890
  if (shopifyOrderId) {
    const match = shopifyOrderId.match(/Order\/(\d+)/);
    if (match) return `https://admin.shopify.com/store/339520-3/orders/${match[1]}`;
  }
  // Fallback: search by order number
  if (orderNumber) {
    return `https://admin.shopify.com/store/339520-3/orders?query=${encodeURIComponent(orderNumber.replace("#", ""))}`;
  }
  return null;
}

// ── Date range helpers ─────────────────────────────────────────

type DatePreset = "all" | "this_month" | "last_month" | "last_3_months" | "custom";

function getPresetRange(preset: DatePreset): { from: string; to: string } | null {
  if (preset === "all") return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  if (preset === "this_month") {
    return {
      from: `${y}-${String(m + 1).padStart(2, "0")}-01`,
      to: new Date(y, m + 1, 0).toISOString().split("T")[0],
    };
  }
  if (preset === "last_month") {
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    return {
      from: `${py}-${String(pm + 1).padStart(2, "0")}-01`,
      to: new Date(py, pm + 1, 0).toISOString().split("T")[0],
    };
  }
  if (preset === "last_3_months") {
    const d = new Date(y, m - 2, 1);
    return {
      from: d.toISOString().split("T")[0],
      to: now.toISOString().split("T")[0],
    };
  }
  return null;
}

// ── Sync Dialog ────────────────────────────────────────────────

function SyncDialog({
  locale,
  onClose,
  onSync,
  syncing,
  report,
}: {
  locale: Locale;
  onClose: () => void;
  onSync: (from: string, to: string) => void;
  syncing: boolean;
  report: SyncReport | null;
}) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const [syncFrom, setSyncFrom] = useState(threeMonthsAgo.toISOString().split("T")[0]);
  const [syncTo, setSyncTo] = useState(new Date().toISOString().split("T")[0]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">
          {t(locale, "returns.sync_title")}
        </h2>

        {report ? (
          /* ── Report after sync ── */
          <div className="space-y-4">
            {report.error ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                {report.error}
              </div>
            ) : (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-700">
                {t(locale, "returns.sync_success")}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-neutral-50 rounded-lg p-3">
                <div className="text-xs text-neutral-500 uppercase tracking-wide">{t(locale, "returns.sync_report_found")}</div>
                <div className="text-lg font-semibold text-neutral-900">{report.refundedOrdersFound}</div>
              </div>
              <div className="bg-neutral-50 rounded-lg p-3">
                <div className="text-xs text-neutral-500 uppercase tracking-wide">{t(locale, "returns.sync_report_imported")}</div>
                <div className="text-lg font-semibold text-emerald-700">{report.synced}</div>
              </div>
              <div className="bg-neutral-50 rounded-lg p-3">
                <div className="text-xs text-neutral-500 uppercase tracking-wide">{t(locale, "returns.sync_report_skipped")}</div>
                <div className="text-lg font-semibold text-neutral-500">{report.skipped}</div>
              </div>
              <div className="bg-neutral-50 rounded-lg p-3">
                <div className="text-xs text-neutral-500 uppercase tracking-wide">{t(locale, "returns.sync_report_refund")}</div>
                <div className="text-lg font-semibold text-neutral-900">{report.totalRefundAmount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</div>
              </div>
            </div>
            {(report.updated ?? 0) > 0 && (
              <p className="text-xs text-blue-600">{report.updated} vorhandene Retouren mit Kundennamen aktualisiert</p>
            )}
            {report.shopifyReturnsFound > 0 && (
              <p className="text-xs text-neutral-400">{report.shopifyReturnsFound} Shopify Returns gefunden (Returns API)</p>
            )}
            <div className="flex justify-end">
              <button onClick={onClose}
                className="px-4 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition">
                {t(locale, "returns.sync_close")}
              </button>
            </div>
          </div>
        ) : (
          /* ── Input form ── */
          <>
            <p className="text-sm text-neutral-500 mb-4">
              {t(locale, "returns.sync_description")}
            </p>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.sync_from")}</label>
                <input type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.sync_to")}</label>
                <input type="date" value={syncTo} onChange={(e) => setSyncTo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 rounded-lg transition">
                {t(locale, "returns.cancel")}
              </button>
              <button onClick={() => onSync(syncFrom, syncTo)} disabled={syncing}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition disabled:opacity-50">
                <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                {syncing ? t(locale, "returns.syncing") : t(locale, "returns.sync_start")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Searchable dropdown with search ────────────────────────────

function SearchableSelect({
  name,
  defaultValue,
  options,
  placeholder,
  wide,
}: {
  name: string;
  defaultValue: string;
  options: string[];
  placeholder: string;
  wide?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);

  const filtered = useMemo(() => {
    if (!search) return options.slice(0, 80);
    const q = search.toLowerCase();
    return options.filter((c) => c.toLowerCase().includes(q)).slice(0, 80);
  }, [options, search]);

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full rounded border border-neutral-300 px-2 py-1.5 text-xs text-left truncate hover:bg-neutral-50">
        {value || <span className="text-neutral-400">{placeholder}</span>}
      </button>
      {open && (
        <div className={`absolute z-50 top-full left-0 mt-1 ${wide ? "w-96" : "w-64"} bg-white border border-neutral-200 rounded-xl shadow-lg py-1 max-h-72 overflow-hidden flex flex-col`}>
          <div className="px-2 py-1.5 border-b border-neutral-100">
            <div className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2 py-1">
              <Search size={12} className="text-neutral-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
                placeholder="Suche..."
                className="flex-1 text-xs outline-none bg-transparent" />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            <button type="button" onClick={() => { setValue(""); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-50 text-neutral-400">—</button>
            {filtered.map((c) => (
              <button key={c} type="button" onClick={() => { setValue(c); setOpen(false); setSearch(""); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-50 ${c === value ? "bg-neutral-100 font-medium" : ""}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Form Dialog ────────────────────────────────────────────────

function ReturnFormDialog({
  locale,
  editReturn,
  onClose,
  catalogColors,
  shopifyProductTitles,
  handlerOptions,
}: {
  locale: Locale;
  editReturn?: ReturnWithItems | null;
  onClose: () => void;
  catalogColors: string[];
  shopifyProductTitles: string[];
  handlerOptions: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [itemCount, setItemCount] = useState(editReturn?.items.length || 1);
  const [returnType, setReturnType] = useState<RType>(editReturn?.return_type ?? "return");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      let result;
      if (editReturn) {
        formData.set("_old_status", editReturn.status);
        result = await updateReturn(editReturn.id, formData);
      } else {
        result = await createReturn(null, formData);
      }
      if (result && "error" in result && result.error) {
        setError(result.error);
      } else {
        onClose();
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center pt-[5vh] z-50 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 my-8">
        <form action={handleSubmit}>
          <div className="p-6 border-b border-neutral-200">
            <h2 className="text-lg font-semibold text-neutral-900">
              {editReturn ? t(locale, "returns.edit") : t(locale, "returns.create")}
            </h2>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Basic fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.customer_name")}</label>
                <input name="customer_name" defaultValue={editReturn?.customer_name ?? ""} required
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.order_number")}</label>
                <input name="order_number" defaultValue={editReturn?.order_number ?? ""}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.type_label")}</label>
                <select name="return_type" value={returnType} onChange={(e) => setReturnType(e.target.value as RType)}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none">
                  {RETURN_TYPES.map((rt) => (
                    <option key={rt} value={rt}>{t(locale, `returns.type.${rt}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.reason")}</label>
                <select name="reason" defaultValue={editReturn?.reason ?? ""}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none">
                  <option value="">—</option>
                  {RETURN_REASONS.map((r) => (
                    <option key={r} value={r}>{t(locale, `returns.reason.${r}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.handler")}</label>
                <select name="handler" defaultValue={editReturn?.handler ?? ""}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none">
                  <option value="">—</option>
                  {handlerOptions.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.status_label")}</label>
                <select name="status" defaultValue={editReturn?.status ?? "open"}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none">
                  {RETURN_STATUSES.map((s) => (
                    <option key={s} value={s}>{t(locale, `returns.status.${s}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.initiated_at")}</label>
                <input type="date" name="initiated_at" defaultValue={editReturn?.initiated_at ?? new Date().toISOString().split("T")[0]}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.refund_amount")}</label>
                <input type="number" step="0.01" name="refund_amount" defaultValue={editReturn?.refund_amount ?? ""}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none" />
              </div>
            </div>

            {/* Reklamation fields */}
            {returnType === "complaint" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.resolution_result")}</label>
                  <input name="resolution_result" defaultValue={editReturn?.resolution_result ?? ""}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.resolution")}</label>
                  <input name="resolution" defaultValue={editReturn?.resolution ?? ""}
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none" />
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t(locale, "returns.notes")}</label>
              <textarea name="notes" rows={2} defaultValue={editReturn?.notes ?? ""}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none" />
            </div>

            {/* Product items */}
            <div className="border-t border-neutral-200 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-neutral-900">{t(locale, "returns.products")}</h3>
                <button type="button" onClick={() => setItemCount((c) => c + 1)}
                  className="text-xs text-neutral-600 hover:text-neutral-900 flex items-center gap-1">
                  <Plus size={14} /> {t(locale, "returns.add_item")}
                </button>
              </div>
              {Array.from({ length: itemCount }, (_, i) => {
                const existing = editReturn?.items[i];
                return (
                  <div key={i} className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-2 p-2 bg-neutral-50 rounded-lg">
                    <div className="col-span-3 sm:col-span-2">
                      <SearchableSelect
                        name={`item_${i}_product_type`}
                        defaultValue={existing?.product_type ?? ""}
                        options={shopifyProductTitles}
                        placeholder={t(locale, "returns.product_type")}
                        wide
                      />
                    </div>
                    <SearchableSelect
                      name={`item_${i}_color`}
                      defaultValue={existing?.color ?? ""}
                      options={catalogColors}
                      placeholder={t(locale, "returns.color")}
                    />
                    <select name={`item_${i}_length`} defaultValue={existing?.length ?? ""}
                      className="rounded border border-neutral-300 px-2 py-1.5 text-xs">
                      <option value="">{t(locale, "returns.length")}</option>
                      {LENGTHS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <select name={`item_${i}_origin`} defaultValue={existing?.origin ?? ""}
                      className="rounded border border-neutral-300 px-2 py-1.5 text-xs">
                      <option value="">{t(locale, "returns.origin")}</option>
                      {ORIGINS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <select name={`item_${i}_weight`} defaultValue={existing?.weight ?? ""}
                      className="rounded border border-neutral-300 px-2 py-1.5 text-xs">
                      <option value="">{t(locale, "returns.weight")}</option>
                      {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                    {returnType === "complaint" && (
                      <input name={`item_${i}_quality`} placeholder={t(locale, "returns.quality")} defaultValue={existing?.quality ?? ""}
                        className="rounded border border-neutral-300 px-2 py-1.5 text-xs" />
                    )}
                    {returnType === "exchange" && (
                      <>
                        <div className="col-span-2">
                          <SearchableSelect
                            name={`item_${i}_exchange_product`}
                            defaultValue={existing?.exchange_product ?? ""}
                            options={shopifyProductTitles}
                            placeholder={t(locale, "returns.exchange_product")}
                            wide
                          />
                        </div>
                        <select name={`item_${i}_exchange_weight`} defaultValue={existing?.exchange_weight ?? ""}
                          className="rounded border border-neutral-300 px-2 py-1.5 text-xs">
                          <option value="">{t(locale, "returns.exchange_weight")}</option>
                          {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
                        </select>
                        <input name={`item_${i}_exchange_tracking`} placeholder={t(locale, "returns.exchange_tracking")} defaultValue={existing?.exchange_tracking ?? ""}
                          className="rounded border border-neutral-300 px-2 py-1.5 text-xs col-span-2" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-6 border-t border-neutral-200 flex justify-end gap-3">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 rounded-lg transition">
              {t(locale, "returns.cancel")}
            </button>
            <button type="submit" disabled={pending}
              className="px-4 py-2 text-sm font-medium bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition disabled:opacity-50">
              {pending ? "..." : editReturn ? t(locale, "returns.save") : t(locale, "returns.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main List ──────────────────────────────────────────────────

export default function ReturnsList({
  returns,
  locale,
  isAdmin,
  catalogColors,
  shopifyProductTitles,
  employees,
  syncInfo,
}: {
  returns: ReturnWithItems[];
  locale: Locale;
  isAdmin: boolean;
  catalogColors: string[];
  shopifyProductTitles: string[];
  employees: { id: string; name: string }[];
  syncInfo?: { lastSyncAt: string | null; coverageFrom: string | null; coverageTo: string | null };
}) {
  // Dropdown options: DB employees + legacy hardcoded names so historical
  // entries like "ibo" / "ceylan" / "Larissa" keep rendering cleanly.
  const employeeNames = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees) set.add(e.name);
    for (const h of HANDLERS) set.add(h);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [employees]);
  const [typeFilter, setTypeFilter] = useState<RType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ReturnStatus | "all">("all");
  const [handlerFilter, setHandlerFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "shopify" | "manual">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editReturn, setEditReturn] = useState<ReturnWithItems | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, startSync] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [importingSheet, startSheetImport] = useTransition();
  const [sheetReport, setSheetReport] = useState<SheetImportReport | null>(null);
  const [syncingCollections, startCollectionSync] = useTransition();
  const [collectionResult, setCollectionResult] = useState<string | null>(null);

  // Compute active date range
  const dateRange = useMemo(() => {
    if (datePreset === "custom" && customFrom) {
      return { from: customFrom, to: customTo || "9999-12-31" };
    }
    return getPresetRange(datePreset);
  }, [datePreset, customFrom, customTo]);

  const filtered = useMemo(() => {
    return returns.filter((r) => {
      if (typeFilter !== "all" && r.return_type !== typeFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (handlerFilter !== "all" && r.handler !== handlerFilter) return false;
      if (sourceFilter !== "all") {
        const isShopify = Boolean(r.shopify_refund_id || r.shopify_return_id);
        if (sourceFilter === "shopify" && !isShopify) return false;
        if (sourceFilter === "manual" && isShopify) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const order = (r.order_number ?? "").toLowerCase();
        const customer = (r.customer_name ?? "").toLowerCase();
        if (!order.includes(q) && !customer.includes(q)) return false;
      }
      if (dateRange && r.initiated_at) {
        if (r.initiated_at < dateRange.from) return false;
        if (r.initiated_at > dateRange.to) return false;
      }
      if (dateRange && !r.initiated_at) return false;
      return true;
    });
  }, [returns, typeFilter, statusFilter, handlerFilter, sourceFilter, searchQuery, dateRange]);

  const handleSync = (from: string, to: string) => {
    startSync(async () => {
      setSyncReport(null);
      const result = await syncReturnsFromShopify(from, to);
      setSyncReport(result);
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm(t(locale, "returns.confirm_delete"))) return;
    startDelete(async () => {
      await deleteReturn(id);
    });
  };

  const handleSheetImport = () => {
    startSheetImport(async () => {
      setSheetReport(null);
      const r = await importFromRetourenSheet();
      setSheetReport(r);
    });
  };

  const handleCollectionSync = () => {
    startCollectionSync(async () => {
      setCollectionResult(null);
      // Step 1: Refine existing return_items using product_type heuristic (no API call)
      const refineResult = await refineStoredCollections();
      // Step 2: Re-sync sales from Shopify with updated refinement logic
      const sales = await syncShopifyCollectionSales();
      // Step 3: Re-fetch collections from Shopify for returns without one
      const backfill = await backfillReturnCollections();

      if (sales.error) setCollectionResult(`Fehler: ${sales.error}`);
      else {
        const parts: string[] = [];
        if (refineResult.updatedReturns > 0) parts.push(`${refineResult.updatedReturns} Retouren neu zugeordnet`);
        parts.push(`${sales.synced} Sales-Zeilen`);
        if (backfill.updated > 0) parts.push(`${backfill.updated} Collections gefüllt`);
        setCollectionResult(parts.join(" · "));
      }
    });
  };

  const handleInlineUpdate = (r: ReturnWithItems, field: "return_type" | "reason" | "status" | "handler", value: string) => {
    const fd = new FormData();
    fd.set(field, value);
    if (field === "status") fd.set("_old_status", r.status);
    updateReturn(r.id, fd);
  };

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    // Parse YYYY-MM-DD (or ISO) without timezone conversion to avoid SSR/CSR mismatch
    const dateStr = d.split("T")[0];
    const [y, m, day] = dateStr.split("-");
    if (!y || !m || !day) return d;
    return `${parseInt(day, 10)}.${parseInt(m, 10)}.${y}`;
  };

  return (
    <>
      {/* Filters Row 1: Type, Status, Handler */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as RType | "all")}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
          <option value="all">{t(locale, "returns.all_types")}</option>
          {RETURN_TYPES.map((rt) => (
            <option key={rt} value={rt}>{t(locale, `returns.type.${rt}`)}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ReturnStatus | "all")}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
          <option value="all">{t(locale, "returns.all_statuses")}</option>
          {RETURN_STATUSES.map((s) => (
            <option key={s} value={s}>{t(locale, `returns.status.${s}`)}</option>
          ))}
        </select>
        <select value={handlerFilter} onChange={(e) => setHandlerFilter(e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
          <option value="all">{t(locale, "returns.all_handlers")}</option>
          {employeeNames.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as "all" | "shopify" | "manual")}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
          <option value="all">Alle Quellen</option>
          <option value="shopify">Nur Shopify</option>
          <option value="manual">Nur manuell</option>
        </select>
        <div className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm min-w-[220px]">
          <Search size={14} className="text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Bestellnr. oder Kunde…"
            className="flex-1 outline-none bg-transparent"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-neutral-400 hover:text-neutral-700 text-xs">×</button>
          )}
        </div>

        {/* Date range filter */}
        <div className="flex items-center gap-2 border-l border-neutral-200 pl-3 ml-1">
          <Calendar size={14} className="text-neutral-400" />
          <select value={datePreset} onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
            <option value="all">{t(locale, "returns.date_all")}</option>
            <option value="this_month">{t(locale, "returns.date_this_month")}</option>
            <option value="last_month">{t(locale, "returns.date_last_month")}</option>
            <option value="last_3_months">{t(locale, "returns.date_last_3_months")}</option>
            <option value="custom">{t(locale, "returns.date_custom")}</option>
          </select>
          {datePreset === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2 py-2 text-sm w-[140px]" />
              <span className="text-xs text-neutral-400">–</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2 py-2 text-sm w-[140px]" />
            </>
          )}
        </div>

        <div className="flex-1" />

        {syncReport && !showSyncDialog && (
          <span className="text-xs text-neutral-500">
            {syncReport.synced} importiert, {syncReport.skipped} übersprungen
            {syncReport.updated ? `, ${syncReport.updated} aktualisiert` : ""}
          </span>
        )}

        {isAdmin && (
          <>
            <div className="flex flex-col items-end">
              <button onClick={handleSheetImport} disabled={importingSheet}
                className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700 px-3 py-2 rounded-lg border border-neutral-300 hover:bg-neutral-50 transition disabled:opacity-50"
                title="Daten aus dem Google Sheet 'Retouren 2026' importieren (Gründe, Bearbeiter, Lösungen)">
                <FileSpreadsheet size={14} className={importingSheet ? "animate-pulse" : ""} />
                {importingSheet ? "Importiere..." : "Sheet Import"}
              </button>
              {sheetReport && !sheetReport.error && (
                <div className="text-[10px] text-neutral-400 mt-1 text-right leading-tight">
                  {sheetReport.inserted} neu · {sheetReport.updated} aktualisiert · {sheetReport.skipped} übersprungen
                </div>
              )}
              {sheetReport?.error && (
                <div className="text-[10px] text-red-500 mt-1 text-right leading-tight">{sheetReport.error}</div>
              )}
            </div>
            <div className="flex flex-col items-end">
              <button onClick={handleCollectionSync} disabled={syncingCollections}
                className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700 px-3 py-2 rounded-lg border border-neutral-300 hover:bg-neutral-50 transition disabled:opacity-50"
                title="Shopify Collections + Sales für Rückgabequote pro Collection synchronisieren (dauert 1-3 Min)">
                <RefreshCw size={14} className={syncingCollections ? "animate-spin" : ""} />
                {syncingCollections ? "Collections..." : "Collections Sync"}
              </button>
              {collectionResult && (
                <div className="text-[10px] text-neutral-400 mt-1 text-right leading-tight max-w-[240px]">
                  {collectionResult}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end">
              <button onClick={() => { setSyncReport(null); setShowSyncDialog(true); }} disabled={syncing}
                className="inline-flex items-center gap-2 text-sm font-medium text-neutral-700 px-3 py-2 rounded-lg border border-neutral-300 hover:bg-neutral-50 transition disabled:opacity-50">
                <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                Shopify Sync
              </button>
              {syncInfo && (syncInfo.lastSyncAt || syncInfo.coverageFrom) && (
                <div className="text-[10px] text-neutral-400 mt-1 text-right leading-tight">
                  {syncInfo.lastSyncAt && (
                    <div>{t(locale, "returns.last_sync")}: {formatDate(syncInfo.lastSyncAt)}</div>
                  )}
                  {syncInfo.coverageFrom && syncInfo.coverageTo && (
                    <div>{t(locale, "returns.sync_coverage")}: {formatDate(syncInfo.coverageFrom)} – {formatDate(syncInfo.coverageTo)}</div>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => { setEditReturn(null); setShowForm(true); }}
              className="inline-flex items-center gap-2 bg-neutral-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-neutral-800 transition">
              <Plus size={16} /> {t(locale, "returns.create")}
            </button>
          </>
        )}
      </div>

      {/* Stats row — based on filtered data */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["return", "exchange", "complaint"] as RType[]).map((rt) => {
          const count = filtered.filter((r) => r.return_type === rt).length;
          return (
            <div key={rt} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
              <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                {t(locale, `returns.type.${rt}`)}
              </div>
              <div className="text-2xl font-semibold text-neutral-900 mt-1">{count}</div>
            </div>
          );
        })}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
            {t(locale, "returns.total_refund")}
          </div>
          <div className="text-2xl font-semibold text-neutral-900 mt-1">
            {filtered.reduce((sum, r) => sum + (r.refund_amount ?? 0), 0).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </div>
        </div>
      </div>

      {/* Filtered count indicator */}
      {dateRange && (
        <p className="text-xs text-neutral-400">
          {filtered.length} von {returns.length} {t(locale, "returns.filtered")}
        </p>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-neutral-500 text-sm">
            {t(locale, "returns.no_returns")}
          </div>
        ) : (
          <>
            {/* Desktop table — scrolls horizontally only if viewport is extremely narrow */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm table-auto">
              <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">{t(locale, "returns.date")}</th>
                  <th className="px-3 py-2.5 font-medium">{t(locale, "returns.order_number")}</th>
                  <th className="px-3 py-2.5 font-medium">{t(locale, "returns.type_label")}</th>
                  <th className="px-3 py-2.5 font-medium">{t(locale, "returns.reason")}</th>
                  <th className="px-3 py-2.5 font-medium w-[220px]">{t(locale, "returns.products")}</th>
                  <th className="px-3 py-2.5 font-medium text-right">{t(locale, "returns.refund_amount")}</th>
                  <th className="px-3 py-2.5 font-medium">{t(locale, "returns.status_label")}</th>
                  <th className="px-3 py-2.5 font-medium">{t(locale, "returns.handler")}</th>
                  {isAdmin && <th className="px-3 py-2.5 font-medium w-20"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map((r) => {
                  const isExpanded = expandedId === r.id;
                  return (
                    <tr key={r.id} className="group">
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-neutral-500">{formatDate(r.initiated_at)}</div>
                        {isAdmin ? (
                          <button onClick={() => { setEditReturn(r); setShowForm(true); }}
                            className="font-medium text-neutral-900 text-sm hover:underline text-left">
                            {r.customer_name}
                          </button>
                        ) : (
                          <div className="font-medium text-neutral-900 text-sm">{r.customer_name}</div>
                        )}
                        {(r.notes || r.resolution) && (
                          <div className="mt-1.5 space-y-1">
                            {r.notes && (
                              <div className="text-xs text-neutral-600 bg-amber-50 border-l-2 border-amber-300 px-2 py-1 rounded whitespace-pre-wrap">
                                <span className="font-medium text-amber-700">📝 Notiz:</span> {r.notes}
                              </div>
                            )}
                            {r.resolution && <div className="text-[11px] text-purple-600">{t(locale, "returns.resolution")}: {r.resolution}</div>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-neutral-700">
                        {(() => {
                          const url = shopifyOrderUrl(r.shopify_order_id, r.order_number);
                          return r.order_number && url ? (
                            <a href={url} target="_blank" rel="noreferrer"
                              className="text-blue-600 hover:underline">
                              {r.order_number}
                            </a>
                          ) : r.order_number ?? "—";
                        })()}
                      </td>
                      <td className="px-3 py-2.5">
                        {isAdmin ? (
                          <InlineSelect
                            ariaLabel="Typ"
                            value={r.return_type}
                            className={TYPE_COLORS[r.return_type]}
                            options={RETURN_TYPES.map((rt) => ({ value: rt, label: t(locale, `returns.type.${rt}`) }))}
                            onChange={(v) => handleInlineUpdate(r, "return_type", v)}
                          />
                        ) : <TypeBadge type={r.return_type} locale={locale} />}
                      </td>
                      <td className="px-3 py-2.5 text-neutral-700 text-xs">
                        {isAdmin ? (
                          <InlineSelect
                            ariaLabel="Grund"
                            value={r.reason ?? ""}
                            className="bg-neutral-100 text-neutral-700"
                            options={[
                              { value: "", label: "—" },
                              ...RETURN_REASONS.map((rs) => ({ value: rs, label: t(locale, `returns.reason.${rs}`) })),
                            ]}
                            onChange={(v) => handleInlineUpdate(r, "reason", v)}
                          />
                        ) : (r.reason ? t(locale, `returns.reason.${r.reason}`) : "—")}
                      </td>
                      <td className="px-3 py-2.5">
                        <ProductChips
                          items={r.items}
                          isExchange={r.return_type === "exchange"}
                          expanded={isExpanded}
                          onToggle={() => setExpandedId(isExpanded ? null : r.id)}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right text-neutral-700 font-medium whitespace-nowrap">
                        {r.refund_amount != null ? `${Number(r.refund_amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €` : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {isAdmin ? (
                          <InlineSelect
                            ariaLabel="Status"
                            value={r.status}
                            className={STATUS_COLORS[r.status as ReturnStatus]}
                            options={RETURN_STATUSES.map((s) => ({ value: s, label: t(locale, `returns.status.${s}`) }))}
                            onChange={(v) => handleInlineUpdate(r, "status", v)}
                          />
                        ) : <StatusBadge status={r.status as ReturnStatus} locale={locale} />}
                      </td>
                      <td className="px-3 py-2.5 text-neutral-700">
                        {isAdmin ? (
                          <InlineSelect
                            ariaLabel="Bearbeiter"
                            value={r.handler ?? ""}
                            className="bg-neutral-100 text-neutral-700"
                            options={[
                              { value: "", label: "—" },
                              ...employeeNames.map((h) => ({ value: h, label: h })),
                            ]}
                            onChange={(v) => handleInlineUpdate(r, "handler", v)}
                          />
                        ) : (r.handler ?? "—")}
                        {r.updated_at && (
                          <div className="text-[10px] text-neutral-400 mt-0.5">
                            {formatDate(r.updated_at)}
                          </div>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setEditReturn(r); setShowForm(true); }}
                              title={t(locale, "returns.edit")}
                              className="p-1.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded transition">
                              <Edit2 size={14} />
                            </button>
                            <button onClick={() => handleDelete(r.id)} disabled={deleting}
                              title={t(locale, "returns.confirm_delete")}
                              className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded transition">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-neutral-100">
              {filtered.map((r) => (
                <div key={r.id} className="px-3 py-2.5 space-y-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs text-neutral-500">{formatDate(r.initiated_at)}</div>
                      {isAdmin ? (
                        <button onClick={() => { setEditReturn(r); setShowForm(true); }}
                          className="font-medium text-neutral-900 text-sm hover:underline text-left">
                          {r.customer_name}
                        </button>
                      ) : (
                        <div className="font-medium text-neutral-900 text-sm">{r.customer_name}</div>
                      )}
                      <div className="text-xs text-neutral-500">
                        {(() => {
                          const url = shopifyOrderUrl(r.shopify_order_id, r.order_number);
                          return r.order_number && url ? (
                            <a href={url} target="_blank" rel="noreferrer"
                              className="text-blue-600 hover:underline">
                              {r.order_number}
                            </a>
                          ) : r.order_number ?? "";
                        })()}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <StatusBadge status={r.status as ReturnStatus} locale={locale} />
                      {r.refund_amount != null && (
                        <div className="text-sm font-semibold text-neutral-900 mt-1">
                          {Number(r.refund_amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <TypeBadge type={r.return_type} locale={locale} />
                    {r.reason && (
                      <span className="text-xs text-neutral-500">{t(locale, `returns.reason.${r.reason}`)}</span>
                    )}
                  </div>
                  {r.items.length > 0 && (
                    <ProductChips
                      items={r.items}
                      isExchange={r.return_type === "exchange"}
                      expanded={expandedId === r.id}
                      onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    />
                  )}
                  {r.notes && (
                    <div className="text-xs text-neutral-600 bg-amber-50 border-l-2 border-amber-300 px-2 py-1 rounded whitespace-pre-wrap">
                      <span className="font-medium text-amber-700">📝 Notiz:</span> {r.notes}
                    </div>
                  )}
                  {isAdmin && (
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => { setEditReturn(r); setShowForm(true); }}
                        className="text-xs text-neutral-600 hover:text-neutral-900">
                        <Edit2 size={12} />
                      </button>
                      <button onClick={() => handleDelete(r.id)}
                        className="text-xs text-red-600 hover:text-red-800">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Form dialog */}
      {showForm && (
        <ReturnFormDialog
          locale={locale}
          editReturn={editReturn}
          onClose={() => { setShowForm(false); setEditReturn(null); }}
          catalogColors={catalogColors}
          shopifyProductTitles={shopifyProductTitles}
          handlerOptions={employeeNames}
        />
      )}

      {/* Sync dialog */}
      {showSyncDialog && (
        <SyncDialog
          locale={locale}
          onClose={() => { setShowSyncDialog(false); }}
          onSync={handleSync}
          syncing={syncing}
          report={syncReport}
        />
      )}
    </>
  );
}

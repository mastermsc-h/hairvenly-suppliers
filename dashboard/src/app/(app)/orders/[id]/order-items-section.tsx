"use client";

import { useState, useTransition, useMemo } from "react";
import {
  ChevronDown, ChevronRight, FileSpreadsheet, ExternalLink, Loader2, FileDown,
  Plus, X, Trash2, RefreshCw, AlertCircle, Search,
} from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import {
  exportOrderToGoogleSheet, generateAndUploadPDF,
  updateOrderItemQuantity, deleteOrderItem, addOrderItem,
} from "@/lib/actions/orders";
import type { OrderItem, OrderStatus, CatalogMethod, ProductColor } from "@/lib/types";

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
  canEdit: boolean;
  orderStatus: OrderStatus;
  pendingResync: boolean;
  catalog: CatalogMethod[];
}

const fmt = (n: number) => new Intl.NumberFormat("de-DE").format(n);

const EDITABLE_STATUSES: OrderStatus[] = ["draft", "sent_to_supplier", "confirmed", "in_production"];

const METHOD_COLORS: Record<string, { bg: string; text: string; border: string; chip: string }> = {
  Bondings: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", chip: "bg-purple-100 text-purple-700" },
  "Standard Tapes": { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200", chip: "bg-pink-100 text-pink-700" },
  Minitapes: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", chip: "bg-rose-100 text-rose-700" },
  "Classic Weft": { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", chip: "bg-blue-100 text-blue-700" },
  "Invisible Weft": { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200", chip: "bg-cyan-100 text-cyan-700" },
  "Clip-ins": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", chip: "bg-amber-100 text-amber-700" },
  Tapes: { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", chip: "bg-indigo-100 text-indigo-700" },
  "Classic Tressen": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", chip: "bg-emerald-100 text-emerald-700" },
  "Genius Weft": { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", chip: "bg-teal-100 text-teal-700" },
};

const DEFAULT_COLOR = { bg: "bg-neutral-50", text: "text-neutral-700", border: "border-neutral-200", chip: "bg-neutral-100 text-neutral-700" };

function getMethodColor(method: string) {
  return METHOD_COLORS[method] ?? DEFAULT_COLOR;
}

export default function OrderItemsSection({
  items, itemGroups, totalQty, locale, sheetUrl, orderId, isAdmin,
  canEdit, orderStatus, pendingResync, catalog,
}: Props) {
  const [open, setOpen] = useState(false);
  const [exporting, startExport] = useTransition();
  const [generatingPdf, startPdf] = useTransition();
  const [exportError, setExportError] = useState("");
  const [currentSheetUrl, setCurrentSheetUrl] = useState(sheetUrl);
  const [showAddNewGroup, setShowAddNewGroup] = useState(false);

  const handleExport = () => {
    setExportError("");
    startExport(async () => {
      const result = await exportOrderToGoogleSheet(orderId);
      if (result.error) setExportError(result.error);
      else if (result.sheetUrl) setCurrentSheetUrl(result.sheetUrl);
    });
  };

  const handlePdf = () => {
    setExportError("");
    startPdf(async () => {
      const result = await generateAndUploadPDF(orderId);
      if (result.error) setExportError(result.error);
    });
  };

  const unit = items[0]?.unit ?? "g";
  const isEditable = canEdit && EDITABLE_STATUSES.includes(orderStatus);

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
            {pendingResync && (
              <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                <AlertCircle size={10} /> nicht synchronisiert
              </span>
            )}
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
          {/* Resync banner */}
          {pendingResync && isEditable && (
            <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-start gap-2 flex-1">
                <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900">
                  <div className="font-medium">Bestellung wurde geändert</div>
                  <div className="text-amber-700 mt-0.5">
                    Google Sheet & PDF sind veraltet — bitte neu erstellen, damit der Lieferant die aktuelle Liste sieht.
                  </div>
                </div>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition"
                  >
                    {exporting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Sheet
                  </button>
                  <button
                    onClick={handlePdf}
                    disabled={generatingPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                  >
                    {generatingPdf ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    PDF
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Groups */}
          <div className="mt-4 space-y-4">
            {itemGroups.map((group, gi) => {
              const methodName = group.items[0]?.method_name ?? "";
              const lengthValue = group.items[0]?.length_value ?? "";
              return (
                <GroupCard
                  key={gi}
                  group={group}
                  methodName={methodName}
                  lengthValue={lengthValue}
                  unit={unit}
                  orderId={orderId}
                  isEditable={isEditable}
                  catalog={catalog}
                />
              );
            })}
            {itemGroups.length === 0 && (
              <div className="text-center py-8 text-sm text-neutral-400">
                Noch keine Positionen — füge die erste hinzu.
              </div>
            )}
          </div>

          {/* Add completely new group */}
          {isEditable && (
            <div className="mt-4">
              {showAddNewGroup ? (
                <NewGroupForm
                  orderId={orderId}
                  catalog={catalog}
                  onClose={() => setShowAddNewGroup(false)}
                />
              ) : (
                <button
                  onClick={() => setShowAddNewGroup(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-neutral-300 text-sm font-medium text-neutral-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition"
                >
                  <Plus size={14} /> Neue Methode/Länge hinzufügen
                </button>
              )}
            </div>
          )}

          {/* Footer: total + export buttons */}
          <div className="mt-5 pt-3 border-t border-neutral-100 flex items-center justify-between flex-wrap gap-2">
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
                  onClick={handlePdf}
                  disabled={generatingPdf}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {generatingPdf ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
                  {generatingPdf ? "Erstellt..." : "PDF erstellen"}
                </button>
              </div>
            )}
          </div>

          {!isEditable && canEdit && (
            <div className="mt-3 text-xs text-neutral-500 italic">
              Bestellung kann im Status &quot;{orderStatus}&quot; nicht mehr bearbeitet werden.
            </div>
          )}

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

// ── Sub-Components ──────────────────────────────────────────────

function GroupCard({
  group, methodName, lengthValue, unit, orderId, isEditable, catalog,
}: {
  group: ItemGroup;
  methodName: string;
  lengthValue: string;
  unit: string;
  orderId: string;
  isEditable: boolean;
  catalog: CatalogMethod[];
}) {
  const mc = getMethodColor(methodName);
  const groupQty = group.items.reduce((s, i) => s + i.quantity, 0);
  const [showAdd, setShowAdd] = useState(false);

  // Find catalog entries for this method+length to power the color picker
  const availableColors = useMemo(() => {
    const m = catalog.find((m) => m.name === methodName);
    if (!m) return [];
    const l = m.lengths.find((l) => l.value === lengthValue);
    return l?.colors ?? [];
  }, [catalog, methodName, lengthValue]);

  // Filter out colors already in this group (avoid duplicates)
  const usedColorIds = new Set(group.items.map((i) => i.color_id).filter(Boolean) as string[]);
  const pickableColors = availableColors.filter((c) => !usedColorIds.has(c.id));

  return (
    <div className={`rounded-xl border ${mc.border} overflow-hidden`}>
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
          <ItemRow
            key={item.id}
            item={item}
            orderId={orderId}
            isEditable={isEditable}
          />
        ))}
        {/* Add row inside group */}
        {isEditable && (
          <div>
            {showAdd ? (
              <AddItemForm
                orderId={orderId}
                methodName={methodName}
                lengthValue={lengthValue}
                unit={unit}
                pickableColors={pickableColors}
                methodColor={mc}
                onClose={() => setShowAdd(false)}
              />
            ) : (
              <button
                onClick={() => setShowAdd(true)}
                className={`w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium ${mc.text} hover:${mc.bg} transition`}
              >
                <Plus size={12} /> Farbe hinzufügen
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemRow({ item, orderId, isEditable }: { item: OrderItem; orderId: string; isEditable: boolean }) {
  const [qty, setQty] = useState(String(item.quantity));
  const [pending, startTx] = useTransition();
  const [error, setError] = useState("");

  const save = () => {
    const n = parseInt(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Ungültig");
      setQty(String(item.quantity));
      return;
    }
    if (n === item.quantity) return;
    setError("");
    startTx(async () => {
      const res = await updateOrderItemQuantity({ orderId, itemId: item.id, quantity: n });
      if (res.error) {
        setError(res.error);
        setQty(String(item.quantity));
      }
    });
  };

  const remove = () => {
    if (!confirm(`Position #${item.color_name} entfernen?`)) return;
    startTx(async () => {
      const res = await deleteOrderItem({ orderId, itemId: item.id });
      if (res.error) setError(res.error);
    });
  };

  return (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-50/50 transition group">
      <span className="text-sm font-medium text-neutral-900 flex-1 truncate">#{item.color_name}</span>
      {isEditable ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") { setQty(String(item.quantity)); (e.target as HTMLInputElement).blur(); }
            }}
            disabled={pending}
            className="w-[80px] px-2 py-1 text-sm text-right font-semibold tabular-nums bg-white border border-neutral-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
          />
          <span className="text-xs text-neutral-400 w-3">{item.unit}</span>
          <button
            onClick={remove}
            disabled={pending}
            title="Position entfernen"
            className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-red-500 disabled:opacity-30 transition"
          >
            <Trash2 size={14} />
          </button>
          {error && <span className="text-[10px] text-red-600 ml-1">{error}</span>}
        </div>
      ) : (
        <span className="text-sm tabular-nums text-neutral-600 font-medium">
          {fmt(item.quantity)} {item.unit}
        </span>
      )}
    </div>
  );
}

function AddItemForm({
  orderId, methodName, lengthValue, unit, pickableColors, methodColor, onClose,
}: {
  orderId: string;
  methodName: string;
  lengthValue: string;
  unit: string;
  pickableColors: ProductColor[];
  methodColor: { bg: string; text: string; border: string; chip: string };
  onClose: () => void;
}) {
  const [colorId, setColorId] = useState<string>("");
  const [colorName, setColorName] = useState("");
  const [colorSearch, setColorSearch] = useState("");
  const [qty, setQty] = useState("");
  const [pending, startTx] = useTransition();
  const [error, setError] = useState("");
  const [showFreeText, setShowFreeText] = useState(false);

  const filteredColors = colorSearch
    ? pickableColors.filter((c) => c.name_hairvenly.toLowerCase().includes(colorSearch.toLowerCase()))
    : pickableColors;

  const submit = () => {
    setError("");
    const n = parseInt(qty);
    if (!Number.isFinite(n) || n <= 0) { setError("Menge ungültig"); return; }
    if (!colorName.trim()) { setError("Bitte Farbe wählen"); return; }
    startTx(async () => {
      const res = await addOrderItem({
        orderId, methodName, lengthValue, colorId: colorId || null,
        colorName: colorName.trim(), quantity: n, unit,
      });
      if (res.error) setError(res.error);
      else onClose();
    });
  };

  return (
    <div className={`p-3 ${methodColor.bg} border-t ${methodColor.border}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold ${methodColor.text}`}>Farbe hinzufügen</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={14} /></button>
      </div>

      {!showFreeText ? (
        <>
          <div className="relative mb-2">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={colorSearch}
              onChange={(e) => setColorSearch(e.target.value)}
              placeholder="Farbe suchen..."
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-white border border-neutral-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="max-h-[140px] overflow-y-auto rounded border border-neutral-200 bg-white mb-2">
            {filteredColors.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-neutral-400">
                Keine Farben gefunden
                <button
                  onClick={() => setShowFreeText(true)}
                  className="block mx-auto mt-1.5 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  → Farbe manuell eingeben
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {filteredColors.slice(0, 50).map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => { setColorId(c.id); setColorName(c.name_hairvenly); }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-indigo-50 transition ${
                        colorId === c.id ? "bg-indigo-100 font-semibold text-indigo-800" : "text-neutral-700"
                      }`}
                    >
                      #{c.name_hairvenly}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!showFreeText && pickableColors.length > 0 && (
            <button
              onClick={() => setShowFreeText(true)}
              className="text-[11px] text-neutral-500 hover:text-indigo-600 mb-2"
            >
              Farbe nicht im Katalog? → manuell eingeben
            </button>
          )}
        </>
      ) : (
        <div className="mb-2">
          <input
            type="text"
            value={colorName}
            onChange={(e) => { setColorName(e.target.value); setColorId(""); }}
            placeholder="z.B. SOFT BLOND BALAYAGE"
            className="w-full px-3 py-1.5 text-xs bg-white border border-neutral-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
            autoFocus
          />
          <button
            onClick={() => { setShowFreeText(false); setColorName(""); }}
            className="text-[11px] text-neutral-500 hover:text-indigo-600 mt-1"
          >
            ← Aus Katalog wählen
          </button>
        </div>
      )}

      {colorName && (
        <div className="text-[11px] text-neutral-600 mb-2">
          Gewählt: <span className={`font-semibold ${methodColor.text}`}>#{colorName}</span>
          {!colorId && showFreeText && <span className="text-amber-600 ml-1">(manuell, nicht im Katalog)</span>}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={`Menge in ${unit}`}
            className="w-full px-3 py-1.5 text-xs bg-white border border-neutral-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-neutral-400">{unit}</span>
        </div>
        <button
          onClick={submit}
          disabled={pending || !colorName.trim() || !qty}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-neutral-900 text-white text-xs font-medium rounded hover:bg-neutral-800 disabled:opacity-50 transition"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Hinzufügen
        </button>
      </div>
      {error && <div className="text-[11px] text-red-600 mt-1.5">{error}</div>}
    </div>
  );
}

function NewGroupForm({
  orderId, catalog, onClose,
}: {
  orderId: string;
  catalog: CatalogMethod[];
  onClose: () => void;
}) {
  const [methodId, setMethodId] = useState("");
  const [lengthId, setLengthId] = useState("");
  const [colorId, setColorId] = useState("");
  const [colorName, setColorName] = useState("");
  const [colorSearch, setColorSearch] = useState("");
  const [qty, setQty] = useState("");
  const [pending, startTx] = useTransition();
  const [error, setError] = useState("");

  const method = catalog.find((m) => m.id === methodId);
  const length = method?.lengths.find((l) => l.id === lengthId);
  const colors = length?.colors ?? [];
  const filteredColors = colorSearch
    ? colors.filter((c) => c.name_hairvenly.toLowerCase().includes(colorSearch.toLowerCase()))
    : colors;
  const unit = length?.unit ?? "g";

  const submit = () => {
    setError("");
    if (!method || !length) { setError("Methode und Länge wählen"); return; }
    if (!colorName.trim()) { setError("Farbe wählen"); return; }
    const n = parseInt(qty);
    if (!Number.isFinite(n) || n <= 0) { setError("Menge ungültig"); return; }
    startTx(async () => {
      const res = await addOrderItem({
        orderId,
        methodName: method.name,
        lengthValue: length.value,
        colorId: colorId || null,
        colorName: colorName.trim(),
        quantity: n,
        unit,
      });
      if (res.error) setError(res.error);
      else onClose();
    });
  };

  return (
    <div className="p-4 bg-indigo-50/50 rounded-xl border-2 border-dashed border-indigo-300 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-indigo-900">Neue Methode/Länge anlegen</span>
        <button onClick={onClose} className="text-indigo-400 hover:text-indigo-700"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-medium text-neutral-600 uppercase tracking-wide block mb-1">Methode</label>
          <select
            value={methodId}
            onChange={(e) => { setMethodId(e.target.value); setLengthId(""); setColorId(""); setColorName(""); }}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">— wählen —</option>
            {catalog.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-medium text-neutral-600 uppercase tracking-wide block mb-1">Länge</label>
          <select
            value={lengthId}
            onChange={(e) => { setLengthId(e.target.value); setColorId(""); setColorName(""); }}
            disabled={!method}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
          >
            <option value="">— wählen —</option>
            {method?.lengths.map((l) => <option key={l.id} value={l.id}>{l.value}</option>)}
          </select>
        </div>
      </div>

      {length && (
        <>
          <div>
            <label className="text-[10px] font-medium text-neutral-600 uppercase tracking-wide block mb-1">Farbe</label>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={colorSearch}
                onChange={(e) => setColorSearch(e.target.value)}
                placeholder="Farbe suchen..."
                className="w-full pl-7 pr-3 py-1.5 text-xs bg-white border border-neutral-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div className="mt-1 max-h-[140px] overflow-y-auto rounded border border-neutral-200 bg-white">
              {filteredColors.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-neutral-400">Keine Farben</div>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {filteredColors.slice(0, 50).map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => { setColorId(c.id); setColorName(c.name_hairvenly); }}
                        className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-indigo-50 transition ${
                          colorId === c.id ? "bg-indigo-100 font-semibold text-indigo-800" : "text-neutral-700"
                        }`}
                      >
                        #{c.name_hairvenly}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {colorName && (
            <div className="flex items-center gap-2">
              <div className="text-xs text-neutral-700 flex-1">
                <span className="text-neutral-500">Position: </span>
                <span className="font-medium">{method?.name} · {length?.value}</span>
                <span className="font-semibold text-indigo-700 ml-2">#{colorName}</span>
              </div>
              <div className="relative w-[120px]">
                <input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder={`Menge`}
                  className="w-full px-2 py-1.5 text-xs bg-white border border-neutral-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-neutral-400">{unit}</span>
              </div>
              <button
                onClick={submit}
                disabled={pending || !qty}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-neutral-900 text-white text-xs font-medium rounded hover:bg-neutral-800 disabled:opacity-50 transition"
              >
                {pending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Hinzufügen
              </button>
            </div>
          )}
        </>
      )}

      {error && <div className="text-[11px] text-red-600">{error}</div>}
    </div>
  );
}

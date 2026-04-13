"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil, Check, X, Download, Loader2 } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import {
  createMethod, deleteMethod,
  createLength, deleteLength,
  createColor, updateColor, deleteColor,
  syncCatalogFromSheets,
} from "@/lib/actions/catalog";
import type { Supplier, CatalogMethod, CatalogLength, ProductColor } from "@/lib/types";

interface Props {
  suppliers: Supplier[];
  catalogs: Record<string, CatalogMethod[]>;
  locale: Locale;
}

export default function CatalogEditor({ suppliers, catalogs, locale }: Props) {
  const [activeSupplier, setActiveSupplier] = useState(suppliers[0]?.id ?? "");
  const [shopifyImporting, startShopifyImport] = useTransition();
  const [syncResult, setSyncResult] = useState<{ methodsCreated: number; lengthsCreated: number; colorsCreated: number; hairvenlyMatched: number; total: number } | null>(null);
  const [syncError, setSyncError] = useState("");
  const methods = catalogs[activeSupplier] ?? [];

  const handleSync = () => {
    setSyncError("");
    setSyncResult(null);
    startShopifyImport(async () => {
      const result = await syncCatalogFromSheets(activeSupplier);
      if (result.error) {
        setSyncError(result.error);
      } else {
        setSyncResult({
          methodsCreated: result.methodsCreated ?? 0,
          lengthsCreated: result.lengthsCreated ?? 0,
          colorsCreated: result.colorsCreated ?? 0,
          hairvenlyMatched: result.hairvenlyMatched ?? 0,
          total: result.total ?? 0,
        });
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Supplier Tabs + Import Button */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {suppliers.map((s) => (
            <button
              key={s.id}
              onClick={() => { setActiveSupplier(s.id); setSyncResult(null); setSyncError(""); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeSupplier === s.id
                  ? "bg-neutral-900 text-white"
                  : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <button onClick={handleSync} disabled={shopifyImporting}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
          {shopifyImporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {shopifyImporting ? "Synchronisiert..." : "Katalog synchronisieren"}
        </button>
      </div>

      {/* Sync Results */}
      {syncError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{syncError}</div>}
      {syncResult && (
        <div className="text-sm rounded-lg p-3 bg-emerald-50 border border-emerald-200 text-emerald-800">
          <strong>Sync abgeschlossen</strong> ({syncResult.total} Einträge verarbeitet)
          <ul className="mt-1 text-xs space-y-0.5">
            {syncResult.methodsCreated > 0 && <li>+ {syncResult.methodsCreated} neue Methoden angelegt</li>}
            {syncResult.lengthsCreated > 0 && <li>+ {syncResult.lengthsCreated} neue Längen angelegt</li>}
            {syncResult.colorsCreated > 0 && <li>+ {syncResult.colorsCreated} neue Farben angelegt</li>}
            {syncResult.hairvenlyMatched > 0 && <li>+ {syncResult.hairvenlyMatched} Hairvenly-Farbcodes aus Bestellungen zugeordnet</li>}
            {syncResult.methodsCreated === 0 && syncResult.lengthsCreated === 0 && syncResult.colorsCreated === 0 && syncResult.hairvenlyMatched === 0 && (
              <li>Keine Änderungen — Katalog ist aktuell</li>
            )}
          </ul>
          <p className="mt-1 text-[10px] text-emerald-600">Seite neu laden um Änderungen zu sehen</p>
        </div>
      )}

      {/* Methods */}
      <div className="space-y-3">
        {methods.map((method) => (
          <MethodBlock key={method.id} method={method} locale={locale} />
        ))}

        {methods.length === 0 && (
          <p className="text-sm text-neutral-400 py-4">{t(locale, "catalog.no_methods")}</p>
        )}

        <AddMethodForm supplierId={activeSupplier} locale={locale} />
      </div>
    </div>
  );
}

function MethodBlock({ method, locale }: { method: CatalogMethod; locale: Locale }) {
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm(t(locale, "catalog.confirm_delete"))) return;
    startTransition(() => { deleteMethod(method.id); });
  };

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-100">
        <button onClick={() => setOpen(!open)} className="text-neutral-400 hover:text-neutral-700">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <h3 className="text-sm font-semibold text-neutral-900 flex-1">{method.name}</h3>
        <span className="text-xs text-neutral-400">
          {method.lengths.reduce((sum, l) => sum + l.colors.length, 0)} {t(locale, "catalog.colors")}
        </span>
        <button onClick={handleDelete} disabled={pending} className="text-neutral-300 hover:text-red-500 transition">
          <Trash2 size={14} />
        </button>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-2 space-y-3">
          {method.lengths.map((length) => (
            <LengthBlock key={length.id} length={length} locale={locale} />
          ))}

          {method.lengths.length === 0 && (
            <p className="text-xs text-neutral-400">{t(locale, "catalog.no_lengths")}</p>
          )}

          <AddLengthForm methodId={method.id} locale={locale} />
        </div>
      )}
    </div>
  );
}

function LengthBlock({ length, locale }: { length: CatalogLength; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm(t(locale, "catalog.confirm_delete"))) return;
    startTransition(() => { deleteLength(length.id); });
  };

  return (
    <div className="border border-neutral-100 rounded-xl">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(!open)} className="text-neutral-400 hover:text-neutral-700">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="text-sm font-medium text-neutral-700 flex-1">
          {length.value} <span className="text-neutral-400">({length.unit})</span>
          {(() => {
            const latest = length.colors
              .filter((c) => c.updated_at)
              .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0];
            if (!latest?.updated_at) return null;
            const d = new Date(latest.updated_at);
            return (
              <span className="text-[10px] text-neutral-300 ml-2">
                Aktualisiert: {d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </span>
            );
          })()}
        </span>
        <span className="text-xs text-neutral-400">{length.colors.length} {t(locale, "catalog.colors")}</span>
        <button onClick={handleDelete} disabled={pending} className="text-neutral-300 hover:text-red-500 transition">
          <Trash2 size={12} />
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3">
          {/* Color table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-neutral-500 uppercase tracking-wider">
                  <th className="text-left pb-2 font-medium">{t(locale, "catalog.name_hairvenly")}</th>
                  <th className="text-left pb-2 font-medium">{t(locale, "catalog.name_supplier")}</th>
                  <th className="text-left pb-2 font-medium">{t(locale, "catalog.name_shopify")}</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {length.colors.map((color) => (
                  <ColorRow key={color.id} color={color} locale={locale} />
                ))}
              </tbody>
            </table>
          </div>

          {length.colors.length === 0 && (
            <p className="text-xs text-neutral-400 py-2">{t(locale, "catalog.no_colors")}</p>
          )}

          <AddColorForm lengthId={length.id} locale={locale} />
        </div>
      )}
    </div>
  );
}

function ColorRow({ color, locale }: { color: ProductColor; locale: Locale }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [nameH, setNameH] = useState(color.name_hairvenly);
  const [nameS, setNameS] = useState(color.name_supplier ?? "");
  const [nameSh, setNameSh] = useState(color.name_shopify ?? "");

  const handleSave = () => {
    const fd = new FormData();
    fd.set("name_hairvenly", nameH);
    fd.set("name_supplier", nameS);
    fd.set("name_shopify", nameSh);
    startTransition(async () => {
      await updateColor(color.id, fd);
      setEditing(false);
    });
  };

  const handleDelete = () => {
    if (!confirm(t(locale, "catalog.confirm_delete"))) return;
    startTransition(() => { deleteColor(color.id); });
  };

  if (editing) {
    const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); };
    return (
      <tr>
        <td className="py-1 pr-2">
          <input value={nameH} onChange={(e) => setNameH(e.target.value)} onKeyDown={onKeyDown} autoFocus
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
        </td>
        <td className="py-1 pr-2">
          <input value={nameS} onChange={(e) => setNameS(e.target.value)} onKeyDown={onKeyDown}
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
        </td>
        <td className="py-1 pr-2 text-xs text-neutral-400 truncate max-w-[200px]" title={nameSh || undefined}>
          {nameSh || "—"}
        </td>
        <td className="py-1">
          <div className="flex gap-1">
            <button onClick={handleSave} disabled={pending} className="text-emerald-600 hover:text-emerald-700"><Check size={14} /></button>
            <button onClick={() => setEditing(false)} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="group hover:bg-neutral-50/50">
      <td className="py-1.5 text-neutral-900 font-medium">#{color.name_hairvenly}</td>
      <td className="py-1.5 text-neutral-500">{color.name_supplier || "—"}</td>
      <td className="py-1.5 text-neutral-500">{color.name_shopify || "—"}</td>
      <td className="py-1.5">
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
          <button onClick={() => setEditing(true)} className="text-neutral-400 hover:text-neutral-700"><Pencil size={12} /></button>
          <button onClick={handleDelete} disabled={pending} className="text-neutral-400 hover:text-red-500"><Trash2 size={12} /></button>
        </div>
      </td>
    </tr>
  );
}

// ── Add Forms ────────────────────────────────────────────────────

function AddMethodForm({ supplierId, locale }: { supplierId: string; locale: Locale }) {
  const [show, setShow] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (fd: FormData) => {
    fd.set("supplier_id", supplierId);
    startTransition(async () => {
      await createMethod(null, fd);
      setShow(false);
    });
  };

  if (!show) {
    return (
      <button onClick={() => setShow(true)}
        className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 font-medium">
        <Plus size={14} /> {t(locale, "catalog.add_method")}
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="flex items-center gap-2">
      <input name="name" required placeholder={t(locale, "catalog.method_name")}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm flex-1" autoFocus />
      <button type="submit" disabled={pending}
        className="px-3 py-1.5 bg-neutral-900 text-white text-sm rounded-lg disabled:opacity-50">{t(locale, "common.save")}</button>
      <button type="button" onClick={() => setShow(false)}
        className="px-3 py-1.5 border border-neutral-300 text-sm rounded-lg">{t(locale, "common.cancel")}</button>
    </form>
  );
}

function AddLengthForm({ methodId, locale }: { methodId: string; locale: Locale }) {
  const [show, setShow] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (fd: FormData) => {
    fd.set("method_id", methodId);
    startTransition(async () => {
      await createLength(null, fd);
      setShow(false);
    });
  };

  if (!show) {
    return (
      <button onClick={() => setShow(true)}
        className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 font-medium">
        <Plus size={12} /> {t(locale, "catalog.add_length")}
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="flex items-center gap-2">
      <input name="value" required placeholder={t(locale, "catalog.length_value")}
        className="rounded-lg border border-neutral-300 px-2 py-1 text-sm w-28" autoFocus />
      <input name="unit" defaultValue="g" placeholder={t(locale, "catalog.unit")}
        className="rounded-lg border border-neutral-300 px-2 py-1 text-sm w-16" />
      <button type="submit" disabled={pending}
        className="px-2 py-1 bg-neutral-900 text-white text-xs rounded-lg disabled:opacity-50">{t(locale, "common.save")}</button>
      <button type="button" onClick={() => setShow(false)}
        className="px-2 py-1 border border-neutral-300 text-xs rounded-lg">{t(locale, "common.cancel")}</button>
    </form>
  );
}

function AddColorForm({ lengthId, locale }: { lengthId: string; locale: Locale }) {
  const [show, setShow] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (fd: FormData) => {
    fd.set("length_id", lengthId);
    startTransition(async () => {
      await createColor(null, fd);
      setShow(false);
    });
  };

  if (!show) {
    return (
      <button onClick={() => setShow(true)}
        className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 font-medium mt-2">
        <Plus size={12} /> {t(locale, "catalog.add_color")}
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="flex items-center gap-2 mt-2">
      <input name="name_hairvenly" required placeholder={t(locale, "catalog.name_hairvenly")}
        className="rounded border border-neutral-300 px-2 py-1 text-sm flex-1" autoFocus />
      <input name="name_supplier" placeholder={t(locale, "catalog.name_supplier")}
        className="rounded border border-neutral-300 px-2 py-1 text-sm flex-1" />
      <input name="name_shopify" placeholder={t(locale, "catalog.name_shopify")}
        className="rounded border border-neutral-300 px-2 py-1 text-sm flex-1" />
      <button type="submit" disabled={pending}
        className="px-2 py-1 bg-neutral-900 text-white text-xs rounded-lg disabled:opacity-50">{t(locale, "common.save")}</button>
      <button type="button" onClick={() => setShow(false)}
        className="px-2 py-1 border border-neutral-300 text-xs rounded-lg">{t(locale, "common.cancel")}</button>
    </form>
  );
}

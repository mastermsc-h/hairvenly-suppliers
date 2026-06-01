"use client";

import { useState, useTransition } from "react";
import { ShoppingBag, Check, AlertTriangle, XCircle, Loader2, X, ExternalLink } from "lucide-react";
import {
  pushOrderItemsToShopify,
  previewShopifyPush,
  type PushItemResult,
  type PushReport,
} from "@/lib/actions/shopify-push";

interface Props {
  orderId: string;
  shipmentId: string | null;
  label?: string; // override button label, e.g. "Teil 1 in Shopify einpflegen"
  compact?: boolean;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusIcon({ status }: { status: PushItemResult["status"] }) {
  if (status === "ok") return <Check size={14} className="text-emerald-600 shrink-0" />;
  if (status === "no_mapping") return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
  return <XCircle size={14} className="text-red-600 shrink-0" />;
}

function statusLabel(status: PushItemResult["status"]): string {
  switch (status) {
    case "ok": return "Eingepflegt";
    case "no_mapping": return "Kein Shopify-Mapping";
    case "missing_conversion": return "Fehlt Umrechnung g→Stück";
    case "product_not_found": return "Produkt nicht gefunden";
    case "variant_not_found": return "Variante nicht gefunden";
    case "ambiguous_product": return "Mehrdeutig (mehrere Varianten)";
    case "error": return "Fehler";
  }
}

export default function PushToShopifyButton({ orderId, shipmentId, label, compact }: Props) {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<PushItemResult[] | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [report, setReport] = useState<PushReport | null>(null);
  // Auswahl pro Position. Default: nur Items, die noch NICHT eingepflegt
  // sind UND ein gültiges Mapping/Umrechnung haben, sind angehakt.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function openConfirm() {
    setPreviewErr(null);
    startTransition(async () => {
      const res = await previewShopifyPush(orderId, shipmentId);
      if (res.error) {
        setPreviewErr(res.error);
        setPreview([]);
        return;
      }
      // Defaults: nur "neue, pushbare" Positionen vorausgewählt
      const def = new Set<string>();
      for (const p of res.items) {
        if (!p.already_pushed_at && p.status === "ok") def.add(p.item_id);
      }
      setSelected(def);
      setPreview(res.items);
    });
  }

  function close() {
    setPreview(null);
    setPreviewErr(null);
    setReport(null);
    setSelected(new Set());
  }

  function toggle(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function selectAllPushable() {
    if (!preview) return;
    const all = new Set<string>();
    for (const p of preview) if (p.status === "ok") all.add(p.item_id);
    setSelected(all);
  }
  function selectNone() { setSelected(new Set()); }
  function selectNewOnly() {
    if (!preview) return;
    const def = new Set<string>();
    for (const p of preview) if (!p.already_pushed_at && p.status === "ok") def.add(p.item_id);
    setSelected(def);
  }

  function doPush() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await pushOrderItemsToShopify(orderId, shipmentId, ids);
      setReport(res);
      setPreview(null);
      setSelected(new Set());
    });
  }

  const btnClass = compact
    ? "inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
    : "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50";

  const alreadyPushedCount = preview?.filter((p) => p.already_pushed_at).length ?? 0;
  const newCount = preview?.filter((p) => !p.already_pushed_at && p.status === "ok").length ?? 0;
  const selectedCount = selected.size;

  return (
    <>
      <button type="button" onClick={openConfirm} disabled={pending} className={btnClass}>
        {pending ? <Loader2 size={compact ? 11 : 14} className="animate-spin" /> : <ShoppingBag size={compact ? 11 : 14} />}
        {label || "In Shopify einpflegen"}
      </button>

      {/* Confirmation modal */}
      {preview !== null && !report && (
        <Modal title="In Shopify einpflegen?" onClose={close}>
          {previewErr && (
            <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
              {previewErr}
            </div>
          )}
          {preview.length === 0 ? (
            <p className="text-sm text-neutral-600">Keine Positionen zum Einpflegen vorhanden.</p>
          ) : (
            <>
              <p className="text-sm text-neutral-700 mb-3">
                {newCount} {newCount === 1 ? "neue Position" : "neue Positionen"} bereit zum Einpflegen
                {alreadyPushedCount > 0 && (
                  <> · {alreadyPushedCount} bereits eingepflegt (übersprungen)</>
                )}
              </p>
              {alreadyPushedCount > 0 && (
                <div className="mb-3 px-3 py-2 rounded bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <div>
                    Bereits eingepflegte Positionen sind automatisch <strong>abgewählt</strong>, damit der Shopify-Bestand nicht doppelt erhöht wird. Du kannst die Auswahl unten manuell anpassen.
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className="text-neutral-500">Schnellauswahl:</span>
                <button type="button" onClick={selectNewOnly} className="px-2 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700">nur neue ({newCount})</button>
                <button type="button" onClick={selectAllPushable} className="px-2 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700">alle pushbaren</button>
                <button type="button" onClick={selectNone} className="px-2 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700">keine</button>
              </div>
              <div className="max-h-96 overflow-y-auto border border-neutral-200 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50 sticky top-0">
                    <tr className="text-left text-neutral-600">
                      <th className="px-2 py-1.5 font-medium w-6"></th>
                      <th className="px-2 py-1.5 font-medium">Position</th>
                      <th className="px-2 py-1.5 font-medium text-right">Gramm</th>
                      <th className="px-2 py-1.5 font-medium text-right">Stück</th>
                      <th className="px-2 py-1.5 font-medium">Shopify</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {preview.map((p) => {
                      const isChecked = selected.has(p.item_id);
                      const disabled = p.status !== "ok";
                      return (
                      <tr
                        key={p.item_id}
                        className={
                          disabled
                            ? "opacity-60"
                            : p.already_pushed_at
                              ? (isChecked ? "bg-amber-50/60" : "bg-neutral-50/40")
                              : (isChecked ? "" : "opacity-60")
                        }
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={disabled}
                            onChange={() => toggle(p.item_id)}
                            title={disabled ? `Nicht pushbar: ${p.status}` : (p.already_pushed_at ? "Bereits eingepflegt — Häkchen setzen würde Bestand doppelt erhöhen!" : "Diese Position einpflegen")}
                            className="rounded"
                          />
                        </td>
                        <td className="px-2 py-1.5">{p.display}</td>
                        <td className="px-2 py-1.5 text-right text-neutral-600">{p.grams} g</td>
                        <td className="px-2 py-1.5 text-right font-medium">
                          {p.pieces != null ? (
                            <span className="text-emerald-700">{p.pieces}</span>
                          ) : (
                            <span className="text-red-600">—</span>
                          )}
                          {p.grams_per_piece && (
                            <div className="text-[9px] text-neutral-400 font-normal">à {p.grams_per_piece}g</div>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {p.shopify_url ? (
                            <a
                              href={p.shopify_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              prüfen <ExternalLink size={9} />
                            </a>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {p.already_pushed_at ? (
                            <span className="text-amber-700">bereits {fmtDate(p.already_pushed_at)}</span>
                          ) : p.status === "no_mapping" ? (
                            <span className="text-amber-700">kein Mapping</span>
                          ) : p.status === "missing_conversion" ? (
                            <span className="text-red-600">fehlt g→Stück</span>
                          ) : (
                            <span className="text-neutral-500">neu</span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center gap-2 mt-4">
                <div className="text-xs text-neutral-500">
                  {selectedCount} {selectedCount === 1 ? "Position" : "Positionen"} ausgewählt
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={doPush}
                    disabled={pending || selectedCount === 0}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {pending && <Loader2 size={14} className="animate-spin" />}
                    {selectedCount === 0 ? "Nichts ausgewählt" : `${selectedCount} jetzt einpflegen`}
                  </button>
                </div>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Report modal */}
      {report && (
        <Modal title="Shopify-Push Ergebnis" onClose={close}>
          <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
            <div className="px-2 py-1.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800">
              <div className="font-semibold text-lg">{report.summary.succeeded}</div>
              <div>eingepflegt</div>
            </div>
            <div className="px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-amber-800">
              <div className="font-semibold text-lg">{report.summary.skipped}</div>
              <div>ohne Mapping</div>
            </div>
            <div className="px-2 py-1.5 rounded bg-red-50 border border-red-200 text-red-800">
              <div className="font-semibold text-lg">{report.summary.failed}</div>
              <div>fehlgeschlagen</div>
            </div>
          </div>
          {report.error && (
            <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
              {report.error}
            </div>
          )}
          <div className="max-h-96 overflow-y-auto border border-neutral-200 rounded">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 sticky top-0">
                <tr className="text-left text-neutral-600">
                  <th className="px-2 py-1.5 font-medium w-4"></th>
                  <th className="px-2 py-1.5 font-medium">Position</th>
                  <th className="px-2 py-1.5 font-medium text-right">Gramm</th>
                  <th className="px-2 py-1.5 font-medium text-right">Stück</th>
                  <th className="px-2 py-1.5 font-medium">Shopify-Variante</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {report.results.map((r) => (
                  <tr key={r.item_id}>
                    <td className="px-2 py-1.5"><StatusIcon status={r.status} /></td>
                    <td className="px-2 py-1.5">{r.display}</td>
                    <td className="px-2 py-1.5 text-right text-neutral-600">{r.grams} g</td>
                    <td className="px-2 py-1.5 text-right font-medium">
                      {r.pieces != null ? r.pieces : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-neutral-600">
                      {r.shopify_product ? (
                        <div className="max-w-[280px]">
                          <div className="truncate" title={`${r.shopify_product} → ${r.shopify_variant ?? ""}`}>
                            {r.shopify_product}
                            {r.shopify_variant && r.shopify_variant !== "Default Title" && (
                              <span className="text-neutral-400"> · {r.shopify_variant}</span>
                            )}
                          </div>
                          {r.shopify_url && (
                            <a
                              href={r.shopify_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline text-[10px] inline-flex items-center gap-0.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              prüfen <ExternalLink size={9} />
                            </a>
                          )}
                        </div>
                      ) : r.shopify_url ? (
                        <a
                          href={r.shopify_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline text-[10px] inline-flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          prüfen <ExternalLink size={9} />
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="text-neutral-700">{statusLabel(r.status)}</div>
                      {r.error && <div className="text-red-600 text-[10px] mt-0.5">{r.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center mt-4">
            <a
              href="https://admin.shopify.com/store/hairvenly/products"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              In Shopify ansehen <ExternalLink size={11} />
            </a>
            <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-800">
              Schließen
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200">
          <h3 className="font-semibold text-neutral-900">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-neutral-100">
            <X size={18} className="text-neutral-500" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

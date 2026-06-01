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
    case "product_not_found": return "Produkt nicht gefunden";
    case "variant_not_found": return "Variante nicht gefunden";
    case "ambiguous_product": return "Mehrdeutig";
    case "error": return "Fehler";
  }
}

export default function PushToShopifyButton({ orderId, shipmentId, label, compact }: Props) {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<PushItemResult[] | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [report, setReport] = useState<PushReport | null>(null);

  function openConfirm() {
    setPreviewErr(null);
    startTransition(async () => {
      const res = await previewShopifyPush(orderId, shipmentId);
      if (res.error) {
        setPreviewErr(res.error);
        setPreview([]);
        return;
      }
      setPreview(res.items);
    });
  }

  function close() {
    setPreview(null);
    setPreviewErr(null);
    setReport(null);
  }

  function doPush() {
    startTransition(async () => {
      const res = await pushOrderItemsToShopify(orderId, shipmentId);
      setReport(res);
      setPreview(null);
    });
  }

  const btnClass = compact
    ? "inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
    : "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50";

  const alreadyPushedCount = preview?.filter((p) => p.already_pushed_at).length ?? 0;

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
                Folgende {preview.length} Positionen werden in Shopify als Bestand <strong>hinzugefügt</strong>:
              </p>
              {alreadyPushedCount > 0 && (
                <div className="mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <div>
                    <strong>{alreadyPushedCount}</strong> {alreadyPushedCount === 1 ? "Position wurde" : "Positionen wurden"} bereits eingepflegt.
                    Erneutes Einpflegen würde den Shopify-Bestand <strong>doppelt erhöhen</strong>.
                  </div>
                </div>
              )}
              <div className="max-h-72 overflow-y-auto border border-neutral-200 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50 sticky top-0">
                    <tr className="text-left text-neutral-600">
                      <th className="px-2 py-1.5 font-medium">Position</th>
                      <th className="px-2 py-1.5 font-medium text-right">Menge</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {preview.map((p) => (
                      <tr key={p.item_id} className={p.already_pushed_at ? "bg-amber-50/40" : ""}>
                        <td className="px-2 py-1.5">{p.display}</td>
                        <td className="px-2 py-1.5 text-right font-medium">{p.qty}</td>
                        <td className="px-2 py-1.5">
                          {p.already_pushed_at ? (
                            <span className="text-amber-700">bereits {fmtDate(p.already_pushed_at)}</span>
                          ) : p.status === "no_mapping" ? (
                            <span className="text-amber-700">kein Mapping</span>
                          ) : (
                            <span className="text-neutral-500">neu</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={doPush}
                  disabled={pending}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {pending && <Loader2 size={14} className="animate-spin" />}
                  Jetzt einpflegen
                </button>
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
                  <th className="px-2 py-1.5 font-medium text-right">Menge</th>
                  <th className="px-2 py-1.5 font-medium">Shopify-Variante</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {report.results.map((r) => (
                  <tr key={r.item_id}>
                    <td className="px-2 py-1.5"><StatusIcon status={r.status} /></td>
                    <td className="px-2 py-1.5">{r.display}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{r.qty}</td>
                    <td className="px-2 py-1.5 text-neutral-600">
                      {r.shopify_product ? (
                        <div className="truncate max-w-[260px]" title={`${r.shopify_product} → ${r.shopify_variant ?? ""}`}>
                          {r.shopify_product}
                          {r.shopify_variant && r.shopify_variant !== "Default Title" && (
                            <span className="text-neutral-400"> · {r.shopify_variant}</span>
                          )}
                        </div>
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

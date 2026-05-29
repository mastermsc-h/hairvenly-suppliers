"use client";

import { useState, useTransition, useRef } from "react";
import { Upload, Truck } from "lucide-react";
import { uploadDocument } from "@/lib/actions/orders";
import { DOCUMENT_QUICK_KINDS, type DocumentKind, type OrderShipment } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";

export default function DocumentUpload({
  orderId,
  locale,
  shipments = [],
}: {
  orderId: string;
  locale: Locale;
  shipments?: OrderShipment[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>("supplier_invoice");
  const [shipmentId, setShipmentId] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  function onFileChange() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    if (shipmentId) fd.set("shipment_id", shipmentId);
    start(async () => {
      const res = await uploadDocument(orderId, fd);
      if (res?.error) setError(res.error);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  const kindLabel = t(locale, `doc.kind.${kind}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {DOCUMENT_QUICK_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              kind === k
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {t(locale, `doc.kind.${k}`)}
          </button>
        ))}
      </div>

      {shipments.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-neutral-600 inline-flex items-center gap-1">
            <Truck size={11} className="text-neutral-400" />
            Zuordnen zu:
          </label>
          <select
            value={shipmentId}
            onChange={(e) => setShipmentId(e.target.value)}
            className="text-xs rounded-md border border-neutral-300 px-2 py-1"
          >
            <option value="">Bestellung (allgemein)</option>
            {shipments.map((s, i) => (
              <option key={s.id} value={s.id}>
                {s.label || `Teillieferung ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white font-medium shadow-sm hover:bg-indigo-700 active:bg-indigo-800 cursor-pointer transition disabled:opacity-50">
          <Upload size={16} />
          <span>
            {pending
              ? t(locale, "doc.uploading")
              : `${t(locale, "doc.upload_as")} „${kindLabel}"${shipmentId ? " · Teillieferung" : ""}`}
          </span>
          <input
            ref={fileRef}
            type="file"
            onChange={onFileChange}
            disabled={pending}
            className="hidden"
          />
        </label>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { FileText, Loader2, ExternalLink, AlertCircle, Check } from "lucide-react";
import { generateAndUploadPDF } from "@/lib/actions/orders";

/**
 * Button in der Bestelldetail-Ansicht (Positionen-Section) um die
 * Bestellübersicht-PDF nachträglich (neu) zu generieren. Nutzt die bestehende
 * generateAndUploadPDF-Action, lädt die neue PDF als 'order_overview'-Document
 * in Supabase Storage hoch und öffnet sie danach in einem neuen Tab.
 *
 * Wenn schon eine PDF existiert wird eine zusätzliche Version angelegt
 * (Timestamp im Pfad) — die alten bleiben in der Dokumente-Liste sichtbar.
 */
export default function RegeneratePdfButton({
  orderId,
  hasExistingPdf,
}: {
  orderId: string;
  hasExistingPdf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function run() {
    setErr(null);
    setOk(false);
    if (hasExistingPdf) {
      if (!confirm("Es existiert bereits eine Bestellübersicht-PDF. Neue Version anlegen? Die alte bleibt in den Dokumenten sichtbar.")) return;
    }
    startTransition(async () => {
      const res = await generateAndUploadPDF(orderId);
      if (res.error) {
        setErr(res.error);
        return;
      }
      setOk(true);
      if (res.signedUrl) window.open(res.signedUrl, "_blank");
      setTimeout(() => setOk(false), 5000);
    });
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-purple-300 text-purple-700 bg-white hover:bg-purple-50 transition disabled:opacity-50"
        title={hasExistingPdf ? "Neue Bestellübersicht-PDF erstellen (alte bleibt erhalten)" : "Bestellübersicht als PDF erzeugen und in Dokumente ablegen"}
      >
        {pending ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
        {pending ? "Wird erstellt…" : hasExistingPdf ? "PDF neu erstellen" : "PDF erstellen"}
      </button>
      {ok && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
          <Check size={11} /> Erstellt & geöffnet
        </span>
      )}
      {err && (
        <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
          <AlertCircle size={11} /> {err}
        </span>
      )}
      {!pending && !err && !ok && hasExistingPdf && (
        <span className="text-[10px] text-neutral-400 inline-flex items-center gap-0.5">
          <ExternalLink size={9} /> öffnet in neuem Tab
        </span>
      )}
    </div>
  );
}

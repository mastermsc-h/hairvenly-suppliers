"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Check, AlertCircle } from "lucide-react";
import { syncOrderItemsEtaFromSheet } from "@/lib/actions/orders";

export default function SyncEtaButton({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ updated?: number; imported?: number; error?: string } | null>(null);

  function sync() {
    setResult(null);
    start(async () => {
      const res = await syncOrderItemsEtaFromSheet(orderId);
      setResult(res);
      setTimeout(() => setResult(null), 8000);
    });
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={sync}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-50 transition disabled:opacity-50"
        title="Liest die ETA-Spalte aus dem Google Sheet und überschreibt die ETAs der Bestellpositionen. Importiert auch fehlende Positionen wenn die Bestellung leer ist."
      >
        <RefreshCw size={12} className={pending ? "animate-spin" : ""} />
        {pending ? "Synchronisiere…" : "ETAs aus Sheet syncen"}
      </button>
      {result?.error && (
        <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
          <AlertCircle size={11} /> {result.error}
        </span>
      )}
      {!result?.error && result?.imported != null && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
          <Check size={11} /> {result.imported} Position{result.imported === 1 ? "" : "en"} importiert
        </span>
      )}
      {!result?.error && result?.updated != null && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
          <Check size={11} />{" "}
          {result.updated === 0
            ? "Bereits aktuell"
            : `${result.updated} Position${result.updated === 1 ? "" : "en"} aktualisiert`}
        </span>
      )}
    </div>
  );
}

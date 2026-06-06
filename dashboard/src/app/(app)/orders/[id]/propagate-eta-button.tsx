"use client";

import { useState, useTransition } from "react";
import { ArrowDownToLine, Check, AlertCircle, Loader2 } from "lucide-react";
import { propagateOrderEtaToItems } from "@/lib/actions/orders";

export default function PropagateEtaButton({ orderId, orderEta }: { orderId: string; orderEta: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ updated_db?: number; updated_sheet?: number; created_eta_col?: boolean; error?: string } | null>(null);

  if (!orderEta) return null;

  const etaDisplay = (() => {
    const m = orderEta.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : orderEta;
  })();

  function go() {
    setResult(null);
    if (!confirm(`Order-ETA (${etaDisplay}) auf alle Positionen ohne Teillieferung übernehmen + ins Sheet schreiben?`)) return;
    start(async () => {
      const res = await propagateOrderEtaToItems(orderId, { writeToSheet: true });
      setResult(res);
      setTimeout(() => setResult(null), 10000);
    });
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-50 transition disabled:opacity-50"
        title={`Setzt die ETA aller Positionen ohne Teillieferung auf ${etaDisplay} (= Order-ETA) und aktualisiert die ETA-Spalte im Google Sheet.`}
      >
        {pending ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}
        {pending ? "Übertrage…" : "Order-ETA → Positionen + Sheet"}
      </button>
      {result?.error && (
        <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
          <AlertCircle size={11} /> {result.error}
        </span>
      )}
      {!result?.error && result?.updated_db != null && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
          <Check size={11} />{" "}
          {result.updated_db} DB
          {result.updated_sheet != null && (
            <> · {result.updated_sheet} Sheet{result.created_eta_col ? " (ETA-Spalte angelegt)" : ""}</>
          )}
        </span>
      )}
    </div>
  );
}

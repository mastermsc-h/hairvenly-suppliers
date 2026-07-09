"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Loader2, Check, AlertCircle } from "lucide-react";
import { refreshStockForOrder } from "@/lib/actions/orders";

/**
 * Button "Stock aktualisieren" — triggert Apps Script createBestellung*
 * für den Lieferant dieser Bestellung. Aggregiert neu und aktualisiert die
 * 'unterwegs'-Spalten im Stock-Sheet (Russisch-GLATT / Usbekisch-WELLIG),
 * damit Chatbot und Dashboard die frisch geänderten Positionen kennen.
 *
 * Dauer: 2-5 Minuten. Nutzt letztes bekanntes Budget aus dem Vorschlag-Tab.
 */
export default function RefreshStockButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function run() {
    setErr(null);
    setOk(false);
    if (!confirm(
      "Stock-Sheet jetzt refreshen? Dauert 2-5 Minuten. Nach Abschluss sieht der Chatbot die aktuellen Positionen als 'unterwegs'.\n\nHinweis: Der Vorschlags-Tab wird dabei auch neu berechnet."
    )) return;
    startTransition(async () => {
      const res = await refreshStockForOrder(orderId);
      if (res.error) setErr(res.error);
      else setOk(true);
      setTimeout(() => { setErr(null); setOk(false); }, 10000);
    });
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-white hover:bg-amber-50 transition disabled:opacity-50"
        title="Apps Script triggern: Stock-Sheet aggregation neu berechnen, sodass der Chatbot die Positionen als 'unterwegs' kennt (2-5 Min)"
      >
        {pending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        {pending ? "Läuft… (2-5 Min)" : "Stock aktualisieren"}
      </button>
      {ok && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
          <Check size={11} /> Fertig — Chatbot kennt die Positionen jetzt
        </span>
      )}
      {err && (
        <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
          <AlertCircle size={11} /> {err}
        </span>
      )}
    </div>
  );
}

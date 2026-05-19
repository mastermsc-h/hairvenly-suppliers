"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, Check, Truck, X, HelpCircle } from "lucide-react";
import { scanReservationsAgainstStock, type StockCheckResult } from "@/lib/actions/chat-reservations";

/**
 * Button + Ergebnis-Panel: scannt alle "waiting"-Reservierungen gegen die
 * Stock-Sheets und zeigt pro Eintrag den aktuellen Status.
 */
export default function StockCheckButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<StockCheckResult[] | null>(null);
  const [, startTransition] = useTransition();

  function runScan() {
    if (busy) return;
    setBusy(true);
    startTransition(async () => {
      try {
        const r = await scanReservationsAgainstStock();
        setResults(r);
        router.refresh();
      } catch (e) {
        alert((e as Error).message);
      } finally {
        setBusy(false);
      }
    });
  }

  const inStock = results?.filter(r => r.status === "in_stock") ?? [];
  const onWay   = results?.filter(r => r.status === "unterwegs") ?? [];
  const oos     = results?.filter(r => r.status === "out_of_stock") ?? [];
  const unknown = results?.filter(r => r.status === "unknown") ?? [];

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={runScan}
        disabled={busy}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60"
        title="Prüft jede wartende Reservierung gegen die Stock-Sheets"
      >
        <ScanLine size={13} />
        {busy ? "Scanne Lager…" : "Lager-Check"}
      </button>

      {results && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-neutral-900">
              Lager-Scan: {results.length} Reservierungen geprüft
            </h3>
            <button
              type="button"
              onClick={() => setResults(null)}
              className="text-neutral-400 hover:text-neutral-700"
              title="Ergebnis schließen"
            >
              <X size={15} />
            </button>
          </div>

          {inStock.length > 0 && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3">
              <div className="flex items-center gap-2 text-green-800 font-semibold mb-1.5">
                <Check size={14} /> Jetzt verfügbar — bereit zum Benachrichtigen ({inStock.length})
              </div>
              <ul className="space-y-1 text-xs text-green-900">
                {inStock.map(r => (
                  <li key={r.reservationId}>
                    <strong>{r.productName}</strong>
                    {r.matchedProduct && r.matchedProduct !== r.productName && (
                      <span className="text-green-700"> · gematcht mit „{r.matchedProduct}"</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {onWay.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <div className="flex items-center gap-2 text-amber-800 font-semibold mb-1.5">
                <Truck size={14} /> Unterwegs ({onWay.length})
              </div>
              <ul className="space-y-1 text-xs text-amber-900">
                {onWay.map(r => (
                  <li key={r.reservationId}>
                    <strong>{r.productName}</strong>
                    {r.eta && <span className="text-amber-700"> · ETA {r.eta}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {oos.length > 0 && (
            <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3">
              <div className="flex items-center gap-2 text-neutral-700 font-semibold mb-1.5">
                <X size={14} /> Ausverkauft, kein Nachschub bestätigt ({oos.length})
              </div>
              <ul className="space-y-1 text-xs text-neutral-700">
                {oos.map(r => (
                  <li key={r.reservationId}>{r.productName}</li>
                ))}
              </ul>
            </div>
          )}

          {unknown.length > 0 && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
              <div className="flex items-center gap-2 text-blue-800 font-semibold mb-1.5">
                <HelpCircle size={14} /> Nicht im Sortiment gefunden ({unknown.length})
              </div>
              <ul className="space-y-1 text-xs text-blue-900">
                {unknown.map(r => (
                  <li key={r.reservationId}>
                    {r.productName} — Produktname zu unspezifisch oder existiert nicht im Sheet
                  </li>
                ))}
              </ul>
            </div>
          )}

          {results.length === 0 && (
            <div className="text-xs text-neutral-500">Keine wartenden Reservierungen.</div>
          )}
        </div>
      )}
    </div>
  );
}

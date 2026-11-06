"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Plus } from "lucide-react";
import type { EinfuhrVermutung, EinfuhrZahlung } from "@/lib/liquiditaet/rechnung";
import { setEinfuhrRechnung } from "@/lib/actions/liquiditaet";

const deDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
const eur = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/**
 * DHL-/Zoll-Rechnungsnummer (ZIT…) an der Bestellung. Steht sie im Verwendungszweck einer
 * Abbuchung, sind die Einfuhrabgaben bezahlt und fallen aus der Vorschau.
 */
export default function EinfuhrRechnung({
  orderId,
  rechnung,
  zahlung,
  vermutung = null,
  art = "dhl",
}: {
  orderId: string;
  rechnung: string | null;
  zahlung: EinfuhrZahlung | null;
  /** Nicht zugeordnete Abbuchung nach dem Versand, schon gegen die Schätzung verrechnet. */
  vermutung?: EinfuhrVermutung | null;
  /** "zoll" = beliebiger Verzoller (Ungewitter, DHL …), sonst DHL-ZIT. */
  art?: "dhl" | "zoll";
}) {
  const [offen, setOffen] = useState(false);
  const [wert, setWert] = useState(rechnung ?? "");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function speichern(text: string | null) {
    setBusy(true);
    setFehler(null);
    const r = await setEinfuhrRechnung(orderId, text);
    setBusy(false);
    if (!r.ok) return setFehler(r.error ?? "Fehler");
    setOffen(false);
  }

  if (offen) {
    return (
      <div className="mt-1 w-56 space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs">
        <input
          autoFocus
          value={wert}
          maxLength={300}
          onChange={(ev) => setWert(ev.target.value)}
          onKeyDown={(ev) => ev.key === "Enter" && !busy && speichern(wert)}
          placeholder={art === "zoll" ? "z.B. 26 33474 oder ZIT8150777" : "z.B. ZIT8150777"}
          className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
        />
        <div className="text-neutral-500">Mehrere mit Komma trennen.</div>
        {fehler && <div className="text-red-700">{fehler}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => speichern(wert)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-2.5 py-1 font-medium text-white disabled:opacity-50">
            {busy && <Loader2 size={12} className="animate-spin" />}
            Speichern
          </button>
          {rechnung && (
            <button onClick={() => speichern(null)} disabled={busy} className="font-medium text-neutral-700 hover:underline disabled:opacity-50">
              Entfernen
            </button>
          )}
          <button onClick={() => { setWert(rechnung ?? ""); setFehler(null); setOffen(false); }} disabled={busy} className="text-neutral-500 hover:underline disabled:opacity-50">
            Abbrechen
          </button>
        </div>
      </div>
    );
  }

  if (!rechnung && vermutung) {
    const nr = vermutung.nummern.join(", ");
    return (
      <div className="mt-1 text-xs">
        <div
          className="text-emerald-700"
          title="Diese Abbuchung kam nach dem Versand und steht an keiner Bestellung — sie ist gegen die Schätzung verrechnet, damit sie nicht doppelt zählt."
        >
          ≈ wahrscheinlich bezahlt: {nr || "Abbuchung"} am {deDate(vermutung.datum)} ({eur(vermutung.betragEur)})
          {!vermutung.vollstaendig && <span className="text-amber-700"> · deckt {eur(vermutung.anteilEur)}, Rest offen</span>}
        </div>
        {fehler && <div className="text-red-700">{fehler}</div>}
        <div className="flex items-center gap-2">
          {nr && (
            <button onClick={() => speichern(nr)} disabled={busy} className="inline-flex items-center gap-1 font-medium text-neutral-900 hover:underline disabled:opacity-50">
              {busy && <Loader2 size={11} className="animate-spin" />}
              Zuordnen
            </button>
          )}
          <button onClick={() => setOffen(true)} disabled={busy} className="text-neutral-500 hover:text-neutral-900 disabled:opacity-50">
            andere Nummer
          </button>
        </div>
      </div>
    );
  }

  if (!rechnung) {
    return (
      <button onClick={() => setOffen(true)} className="mt-1 inline-flex items-center gap-0.5 text-xs text-neutral-500 hover:text-neutral-900">
        <Plus size={11} /> {art === "zoll" ? "Zoll-Rechnung (Ungewitter/DHL)" : "DHL-Rechnung (ZIT)"}
      </button>
    );
  }

  const fertig = !!zahlung && zahlung.gefunden.length === zahlung.rechnungen.length;
  const fehlt = zahlung ? zahlung.rechnungen.filter((n) => !zahlung.gefunden.includes(n)) : [];
  return (
    <div className="mt-1 text-xs">
      <button onClick={() => setOffen(true)} title="Rechnungsnummer ändern" className="group inline-flex items-center gap-1 text-neutral-600 hover:text-neutral-900">
        <span className="font-mono">{rechnung}</span>
        <Pencil size={10} className="text-neutral-400 group-hover:text-neutral-900" />
      </button>
      {fertig && zahlung?.datum ? (
        <div
          className="flex items-center gap-1 font-medium text-emerald-700"
          title={zahlung.sammel ? "DHL hat mehrere Rechnungen in einer Abbuchung zusammengefasst — der Betrag gilt nicht nur für diese Bestellung." : undefined}
        >
          <Check size={12} /> abgebucht {deDate(zahlung.datum)}: {eur(zahlung.betragEur)}
          {zahlung.sammel && <span className="font-normal text-neutral-500">(Sammelzahlung)</span>}
        </div>
      ) : (
        <div className="text-amber-700">
          {zahlung?.gefunden.length ? `teils abgebucht (${eur(zahlung.betragEur)}) · offen: ${fehlt.join(", ")}` : "noch nicht abgebucht"}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import type { TerminStand } from "@/lib/liquiditaet/rechnung";

function deDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

/**
 * Zahltermin mit Verschieben: Klick aufs Datum öffnet das Feld. Solange es offen ist, rechnet die
 * Seite mit dem gewählten Datum (Vorschau), gespeichert wird erst mit „Speichern“.
 */
export default function ZahlTermin({
  datum,
  sofort,
  termin,
  min,
  max,
  tiefpunkt,
  oeffnenSignal = 0,
  onVorschau,
  onSpeichern,
}: {
  datum: string;
  sofort: boolean;
  termin: TerminStand;
  min: string;
  max: string;
  /** Aktueller Tiefpunkt der Vorschau, als Rückmeldung beim Ausprobieren. */
  tiefpunkt: string;
  /** Steigt der Wert, öffnet sich das Feld (Sprung aus dem Diagramm). */
  oeffnenSignal?: number;
  onVorschau: (datum: string | null) => void;
  onSpeichern: (datum: string | null, notiz: string) => Promise<string | null>;
}) {
  const [offen, setOffen] = useState(false);
  const [wert, setWert] = useState(datum);
  const [notiz, setNotiz] = useState("");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const gueltig = /^\d{4}-\d{2}-\d{2}$/.test(wert) && wert >= min && wert <= max;

  function oeffnen() {
    setWert(datum);
    setNotiz(termin.notiz ?? "");
    setFehler(null);
    setOffen(true);
  }

  useEffect(() => {
    if (oeffnenSignal) oeffnen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oeffnenSignal]);

  function aendern(v: string) {
    setWert(v);
    onVorschau(/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= min && v <= max ? v : null);
  }

  async function speichern(ziel: string | null) {
    setBusy(true);
    setFehler(null);
    const err = await onSpeichern(ziel, notiz);
    setBusy(false);
    if (err) return setFehler(err);
    onVorschau(null);
    setOffen(false);
  }

  if (!offen) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <button
          onClick={oeffnen}
          title="Zahltermin verschieben"
          className="group inline-flex items-center gap-1 tabular-nums underline decoration-dotted decoration-neutral-300 underline-offset-2 hover:decoration-neutral-900"
        >
          {deDate(datum)}
          <Pencil size={11} className="text-neutral-400 group-hover:text-neutral-900" />
        </button>
        {termin.verschoben && (
          <span
            title={`Berechnet: ${deDate(termin.regelDatum)}${termin.notiz ? ` · ${termin.notiz}` : ""}`}
            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
          >
            verschoben
          </span>
        )}
        {termin.abgelaufenAm ? (
          <span className="text-xs font-medium text-red-600">Termin {deDate(termin.abgelaufenAm)} verstrichen</span>
        ) : (
          sofort && <span className="text-xs font-medium text-red-600">sofort</span>
        )}
      </span>
    );
  }

  return (
    <div className="w-52 space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs">
      <input
        type="date"
        autoFocus
        value={wert}
        min={min}
        max={max}
        onChange={(ev) => aendern(ev.target.value)}
        className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
      <input
        type="text"
        value={notiz}
        maxLength={200}
        onChange={(ev) => setNotiz(ev.target.value)}
        placeholder="Notiz (optional)"
        className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
      <div className="text-neutral-600">
        Berechnet: {deDate(termin.regelDatum)} · Tiefpunkt: <b className="tabular-nums">{tiefpunkt}</b>
      </div>
      {!gueltig && <div className="text-red-700">Datum muss zwischen {deDate(min)} und {deDate(max)} liegen.</div>}
      {fehler && <div className="text-red-700">{fehler}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => speichern(wert)}
          disabled={busy || !gueltig}
          className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-2.5 py-1 font-medium text-white disabled:opacity-50"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          Speichern
        </button>
        {(termin.verschoben || termin.abgelaufenAm) && (
          <button onClick={() => speichern(null)} disabled={busy} className="font-medium text-neutral-700 hover:underline disabled:opacity-50">
            Zurücksetzen
          </button>
        )}
        <button
          onClick={() => {
            onVorschau(null);
            setOffen(false);
          }}
          disabled={busy}
          className="text-neutral-500 hover:underline disabled:opacity-50"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

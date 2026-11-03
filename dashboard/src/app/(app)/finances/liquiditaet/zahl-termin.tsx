"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { plusTage, type TerminStand, type Teilung } from "@/lib/liquiditaet/rechnung";

function deDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}
const usd = (n: number) => "$" + Math.round(n).toLocaleString("de-DE");
const istDatum = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Was das Terminfeld plant: ganzer Betrag am `datum` oder Anzahlung am `datum` + Rest am `restDatum`. */
export type TerminEntwurf = { datum: string; anzahlungUsd?: number | null; restDatum?: string | null };

/**
 * Zahltermin mit Verschieben: Klick aufs Datum öffnet das Feld. Solange es offen ist, rechnet die
 * Seite mit dem gewählten Datum (Vorschau), gespeichert wird erst mit „Speichern“.
 * Mit `anzahlung` (nur Bestellungen) lässt sich der Betrag in Anzahlung + Rest teilen.
 */
export default function ZahlTermin({
  datum,
  sofort,
  termin,
  min,
  max,
  tiefpunkt,
  oeffnenSignal = 0,
  anzahlung,
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
  anzahlung?: { offenUsd: number; restTage: number; teilung: Teilung | null };
  onVorschau: (entwurf: TerminEntwurf | null) => void;
  onSpeichern: (entwurf: TerminEntwurf | null, notiz: string) => Promise<string | null>;
}) {
  const teilung = anzahlung?.teilung ?? null;
  const [offen, setOffen] = useState(false);
  const [geteilt, setGeteilt] = useState(false);
  const [wert, setWert] = useState(datum);
  const [betrag, setBetrag] = useState("");
  const [restWert, setRestWert] = useState("");
  const [restVonHand, setRestVonHand] = useState(false);
  const [notiz, setNotiz] = useState("");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const imZeitraum = (v: string) => istDatum(v) && v >= min && v <= max;
  const anzBezahlt = !!teilung?.anzahlungBezahlt;
  const betragZahl = Number(betrag.replace(/\./g, "").replace(",", "."));
  const fehlerText = !imZeitraum(geteilt && anzBezahlt ? restWert : wert)
    ? `Datum muss zwischen ${deDate(min)} und ${deDate(max)} liegen.`
    : !geteilt
      ? null
      : !anzBezahlt && !(betragZahl > 0 && betragZahl < (anzahlung?.offenUsd ?? 0))
        ? `Anzahlung zwischen $1 und ${usd(anzahlung?.offenUsd ?? 0)}.`
        : !imZeitraum(restWert) || (!anzBezahlt && restWert < wert)
          ? "Rest-Datum muss nach der Anzahlung und im Vorschau-Zeitraum liegen."
          : null;

  // Ist die Anzahlung schon bezahlt, zählt nur noch der Rest-Termin
  const entwurf = (z: { geteilt: boolean; wert: string; betrag: number; rest: string }): TerminEntwurf =>
    !z.geteilt ? { datum: z.wert } : anzBezahlt ? { datum: z.rest, anzahlungUsd: z.betrag, restDatum: z.rest } : { datum: z.wert, anzahlungUsd: z.betrag, restDatum: z.rest };

  function vorschau(z: { geteilt: boolean; wert: string; betrag: number; rest: string }) {
    const ok = !z.geteilt ? imZeitraum(z.wert) : z.betrag > 0 && imZeitraum(z.rest) && (anzBezahlt || (imZeitraum(z.wert) && z.rest >= z.wert));
    onVorschau(ok ? entwurf(z) : null);
  }

  function oeffnen() {
    const t = !!teilung;
    const w = teilung ? teilung.anzahlungDatum : datum;
    setGeteilt(t);
    setWert(w);
    setBetrag(teilung ? String(Math.round(teilung.anzahlungUsd)) : "");
    setRestWert(teilung ? teilung.restDatum : plusTage(w, anzahlung?.restTage ?? 28));
    setRestVonHand(t);
    setNotiz(termin.notiz ?? "");
    setFehler(null);
    setOffen(true);
  }

  useEffect(() => {
    if (oeffnenSignal) oeffnen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oeffnenSignal]);

  function aendern(patch: Partial<{ geteilt: boolean; wert: string; betrag: string; rest: string }>) {
    const z = { geteilt, wert, betrag, rest: restWert, ...patch };
    // Rest folgt der Anzahlung, bis er von Hand gesetzt wurde
    if (patch.wert && !restVonHand && istDatum(patch.wert)) z.rest = plusTage(patch.wert, anzahlung?.restTage ?? 28);
    if (patch.rest !== undefined) setRestVonHand(true);
    setGeteilt(z.geteilt);
    setWert(z.wert);
    setBetrag(z.betrag);
    setRestWert(z.rest);
    vorschau({ geteilt: z.geteilt, wert: z.wert, betrag: Number(z.betrag.replace(/\./g, "").replace(",", ".")), rest: z.rest });
  }

  async function speichern(ziel: TerminEntwurf | null) {
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
          title={anzahlung ? "Zahltermin verschieben oder Anzahlung planen" : "Zahltermin verschieben"}
          className="group inline-flex items-center gap-1 tabular-nums underline decoration-dotted decoration-neutral-300 underline-offset-2 hover:decoration-neutral-900"
        >
          {deDate(datum)}
          <Pencil size={11} className="text-neutral-400 group-hover:text-neutral-900" />
        </button>
        {teilung ? (
          <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
            {teilung.anzahlungBezahlt ? `Anzahlung bezahlt · Rest ${usd(teilung.restUsd)}` : `Anzahlung ${usd(teilung.anzahlungUsd)}`}
          </span>
        ) : (
          termin.verschoben && (
            <span
              title={`Berechnet: ${deDate(termin.regelDatum)}${termin.notiz ? ` · ${termin.notiz}` : ""}`}
              className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
            >
              verschoben
            </span>
          )
        )}
        {termin.abgelaufenAm ? (
          <span className="text-xs font-medium text-red-600">Termin {deDate(termin.abgelaufenAm)} verstrichen</span>
        ) : teilung?.restAbgelaufenAm ? (
          <span className="text-xs font-medium text-red-600">Rest-Termin {deDate(teilung.restAbgelaufenAm)} verstrichen</span>
        ) : (
          sofort && <span className="text-xs font-medium text-red-600">sofort</span>
        )}
        {teilung && !teilung.anzahlungBezahlt && teilung.restUsd > 0.01 && (
          <span className="block w-full text-xs text-neutral-500" title={termin.notiz ?? undefined}>
            Rest {usd(teilung.restUsd)} am {deDate(teilung.restDatum)}
          </span>
        )}
      </span>
    );
  }

  const feld = "w-full rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900";
  return (
    <div className="w-56 space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs">
      {anzahlung && (
        <div className="flex rounded-lg border border-neutral-300 bg-white p-0.5">
          {[
            [false, "Ganzer Betrag"],
            [true, "Anzahlung"],
          ].map(([an, text]) => (
            <button
              key={String(an)}
              onClick={() => aendern({ geteilt: an as boolean })}
              className={`flex-1 rounded-md px-1.5 py-0.5 font-medium ${geteilt === an ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"}`}
            >
              {text as string}
            </button>
          ))}
        </div>
      )}
      {geteilt && anzBezahlt ? (
        <div className="text-neutral-600">
          Anzahlung {usd(teilung?.anzahlungUsd ?? 0)} ist bezahlt. Offen: <b className="tabular-nums">{usd(anzahlung?.offenUsd ?? 0)}</b>
        </div>
      ) : (
        <>
          {geteilt && (
            <label className="block">
              <span className="text-neutral-500">Anzahlung ($) von {usd(anzahlung?.offenUsd ?? 0)}</span>
              <input
                inputMode="decimal"
                autoFocus
                value={betrag}
                onChange={(ev) => aendern({ betrag: ev.target.value })}
                placeholder="z.B. 10000"
                className={feld}
              />
            </label>
          )}
          <label className="block">
            {geteilt && <span className="text-neutral-500">Anzahlung am</span>}
            <input type="date" autoFocus={!geteilt} value={wert} min={min} max={max} onChange={(ev) => aendern({ wert: ev.target.value })} className={feld} />
          </label>
        </>
      )}
      {geteilt && (
        <label className="block">
          <span className="text-neutral-500">
            Rest{!anzBezahlt && betragZahl > 0 && betragZahl < (anzahlung?.offenUsd ?? 0) ? ` ${usd((anzahlung?.offenUsd ?? 0) - betragZahl)}` : ""} am
          </span>
          <input type="date" value={restWert} min={anzBezahlt ? min : wert} max={max} onChange={(ev) => aendern({ rest: ev.target.value })} className={feld} />
        </label>
      )}
      <input type="text" value={notiz} maxLength={200} onChange={(ev) => setNotiz(ev.target.value)} placeholder="Notiz (optional)" className={feld} />
      <div className="text-neutral-600">
        Berechnet: {deDate(termin.regelDatum)} · Tiefpunkt: <b className="tabular-nums">{tiefpunkt}</b>
      </div>
      {fehlerText && <div className="text-red-700">{fehlerText}</div>}
      {fehler && <div className="text-red-700">{fehler}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => speichern(entwurf({ geteilt, wert, betrag: anzBezahlt ? (teilung?.anzahlungUsd ?? 0) : betragZahl, rest: restWert }))}
          disabled={busy || !!fehlerText}
          className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-2.5 py-1 font-medium text-white disabled:opacity-50"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          Speichern
        </button>
        {(termin.verschoben || termin.abgelaufenAm || teilung) && (
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

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Paperclip,
  Receipt,
  Settings,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import {
  fetchZBonStatus,
  fetchZBons,
  zbonAusnahmeEntfernen,
  zbonAusnahmeSetzen,
  zbonDateiUrl,
  zbonEinstellungenSpeichern,
  zbonLoeschen,
  zbonSpeichern,
} from "@/lib/actions/z-bons";
import { ladeHoch, mimeVon, verkleinere } from "@/lib/z-bons/browser";
import type { ZBon, ZBonQuelle, ZBonStatus } from "@/lib/types";

const QUELLEN: Record<ZBonQuelle, { name: string; cls: string; aktiv: string }> = {
  shopify_pos: { name: "Shopify POS", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", aktiv: "bg-emerald-600 text-white border-emerald-600" },
  nexi: { name: "Nexi (Treatwell)", cls: "bg-sky-50 text-sky-800 border-sky-200", aktiv: "bg-sky-600 text-white border-sky-600" },
};
const QUELL_LISTE = Object.keys(QUELLEN) as ZBonQuelle[];

const eur = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const iso = (j: number, m: number, t: number) => `${j}-${String(m).padStart(2, "0")}-${String(t).padStart(2, "0")}`;
const deDatum = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

type Auswahl = { id: string; file: File; vorschau: string | null };

export default function ZBons({
  initialJahr,
  initialMonat,
  initialBons,
  initialStatus,
  heute,
}: {
  initialJahr: number;
  initialMonat: number;
  initialBons: ZBon[];
  initialStatus: ZBonStatus;
  heute: string;
}) {
  const [jahr, setJahr] = useState(initialJahr);
  const [monat, setMonat] = useState(initialMonat);
  const [bons, setBons] = useState<ZBon[]>(initialBons);
  const [status, setStatusDaten] = useState<ZBonStatus>(initialStatus);
  const [ausnahmeFuer, setAusnahmeFuer] = useState<{ datum: string; quelle: ZBonQuelle } | null>(null);
  const [ausnahmeGrund, setAusnahmeGrund] = useState("geschlossen");
  const [laedt, startLaden] = useTransition();
  const [offen, setOffen] = useState<ZBon | null>(null);

  // Formular
  const [quelle, setQuelle] = useState<ZBonQuelle>("shopify_pos");
  const [datum, setDatum] = useState(heute);
  const [betrag, setBetrag] = useState("");
  const [notiz, setNotiz] = useState("");
  const [auswahl, setAuswahl] = useState<Auswahl[]>([]);
  const [schritt, setSchritt] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const kameraRef = useRef<HTMLInputElement>(null);
  const dateiRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => auswahl.forEach((a) => a.vorschau && URL.revokeObjectURL(a.vorschau)), [auswahl]);

  function laden(j: number, m: number) {
    setJahr(j);
    setMonat(m);
    startLaden(async () => {
      const [b, st] = await Promise.all([fetchZBons(j, m), fetchZBonStatus(j, m)]);
      setBons(b);
      setStatusDaten(st);
    });
  }
  function blaettern(d: number) {
    const m0 = jahr * 12 + (monat - 1) + d;
    laden(Math.floor(m0 / 12), (m0 % 12) + 1);
  }

  function hinzufuegen(files: FileList | null) {
    if (!files?.length) return;
    setFehler(null);
    setErfolg(null);
    const neu = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      vorschau: mimeVon(file).startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setAuswahl((prev) => [...prev, ...neu]);
  }
  function entfernen(id: string) {
    setAuswahl((prev) => {
      const a = prev.find((x) => x.id === id);
      if (a?.vorschau) URL.revokeObjectURL(a.vorschau);
      return prev.filter((x) => x.id !== id);
    });
  }

  const doppelt = bons.filter((b) => b.datum === datum && b.quelle === quelle);
  const betragZahl = betrag.trim() ? Number(betrag.replace(/\./g, "").replace(",", ".")) : null;
  const betragUngueltig = betragZahl !== null && !Number.isFinite(betragZahl);

  async function speichern() {
    if (!auswahl.length || schritt) return;
    if (betragUngueltig) return setFehler("Betrag ist keine Zahl");
    if (datum > heute) return setFehler("Datum liegt in der Zukunft");
    setFehler(null);
    setErfolg(null);
    try {
      setSchritt("Fotos werden vorbereitet …");
      const files = await Promise.all(auswahl.map((a) => verkleinere(a.file)));
      const dateien = await ladeHoch(datum, files, (i, n) => setSchritt(`Hochladen ${i} von ${n} …`));
      setSchritt("Speichern …");
      const res = await zbonSpeichern({ datum, quelle, betrag: betragZahl, notiz, dateien });
      if (!res.ok) throw new Error(res.error);
      setErfolg(`${QUELLEN[quelle].name} vom ${deDatum(datum)} gespeichert`);
      auswahl.forEach((a) => a.vorschau && URL.revokeObjectURL(a.vorschau));
      setAuswahl([]);
      setBetrag("");
      setNotiz("");
      laden(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)));
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setSchritt(null);
    }
  }

  // Tage des Monats bis heute, neueste oben
  const letzterTag = new Date(jahr, monat, 0).getDate();
  const tage = Array.from({ length: letzterTag }, (_, i) => iso(jahr, monat, i + 1))
    .filter((d) => d <= heute)
    .reverse();
  const proTag = (d: string, q: ZBonQuelle) => bons.filter((b) => b.datum === d && b.quelle === q);
  const summe = (q: ZBonQuelle) => bons.filter((b) => b.quelle === q).reduce((s, b) => s + (b.betrag ?? 0), 0);
  const anzahl = (q: ZBonQuelle) => new Set(bons.filter((b) => b.quelle === q).map((b) => b.datum)).size;
  const istAktuellerMonat = iso(jahr, monat, 1).slice(0, 7) === heute.slice(0, 7);
  const erwartet = new Set(status.erwartet.map((e) => `${e.datum}|${e.quelle}`));
  const ausnahme = new Map(status.ausnahmen.map((a) => [`${a.datum}|${a.quelle}`, a.grund]));
  const fehltImMonat = status.fehlend.filter((f) => f.datum < heute); // heute kommt der Bon erst abends

  async function ausnahmeSpeichern() {
    if (!ausnahmeFuer) return;
    const res = await zbonAusnahmeSetzen(ausnahmeFuer.datum, ausnahmeFuer.quelle, ausnahmeGrund);
    if (!res.ok) return setFehler(res.error);
    setAusnahmeFuer(null);
    laden(jahr, monat);
  }

  function nachtragen(d: string, q: ZBonQuelle) {
    setDatum(d);
    setQuelle(q);
    setErfolg(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Z-Bons</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Tagesabschlüsse von Shopify POS und Nexi (Treatwell) — als Foto, PDF oder Bild ablegen.
        </p>
      </div>

      <Link
        href="/finances/z-bons/scan"
        className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 hover:bg-emerald-100"
      >
        <Smartphone size={28} className="shrink-0" />
        <span className="text-sm">
          <b>Z-Bon-Scanner fürs iPhone/iPad:</b> Bon fotografieren — Kasse, Datum und Umsatz werden automatisch erkannt und
          gespeichert. Auf dem iPhone öffnen und über <i>Teilen → Zum Home-Bildschirm</i> als App ablegen.
        </span>
      </Link>

      <WochencheckBanner status={status} fehltImMonat={fehltImMonat.length} istAktuellerMonat={istAktuellerMonat} />

      {/* Hochladen */}
      <div ref={formRef} className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm space-y-4 scroll-mt-4">
        <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
          <Receipt size={18} /> Neuen Z-Bon ablegen
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Kasse</div>
            <div className="grid grid-cols-2 gap-2">
              {QUELL_LISTE.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuelle(q)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${quelle === q ? QUELLEN[q].aktiv : "bg-white text-neutral-700 border-neutral-300"}`}
                >
                  {QUELLEN[q].name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-neutral-600 uppercase tracking-wide">Datum</span>
              <input
                type="date"
                value={datum}
                max={heute}
                onChange={(e) => setDatum(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-neutral-600 uppercase tracking-wide">Tagesumsatz (optional)</span>
              <input
                inputMode="decimal"
                placeholder="z.B. 1.234,50"
                value={betrag}
                onChange={(e) => setBetrag(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm text-right tabular-nums focus:ring-2 focus:ring-neutral-900 focus:outline-none ${betragUngueltig ? "border-red-400" : "border-neutral-300"}`}
              />
            </label>
          </div>
        </div>

        {/* Dateien */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:flex">
            <button
              type="button"
              onClick={() => kameraRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-4 py-3 text-sm font-medium"
            >
              <Camera size={18} /> Foto aufnehmen
            </button>
            <button
              type="button"
              onClick={() => dateiRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-3 text-sm font-medium text-neutral-800"
            >
              <Paperclip size={18} /> Datei wählen
            </button>
          </div>
          <input
            ref={kameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              hinzufuegen(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={dateiRef}
            type="file"
            accept="application/pdf,image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => {
              hinzufuegen(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="text-xs text-neutral-500">
            Langer Bon? Einfach mehrere Fotos nacheinander aufnehmen — sie werden zusammen als ein Z-Bon gespeichert.
          </p>
          {auswahl.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {auswahl.map((a, i) => (
                <div key={a.id} className="relative w-24 h-32 rounded-lg border border-neutral-200 bg-neutral-50 overflow-hidden">
                  {a.vorschau ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.vorschau} alt={a.file.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-neutral-600">
                      <FileText size={24} className="text-neutral-400" />
                      <span className="line-clamp-3 break-all">{a.file.name}</span>
                    </div>
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => entfernen(a.id)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                    aria-label="Entfernen"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <input
          placeholder="Notiz (optional)"
          value={notiz}
          onChange={(e) => setNotiz(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
        />

        {doppelt.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Für {QUELLEN[quelle].name} am {deDatum(datum)} liegt schon ein Z-Bon vor. Trotzdem speichern geht (z.B. zweite Kasse oder
            fehlende Seite).
          </div>
        )}
        {fehler && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{fehler}</div>}
        {erfolg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">✓ {erfolg}</div>}

        <button
          type="button"
          onClick={speichern}
          disabled={!auswahl.length || !!schritt}
          className="w-full md:w-auto flex items-center justify-center gap-2 bg-neutral-900 text-white font-medium rounded-lg px-5 py-2.5 text-sm disabled:opacity-40"
        >
          {schritt ? <Loader2 size={16} className="animate-spin" /> : null}
          {schritt ?? (auswahl.length ? `Z-Bon speichern (${auswahl.length} ${auswahl.length === 1 ? "Datei" : "Dateien"})` : "Erst Foto oder Datei hinzufügen")}
        </button>
      </div>

      {/* Monatsübersicht */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center rounded-lg border border-neutral-300 bg-white">
            <button onClick={() => blaettern(-1)} className="px-2 py-1.5 text-neutral-500 hover:text-neutral-900" aria-label="Vormonat">
              <ChevronLeft size={16} />
            </button>
            <span className="px-2 text-sm font-semibold tabular-nums min-w-36 text-center">
              {laedt ? <Loader2 size={14} className="animate-spin inline" /> : `${MONATE[monat - 1]} ${jahr}`}
            </span>
            <button
              onClick={() => blaettern(1)}
              disabled={istAktuellerMonat}
              className="px-2 py-1.5 text-neutral-500 hover:text-neutral-900 disabled:opacity-30"
              aria-label="Nächster Monat"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {QUELL_LISTE.map((q) => (
              <span key={q} className={`rounded-full border px-2.5 py-1 ${QUELLEN[q].cls}`}>
                {QUELLEN[q].name}: <b>{anzahl(q)}</b> Tage{summe(q) > 0 && <> · {eur(summe(q))}</>}
              </span>
            ))}
          </div>
        </div>

        {tage.length === 0 ? (
          <p className="text-sm text-neutral-500">Dieser Monat liegt in der Zukunft.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                <th className="py-2 text-left font-medium">Tag</th>
                {QUELL_LISTE.map((q) => (
                  <th key={q} className="py-2 text-left font-medium">
                    {QUELLEN[q].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tage.map((d) => {
                const wt = new Date(`${d}T12:00:00`).getDay();
                return (
                  <tr key={d} className={`border-b border-neutral-100 ${wt === 0 ? "bg-neutral-50" : ""}`}>
                    <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums text-neutral-700">
                      <span className="inline-block w-6 text-neutral-400">{WT[wt]}</span>
                      {d.slice(8, 10)}.{d.slice(5, 7)}.
                    </td>
                    {QUELL_LISTE.map((q) => {
                      const liste = proTag(d, q);
                      return (
                        <td key={q} className="py-1.5 pr-2">
                          {liste.length ? (
                            <div className="flex flex-wrap gap-1">
                              {liste.map((b) => (
                                <button
                                  key={b.id}
                                  onClick={() => setOffen(b)}
                                  className={`rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums hover:opacity-80 ${QUELLEN[q].cls}`}
                                >
                                  ✓ {b.betrag != null ? eur(b.betrag) : "Bon"}
                                  {b.dateien.length > 1 && <span className="opacity-60"> · {b.dateien.length} S.</span>}
                                </button>
                              ))}
                            </div>
                          ) : ausnahme.has(`${d}|${q}`) ? (
                            <button
                              onClick={async () => {
                                await zbonAusnahmeEntfernen(d, q);
                                laden(jahr, monat);
                              }}
                              title="Ausnahme aufheben"
                              className="text-xs text-neutral-400 hover:text-neutral-700"
                            >
                              kein Bon · {ausnahme.get(`${d}|${q}`)}
                            </button>
                          ) : erwartet.has(`${d}|${q}`) && d < heute ? (
                            <span className="flex flex-wrap items-center gap-x-2 text-xs">
                              <button onClick={() => nachtragen(d, q)} className="font-medium text-red-600 hover:underline">
                                fehlt · nachtragen
                              </button>
                              <button
                                onClick={() => {
                                  setAusnahmeFuer({ datum: d, quelle: q });
                                  setAusnahmeGrund("geschlossen");
                                }}
                                className="text-neutral-400 hover:text-neutral-700"
                              >
                                kein Bon
                              </button>
                            </span>
                          ) : (
                            <button onClick={() => nachtragen(d, q)} className="text-xs text-neutral-300 hover:text-neutral-700">
                              – nachtragen
                            </button>
                          )}
                          {q === "shopify_pos" && status.posUmsatz[d] != null && (
                            <PosAbgleich shopify={status.posUmsatz[d]} bons={liste} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {ausnahmeFuer && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50" onClick={() => setAusnahmeFuer(null)}>
          <div className="bg-white w-full md:max-w-sm rounded-t-2xl md:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-neutral-900">
              Kein Z-Bon: {QUELLEN[ausnahmeFuer.quelle].name}, {deDatum(ausnahmeFuer.datum)}
            </div>
            <div className="flex flex-wrap gap-2">
              {["geschlossen", "Feiertag", "Kasse nicht benutzt", "Urlaub"].map((g) => (
                <button
                  key={g}
                  onClick={() => setAusnahmeGrund(g)}
                  className={`rounded-full border px-3 py-1 text-xs ${ausnahmeGrund === g ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300"}`}
                >
                  {g}
                </button>
              ))}
            </div>
            <input
              value={ausnahmeGrund}
              onChange={(e) => setAusnahmeGrund(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button onClick={ausnahmeSpeichern} disabled={!ausnahmeGrund.trim()} className="flex-1 rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-40">
                Speichern
              </button>
              <button onClick={() => setAusnahmeFuer(null)} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      <PruefEinstellungen
        einst={status.einstellungen}
        onGespeichert={() => laden(jahr, monat)}
      />

      {offen && (
        <BonDetail
          bon={offen}
          onClose={() => setOffen(null)}
          onGeloescht={() => {
            setBons((prev) => prev.filter((b) => b.id !== offen.id));
            setOffen(null);
          }}
        />
      )}
    </div>
  );
}

function BonDetail({ bon, onClose, onGeloescht }: { bon: ZBon; onClose: () => void; onGeloescht: () => void }) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [loeschen, setLoeschen] = useState(false);
  const [grund, setGrund] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let aktiv = true;
    Promise.all(bon.dateien.map(async (d) => [d.id, await zbonDateiUrl(d.pfad)] as const)).then((e) => {
      if (aktiv) setUrls(Object.fromEntries(e));
    });
    return () => {
      aktiv = false;
    };
  }, [bon]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function herunterladen(pfad: string) {
    const url = await zbonDateiUrl(pfad, true);
    if (url) window.location.assign(url);
  }

  async function bestaetigeLoeschen() {
    setBusy(true);
    setFehler(null);
    const res = await zbonLoeschen(bon.id, grund);
    setBusy(false);
    if (res.ok) onGeloescht();
    else setFehler(res.error);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-6" onClick={onClose}>
      <div
        className="bg-white w-full md:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl md:rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-neutral-900">
              {QUELLEN[bon.quelle].name} · {deDatum(bon.datum)}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {bon.betrag != null && <>Tagesumsatz {eur(bon.betrag)} · </>}
              Abgelegt {new Date(bon.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
              {bon.hochgeladen_von_name && <> von {bon.hochgeladen_von_name}</>}
            </div>
            {bon.notiz && <div className="text-sm text-neutral-700 mt-1">{bon.notiz}</div>}
          </div>
          <button onClick={onClose} className="p-1 text-neutral-500 hover:text-neutral-900" aria-label="Schließen">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {bon.dateien.map((d, i) => {
            const url = urls[d.id];
            const istBild = d.mime.startsWith("image/");
            return (
              <div key={d.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
                  <span className="truncate">
                    {bon.dateien.length > 1 && <>Seite {i + 1} · </>}
                    {d.dateiname} · {(d.groesse / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-neutral-900">
                        <ExternalLink size={13} /> Öffnen
                      </a>
                    )}
                    <button onClick={() => herunterladen(d.pfad)} className="flex items-center gap-1 hover:text-neutral-900">
                      <Download size={13} /> Laden
                    </button>
                  </span>
                </div>
                {url === undefined ? (
                  <div className="flex h-40 items-center justify-center rounded-lg bg-neutral-50">
                    <Loader2 size={20} className="animate-spin text-neutral-400" />
                  </div>
                ) : url === null ? (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Datei konnte nicht geladen werden</div>
                ) : istBild ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={d.dateiname} className="w-full rounded-lg border border-neutral-200" />
                ) : (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    <FileText size={28} className="text-neutral-400" /> PDF öffnen
                  </a>
                )}
              </div>
            );
          })}

          <div className="border-t border-neutral-200 pt-3">
            {!loeschen ? (
              <button onClick={() => setLoeschen(true)} className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-red-700">
                <Trash2 size={13} /> Z-Bon entfernen
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-neutral-600">
                  Kassenbelege sind aufbewahrungspflichtig — der Eintrag wird ausgeblendet, die Datei bleibt archiviert.
                </p>
                <div className="flex flex-col gap-2 md:flex-row">
                  <input
                    autoFocus
                    placeholder="Grund, z.B. falscher Tag / doppelt"
                    value={grund}
                    onChange={(e) => setGrund(e.target.value)}
                    className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
                  />
                  <button
                    onClick={bestaetigeLoeschen}
                    disabled={busy || !grund.trim()}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {busy ? "…" : "Entfernen"}
                  </button>
                  <button onClick={() => setLoeschen(false)} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm">
                    Abbrechen
                  </button>
                </div>
                {fehler && <div className="text-xs text-red-700">{fehler}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WochencheckBanner({ status, fehltImMonat, istAktuellerMonat }: { status: ZBonStatus; fehltImMonat: number; istAktuellerMonat: boolean }) {
  const p = status.letztePruefung;
  const datum = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
  return (
    <div className="space-y-2">
      {p && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${p.fehlend.length ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          {p.fehlend.length ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
          <span>
            <b>Wochencheck {datum(p.von)}–{datum(p.bis)}:</b>{" "}
            {p.fehlend.length
              ? `${p.fehlend.length} Z-Bons fehlten (${p.fehlend.map((f) => `${datum(f.datum)} ${QUELLEN[f.quelle].name}`).join(", ")})`
              : "alle Z-Bons da"}
            <span className="opacity-70"> · geprüft {new Date(p.geprueft_am).toLocaleDateString("de-DE")}{p.mail_status ? ` · Mail: ${p.mail_status}` : ""}</span>
          </span>
        </div>
      )}
      {fehltImMonat > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {istAktuellerMonat ? "Diesen Monat" : "In diesem Monat"} fehlen aktuell <b>{fehltImMonat}</b> Z-Bons — unten rot markiert.
          </span>
        </div>
      )}
      {!p && (
        <p className="text-xs text-neutral-500">Der Wochencheck läuft jeden Montag früh und meldet fehlende Z-Bons der Vorwoche per Mail.</p>
      )}
    </div>
  );
}

// Shopify-POS-Umsatz des Tages laut Shopify neben dem Bon-Betrag
function PosAbgleich({ shopify, bons }: { shopify: number; bons: ZBon[] }) {
  const bonSumme = bons.reduce((s, b) => s + (b.betrag ?? 0), 0);
  const mitBetrag = bons.some((b) => b.betrag != null);
  const abweichung = mitBetrag && Math.abs(bonSumme - shopify) > 1;
  return (
    <div className={`mt-0.5 text-[11px] tabular-nums ${abweichung ? "text-amber-700 font-medium" : "text-neutral-400"}`}>
      Shopify: {eur(shopify)}
      {abweichung && ` · Abweichung ${eur(bonSumme - shopify)}`}
    </div>
  );
}

function PruefEinstellungen({ einst, onGespeichert }: { einst: ZBonStatus["einstellungen"]; onGespeichert: () => void }) {
  const [offen, setOffen] = useState(false);
  const [ab, setAb] = useState(einst.pruef_ab);
  const [tage, setTage] = useState<number[]>(einst.nexi_wochentage);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const reihenfolge = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <button onClick={() => setOffen((o) => !o)} className="flex items-center gap-2 text-sm font-medium text-neutral-700">
        <Settings size={16} /> Prüfregeln für den Wochencheck
      </button>
      {offen && (
        <div className="mt-4 space-y-4 text-sm">
          <p className="text-neutral-600">
            <b>Shopify POS</b> wird an jedem Tag erwartet, an dem Shopify Kassenverkäufe zeigt. <b>Nexi (Treatwell)</b> wird an den
            gewählten Öffnungstagen erwartet, außer an Feiertagen in Bremen. Einzelne Tage lassen sich in der Tabelle als „kein Bon“
            markieren.
          </p>
          <div>
            <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1.5">Salon-Öffnungstage (Nexi)</div>
            <div className="flex flex-wrap gap-1.5">
              {reihenfolge.map((t) => (
                <button
                  key={t}
                  onClick={() => setTage((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
                  className={`w-11 rounded-lg border py-1.5 text-sm ${tage.includes(t) ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-300 text-neutral-600"}`}
                >
                  {WT[t]}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1.5">Prüfen ab</span>
            <input type="date" value={ab} onChange={(e) => setAb(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2" />
          </label>
          {fehler && <div className="text-xs text-red-700">{fehler}</div>}
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setFehler(null);
              const res = await zbonEinstellungenSpeichern(ab, tage);
              setBusy(false);
              if (!res.ok) return setFehler(res.error);
              setOffen(false);
              onGespeichert();
            }}
            className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-40"
          >
            {busy ? "…" : "Speichern"}
          </button>
        </div>
      )}
    </div>
  );
}

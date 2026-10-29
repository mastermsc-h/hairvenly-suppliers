"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Camera, Check, ChevronLeft, FileText, Loader2, Paperclip, Plus, RotateCcw, X } from "lucide-react";
import { fetchZBons, zbonAendern, zbonErkennen, zbonSpeichern, zbonUploadVerwerfen } from "@/lib/actions/z-bons";
import { erkennungsInput, ladeHoch, mimeVon, verkleinere, type Hochgeladen } from "@/lib/z-bons/browser";
import type { ZBonErkennung, ZBonFehlend, ZBonQuelle } from "@/lib/types";

const NAME: Record<ZBonQuelle, string> = { shopify_pos: "Shopify POS", nexi: "Nexi (Treatwell)" };
const AKTIV: Record<ZBonQuelle, string> = { shopify_pos: "bg-emerald-600 text-white border-emerald-600", nexi: "bg-sky-600 text-white border-sky-600" };
const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const deDatum = (d: string) => `${WT[new Date(`${d}T12:00:00`).getDay()]} ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const eur = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const parseBetrag = (s: string) => (s.trim() ? Number(s.replace(/\./g, "").replace(",", ".")) : null);

type Seite = { id: string; file: File; vorschau: string | null };
type Phase =
  | { art: "start" }
  | { art: "seiten" }
  | { art: "arbeitet"; text: string }
  | { art: "pruefen"; erkannt: ZBonErkennung; dateien: Hochgeladen[]; warnung: string | null }
  | { art: "gespeichert"; id: string; quelle: ZBonQuelle; datum: string; betrag: number | null; automatisch: boolean };

export default function ScanClient({ heute, offen }: { heute: string; offen: ZBonFehlend[] }) {
  const [phase, setPhase] = useState<Phase>({ art: "start" });
  const [seiten, setSeiten] = useState<Seite[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offenListe, setOffenListe] = useState(offen);
  // Formular (Prüfen/Korrigieren)
  const [quelle, setQuelle] = useState<ZBonQuelle | null>(null);
  const [datum, setDatum] = useState(heute);
  const [betrag, setBetrag] = useState("");
  const [busy, setBusy] = useState(false);
  const kameraRef = useRef<HTMLInputElement>(null);
  const dateiRef = useRef<HTMLInputElement>(null);

  function neu(files: FileList | null) {
    if (!files?.length) return;
    setFehler(null);
    const dazu = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      vorschau: mimeVon(file).startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setSeiten((p) => [...p, ...dazu]);
    setPhase({ art: "seiten" });
  }

  function zuruecksetzen() {
    seiten.forEach((s) => s.vorschau && URL.revokeObjectURL(s.vorschau));
    setSeiten([]);
    setFehler(null);
    setQuelle(null);
    setDatum(heute);
    setBetrag("");
    setPhase({ art: "start" });
  }

  async function schonVorhanden(d: string, q: ZBonQuelle): Promise<boolean> {
    const bons = await fetchZBons(Number(d.slice(0, 4)), Number(d.slice(5, 7)));
    return bons.some((b) => b.datum === d && b.quelle === q);
  }

  async function verarbeiten() {
    setFehler(null);
    try {
      setPhase({ art: "arbeitet", text: "Bon wird gelesen …" });
      const files = await Promise.all(seiten.map((s) => verkleinere(s.file)));
      const [erkannt, dateien] = await Promise.all([
        erkennungsInput(files).then((inp) => zbonErkennen(inp)),
        ladeHoch(heute, files),
      ]);
      const sicher = erkannt.ist_z_bon && erkannt.sicherheit === "hoch" && erkannt.kasse !== "unklar" && !!erkannt.datum;
      let warnung: string | null = null;
      if (sicher) {
        const q = erkannt.kasse as ZBonQuelle;
        if (await schonVorhanden(erkannt.datum!, q)) {
          warnung = `Für ${NAME[q]} am ${deDatum(erkannt.datum!)} gibt es schon einen Z-Bon. Trotzdem speichern?`;
        } else {
          setPhase({ art: "arbeitet", text: "Speichern …" });
          const res = await zbonSpeichern({
            datum: erkannt.datum!,
            quelle: q,
            betrag: erkannt.umsatz_brutto,
            notiz: "",
            dateien,
            erkannt,
            automatisch: true,
          });
          if (!res.ok) throw new Error(res.error);
          setOffenListe((l) => l.filter((f) => !(f.datum === erkannt.datum && f.quelle === q)));
          setPhase({ art: "gespeichert", id: res.id, quelle: q, datum: erkannt.datum!, betrag: erkannt.umsatz_brutto, automatisch: true });
          return;
        }
      }
      // Nicht eindeutig → mit Vorschlag zum Bestätigen
      setQuelle(erkannt.kasse === "unklar" ? null : erkannt.kasse);
      setDatum(erkannt.datum ?? heute);
      setBetrag(erkannt.umsatz_brutto != null ? erkannt.umsatz_brutto.toLocaleString("de-DE", { minimumFractionDigits: 2 }) : "");
      setPhase({ art: "pruefen", erkannt, dateien, warnung });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
      setPhase({ art: "seiten" });
    }
  }

  async function bestaetigen() {
    if (phase.art !== "pruefen" || !quelle) return;
    const b = parseBetrag(betrag);
    if (b !== null && !Number.isFinite(b)) return setFehler("Betrag ist keine Zahl");
    if (datum > heute) return setFehler("Datum liegt in der Zukunft");
    setBusy(true);
    setFehler(null);
    const res = await zbonSpeichern({ datum, quelle, betrag: b, notiz: "", dateien: phase.dateien, erkannt: phase.erkannt, automatisch: false });
    setBusy(false);
    if (!res.ok) return setFehler(res.error);
    setOffenListe((l) => l.filter((f) => !(f.datum === datum && f.quelle === quelle)));
    setPhase({ art: "gespeichert", id: res.id, quelle, datum, betrag: b, automatisch: false });
  }

  async function verwerfen() {
    if (phase.art === "pruefen") await zbonUploadVerwerfen(phase.dateien.map((d) => d.pfad)).catch(() => {});
    zuruecksetzen();
  }

  async function korrigieren() {
    if (phase.art !== "gespeichert" || !quelle) return;
    const b = parseBetrag(betrag);
    if (b !== null && !Number.isFinite(b)) return setFehler("Betrag ist keine Zahl");
    setBusy(true);
    const res = await zbonAendern(phase.id, { quelle, datum, betrag: b });
    setBusy(false);
    if (!res.ok) return setFehler(res.error);
    setPhase({ ...phase, quelle, datum, betrag: b, automatisch: false });
  }

  const [korrekturOffen, setKorrekturOffen] = useState(false);

  const felder = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(NAME) as ZBonQuelle[]).map((q) => (
          <button
            key={q}
            onClick={() => setQuelle(q)}
            className={`rounded-xl border px-3 py-3 text-sm font-semibold ${quelle === q ? AKTIV[q] : "bg-white text-neutral-700 border-neutral-300"}`}
          >
            {NAME[q]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={datum}
          max={heute}
          onChange={(e) => setDatum(e.target.value)}
          className="rounded-xl border border-neutral-300 px-3 py-3 text-base"
        />
        <input
          inputMode="decimal"
          placeholder="Umsatz €"
          value={betrag}
          onChange={(e) => setBetrag(e.target.value)}
          className="rounded-xl border border-neutral-300 px-3 py-3 text-base text-right tabular-nums"
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-neutral-50 px-4 pb-10 pt-4 max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/finances/z-bons" className="flex items-center gap-1 text-sm text-neutral-500">
          <ChevronLeft size={16} /> Übersicht
        </Link>
        <span className="text-sm font-semibold text-neutral-900">Z-Bon scannen</span>
        <span className="w-16" />
      </div>

      <input
        ref={kameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          neu(e.target.files);
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
          neu(e.target.files);
          e.target.value = "";
        }}
      />

      {fehler && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}

      {phase.art === "start" && (
        <>
          <button
            onClick={() => kameraRef.current?.click()}
            className="w-full aspect-[4/3] rounded-3xl bg-emerald-600 text-white flex flex-col items-center justify-center gap-3 shadow-sm active:scale-[0.99]"
          >
            <Camera size={56} strokeWidth={1.75} />
            <span className="text-lg font-semibold">Bon fotografieren</span>
            <span className="text-xs text-emerald-100">Kasse, Datum und Umsatz werden automatisch erkannt</span>
          </button>
          <button
            onClick={() => dateiRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-neutral-300 bg-white py-3 text-sm font-medium text-neutral-700"
          >
            <Paperclip size={16} /> PDF oder Bild auswählen
          </button>
          {offenListe.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold mb-1">Noch offen</div>
              <ul className="space-y-0.5">
                {offenListe.map((f) => (
                  <li key={`${f.datum}|${f.quelle}`}>
                    {deDatum(f.datum)} — {NAME[f.quelle]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {phase.art === "seiten" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {seiten.map((s, i) => (
              <div key={s.id} className="relative aspect-[3/4] rounded-xl overflow-hidden border border-neutral-200 bg-white">
                {s.vorschau ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.vorschau} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-neutral-600">
                    <FileText size={28} className="text-neutral-400" />
                    <span className="line-clamp-3 break-all">{s.file.name}</span>
                  </div>
                )}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white">{i + 1}</span>
                <button
                  onClick={() => {
                    if (s.vorschau) URL.revokeObjectURL(s.vorschau);
                    const rest = seiten.filter((x) => x.id !== s.id);
                    setSeiten(rest);
                    if (!rest.length) setPhase({ art: "start" });
                  }}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                  aria-label="Entfernen"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              onClick={() => kameraRef.current?.click()}
              className="aspect-[3/4] rounded-xl border-2 border-dashed border-neutral-300 flex flex-col items-center justify-center gap-1 text-xs text-neutral-500"
            >
              <Plus size={22} />
              Weiteres Foto
            </button>
          </div>
          <p className="text-xs text-neutral-500 text-center">Langer Bon? Weitere Fotos von oben nach unten aufnehmen.</p>
          <button onClick={verarbeiten} className="w-full rounded-2xl bg-neutral-900 py-4 text-base font-semibold text-white">
            Fertig — hochladen
          </button>
          <button onClick={zuruecksetzen} className="w-full py-2 text-sm text-neutral-500">
            Abbrechen
          </button>
        </>
      )}

      {phase.art === "arbeitet" && (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-neutral-600">
          <Loader2 size={36} className="animate-spin" />
          <span>{phase.text}</span>
        </div>
      )}

      {phase.art === "pruefen" && (
        <div className="rounded-2xl bg-white border border-neutral-200 p-4 space-y-3 shadow-sm">
          <div className="font-semibold text-neutral-900">Bitte kurz prüfen</div>
          <p className="text-sm text-neutral-600">
            {phase.warnung ??
              (!phase.erkannt.ist_z_bon
                ? "Das sieht nicht eindeutig nach einem Tagesabschluss aus."
                : "Nicht alles war sicher lesbar — bitte ergänzen.")}
            {phase.erkannt.hinweis && <span className="block text-xs text-neutral-500 mt-1">{phase.erkannt.hinweis}</span>}
          </p>
          {felder}
          <button
            onClick={bestaetigen}
            disabled={!quelle || busy}
            className="w-full rounded-2xl bg-neutral-900 py-3.5 text-base font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Speichern …" : quelle ? "Speichern" : "Kasse wählen"}
          </button>
          <button onClick={verwerfen} className="w-full py-2 text-sm text-neutral-500">
            Verwerfen
          </button>
        </div>
      )}

      {phase.art === "gespeichert" && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 text-center space-y-1">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check size={28} />
            </div>
            <div className="text-lg font-semibold text-emerald-900">Gespeichert</div>
            <div className="text-emerald-900">
              {NAME[phase.quelle]} · {deDatum(phase.datum)}
            </div>
            {phase.betrag != null && <div className="text-emerald-800 tabular-nums">{eur(phase.betrag)}</div>}
            {phase.automatisch && <div className="text-xs text-emerald-700">automatisch erkannt</div>}
          </div>
          {korrekturOffen ? (
            <div className="rounded-2xl bg-white border border-neutral-200 p-4 space-y-3">
              {felder}
              <button
                onClick={async () => {
                  await korrigieren();
                  setKorrekturOffen(false);
                }}
                disabled={!quelle || busy}
                className="w-full rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? "…" : "Korrektur speichern"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setQuelle(phase.quelle);
                setDatum(phase.datum);
                setBetrag(phase.betrag != null ? phase.betrag.toLocaleString("de-DE", { minimumFractionDigits: 2 }) : "");
                setKorrekturOffen(true);
              }}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border border-neutral-300 bg-white py-3 text-sm font-medium text-neutral-700"
            >
              <RotateCcw size={15} /> Stimmt was nicht? Korrigieren
            </button>
          )}
          <button
            onClick={() => {
              setKorrekturOffen(false);
              zuruecksetzen();
            }}
            className="w-full rounded-2xl bg-emerald-600 py-4 text-base font-semibold text-white"
          >
            Nächsten Bon scannen
          </button>
        </div>
      )}
    </div>
  );
}

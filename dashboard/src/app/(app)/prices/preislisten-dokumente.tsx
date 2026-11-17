"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, ImageIcon, Loader2, Plus, Trash2, Upload, ExternalLink } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { LieferantenPreisliste } from "@/lib/types";
import { preislisteHochladen, preislisteLoeschen } from "@/lib/actions/preislisten-dokumente";

// Feste Reihenfolge der bekannten Lieferanten; weitere kommen aus den Dokumenten oder per "+".
const LIEFERANTEN = ["Amanda", "Ebru", "Aria", "YHW", "Sunny", "Reichert"];
const ERLAUBT = "application/pdf,image/png,image/jpeg,image/webp";
const MAX_BYTES = 9 * 1024 * 1024;

const TXT = {
  de: {
    titel: "Preislisten der Lieferanten",
    sub: "Original-Preislisten als PDF oder Bild — eine Ablage für alle Lieferanten. Nur für Admins sichtbar.",
    hochladen: "Preisliste hochladen",
    ziehen: "PDF, PNG oder JPG hierher ziehen oder klicken (max. 9 MB)",
    bezeichnung: "Bezeichnung (optional)",
    gueltig: "Gültig ab",
    aktuell: "Aktuell",
    leer: "Noch keine Preisliste hinterlegt.",
    oeffnen: "Öffnen",
    loeschen: "Löschen",
    frage: "Diese Preisliste wirklich löschen? Die Datei wird endgültig entfernt.",
    neu: "Lieferant",
    neuFrage: "Name des Lieferanten:",
    hoch: "hochgeladen",
    laedt: "Lädt hoch …",
  },
  en: {
    titel: "Supplier price lists",
    sub: "Original price lists as PDF or image — one place for all suppliers. Admins only.",
    hochladen: "Upload price list",
    ziehen: "Drop PDF, PNG or JPG here or click (max. 9 MB)",
    bezeichnung: "Label (optional)",
    gueltig: "Valid from",
    aktuell: "Current",
    leer: "No price list yet.",
    oeffnen: "Open",
    loeschen: "Delete",
    frage: "Really delete this price list? The file will be removed permanently.",
    neu: "Supplier",
    neuFrage: "Supplier name:",
    hoch: "uploaded",
    laedt: "Uploading …",
  },
  tr: {
    titel: "Tedarikçi fiyat listeleri",
    sub: "Orijinal fiyat listeleri PDF veya resim olarak — tüm tedarikçiler için tek yer. Sadece yöneticiler.",
    hochladen: "Fiyat listesi yükle",
    ziehen: "PDF, PNG veya JPG'yi buraya sürükleyin ya da tıklayın (maks. 9 MB)",
    bezeichnung: "Açıklama (isteğe bağlı)",
    gueltig: "Geçerlilik",
    aktuell: "Güncel",
    leer: "Henüz fiyat listesi yok.",
    oeffnen: "Aç",
    loeschen: "Sil",
    frage: "Bu fiyat listesi gerçekten silinsin mi? Dosya kalıcı olarak kaldırılır.",
    neu: "Tedarikçi",
    neuFrage: "Tedarikçi adı:",
    hoch: "yüklendi",
    laedt: "Yükleniyor …",
  },
} as const;

const datum = (iso: string, locale: Locale) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
const groesse = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function PreislistenDokumente({ dokumente, locale }: { dokumente: LieferantenPreisliste[]; locale: Locale }) {
  const t = TXT[locale] ?? TXT.de;
  const router = useRouter();
  const [extra, setExtra] = useState<string[]>([]);
  const lieferanten = useMemo(() => {
    const alle = [...LIEFERANTEN];
    for (const n of [...dokumente.map((d) => d.lieferant), ...extra]) if (!alle.some((a) => a.toLowerCase() === n.toLowerCase())) alle.push(n);
    return alle;
  }, [dokumente, extra]);
  const [aktiv, setAktiv] = useState(lieferanten[0]);
  const [titel, setTitel] = useState("");
  const [gueltig, setGueltig] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [ziehen, setZiehen] = useState(false);
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const anzahl = (n: string) => dokumente.filter((d) => d.lieferant.toLowerCase() === n.toLowerCase()).length;
  // Neueste zuerst: nach "gültig ab", sonst nach Upload-Datum
  const liste = dokumente
    .filter((d) => d.lieferant.toLowerCase() === aktiv.toLowerCase())
    .sort((a, b) => (b.gueltig_ab ?? b.created_at).localeCompare(a.gueltig_ab ?? a.created_at));

  async function hochladen(dateien: FileList | File[]) {
    setFehler(null);
    const liste = Array.from(dateien);
    if (!liste.length) return;
    setLaedt(true);
    for (const datei of liste) {
      if (!ERLAUBT.split(",").includes(datei.type)) { setFehler(`${datei.name}: nur PDF, PNG, JPG oder WebP`); continue; }
      if (datei.size > MAX_BYTES) { setFehler(`${datei.name}: zu groß (max. 9 MB)`); continue; }
      const fd = new FormData();
      fd.set("datei", datei);
      fd.set("lieferant", aktiv);
      fd.set("titel", titel);
      fd.set("gueltig_ab", gueltig);
      const r = await preislisteHochladen(fd);
      if (!r.ok) setFehler(`${datei.name}: ${r.error}`);
    }
    setLaedt(false);
    setTitel("");
    setGueltig("");
    if (input.current) input.current.value = "";
    startTransition(() => router.refresh());
  }

  function loeschen(id: string) {
    if (!window.confirm(t.frage)) return;
    startTransition(async () => {
      const r = await preislisteLoeschen(id);
      if (!r.ok) setFehler(r.error);
      router.refresh();
    });
  }

  function lieferantDazu() {
    const name = window.prompt(t.neuFrage)?.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) return;
    const vorhanden = lieferanten.find((l) => l.toLowerCase() === name.toLowerCase());
    if (!vorhanden) setExtra((e) => [...e, name]);
    setAktiv(vorhanden ?? name);
  }

  return (
    <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-neutral-900">{t.titel}</h2>
        <p className="text-xs text-neutral-500 mt-0.5">{t.sub}</p>
      </div>

      {/* Lieferanten */}
      <div className="flex flex-wrap gap-2 mb-4">
        {lieferanten.map((n) => {
          const an = n === aktiv;
          const z = anzahl(n);
          return (
            <button
              key={n}
              type="button"
              onClick={() => { setAktiv(n); setFehler(null); }}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                an ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {n}
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${an ? "bg-white/20" : z ? "bg-white text-neutral-600" : "text-neutral-400"}`}>{z}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={lieferantDazu}
          className="flex items-center gap-1 rounded-full border border-dashed border-neutral-300 px-3 py-1.5 text-sm text-neutral-500 hover:border-neutral-400 hover:text-neutral-700"
        >
          <Plus size={14} /> {t.neu}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Hochladen */}
        <div className="space-y-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setZiehen(true); }}
            onDragLeave={() => setZiehen(false)}
            onDrop={(e) => { e.preventDefault(); setZiehen(false); if (!laedt) hochladen(e.dataTransfer.files); }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center cursor-pointer transition ${
              ziehen ? "border-neutral-900 bg-neutral-50" : "border-neutral-300 hover:border-neutral-400"
            }`}
          >
            {laedt ? <Loader2 size={22} className="animate-spin text-neutral-500" /> : <Upload size={22} className="text-neutral-500" />}
            <div className="text-sm font-medium text-neutral-800">{laedt ? t.laedt : `${t.hochladen} · ${aktiv}`}</div>
            <div className="text-xs text-neutral-500">{t.ziehen}</div>
            <input
              ref={input}
              type="file"
              accept={ERLAUBT}
              multiple
              className="hidden"
              disabled={laedt}
              onChange={(e) => e.target.files && hochladen(e.target.files)}
            />
          </div>
          <div className="grid gap-2">
            <label className="block">
              <span className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t.bezeichnung}</span>
              <input
                value={titel}
                onChange={(e) => setTitel(e.target.value)}
                maxLength={120}
                placeholder="z. B. Preisliste 2027"
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{t.gueltig}</span>
              <input
                type="date"
                value={gueltig}
                onChange={(e) => setGueltig(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 outline-none"
              />
            </label>
          </div>
          {fehler && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{fehler}</div>}
        </div>

        {/* Dokumente des Lieferanten */}
        <div>
          {liste.length === 0 ? (
            <div className="flex h-full min-h-[140px] items-center justify-center rounded-xl bg-neutral-50 text-sm text-neutral-400">{t.leer}</div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {liste.map((d, i) => {
                const bild = d.mime.startsWith("image/");
                return (
                  <li key={d.id} className={`group relative flex flex-col overflow-hidden rounded-xl border ${i === 0 ? "border-emerald-300" : "border-neutral-200"}`}>
                    <a href={d.url ?? undefined} target="_blank" rel="noopener noreferrer" className="block h-32 bg-neutral-50">
                      {bild && d.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.url} alt={d.titel || d.dateiname} className="h-full w-full object-cover object-top" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-red-500">
                          {bild ? <ImageIcon size={36} /> : <FileText size={36} />}
                        </div>
                      )}
                    </a>
                    {i === 0 && (
                      <span className="absolute left-2 top-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">{t.aktuell}</span>
                    )}
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <div className="truncate text-sm font-medium text-neutral-900" title={d.dateiname}>{d.titel || d.dateiname}</div>
                      <div className="text-xs text-neutral-500">
                        {d.gueltig_ab ? `${t.gueltig} ${datum(d.gueltig_ab, locale)}` : `${t.hoch} ${datum(d.created_at, locale)}`} · {groesse(d.groesse)}
                      </div>
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <a
                          href={d.url ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-medium text-neutral-700 hover:text-neutral-900"
                        >
                          <ExternalLink size={13} /> {t.oeffnen}
                        </a>
                        <button
                          type="button"
                          onClick={() => loeschen(d.id)}
                          className="flex items-center gap-1 text-xs text-neutral-400 hover:text-red-600"
                          aria-label={t.loeschen}
                        >
                          <Trash2 size={13} /> {t.loeschen}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

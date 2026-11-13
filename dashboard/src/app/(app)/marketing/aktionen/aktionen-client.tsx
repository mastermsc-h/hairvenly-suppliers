"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { speichereInfluencer, speicherePosting, loescheInfluencer, loeschePosting } from "@/lib/actions/influencer";
import type { Influencer } from "@/lib/influencer";

const INPUT = "rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 w-full";
const LABEL = "text-xs font-medium text-neutral-600 uppercase tracking-wide";
const KNOPF = "bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm disabled:opacity-50";

function useAktion() {
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, start] = useTransition();
  const router = useRouter();
  const los = (f: () => Promise<{ ok?: boolean; error?: string }>, danach?: () => void) =>
    start(async () => {
      setFehler(null);
      const r = await f();
      if (r.error) setFehler(r.error);
      else {
        danach?.();
        router.refresh();
      }
    });
  return { fehler, laeuft, los };
}

export function InfluencerFormular({ vorlage, offen: startOffen = false, knopfText = "Influencer anlegen" }: { vorlage?: Partial<Influencer>; offen?: boolean; knopfText?: string }) {
  const [offen, setOffen] = useState(startOffen);
  const { fehler, laeuft, los } = useAktion();
  if (!offen) {
    return (
      <button type="button" onClick={() => setOffen(true)} className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
        {vorlage?.id ? <Pencil size={14} /> : <Plus size={14} />} {knopfText}
      </button>
    );
  }
  const formular = (
    <form
      action={(f) => los(() => speichereInfluencer(f), () => setOffen(false))}
      className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-left"
    >
      {vorlage?.id && <input type="hidden" name="id" value={vorlage.id} />}
      <label className="col-span-2 md:col-span-1"><span className={LABEL}>Name *</span><input name="name" required defaultValue={vorlage?.name ?? ""} className={INPUT} /></label>
      <label><span className={LABEL}>Handle</span><input name="handle" placeholder="@name" defaultValue={vorlage?.handle ?? ""} className={INPUT} /></label>
      <label><span className={LABEL}>Plattform</span>
        <select name="plattform" defaultValue={vorlage?.plattform ?? "instagram"} className={INPUT}>
          <option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="sonstiges">Sonstiges</option>
        </select>
      </label>
      <label><span className={LABEL}>Rabattcode</span><input name="rabattcode" defaultValue={vorlage?.rabattcode ?? ""} className={`${INPUT} uppercase`} /></label>
      <label><span className={LABEL}>Aktiv ab</span><input type="date" name="aktiv_von" defaultValue={vorlage?.aktiv_von ?? ""} className={INPUT} /></label>
      <label><span className={LABEL}>Aktiv bis</span><input type="date" name="aktiv_bis" defaultValue={vorlage?.aktiv_bis ?? ""} className={INPUT} /></label>
      <label><span className={LABEL}>Kosten (€)</span><input name="kosten_eur" inputMode="decimal" defaultValue={vorlage?.kosten_eur ?? ""} className={INPUT} /></label>
      <label><span className={LABEL}>Vergütung</span><input name="verguetung" placeholder="z. B. Produkte + 10 % Provision" defaultValue={vorlage?.verguetung ?? ""} className={INPUT} /></label>
      <label className="col-span-2 md:col-span-4"><span className={LABEL}>Notiz</span><input name="notiz" defaultValue={vorlage?.notiz ?? ""} className={INPUT} /></label>
      <div className="col-span-2 md:col-span-4 flex items-center gap-3">
        <button type="submit" disabled={laeuft} className={KNOPF}>{laeuft ? "Speichert…" : "Speichern"}</button>
        <button type="button" onClick={() => setOffen(false)} className="text-sm text-neutral-600 inline-flex items-center gap-1"><X size={14} /> Abbrechen</button>
        {fehler && <span className="text-sm text-rose-600">{fehler}</span>}
      </div>
    </form>
  );
  // Bearbeiten (aus der Tabelle heraus) als Fenster über der Seite, Neuanlage inline
  if (!vorlage?.id) return formular;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOffen(false)}>
      <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-semibold">{vorlage.name} bearbeiten</h3>
        {formular}
      </div>
    </div>
  );
}

export function PostingFormular({ influencer }: { influencer: Pick<Influencer, "id" | "name">[] }) {
  const { fehler, laeuft, los } = useAktion();
  const [schluessel, setSchluessel] = useState(0);
  if (!influencer.length) return <p className="text-sm text-neutral-500">Erst einen Influencer anlegen.</p>;
  return (
    <form key={schluessel} action={(f) => los(() => speicherePosting(f), () => setSchluessel((k) => k + 1))} className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
      <label className="col-span-2 md:col-span-1"><span className={LABEL}>Influencer</span>
        <select name="influencer_id" required className={INPUT}>{influencer.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
      </label>
      <label><span className={LABEL}>Datum</span><input type="date" name="datum" required defaultValue={new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date())} className={INPUT} /></label>
      <label><span className={LABEL}>Art</span>
        <select name="art" className={INPUT}><option value="reel">Reel</option><option value="story">Story</option><option value="post">Post</option><option value="video">Video</option><option value="live">Live</option><option value="sonstiges">Sonstiges</option></select>
      </label>
      <label><span className={LABEL}>Link</span><input name="link" type="url" placeholder="https://…" className={INPUT} /></label>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={laeuft} className={KNOPF}>{laeuft ? "…" : "Posting eintragen"}</button>
      </div>
      {fehler && <span className="col-span-full text-sm text-rose-600">{fehler}</span>}
    </form>
  );
}

export function LoeschKnopf({ art, id, frage }: { art: "influencer" | "posting"; id: string; frage: string }) {
  const { fehler, laeuft, los } = useAktion();
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={laeuft}
        title="Löschen"
        aria-label="Löschen"
        onClick={() => confirm(frage) && los(() => (art === "influencer" ? loescheInfluencer(id) : loeschePosting(id)))}
        className="text-neutral-400 hover:text-rose-600 p-1"
      >
        <Trash2 size={14} />
      </button>
      {fehler && <span className="text-xs text-rose-600">{fehler}</span>}
    </span>
  );
}

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function PostingChart({ tage, punkte }: { tage: { datum: string; umsatz: number }[]; punkte: { datum: string; name: string; art: string }[] }) {
  const proTag = new Map<string, string[]>();
  for (const p of punkte) proTag.set(p.datum, [...(proTag.get(p.datum) ?? []), `${p.name} (${p.art})`]);
  const daten = tage.map((t) => ({
    datum: t.datum,
    label: `${t.datum.slice(8, 10)}.${t.datum.slice(5, 7)}.`,
    umsatz: Math.round(t.umsatz),
    posting: proTag.has(t.datum) ? Math.round(t.umsatz) : null,
    wer: proTag.get(t.datum)?.join(", ") ?? null,
  }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={daten} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#737373" }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: "#737373" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof daten)[number];
              return (
                <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm">
                  <div className="font-medium">{d.label}</div>
                  <div>Umsatz {eur(d.umsatz)}</div>
                  {d.wer && <div className="text-rose-600 mt-1">Posting: {d.wer}</div>}
                </div>
              );
            }}
          />
          <Bar dataKey="umsatz" name="Umsatz" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
          <Scatter dataKey="posting" name="Posting" fill="#e11d48" shape="diamond" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

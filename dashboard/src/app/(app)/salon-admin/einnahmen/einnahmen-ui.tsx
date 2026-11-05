"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Smartphone } from "lucide-react";
import { einnahmeArtSpeichern, einnahmeStornoAdmin, einnahmenKopplungsLink } from "@/lib/actions/salon-einnahmen";
import { BEREICH_LABEL, type Bereich, type EinnahmeArt } from "@/lib/salon/einnahmen";

export function StornoKnopf({ id, storniert }: { id: string; storniert: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!storniert && !confirm("Eintrag stornieren? Er zählt dann nicht mehr mit.")) return;
        start(async () => {
          const r = await einnahmeStornoAdmin(id, !storniert);
          if (!r.ok) alert(r.error);
          router.refresh();
        });
      }}
      className="text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-50"
    >
      {pending ? "…" : storniert ? "Wiederherstellen" : "Stornieren"}
    </button>
  );
}

/** Einnahme-Arten, die am iPad als Knöpfe erscheinen. Umbenennen ändert alte Einträge nicht. */
export function ArtenVerwaltung({ arten }: { arten: EinnahmeArt[] }) {
  const [neu, setNeu] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">Arten am iPad</h2>
        {!neu && (
          <button onClick={() => setNeu(true)} className="flex items-center gap-1 text-sm text-neutral-700 hover:text-neutral-900">
            <Plus size={14} /> Neue Art
          </button>
        )}
      </div>
      <div className="space-y-2">
        {neu && <ArtZeile art={null} onFertig={() => setNeu(false)} />}
        {arten.map((a) => (
          <ArtZeile key={a.id} art={a} />
        ))}
      </div>
      <p className="mt-3 text-xs text-neutral-500">
        Reihenfolge = kleinere Zahl zuerst. Deaktivierte Arten verschwinden am iPad, alte Einträge bleiben unverändert.
      </p>
    </div>
  );
}

function ArtZeile({ art, onFertig }: { art: EinnahmeArt | null; onFertig?: () => void }) {
  const [name, setName] = useState(art?.name ?? "");
  const [bereich, setBereich] = useState<Bereich>(art?.bereich ?? "salon");
  const [sortierung, setSortierung] = useState(String(art?.sortierung ?? 200));
  const [aktiv, setAktiv] = useState(art?.aktiv ?? true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const geaendert = !art || name !== art.name || bereich !== art.bereich || sortierung !== String(art.sortierung) || aktiv !== art.aktiv;

  function speichern() {
    setFehler(null);
    start(async () => {
      const r = await einnahmeArtSpeichern({ id: art?.id, name, bereich, sortierung: Number(sortierung), aktiv });
      if (!r.ok) return setFehler(r.error);
      router.refresh();
      onFertig?.();
    });
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${aktiv ? "" : "opacity-60"}`}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        maxLength={60}
        className="flex-1 min-w-48 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
      />
      <select value={bereich} onChange={(e) => setBereich(e.target.value as Bereich)} className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm">
        {(["verkauf", "salon"] as Bereich[]).map((b) => (
          <option key={b} value={b}>{BEREICH_LABEL[b]}</option>
        ))}
      </select>
      <input
        value={sortierung}
        onChange={(e) => setSortierung(e.target.value.replace(/\D/g, ""))}
        inputMode="numeric"
        title="Reihenfolge"
        className="w-16 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
      />
      <label className="flex items-center gap-1 text-sm text-neutral-600">
        <input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} /> aktiv
      </label>
      {geaendert && (
        <button onClick={speichern} disabled={pending || !name.trim()} className="flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          <Save size={14} /> {pending ? "…" : "Speichern"}
        </button>
      )}
      {!art && (
        <button onClick={onFertig} className="text-sm text-neutral-500">Abbrechen</button>
      )}
      {fehler && <span className="text-xs text-rose-600">{fehler}</span>}
    </div>
  );
}

/** QR-Code zum Freischalten eines Mitarbeiter-Handys (15 Min. gültig). */
export function HandyFreischalten() {
  const [url, setUrl] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-neutral-600">
          <b className="text-neutral-900">Erfassung am iPad/iPhone:</b> Salon-iPad → Kachel „Einnahme erfassen“. Für ein Handy einmal freischalten:
        </div>
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setFehler(null);
              const r = await einnahmenKopplungsLink();
              if (!r.ok) return setFehler(r.error);
              setUrl(window.location.origin + r.path);
            })
          }
          className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <Smartphone size={16} /> {pending ? "…" : "Handy freischalten"}
        </button>
      </div>
      {fehler && <div className="mt-2 text-sm text-rose-600">{fehler}</div>}
      {url && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/qr?size=220&text=${encodeURIComponent(url)}`} alt="QR-Code zum Freischalten" width={220} height={220} className="rounded-lg border border-neutral-200" />
          <div className="text-sm text-neutral-600 max-w-md space-y-1">
            <div>Mit der Kamera des Handys scannen — es öffnet sich die Einnahmen-Erfassung, danach mit der eigenen PIN anmelden.</div>
            <div className="text-xs text-neutral-500">Gilt 15 Minuten und kann in der Zeit für mehrere Handys benutzt werden. Danach in Safari „Zum Home-Bildschirm“.</div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Save, Smartphone, X } from "lucide-react";
import { einnahmeAdminSpeichern, einnahmeArtSpeichern, einnahmeStornoAdmin, einnahmenKopplungsLink, einnahmenZugangSetzen } from "@/lib/actions/salon-einnahmen";
import { BEREICH_LABEL, berlinLokal, type Bereich, type EinnahmeArt } from "@/lib/salon/einnahmen";

export interface MitarbeiterOption {
  id: string;
  name: string;
  active: boolean;
}

/** Bestehender Eintrag zum Bearbeiten (zeitpunkt = Bremer Ortszeit "YYYY-MM-DDTHH:mm"). */
export interface EintragEdit {
  id: string;
  employeeId: string;
  artId: string | null;
  artName: string;
  bereich: Bereich;
  betrag: number;
  zeitpunkt: string;
  notiz: string | null;
}

type DialogProps = { mitarbeiter: MitarbeiterOption[]; arten: EinnahmeArt[] };

/** Knopf „Einnahme nachtragen" (Admin am Rechner, ohne PIN). */
export function NeueEinnahmeKnopf(props: DialogProps) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button onClick={() => setOffen(true)} className="flex items-center gap-2 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm">
        <Plus size={16} /> Einnahme nachtragen
      </button>
      {offen && <EinnahmeDialog {...props} eintrag={null} onClose={() => setOffen(false)} />}
    </>
  );
}

export function BearbeitenKnopf(props: DialogProps & { eintrag: EintragEdit }) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button onClick={() => setOffen(true)} className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 mr-3">
        <Pencil size={12} /> Bearbeiten
      </button>
      {offen && <EinnahmeDialog {...props} onClose={() => setOffen(false)} />}
    </>
  );
}

function EinnahmeDialog({ mitarbeiter, arten, eintrag, onClose }: DialogProps & { eintrag: EintragEdit | null; onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState(eintrag?.employeeId ?? "");
  const [artId, setArtId] = useState(eintrag?.artId ?? "");
  const [betrag, setBetrag] = useState(eintrag ? eintrag.betrag.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
  const [zeitpunkt, setZeitpunkt] = useState(eintrag?.zeitpunkt ?? berlinLokal(new Date()));
  const [notiz, setNotiz] = useState(eintrag?.notiz ?? "");
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // Inaktive nur zeigen, wenn der Eintrag sie schon verwendet
  const maOptionen = mitarbeiter.filter((m) => m.active || m.id === eintrag?.employeeId);
  const artOptionen = arten.filter((a) => a.aktiv || a.id === eintrag?.artId);
  // Art des Eintrags existiert nicht mehr in der Liste → Schnappschuss als eigene Option behalten
  const artFehlt = eintrag && !artOptionen.some((a) => a.id === eintrag.artId);

  function speichern() {
    setFehler(null);
    start(async () => {
      const r = await einnahmeAdminSpeichern({ id: eintrag?.id, employeeId, artId, betrag, zeitpunkt, notiz });
      if (!r.ok) return setFehler(r.error);
      router.refresh();
      onClose();
    });
  }

  const feld = "mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm normal-case font-normal tracking-normal";
  const label = "block text-xs font-medium text-neutral-600 uppercase tracking-wide";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-5 space-y-4 text-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{eintrag ? "Eintrag bearbeiten" : "Einnahme nachtragen"}</h3>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-900" aria-label="Schließen"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className={label}>
            Wer hat sie gemacht?
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={feld}>
              <option value="">— auswählen —</option>
              {maOptionen.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.active ? "" : " (inaktiv)"}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Art
            <select value={artId} onChange={(e) => setArtId(e.target.value)} className={feld}>
              <option value="">— auswählen —</option>
              {artFehlt && <option value={eintrag.artId ?? ""}>{eintrag.artName} ({BEREICH_LABEL[eintrag.bereich]}, bisher)</option>}
              {(["verkauf", "salon"] as Bereich[]).map((b) => (
                <optgroup key={b} label={BEREICH_LABEL[b]}>
                  {artOptionen.filter((a) => a.bereich === b).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.aktiv ? "" : " (deaktiviert)"}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className={label}>
            Betrag (€)
            <input value={betrag} onChange={(e) => setBetrag(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0,00" className={`${feld} tabular-nums`} />
          </label>
          <label className={label}>
            Datum & Uhrzeit
            <input type="datetime-local" value={zeitpunkt} onChange={(e) => setZeitpunkt(e.target.value)} className={feld} />
          </label>
        </div>
        <label className={label}>
          Notiz
          <textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} maxLength={500} rows={2} placeholder="z.B. 100g Bondings 1B" className={feld} />
        </label>
        {fehler && <div className="text-sm text-rose-600">{fehler}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">Abbrechen</button>
          <button onClick={speichern} disabled={pending || !employeeId || artId === ""} className="flex items-center gap-2 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm disabled:opacity-50">
            <Save size={14} /> {pending ? "Speichere …" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

/** Wer sich in der Einnahmen-App mit seiner PIN anmelden darf. */
export function ZugangVerwaltung({ mitarbeiter }: { mitarbeiter: { id: string; name: string; erlaubt: boolean }[] }) {
  const [pending, start] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const router = useRouter();
  const erlaubt = mitarbeiter.filter((m) => m.erlaubt);
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600 mb-1">Zugang zur Einnahmen-App</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Nur angehakte Mitarbeiter können sich mit ihrer PIN anmelden ({erlaubt.length ? erlaubt.map((m) => m.name).join(", ") : "niemand"}).
        „Ware entnehmen“ am Salon-iPad gilt weiter für alle.
      </p>
      <div className="flex flex-wrap gap-2">
        {mitarbeiter.map((m) => (
          <label
            key={m.id}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm cursor-pointer ${m.erlaubt ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600"} ${pending ? "opacity-60" : ""}`}
          >
            <input
              type="checkbox"
              checked={m.erlaubt}
              disabled={pending}
              onChange={(e) =>
                start(async () => {
                  setFehler(null);
                  const r = await einnahmenZugangSetzen(m.id, e.target.checked);
                  if (!r.ok) setFehler(r.error);
                  router.refresh();
                })
              }
            />
            {m.name}
          </label>
        ))}
      </div>
      {fehler && <div className="mt-2 text-sm text-rose-600">{fehler}</div>}
    </div>
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
  const [code, setCode] = useState<string | null>(null);
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
              setCode(r.code);
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
          <div className="text-sm text-neutral-600 max-w-md space-y-2">
            <div><b>Safari:</b> mit der Kamera scannen — es öffnet sich die Einnahmen-Erfassung, danach mit der eigenen PIN anmelden.</div>
            {code && (
              <div>
                <b>App auf dem Home-Bildschirm:</b> dort „Gerät nicht freigeschaltet“ → diesen Code eingeben:
                <div className="mt-1 font-mono text-2xl font-bold tracking-widest text-neutral-900">{code}</div>
              </div>
            )}
            <div className="text-xs text-neutral-500">QR und Code gelten 15 Minuten und können in der Zeit für mehrere Geräte benutzt werden.</div>
          </div>
        </div>
      )}
    </div>
  );
}

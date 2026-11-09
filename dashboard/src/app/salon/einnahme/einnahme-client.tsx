"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Delete, LogOut, Undo2 } from "lucide-react";
import {
  einnahmeErfassen,
  einnahmenAnmelden,
  einnahmeStornierenMitarbeiter,
  type EigeneEinnahme,
  type EinnahmenSitzung,
} from "@/lib/actions/salon-einnahmen";
import { BEREICH_LABEL, berlinLokal, berlinZeit, type Bereich } from "@/lib/salon/einnahmen";

const eur = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
/** Geteiltes iPad: nach so langer Untätigkeit zurück zur PIN */
const AUTO_ABMELDEN_MS = 2 * 60 * 1000;

export default function EinnahmeClient({ zurueck }: { zurueck: boolean }) {
  const [pin, setPin] = useState("");
  const [sitzung, setSitzung] = useState<EinnahmenSitzung | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function abmelden() {
    setSitzung(null);
    setPin("");
    setFehler(null);
  }

  function ziffer(d: string) {
    if (pending || pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setFehler(null);
    if (next.length === 6) {
      start(async () => {
        const r = await einnahmenAnmelden(next);
        if (!r.ok) {
          setFehler(r.error);
          setPin("");
          return;
        }
        setSitzung(r.sitzung);
      });
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="px-4 py-3 flex items-center gap-3 border-b border-neutral-900">
        {zurueck && (
          <Link href="/salon" className="p-2 -ml-2 hover:bg-neutral-900 rounded-lg" onClick={abmelden}>
            <ArrowLeft size={24} />
          </Link>
        )}
        <div className="text-lg font-semibold flex-1">Einnahme erfassen</div>
        {sitzung && (
          <button onClick={abmelden} className="flex items-center gap-2 rounded-lg bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700">
            <LogOut size={16} /> Fertig
          </button>
        )}
      </header>

      {!sitzung ? (
        <div className="flex-1 flex flex-col p-6 gap-6 max-w-md w-full mx-auto justify-center">
          <div className="text-center">
            <div className="text-2xl font-bold">Deine PIN</div>
            <div className="text-neutral-400 mt-1">6 Ziffern</div>
            <div className="mt-5 flex gap-3 justify-center">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`w-5 h-5 rounded-full border-2 ${i < pin.length ? "bg-white border-white" : "border-neutral-600"}`} />
              ))}
            </div>
            {fehler && <div className="mt-4 text-rose-400">{fehler}</div>}
            {pending && <div className="mt-4 text-neutral-400">Prüfe …</div>}
          </div>
          <Numpad onDigit={ziffer} onDel={() => setPin((p) => p.slice(0, -1))} disabled={pending} />
        </div>
      ) : (
        <Formular sitzung={sitzung} pin={pin} onHeute={(heute) => setSitzung({ ...sitzung, heute })} onAbmelden={abmelden} />
      )}
    </div>
  );
}

function Formular({
  sitzung,
  pin,
  onHeute,
  onAbmelden,
}: {
  sitzung: EinnahmenSitzung;
  pin: string;
  onHeute: (h: EigeneEinnahme[]) => void;
  onAbmelden: () => void;
}) {
  const [fuerId, setFuerId] = useState<string | null>(null);
  const [artId, setArtId] = useState<string | null>(null);
  const [betrag, setBetrag] = useState("");
  const [zeitpunkt, setZeitpunkt] = useState(() => berlinLokal(new Date()));
  const [zeitGeaendert, setZeitGeaendert] = useState(false);
  const [notiz, setNotiz] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichert, setGespeichert] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Untätigkeit → abmelden; jede Eingabe setzt die Uhr zurück
  function aktiv() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onAbmelden, AUTO_ABMELDEN_MS);
  }
  useEffect(() => {
    aktiv();
    // Uhrzeit läuft mit, solange sie nicht von Hand geändert wurde
    const uhr = setInterval(() => !zeitGeaendert && setZeitpunkt(berlinLokal(new Date())), 30000);
    return () => {
      clearInterval(uhr);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeitGeaendert]);

  const art = sitzung.arten.find((a) => a.id === artId) ?? null;
  const fuer = sitzung.alle.find((m) => m.id === fuerId) ?? null;
  const gruppen: Bereich[] = ["verkauf", "salon"];
  const aktiveHeute = sitzung.heute.filter((h) => !h.storniert);
  const summeHeute = aktiveHeute.reduce((s, h) => s + h.betrag, 0);

  function speichern() {
    aktiv();
    setFehler(null);
    setGespeichert(null);
    if (!fuerId) return setFehler("Bitte auswählen, wer die Einnahme gemacht hat");
    if (!artId) return setFehler("Bitte eine Art auswählen");
    start(async () => {
      const r = await einnahmeErfassen({ pin, fuerId, artId, betrag, zeitpunkt, notiz });
      if (!r.ok) return setFehler(r.error);
      onHeute(r.heute);
      setGespeichert(`${betrag.trim()} € · ${art?.name ?? ""} · ${fuer?.name ?? ""}`);
      setFuerId(null);
      setArtId(null);
      setBetrag("");
      setNotiz("");
      setZeitGeaendert(false);
      setZeitpunkt(berlinLokal(new Date()));
    });
  }

  function stornieren(id: string) {
    aktiv();
    if (!confirm("Diesen Eintrag stornieren?")) return;
    start(async () => {
      const r = await einnahmeStornierenMitarbeiter({ pin, id });
      if (!r.ok) return setFehler(r.error);
      onHeute(r.heute);
    });
  }

  return (
    <div className="flex-1 overflow-y-auto" onPointerDown={aktiv} onKeyDown={aktiv}>
      <div className="max-w-2xl w-full mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-2xl font-bold">Hallo {sitzung.mitarbeiter.name}</div>
          <div className="text-sm text-neutral-400">Heute: {eur(summeHeute)}</div>
        </div>

        {gespeichert && (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-700/30 border border-emerald-600 px-4 py-3">
            <Check size={20} className="text-emerald-400" /> Gespeichert: {gespeichert}
          </div>
        )}

        <div>
          <div className="text-xs uppercase tracking-widest text-neutral-500 mb-2">Wer hat die Einnahme gemacht?</div>
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
            {sitzung.alle.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  aktiv();
                  setFuerId(m.id);
                }}
                className={`rounded-xl px-2 py-3 font-semibold transition active:scale-95 ${
                  fuerId === m.id ? "bg-amber-500 text-neutral-950 ring-2 ring-white" : "bg-neutral-800 hover:bg-neutral-700"
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>

        {gruppen.map((g) => {
          const arten = sitzung.arten.filter((a) => a.bereich === g);
          if (arten.length === 0) return null;
          return (
            <div key={g}>
              <div className="text-xs uppercase tracking-widest text-neutral-500 mb-2">{BEREICH_LABEL[g]}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {arten.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      aktiv();
                      setArtId(a.id);
                    }}
                    className={`rounded-xl px-3 py-4 text-left font-semibold transition active:scale-95 ${
                      artId === a.id
                        ? g === "verkauf" ? "bg-sky-600 ring-2 ring-white" : "bg-rose-600 ring-2 ring-white"
                        : "bg-neutral-800 hover:bg-neutral-700"
                    }`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-neutral-500">Betrag (€)</span>
            <input
              value={betrag}
              onChange={(e) => setBetrag(e.target.value.replace(/[^\d.,]/g, ""))}
              inputMode="decimal"
              placeholder="0,00"
              className="mt-1 w-full rounded-xl border-2 border-neutral-700 px-4 py-4 text-3xl font-bold tabular-nums focus:outline-none focus:border-amber-400"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-neutral-500">Datum & Uhrzeit</span>
            <input
              type="datetime-local"
              value={zeitpunkt}
              onChange={(e) => {
                setZeitpunkt(e.target.value);
                setZeitGeaendert(true);
              }}
              className="mt-1 w-full rounded-xl border-2 border-neutral-700 px-4 py-4 text-lg focus:outline-none focus:border-amber-400"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-widest text-neutral-500">Notiz</span>
          <textarea
            value={notiz}
            onChange={(e) => setNotiz(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="z.B. 100g Bondings 1B"
            className="mt-1 w-full rounded-xl border-2 border-neutral-700 px-4 py-3 text-base focus:outline-none focus:border-amber-400"
          />
        </label>

        {fehler && <div className="text-rose-400">{fehler}</div>}

        <button
          onClick={speichern}
          disabled={pending}
          className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 py-5 text-2xl font-bold disabled:opacity-50"
        >
          {pending ? "Speichere …" : "Speichern"}
        </button>

        <div>
          <div className="text-xs uppercase tracking-widest text-neutral-500 mb-2">Von dir heute erfasst</div>
          {sitzung.heute.length === 0 ? (
            <div className="text-neutral-500 text-sm">Noch nichts erfasst.</div>
          ) : (
            <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
              {sitzung.heute.map((h) => (
                <div key={h.id} className={`flex items-center gap-3 px-4 py-3 ${h.storniert ? "opacity-50" : ""}`}>
                  <div className="text-sm text-neutral-400 tabular-nums w-12">{berlinZeit(h.zeitpunkt)}</div>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${h.storniert ? "line-through" : ""}`}>
                      {h.fuerName} <span className="text-neutral-400 font-normal">· {h.artName}</span>
                    </div>
                    {h.notiz && <div className="text-xs text-neutral-400 truncate">{h.notiz}</div>}
                  </div>
                  <div className={`tabular-nums font-semibold ${h.storniert ? "line-through" : ""}`}>{eur(h.betrag)}</div>
                  {h.storniert ? (
                    <span className="text-xs text-neutral-500 w-24 text-right">storniert</span>
                  ) : h.stornierbar ? (
                    <button onClick={() => stornieren(h.id)} disabled={pending} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-rose-400 w-24 justify-end">
                      <Undo2 size={14} /> Stornieren
                    </button>
                  ) : (
                    <span className="w-24" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Numpad({ onDigit, onDel, disabled }: { onDigit: (d: string) => void; onDel: () => void; disabled: boolean }) {
  const tasten = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const cls = "rounded-2xl bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-600 py-6 text-3xl font-semibold disabled:opacity-50";
  return (
    <div className="grid grid-cols-3 gap-3">
      {tasten.map((t) => (
        <button key={t} onClick={() => onDigit(t)} disabled={disabled} className={cls}>
          {t}
        </button>
      ))}
      <div />
      <button onClick={() => onDigit("0")} disabled={disabled} className={cls}>
        0
      </button>
      <button onClick={onDel} disabled={disabled} className={`${cls} flex items-center justify-center`} aria-label="Löschen">
        <Delete size={28} />
      </button>
    </div>
  );
}

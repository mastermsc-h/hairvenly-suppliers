"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Save, AlertTriangle, CheckCircle2 } from "lucide-react";
import { updateReservationStructured } from "@/lib/actions/chat-reservations";

type Line = "russisch" | "usbekisch";
type LengthCm = 45 | 55 | 60 | 65 | 85;
type MethodKind =
  | "tape" | "mini_tape"
  | "genius_weft" | "classic_weft" | "invisible_weft"
  | "bonding" | "clip" | "ponytail";

interface Props {
  reservationId: string;
  initial: {
    line: Line | null;
    lengthCm: LengthCm | null;
    methodKind: MethodKind | null;
    color: string | null;
  };
  onClose: () => void;
}

const METHOD_LABELS: Record<MethodKind, string> = {
  tape:            "Tapes Standard",
  mini_tape:       "Mini Tapes",
  genius_weft:     "Genius Weft / Tressen",
  classic_weft:    "Classic Weft / Tressen",
  invisible_weft:  "Invisible (Butterfly) Weft",
  bonding:         "Bondings",
  clip:            "Clip-In Extensions",
  ponytail:        "Ponytail",
};

const LENGTH_OPTIONS_BY_LINE: Record<Line, LengthCm[]> = {
  russisch:  [60],
  usbekisch: [45, 55, 65, 85],
};

export default function StructuredFormModal({ reservationId, initial, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [line, setLine] = useState<Line | null>(initial.line);
  const [lengthCm, setLengthCm] = useState<LengthCm | null>(initial.lengthCm);
  const [methodKind, setMethodKind] = useState<MethodKind | null>(initial.methodKind);
  const [color, setColor] = useState<string>(initial.color || "");

  // Bei Linien-Wechsel: Länge zurücksetzen falls inkompatibel
  const availableLengths = line ? LENGTH_OPTIONS_BY_LINE[line] : [60, 45, 55, 65, 85] as LengthCm[];
  function onLineChange(next: Line) {
    setLine(next);
    if (lengthCm && !LENGTH_OPTIONS_BY_LINE[next].includes(lengthCm)) {
      setLengthCm(next === "russisch" ? 60 : null);
    } else if (next === "russisch" && !lengthCm) {
      setLengthCm(60);
    }
  }

  const complete = !!(line && lengthCm && methodKind);

  function handleSave() {
    startTransition(async () => {
      try {
        await updateReservationStructured(reservationId, {
          line,
          lengthCm,
          methodKind,
          color: color.trim() || undefined,
        });
        onClose();
        router.refresh();
      } catch (e) {
        alert(`Speichern fehlgeschlagen: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {complete
              ? <CheckCircle2 size={18} className="text-green-600" />
              : <AlertTriangle size={18} className="text-amber-600" />
            }
            <h3 className="text-base font-semibold text-neutral-900">
              {complete ? "Angaben prüfen" : "Angaben vervollständigen"}
            </h3>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={18} /></button>
        </div>
        <p className="text-xs text-neutral-500">
          Diese Felder bestimmen direkt den Lager-Scan. Alle 3 Pflichtfelder ausfüllen,
          damit die Reservierung beim nächsten Scan korrekt geprüft wird.
        </p>

        {/* LINIE */}
        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Linie *</label>
          <div className="grid grid-cols-2 gap-2">
            {(["russisch","usbekisch"] as Line[]).map(l => (
              <button
                key={l}
                type="button"
                onClick={() => onLineChange(l)}
                className={`text-sm rounded-lg px-3 py-2 border ${
                  line === l ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {l === "russisch" ? "🇷🇺 Russisch (glatt)" : "🇺🇿 Usbekisch (wellig)"}
              </button>
            ))}
          </div>
        </div>

        {/* LÄNGE */}
        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
            Länge * {line === "russisch" && <span className="text-neutral-400 normal-case">(russisch = immer 60 cm)</span>}
          </label>
          <div className="flex gap-2 flex-wrap">
            {availableLengths.map(cm => (
              <button
                key={cm}
                type="button"
                onClick={() => setLengthCm(cm)}
                disabled={line === "russisch" && cm !== 60}
                className={`text-sm rounded-lg px-3 py-2 border ${
                  lengthCm === cm ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
                } disabled:opacity-30`}
              >
                {cm} cm
              </button>
            ))}
            {!line && <span className="text-xs text-neutral-400 self-center">Erst Linie wählen</span>}
          </div>
        </div>

        {/* METHODE */}
        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Methode *</label>
          <select
            value={methodKind || ""}
            onChange={(e) => setMethodKind((e.target.value || null) as MethodKind | null)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 bg-white"
          >
            <option value="">— wählen —</option>
            {(Object.keys(METHOD_LABELS) as MethodKind[]).map(k => (
              <option key={k} value={k}>{METHOD_LABELS[k]}</option>
            ))}
          </select>
        </div>

        {/* FARBE */}
        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
            Farbe / Farbcode <span className="text-neutral-400 normal-case">(optional, aber empfohlen — z.B. „4/27T24", „Ebony")</span>
          </label>
          <input
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="z.B. 4/27T24 oder Ebony"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
          />
        </div>

        {/* STATUS */}
        <div className={`text-xs rounded-lg px-3 py-2 ${
          complete ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
        }`}>
          {complete
            ? "✓ Alle Pflichtfelder gesetzt — beim Speichern wird der Lager-Matcher diese Felder nutzen."
            : "⚠ Linie, Länge und Methode sind Pflicht. Erst dann nutzt der Lager-Matcher den strukturierten Pfad."}
        </div>

        {/* ACTIONS */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={pending}
            className="text-sm px-4 py-2 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={pending}
            className="bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save size={14} /> {pending ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

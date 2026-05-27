"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, X, Plus, Trash2 } from "lucide-react";
import { createReservationManual } from "@/lib/actions/chat-reservations";

type Line = "russisch" | "usbekisch";
type LengthCm = 45 | 55 | 60 | 65 | 85;
type MethodKind =
  | "tape" | "mini_tape"
  | "genius_weft" | "classic_weft" | "invisible_weft"
  | "bonding" | "clip" | "ponytail";

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

const ALL_LENGTHS: LengthCm[] = [45, 55, 60, 65, 85];

interface ProductRow {
  id: number;
  line: Line | null;
  lengthCm: LengthCm | null;
  methodKind: MethodKind | null;
  color: string;
  etaHint: string;
}

function newRow(): ProductRow {
  return { id: Date.now() + Math.random(), line: null, lengthCm: null, methodKind: null, color: "", etaHint: "" };
}

/**
 * Generiert einen displayfreundlichen product_name aus den strukturierten Feldern.
 * Beispiel: "COLDNESS · Russisch · Tapes Standard · 65cm"
 */
function buildProductName(r: ProductRow): string {
  const parts: string[] = [];
  if (r.color.trim()) parts.push(r.color.trim().toUpperCase());
  if (r.line) parts.push(r.line === "russisch" ? "Russisch glatt" : "Usbekisch wellig");
  if (r.methodKind) parts.push(METHOD_LABELS[r.methodKind]);
  if (r.lengthCm) parts.push(`${r.lengthCm}cm`);
  return parts.join(" · ");
}

/**
 * Button + Slide-In-Panel rechts.
 * Strukturierte Felder (Linie / Länge / Methode / Farbe) statt Free-Text —
 * Lager-Matcher kann diese dann deterministisch auswerten (siehe
 * chat-reservations.ts structuredMatch).
 * Längen-Auswahl ist UNABHÄNGIG von der Linie — MA kann jede Kombi wählen,
 * Server-Validation greift im Lager-Scan (z.B. 60cm + Usbekisch wird im
 * Match-Algorithmus berücksichtigt).
 */
export default function AddToWaitlistButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [rows, setRows] = useState<ProductRow[]>([newRow()]);
  const [notes, setNotes] = useState("");
  const [, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const validRows = rows.filter(r => r.color.trim() || r.line || r.lengthCm || r.methodKind);
    if (validRows.length === 0) {
      alert("Bitte mindestens ein Feld pro Zeile ausfüllen (Farbe oder Linie/Länge/Methode).");
      return;
    }
    setBusy(true);
    startTransition(async () => {
      try {
        for (const r of validRows) {
          const fd = new FormData();
          fd.set("session_id", sessionId);
          fd.set("product_name", buildProductName(r) || r.color.trim() || "Reservierung");
          if (r.color.trim())   fd.set("color", r.color.trim());
          if (r.line)           fd.set("line", r.line);
          if (r.lengthCm)       fd.set("length_cm", String(r.lengthCm));
          if (r.methodKind)     fd.set("method_kind", r.methodKind);
          // Display-Methode + Linie für lesbare Notification-Texte
          if (r.methodKind) fd.set("method", METHOD_LABELS[r.methodKind]);
          if (r.etaHint.trim()) fd.set("eta_hint", r.etaHint.trim());
          if (notes.trim())     fd.set("notes",    notes.trim());
          await createReservationManual(fd);
        }
        setDone(true);
        router.refresh();
        setTimeout(() => {
          setOpen(false);
          setDone(false);
          setRows([newRow()]);
          setNotes("");
        }, 1100);
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(false);
      }
    });
  }

  function updateRow(id: number, patch: Partial<ProductRow>) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: number) {
    setRows(prev => (prev.length === 1 ? prev : prev.filter(r => r.id !== id)));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Kundin auf Warteliste setzen — wird bei Wareneingang per 1-Klick benachrichtigt"
        className={`h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition ${
          open
            ? "bg-purple-500 text-white shadow-sm"
            : "text-purple-700 hover:bg-purple-50"
        }`}
      >
        <Bell size={13} /> Warteliste
      </button>

      {open && (
        <div className="fixed top-20 right-4 md:right-8 z-50 w-[420px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)] bg-white rounded-2xl shadow-2xl border border-neutral-200 flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-neutral-100">
            <div className="flex items-center gap-2">
              <Bell size={15} className="text-purple-600" />
              <h2 className="text-sm font-semibold text-neutral-900">Auf Warteliste setzen</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="text-neutral-400 hover:text-neutral-700 -mr-1"
              title="Schließen"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-3">
            <p className="text-[11px] text-neutral-500 leading-tight">
              Erscheint unter <strong>Reservierungen</strong> mit Status „wartet". Bei Wareneingang dort mit 1 Klick benachrichtigen.
            </p>

            {rows.map((r, idx) => (
              <div key={r.id} className="rounded-xl border border-neutral-200 p-3 space-y-2.5 bg-neutral-50/40">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide">
                    Produkt {rows.length > 1 ? idx + 1 : ""}
                  </span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      disabled={busy}
                      className="text-neutral-400 hover:text-red-600"
                      title="Diese Zeile entfernen"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {/* LINIE */}
                <div>
                  <label className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide block mb-1">Linie</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["russisch", "usbekisch"] as Line[]).map(l => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => updateRow(r.id, { line: r.line === l ? null : l })}
                        disabled={busy}
                        className={`text-xs rounded-md px-2 py-1.5 border ${
                          r.line === l
                            ? "bg-neutral-900 text-white border-neutral-900"
                            : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100"
                        }`}
                      >
                        {l === "russisch" ? "🇷🇺 Russisch" : "🇺🇿 Usbekisch"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* LÄNGE — alle Optionen immer auswählbar (User-Wunsch 2026-05-27) */}
                <div>
                  <label className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide block mb-1">Länge</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_LENGTHS.map(cm => (
                      <button
                        key={cm}
                        type="button"
                        onClick={() => updateRow(r.id, { lengthCm: r.lengthCm === cm ? null : cm })}
                        disabled={busy}
                        className={`text-xs rounded-md px-2.5 py-1.5 border ${
                          r.lengthCm === cm
                            ? "bg-neutral-900 text-white border-neutral-900"
                            : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100"
                        }`}
                      >
                        {cm}cm
                      </button>
                    ))}
                  </div>
                </div>

                {/* METHODE */}
                <div>
                  <label className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide block mb-1">Methode</label>
                  <select
                    value={r.methodKind || ""}
                    onChange={(e) => updateRow(r.id, { methodKind: (e.target.value || null) as MethodKind | null })}
                    disabled={busy}
                    className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  >
                    <option value="">— wählen —</option>
                    {(Object.keys(METHOD_LABELS) as MethodKind[]).map(k => (
                      <option key={k} value={k}>{METHOD_LABELS[k]}</option>
                    ))}
                  </select>
                </div>

                {/* FARBE */}
                <div>
                  <label className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide block mb-1">
                    Farbe / Farbcode
                  </label>
                  <input
                    type="text"
                    value={r.color}
                    onChange={(e) => updateRow(r.id, { color: e.target.value })}
                    placeholder="z.B. COLDNESS oder 4/27T24"
                    disabled={busy}
                    className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                </div>

                {/* ETA */}
                <div>
                  <label className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide block mb-1">
                    ETA-Hinweis <span className="text-neutral-400 normal-case">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={r.etaHint}
                    onChange={(e) => updateRow(r.id, { etaHint: e.target.value })}
                    placeholder="z.B. Ende Mai"
                    disabled={busy}
                    className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                </div>

                {/* Preview */}
                {buildProductName(r) && (
                  <div className="text-[10px] text-neutral-500 italic pt-1 border-t border-neutral-200">
                    Vorschau: <span className="text-neutral-700 font-medium">{buildProductName(r)}</span>
                  </div>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() => setRows(prev => [...prev, newRow()])}
              disabled={busy}
              className="w-full text-xs px-3 py-2 rounded-lg border border-dashed border-purple-300 text-purple-700 hover:bg-purple-50 inline-flex items-center justify-center gap-1"
            >
              <Plus size={12} /> Weiteres Produkt
            </button>

            <div>
              <label className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide">
                Notiz (intern, gilt für alle Produkte)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="z.B. Kundin braucht für Hochzeit am 15.06"
                disabled={busy}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={busy}
                className={`text-xs px-3.5 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 ${
                  done
                    ? "bg-green-600 text-white"
                    : "bg-purple-600 text-white hover:bg-purple-700"
                } disabled:opacity-60`}
              >
                {done
                  ? "✓ Gespeichert"
                  : busy
                  ? "Speichere…"
                  : rows.length > 1
                  ? `${rows.length} eintragen`
                  : "Eintragen"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

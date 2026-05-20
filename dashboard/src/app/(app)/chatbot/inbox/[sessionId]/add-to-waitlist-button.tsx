"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, X, Plus, Trash2 } from "lucide-react";
import { createReservationManual } from "@/lib/actions/chat-reservations";

interface ProductRow {
  id: number;
  productName: string;
  color: string;
  method: string;
  etaHint: string;
}

function newRow(): ProductRow {
  return { id: Date.now() + Math.random(), productName: "", color: "", method: "", etaHint: "" };
}

/**
 * Button + Slide-In-Panel rechts (kein modaler Overlay, der den Chat blockiert).
 * Erlaubt MEHRERE Produkte gleichzeitig auf die Warteliste zu setzen.
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
    const validRows = rows.filter(r => r.productName.trim());
    if (validRows.length === 0) {
      alert("Bitte mindestens ein Produkt eintragen.");
      return;
    }
    setBusy(true);
    startTransition(async () => {
      try {
        for (const r of validRows) {
          const fd = new FormData();
          fd.set("session_id", sessionId);
          fd.set("product_name", r.productName.trim());
          if (r.color.trim())   fd.set("color",    r.color.trim());
          if (r.method.trim())  fd.set("method",   r.method.trim());
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
        // KEIN backdrop — der Chat bleibt lesbar und text-selectable.
        // Floating Panel oben rechts, scrollt mit der Page.
        <div className="fixed top-20 right-4 md:right-8 z-50 w-[360px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)] bg-white rounded-2xl shadow-2xl border border-neutral-200 flex flex-col">
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
              <div key={r.id} className="rounded-xl border border-neutral-200 p-3 space-y-2 bg-neutral-50/40">
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
                <input
                  value={r.productName}
                  onChange={(e) => updateRow(r.id, { productName: e.target.value })}
                  required={idx === 0}
                  placeholder="z.B. COLDNESS Russisch Tapes 65cm"
                  className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={r.color}
                    onChange={(e) => updateRow(r.id, { color: e.target.value })}
                    placeholder="Farbe (z.B. COLDNESS)"
                    className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                  <input
                    value={r.method}
                    onChange={(e) => updateRow(r.id, { method: e.target.value })}
                    placeholder="Methode"
                    className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                </div>
                <input
                  value={r.etaHint}
                  onChange={(e) => updateRow(r.id, { etaHint: e.target.value })}
                  placeholder="ETA-Hinweis (z.B. Ende Mai)"
                  className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                />
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
                  : rows.filter(r => r.productName.trim()).length > 1
                  ? `${rows.filter(r => r.productName.trim()).length} eintragen`
                  : "Eintragen"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

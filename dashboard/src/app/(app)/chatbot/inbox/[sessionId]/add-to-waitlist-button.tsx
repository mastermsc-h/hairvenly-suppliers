"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { createReservationManual } from "@/lib/actions/chat-reservations";

/**
 * Button + Dialog im Session-Header: legt manuell eine Warteliste-Reservierung
 * an. Taucht danach unter /chatbot/reservations auf, von wo aus der
 * 1-Klick-Benachrichtigen-Button beim Wareneingang verfügbar ist.
 */
export default function AddToWaitlistButton({
  sessionId,
  prefillProductName = "",
}: {
  sessionId: string;
  prefillProductName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    fd.set("session_id", sessionId);
    startTransition(async () => {
      try {
        await createReservationManual(fd);
        setDone(true);
        router.refresh();
        setTimeout(() => {
          setOpen(false);
          setDone(false);
        }, 1200);
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        title="Kundin auf Warteliste setzen — wird bei Wareneingang per 1-Klick benachrichtigt"
        className="text-xs px-3 py-1.5 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 hover:border-purple-300 inline-flex items-center gap-1 disabled:opacity-50"
      >
        <Bell size={12} /> Auf Warteliste
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-purple-600" />
                <h2 className="text-base font-semibold text-neutral-900">Auf Warteliste setzen</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="text-neutral-400 hover:text-neutral-700"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-neutral-500">
              Kundin wird unter <strong>Reservierungen</strong> gelistet. Sobald die Ware da ist,
              kannst du sie dort mit einem Klick benachrichtigen.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
                  Produkt *
                </label>
                <input
                  name="product_name"
                  required
                  defaultValue={prefillProductName}
                  placeholder="z.B. COLDNESS Russisch Tapes 65cm"
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    Farbe
                  </label>
                  <input
                    name="color"
                    placeholder="COLDNESS"
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
                    Methode
                  </label>
                  <input
                    name="method"
                    placeholder="Tapes / Bondings / Clip-Ins"
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
                  ETA-Hinweis
                </label>
                <input
                  name="eta_hint"
                  placeholder="z.B. Ende Mai, ca. 04.06.2026"
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
                  Notiz (intern)
                </label>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder="z.B. Kundin braucht für Hochzeit am 15.06"
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="text-xs px-3 py-2 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={busy}
                className={`text-xs px-4 py-2 rounded-lg font-medium inline-flex items-center gap-1 ${
                  done
                    ? "bg-green-600 text-white"
                    : "bg-purple-600 text-white hover:bg-purple-700"
                } disabled:opacity-60`}
              >
                {done ? "✓ Gespeichert" : busy ? "Speichere…" : "Auf Warteliste setzen"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

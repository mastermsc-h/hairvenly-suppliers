"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import { resetPackStats } from "@/lib/actions/pack";
import { useRouter } from "next/navigation";

export default function ResetStatsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [scope, setScope] = useState<"completed" | "all">("completed");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleReset() {
    startTransition(async () => {
      const r = await resetPackStats(confirmText, scope);
      if (r.success) {
        setResult(`✓ ${r.sessionsDeleted ?? 0} Sessions + ${r.photosDeleted ?? 0} Fotos gelöscht.`);
        setConfirmText("");
        setTimeout(() => {
          setOpen(false);
          setResult(null);
          router.refresh();
        }, 1800);
      } else {
        setResult(`✗ ${r.error ?? "Fehler"}`);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => {
          setResult(null);
          setConfirmText("");
          setScope("completed");
          setOpen(true);
        }}
        className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50 transition flex items-center gap-1"
      >
        <Trash2 size={12} />
        Statistik zurücksetzen
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="bg-red-100 rounded-full p-2 shrink-0">
                <AlertTriangle className="text-red-600" size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-neutral-900">Statistik zurücksetzen</h2>
                <p className="text-sm text-neutral-600 mt-1">
                  Diese Aktion löscht ausgewählte Pack-Sessions inkl. Scans, Fotos und Notizen.
                  Shopify-Bestellungen bleiben unangetastet. Nicht umkehrbar.
                </p>
              </div>
            </div>

            {/* Scope-Auswahl */}
            <div className="space-y-2 mb-4">
              <label className="flex items-start gap-2 p-3 rounded-lg border-2 border-neutral-200 hover:border-neutral-300 cursor-pointer has-[:checked]:border-emerald-400 has-[:checked]:bg-emerald-50">
                <input
                  type="radio"
                  name="scope"
                  value="completed"
                  checked={scope === "completed"}
                  onChange={() => setScope("completed")}
                  className="mt-1 accent-emerald-600"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-neutral-900">Nur abgeschlossene</div>
                  <div className="text-xs text-neutral-600 mt-0.5">
                    verified + shipped Sessions. Laufende Pack-Vorgänge bleiben erhalten.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-3 rounded-lg border-2 border-neutral-200 hover:border-neutral-300 cursor-pointer has-[:checked]:border-red-400 has-[:checked]:bg-red-50">
                <input
                  type="radio"
                  name="scope"
                  value="all"
                  checked={scope === "all"}
                  onChange={() => setScope("all")}
                  className="mt-1 accent-red-600"
                />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-neutral-900">Alles, auch laufende</div>
                  <div className="text-xs text-red-700 mt-0.5">
                    ⚠ MA mitten im Pack-Vorgang verlieren ihren Fortschritt.
                  </div>
                </div>
              </label>
            </div>

            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Tippe <code className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded font-mono">LÖSCHEN</code> zur Bestätigung:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="LÖSCHEN"
              autoFocus
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />

            {result && (
              <div
                className={`mt-3 text-sm rounded-lg px-3 py-2 ${
                  result.startsWith("✓") ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                }`}
              >
                {result}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-4 py-2 rounded-lg border border-neutral-300 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={handleReset}
                disabled={pending || confirmText !== "LÖSCHEN"}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {pending ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                Endgültig löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

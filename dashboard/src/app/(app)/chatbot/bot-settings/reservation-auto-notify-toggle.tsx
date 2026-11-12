"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BellRing } from "lucide-react";
import { setReservationAutoNotify } from "@/lib/actions/chatbot-settings";

type Mode = "off" | "shadow" | "live";

const OPTIONS: { v: Mode; label: string; active: string }[] = [
  { v: "off",    label: "⏸ Aus",        active: "bg-neutral-100 text-neutral-900 border-neutral-300" },
  { v: "shadow", label: "🧪 Probelauf",  active: "bg-blue-50 text-blue-900 border-blue-400" },
  { v: "live",   label: "📨 Live",       active: "bg-green-50 text-green-900 border-green-500" },
];

export default function ReservationAutoNotifyToggle({ initialMode, wouldSend }: { initialMode: Mode; wouldSend: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(initialMode);

  function choose(next: Mode) {
    if (next === mode) return;
    if (next === "live" && !confirm(
      `Automatische Benachrichtigung LIVE schalten?\n\nAb dem nächsten Lauf (Mo–Sa ca. 11 Uhr) bekommen Kundinnen automatisch eine Instagram-Nachricht, sobald ihre reservierte Variante eindeutig auf Lager ist.${wouldSend > 0 ? `\n\nAktuell wären das ${wouldSend} Reservierung(en).` : ""}`,
    )) return;
    const prev = mode;
    setMode(next);
    startTransition(async () => {
      try {
        await setReservationAutoNotify(next);
        router.refresh();
      } catch (e) {
        alert(`Fehler: ${(e as Error).message}`);
        setMode(prev);
      }
    });
  }

  return (
    <div className={`bg-white rounded-2xl border-2 shadow-sm p-4 ${mode === "live" ? "border-green-300" : mode === "shadow" ? "border-blue-200" : "border-neutral-100"}`}>
      <div className="flex items-center gap-2 mb-2">
        <BellRing size={14} className={mode === "live" ? "text-green-600" : "text-neutral-500"} />
        <h2 className="text-sm font-semibold text-neutral-900">Warteliste: automatische Benachrichtigung</h2>
      </div>
      <p className="text-xs text-neutral-600 mb-3 leading-relaxed">
        Jeden Morgen prüft der Lager-Check alle wartenden Reservierungen. Ist <strong>genau die reservierte Variante</strong>{" "}
        (Farbe, Methode, Länge/Gramm) eindeutig auf Lager, schreibt Ava der Kundin Mo–Sa gegen 11 Uhr automatisch auf Instagram
        (max. 30 Nachrichten pro Tag, eine Nachricht pro Kundin). Unklare Treffer, „unterwegs" und WhatsApp/Web bleiben bei euch (1-Klick).
      </p>
      <p className="text-xs text-neutral-600 mb-3 leading-relaxed">
        <strong>Probelauf:</strong> es wird nichts gesendet — auf{" "}
        <Link href="/chatbot/reservations" className="text-blue-600 hover:underline">Reservierungen</Link>{" "}
        steht bei jedem Eintrag, ob er automatisch benachrichtigt <em>würde</em>
        {mode === "shadow" && <> (aktuell: <strong>{wouldSend}</strong>)</>}.
      </p>
      <div className="flex gap-2">
        {OPTIONS.map(o => (
          <button
            key={o.v}
            type="button"
            onClick={() => choose(o.v)}
            disabled={pending}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border-2 transition ${
              mode === o.v ? o.active : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

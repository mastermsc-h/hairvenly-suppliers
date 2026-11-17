"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Moon } from "lucide-react";
import { setOffhoursAutosend } from "@/lib/actions/chatbot-learning";

type Mode = "off" | "shadow" | "live";

const OPTIONS: { v: Mode; label: string; active: string }[] = [
  { v: "off",    label: "⏸ Aus",        active: "bg-neutral-100 text-neutral-900 border-neutral-300" },
  { v: "shadow", label: "🧪 Probelauf",  active: "bg-blue-50 text-blue-900 border-blue-400" },
  { v: "live",   label: "📨 Live",       active: "bg-green-50 text-green-900 border-green-500" },
];

export default function OffhoursToggle({ initialMode, candidates, agreeing }: { initialMode: Mode; candidates: number; agreeing: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(initialMode);

  function choose(next: Mode) {
    if (next === mode) return;
    if (next === "live" && !confirm(
      `Abend-/Wochenend-Bot LIVE schalten?\n\nAußerhalb der Öffnungszeit (Mo–Fr vor 10 / nach 18 Uhr, Wochenende, Feiertage) beantwortet der Bot dann auch einfache Fragen zu Verfügbarkeit, Preisen und Allgemeinem selbst, die er bisher nur als Entwurf abgelegt hat.${candidates > 0 ? `\n\nProbelauf bisher: ${agreeing} von ${candidates} verglichenen Antworten deckten sich mit eurer.` : ""}`,
    )) return;
    const prev = mode;
    setMode(next);
    startTransition(async () => {
      try {
        await setOffhoursAutosend(next);
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
        <Moon size={14} className={mode === "live" ? "text-green-600" : "text-neutral-500"} />
        <h2 className="text-sm font-semibold text-neutral-900">Abend- und Wochenend-Bot</h2>
      </div>
      <p className="text-xs text-neutral-600 mb-3 leading-relaxed">
        Außerhalb der Öffnungszeit warten Kundinnen sonst bis zum nächsten Werktag. Dann darf der Bot in den sicheren Themen
        (Verfügbarkeit, Preise, Allgemeines) auch Antworten ohne Link/Lagerangabe selbst schicken. Alle anderen Sicherheitsregeln
        bleiben: keine Farbberatung, keine Salon-Preise, keine unsicheren Antworten, alle Prüfungen auf erfundene Fakten.
      </p>
      <p className="text-xs text-neutral-600 mb-3 leading-relaxed">
        <strong>Probelauf:</strong> nichts wird gesendet. Die Antwort, die er geschickt <em>hätte</em>, wird nachts mit eurer echten Antwort verglichen
        {candidates > 0
          ? <> — bisher <strong>{agreeing} von {candidates}</strong> deckungsgleich</>
          : <> — noch keine Vergleiche</>}
        {" "}(Details unter <Link href="/chatbot/lernen" className="text-blue-600 hover:underline">Bot lernt</Link>).
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
